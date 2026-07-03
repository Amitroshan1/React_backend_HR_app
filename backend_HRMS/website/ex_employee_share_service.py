"""Create ex-employee document shares from in-memory or disk files."""
from __future__ import annotations

import os
import secrets
import uuid
from datetime import timedelta

from flask import current_app

from . import db
from .datetime_utils import utc_now
from .email import send_ex_employee_documents_email
from .models.ex_employee_documents import ExEmployeeDocFile, ExEmployeeDocShare

EX_EMPLOYEE_LINK_TTL_HOURS = 48


def _hash_token(raw_token: str) -> str:
    import hashlib

    return hashlib.sha256(raw_token.encode("utf-8")).hexdigest()


def _uploads_base_dir() -> str:
    return os.path.join(current_app.root_path, "static", "uploads", "ex_employee_docs")


def create_ex_employee_doc_share_and_email(
    *,
    recipient_email: str,
    files: list[tuple[str, bytes]],
    created_by_admin_id: int | None = None,
) -> tuple[bool, str, dict | None]:
    """
    Save files, create share row, email secure link.
    files: list of (display_name, content_bytes)
    Returns (success, message, {share_id, doc_link} or None).
    """
    to_addr = (recipient_email or "").strip().lower()
    if not to_addr or "@" not in to_addr:
        return False, "Valid recipient email is required", None
    if not files:
        return False, "At least one file is required", None

    raw_token = secrets.token_urlsafe(32)
    token_hash = _hash_token(raw_token)
    expires_at = utc_now() + timedelta(hours=EX_EMPLOYEE_LINK_TTL_HOURS)

    share = ExEmployeeDocShare(
        token_hash=token_hash,
        recipient_email=to_addr,
        expires_at=expires_at,
        created_by_admin_id=created_by_admin_id,
    )
    db.session.add(share)
    db.session.flush()

    share_dir = os.path.join(_uploads_base_dir(), str(share.id))
    os.makedirs(share_dir, exist_ok=True)
    display_names: list[str] = []

    try:
        for idx, (display_name, content) in enumerate(files):
            dn = (display_name or f"document_{idx + 1}").strip() or f"document_{idx + 1}"
            if len(dn) > 240:
                base, ext = os.path.splitext(dn)
                dn = (base[: max(1, 240 - len(ext))] + ext) if ext else dn[:240]
            disk_name = f"{uuid.uuid4().hex}_{dn}"
            rel_path = os.path.join("ex_employee_docs", str(share.id), disk_name).replace("\\", "/")
            abs_path = os.path.join(share_dir, disk_name)
            with open(abs_path, "wb") as fh:
                fh.write(content or b"")
            db.session.add(
                ExEmployeeDocFile(
                    share_id=share.id,
                    display_name=dn,
                    stored_rel_path=rel_path,
                )
            )
            display_names.append(dn)

        db.session.flush()
        base_url = current_app.config.get("BASE_URL", "").rstrip("/")
        doc_link = f"{base_url}/ex-employee-documents?t={raw_token}"

        email_ok, email_msg = send_ex_employee_documents_email(
            recipient_email=to_addr,
            doc_link=doc_link,
            document_names=display_names,
            valid_hours=EX_EMPLOYEE_LINK_TTL_HOURS,
        )
        if not email_ok:
            db.session.rollback()
            _cleanup_share_dir(share_dir)
            return False, email_msg or "Email could not be sent", None

        return True, "Documents shared", {
            "share_id": share.id,
            "doc_link": doc_link,
            "document_names": display_names,
        }
    except Exception as e:
        db.session.rollback()
        _cleanup_share_dir(share_dir)
        current_app.logger.exception("ex_employee share failed: %s", e)
        return False, str(e), None


def _cleanup_share_dir(share_dir: str) -> None:
    try:
        if os.path.isdir(share_dir):
            for fn in os.listdir(share_dir):
                try:
                    os.remove(os.path.join(share_dir, fn))
                except OSError:
                    pass
            os.rmdir(share_dir)
    except OSError:
        pass
