"""Company KYB invite + public form (hashed tokens, no JWT)."""
from __future__ import annotations

import hashlib
import json
import os
import re
import secrets
from datetime import timedelta

from flask import current_app
from werkzeug.utils import secure_filename

from . import db
from .commands.kyb_identity import (
    ALLOWED_CONTENT_TYPES,
    DOC_TYPES,
    INVALID_LINK_MESSAGE,
    MAX_FILE_BYTES,
    MAX_FILES,
    assert_identity_set,
    normalize_entity_type,
    required_doc_types,
    sniff_file_type,
    validate_pan,
)
from .datetime_utils import utc_now
from .models.tenant import Tenant
from .models.tenant_kyb import TenantKybDocument, TenantKybInvite, TenantKybProfile

INVITE_TTL_DAYS = 7
EDITABLE_STATUSES = frozenset({"sent", "in_progress", "needs_fix"})
LIVE_STATUSES = frozenset({"sent", "in_progress", "submitted", "needs_fix", "verified"})


class KybError(Exception):
    def __init__(self, message: str, *, status_code: int = 400):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def _hash_token(raw: str) -> str:
    return hashlib.sha256((raw or "").encode("utf-8")).hexdigest()


def public_site_base() -> str:
    """Customer-facing origin for KYB links (test or live). Does not change login BASE_URL."""
    for key in ("KYB_PUBLIC_BASE_URL", "PUBLIC_APP_URL", "BASE_URL"):
        raw = (current_app.config.get(key) or "").strip().rstrip("/")
        if raw.startswith(("http://", "https://")):
            return raw
    return ""


def kyb_link(raw_token: str) -> str:
    base = public_site_base()
    return f"{base}/company-kyb?t={raw_token}"


def _invite_for_token(raw_token: str) -> TenantKybInvite | None:
    token = (raw_token or "").strip()
    if not token or len(token) > 128:
        return None
    return TenantKybInvite.query.filter_by(token_hash=_hash_token(token)).first()


def _require_invite(raw_token: str, *, allow_submitted: bool = False) -> TenantKybInvite:
    invite = _invite_for_token(raw_token)
    if invite is None:
        raise KybError(INVALID_LINK_MESSAGE, status_code=404)
    now = utc_now()
    if invite.status in ("cancelled", "expired"):
        raise KybError(INVALID_LINK_MESSAGE, status_code=404)
    if invite.expires_at and invite.expires_at < now and invite.status not in ("submitted", "verified"):
        invite.status = "expired"
        db.session.commit()
        raise KybError(INVALID_LINK_MESSAGE, status_code=404)
    if invite.status == "verified":
        if allow_submitted:
            return invite
        raise KybError("This onboarding form is already verified.", status_code=409)
    if invite.status == "submitted" and not allow_submitted:
        raise KybError("Details are already submitted. Wait for the review email.", status_code=409)
    if invite.status not in EDITABLE_STATUSES and not allow_submitted:
        raise KybError(INVALID_LINK_MESSAGE, status_code=404)
    return invite


def _tenant(invite: TenantKybInvite) -> Tenant:
    tenant = db.session.get(Tenant, invite.tenant_id)
    if tenant is None:
        raise KybError(INVALID_LINK_MESSAGE, status_code=404)
    return tenant


def _profile(tenant_id: int) -> TenantKybProfile:
    row = TenantKybProfile.query.filter_by(tenant_id=tenant_id).first()
    if row is None:
        row = TenantKybProfile(tenant_id=tenant_id)
        db.session.add(row)
        db.session.flush()
    return row


def _identifier_taken(*, field: str, value: str | None, tenant_id: int) -> bool:
    if not value:
        return False
    q = TenantKybProfile.query.filter(getattr(TenantKybProfile, field) == value)
    q = q.filter(TenantKybProfile.tenant_id != tenant_id)
    for row in q.all():
        other = db.session.get(Tenant, row.tenant_id)
        if other is None:
            continue
        if (other.status or "").lower() == "cancelled":
            continue
        return True
    return False


def issue_kyb_invite(*, tenant: Tenant, to_email: str, actor_id=None) -> tuple[TenantKybInvite, str]:
    email = (to_email or "").strip().lower()
    if not email or "@" not in email or len(email) > 200:
        raise KybError("A valid onboarding email is required")
    kyc = (tenant.kyc_status or "").strip().lower()
    if kyc in ("submitted", "verified"):
        raise KybError("KYB is already submitted or verified", status_code=409)
    live = (
        TenantKybInvite.query.filter_by(tenant_id=tenant.id)
        .filter(TenantKybInvite.status.in_(tuple(LIVE_STATUSES)))
        .order_by(TenantKybInvite.id.desc())
        .all()
    )
    revision = 1
    for old in live:
        if old.status in ("sent", "in_progress", "needs_fix"):
            old.status = "cancelled"
            old.token_hash = hashlib.sha256(os.urandom(32)).hexdigest()
        revision = max(revision, int(old.revision or 1) + 1)
    raw = secrets.token_urlsafe(32)
    invite = TenantKybInvite(
        tenant_id=tenant.id,
        token_hash=_hash_token(raw),
        sent_to_email=email,
        sent_by_admin_id=int(actor_id) if actor_id not in (None, "") else None,
        status="sent",
        revision=revision,
        expires_at=utc_now() + timedelta(days=INVITE_TTL_DAYS),
    )
    db.session.add(invite)
    tenant.kyc_status = "invite_sent"
    db.session.flush()
    return invite, raw


def public_context(raw_token: str) -> dict:
    invite = _require_invite(raw_token, allow_submitted=True)
    tenant = _tenant(invite)
    if invite.opened_at is None:
        invite.opened_at = utc_now()
        db.session.commit()
    profile = TenantKybProfile.query.filter_by(tenant_id=tenant.id).first()
    docs = (
        TenantKybDocument.query.filter_by(tenant_id=tenant.id, invite_id=invite.id)
        .order_by(TenantKybDocument.id.asc())
        .all()
    )
    read_only = invite.status in ("submitted", "verified")
    profile_dict = profile.to_public_dict() if profile else TenantKybProfile().to_public_dict()
    profile_dict.update({
        "company_name": tenant.name or "",
        "contact_email": tenant.contact_email or "",
        "country": tenant.country or "",
    })
    return {
        "success": True,
        "company_name": tenant.name,
        "company": {
            "name": tenant.name or "",
            "slug": tenant.slug or "",
            "plan": (tenant.plan or "essential").lower(),
            "plan_label": tenant.plan_label(),
            "contact_email": tenant.contact_email or "",
            "country": tenant.country or "",
        },
        "countries": ["India", "USA", "Uganda", "UAE", "Dubai", "China"],
        "read_only": read_only,
        "already_submitted": invite.status in ("submitted", "verified"),
        "invite": invite.to_public_meta(),
        "review_note": (invite.review_note or "") if invite.status == "needs_fix" else "",
        "profile": profile_dict,
        "documents": [d.to_public_dict() for d in docs],
        "entity_types": [
            {"id": "pvt_ltd", "label": "Private Limited"},
            {"id": "public_ltd", "label": "Public Limited"},
            {"id": "opc", "label": "One Person Company"},
            {"id": "llp", "label": "LLP"},
            {"id": "partnership", "label": "Partnership"},
            {"id": "proprietorship", "label": "Proprietorship"},
            {"id": "other", "label": "Other"},
        ],
        "doc_types": [
            {"id": "coi", "label": "Certificate of Incorporation / deed"},
            {"id": "gst_cert", "label": "GST certificate"},
            {"id": "company_pan", "label": "Company PAN"},
            {"id": "authorization", "label": "Authorization letter"},
            {"id": "cancelled_cheque", "label": "Cancelled cheque (optional)"},
        ],
    }


def _sync_customer_shell(tenant: Tenant) -> None:
    from .models.deployed_customer import DeployedCustomer

    customer = DeployedCustomer.query.filter_by(slug=tenant.slug).first()
    if customer is None:
        return
    customer.company_name = tenant.name
    customer.contact_email = tenant.contact_email
    customer.country = tenant.country


def _apply_company_shell(tenant: Tenant, payload: dict) -> None:
    if payload.get("company_name") is not None:
        name = str(payload.get("company_name") or "").strip()[:200]
        if not name:
            raise KybError("Company name is required")
        tenant.name = name
    if payload.get("contact_email") is not None:
        email = str(payload.get("contact_email") or "").strip().lower()[:200]
        if email and "@" not in email:
            raise KybError("Contact email is invalid")
        tenant.contact_email = email or None
    if payload.get("country") is not None:
        country = str(payload.get("country") or "").strip()[:100]
        tenant.country = country or None
    _sync_customer_shell(tenant)


def save_profile(raw_token: str, data: dict) -> dict:
    invite = _require_invite(raw_token)
    tenant = _tenant(invite)
    payload = data or {}
    payload.pop("plan", None)
    payload.pop("slug", None)
    payload.pop("plan_label", None)
    _apply_company_shell(tenant, payload)
    row = _profile(tenant.id)
    if payload.get("legal_name") is not None:
        name = str(payload.get("legal_name") or "").strip()[:200]
        row.legal_name = name or None
    if payload.get("trade_name") is not None:
        row.trade_name = str(payload.get("trade_name") or "").strip()[:200] or None
    if payload.get("entity_type"):
        row.entity_type = normalize_entity_type(payload.get("entity_type"))
    if "registered_address" in payload:
        row.registered_address = str(payload.get("registered_address") or "").strip()[:500] or None
    if "signatory_name" in payload:
        row.signatory_name = str(payload.get("signatory_name") or "").strip()[:150] or None
    if "signatory_designation" in payload:
        row.signatory_designation = str(payload.get("signatory_designation") or "").strip()[:120] or None
    if "signatory_mobile" in payload:
        mobile = re.sub(r"\D+", "", str(payload.get("signatory_mobile") or ""))[:15]
        row.signatory_mobile = mobile or None
    if "signatory_email" in payload:
        email = str(payload.get("signatory_email") or "").strip().lower()[:200]
        if email and "@" not in email:
            raise KybError("Signatory email is invalid")
        row.signatory_email = email or None
    if "gst_exempt_reason" in payload:
        row.gst_exempt_reason = str(payload.get("gst_exempt_reason") or "").strip()[:200] or None
    try:
        if "pan" in payload:
            row.pan = validate_pan(payload.get("pan"))
        if "gstin" in payload or "cin" in payload or "llpin" in payload or "pan" in payload:
            from .commands.kyb_identity import validate_cin, validate_gstin, validate_llpin

            if "gstin" in payload:
                row.gstin = validate_gstin(payload.get("gstin"))
            if "cin" in payload:
                row.cin = validate_cin(payload.get("cin"))
            if "llpin" in payload:
                row.llpin = validate_llpin(payload.get("llpin"))
        if "signatory_pan" in payload:
            row.signatory_pan = validate_pan(payload.get("signatory_pan"))
    except ValueError as exc:
        raise KybError(str(exc)) from exc
    if _identifier_taken(field="gstin", value=row.gstin, tenant_id=tenant.id):
        raise KybError("This GSTIN is already registered", status_code=409)
    if _identifier_taken(field="pan", value=row.pan, tenant_id=tenant.id):
        raise KybError("This company PAN is already registered", status_code=409)
    if invite.status == "sent":
        invite.status = "in_progress"
        tenant.kyc_status = "in_progress"
    invite.updated_at = utc_now()
    db.session.commit()
    return public_context(raw_token)


def _uploads_abs(storage_key: str) -> str:
    from .secure_file_service import private_uploads_root

    root = private_uploads_root()
    abs_path = os.path.abspath(os.path.join(root, *storage_key.split("/")))
    if not abs_path.startswith(root + os.sep):
        raise KybError("Invalid storage path")
    os.makedirs(os.path.dirname(abs_path), exist_ok=True)
    return abs_path


def save_document(raw_token: str, *, doc_type: str, file_storage) -> dict:
    invite = _require_invite(raw_token)
    tenant = _tenant(invite)
    kind = str(doc_type or "").strip().lower()
    if kind not in DOC_TYPES:
        raise KybError("Unknown document type")
    if file_storage is None or not getattr(file_storage, "filename", None):
        raise KybError("Choose a file to upload")
    count = TenantKybDocument.query.filter_by(tenant_id=tenant.id, invite_id=invite.id).count()
    existing_same = TenantKybDocument.query.filter_by(
        tenant_id=tenant.id, invite_id=invite.id, doc_type=kind
    ).first()
    if count >= MAX_FILES and existing_same is None:
        raise KybError(f"You can upload at most {MAX_FILES} files")
    blob = file_storage.read(MAX_FILE_BYTES + 1)
    if not blob:
        raise KybError("File is empty")
    if len(blob) > MAX_FILE_BYTES:
        raise KybError("Each file must be 8 MB or smaller")
    try:
        content_type = sniff_file_type(blob[:16], file_storage.filename)
    except ValueError as exc:
        raise KybError(str(exc)) from exc
    if content_type not in ALLOWED_CONTENT_TYPES:
        raise KybError("Upload PDF, JPG, or PNG only")
    digest = hashlib.sha256(blob).hexdigest()
    safe_name = secure_filename(file_storage.filename) or f"{kind}.bin"
    storage_key = f"tenants/{tenant.id}/kyb/{invite.id}/{kind}_{secrets.token_hex(8)}_{safe_name}"[:380]
    path = _uploads_abs(storage_key)
    with open(path, "wb") as fh:
        fh.write(blob)
    if existing_same is not None:
        try:
            old = _uploads_abs(existing_same.storage_key)
            if os.path.isfile(old):
                os.remove(old)
        except OSError:
            pass
        existing_same.storage_key = storage_key
        existing_same.original_filename = safe_name[:255]
        existing_same.content_type = content_type
        existing_same.size_bytes = len(blob)
        existing_same.sha256 = digest
        existing_same.invite_revision = invite.revision
        existing_same.uploaded_at = utc_now()
    else:
        db.session.add(TenantKybDocument(
            tenant_id=tenant.id,
            invite_id=invite.id,
            doc_type=kind,
            storage_key=storage_key,
            original_filename=safe_name[:255],
            content_type=content_type,
            size_bytes=len(blob),
            sha256=digest,
            invite_revision=invite.revision,
        ))
    if invite.status == "sent":
        invite.status = "in_progress"
        tenant.kyc_status = "in_progress"
    db.session.commit()
    return public_context(raw_token)


def delete_document(raw_token: str, doc_id: int) -> dict:
    invite = _require_invite(raw_token)
    tenant = _tenant(invite)
    row = TenantKybDocument.query.filter_by(id=int(doc_id), tenant_id=tenant.id, invite_id=invite.id).first()
    if row is None:
        raise KybError("Document not found", status_code=404)
    try:
        path = _uploads_abs(row.storage_key)
        if os.path.isfile(path):
            os.remove(path)
    except OSError:
        pass
    db.session.delete(row)
    db.session.commit()
    return public_context(raw_token)


def _auto_check(profile: TenantKybProfile, docs: list[TenantKybDocument]) -> dict:
    present = {d.doc_type for d in docs}
    has_gstin = bool(profile.gstin)
    required = []
    missing = []
    try:
        required = list(required_doc_types(profile.entity_type or "other", has_gstin=has_gstin))
        missing = [d for d in required if d not in present]
        ids = assert_identity_set(
            entity_type=profile.entity_type or "other",
            pan=profile.pan,
            gstin=profile.gstin,
            cin=profile.cin,
            llpin=profile.llpin,
            gst_exempt_reason=profile.gst_exempt_reason or "",
        )
        identity_ok = True
        identity_error = ""
    except ValueError as exc:
        ids = {}
        identity_ok = False
        identity_error = str(exc)
    from .commands.kyb_registry import enrich_registry

    registry = enrich_registry(profile)
    gst_ok = (not profile.gstin) or bool(registry.get("gst", {}).get("checksum_ok"))
    mca_ok = (not profile.cin) or bool(registry.get("mca", {}).get("format_ok"))
    return {
        "identity_ok": identity_ok,
        "identity_error": identity_error,
        "gstin_format_ok": bool(profile.gstin) or bool(profile.gst_exempt_reason),
        "gstin_checksum_ok": gst_ok,
        "cin_format_ok": mca_ok,
        "pan_format_ok": bool(profile.pan),
        "required_docs": required,
        "missing_docs": missing,
        "ids": {k: bool(v) for k, v in ids.items()} if identity_ok else {},
        "registry": registry,
    }


def submit_kyb(raw_token: str) -> dict:
    invite = _require_invite(raw_token)
    tenant = _tenant(invite)
    profile = TenantKybProfile.query.filter_by(tenant_id=tenant.id).first()
    if profile is None:
        raise KybError("Fill company details before submitting")
    if not (tenant.name or "").strip():
        raise KybError("Company name is required")
    if not (tenant.contact_email or "").strip() or "@" not in (tenant.contact_email or ""):
        raise KybError("Company contact email is required")
    if not (tenant.country or "").strip():
        raise KybError("Country is required")
    if not (profile.legal_name or "").strip():
        raise KybError("Legal name is required")
    if not (profile.signatory_name or "").strip():
        raise KybError("Authorized signatory name is required")
    if not (profile.signatory_email or "").strip() or "@" not in (profile.signatory_email or ""):
        raise KybError("Authorized signatory email is required")
    if _identifier_taken(field="gstin", value=profile.gstin, tenant_id=tenant.id):
        raise KybError("This GSTIN is already registered", status_code=409)
    if _identifier_taken(field="pan", value=profile.pan, tenant_id=tenant.id):
        raise KybError("This company PAN is already registered", status_code=409)
    docs = TenantKybDocument.query.filter_by(tenant_id=tenant.id, invite_id=invite.id).all()
    checks = _auto_check(profile, docs)
    if not checks["identity_ok"]:
        raise KybError(checks["identity_error"] or "Government IDs are incomplete")
    if checks["missing_docs"]:
        raise KybError("Upload all required documents: " + ", ".join(checks["missing_docs"]))
    invite.status = "submitted"
    invite.submitted_at = utc_now()
    invite.auto_check_json = json.dumps(checks)
    tenant.kyc_status = "submitted"
    db.session.commit()
    notify_kyb_submitted(tenant, invite)
    return public_context(raw_token)


def _latest_invite(tenant_id: int) -> TenantKybInvite | None:
    return (
        TenantKybInvite.query.filter_by(tenant_id=tenant_id)
        .order_by(TenantKybInvite.id.desc())
        .first()
    )


def registry_manager_admins():
    """Platform Super Admins on tenant 1 (optional CUSTOMER_REGISTRY_EMAILS allow-list)."""
    import os

    from .models.Admin_models import Admin
    from .plan_features import is_super_admin_emp_type
    from .tenant_context import DEFAULT_TENANT_ID

    rows = Admin.query.filter(
        db.or_(Admin.tenant_id == DEFAULT_TENANT_ID, Admin.tenant_id.is_(None))
    ).all()
    allowed_raw = (os.getenv("CUSTOMER_REGISTRY_EMAILS") or os.getenv("DEPLOYMENT_GUIDE_EMAILS") or "").strip()
    allowed = {e.strip().lower() for e in allowed_raw.split(",") if e.strip()} if allowed_raw else None
    out = []
    for admin in rows:
        if not is_super_admin_emp_type(getattr(admin, "emp_type", "") or ""):
            continue
        email = (admin.email or "").strip().lower()
        if allowed is not None and email not in allowed:
            continue
        out.append(admin)
    return out


def notify_kyb_submitted(tenant: Tenant, invite: TenantKybInvite) -> None:
    from flask import current_app

    from .models.notification import Notification

    title = f"KYB submitted: {tenant.name}"
    body = "Company documents are ready for review."
    for admin in registry_manager_admins():
        existing = Notification.query.filter_by(
            recipient_admin_id=admin.id,
            notif_type="tenant_kyb",
            entity_type="tenant",
            entity_id=tenant.id,
            is_read=False,
        ).first()
        if existing:
            existing.title = title
            existing.body = body
            existing.created_at = utc_now()
            continue
        db.session.add(Notification(
            recipient_admin_id=admin.id,
            notif_type="tenant_kyb",
            title=title,
            body=body,
            entity_type="tenant",
            entity_id=tenant.id,
        ))
    try:
        db.session.commit()
    except Exception:
        db.session.rollback()
        current_app.logger.warning("KYB notification persist failed", exc_info=True)
        return
    try:
        from .email import send_company_kyb_submitted_ops_email

        emails = [a.email for a in registry_manager_admins() if (a.email or "").strip()]
        send_company_kyb_submitted_ops_email(
            to_emails=emails,
            company_name=tenant.name,
            tenant_id=tenant.id,
        )
    except Exception:
        current_app.logger.warning("KYB ops email failed", exc_info=True)


def _mark_kyb_notifications_read(tenant_id: int) -> None:
    from .models.notification import Notification

    Notification.query.filter_by(
        notif_type="tenant_kyb",
        entity_type="tenant",
        entity_id=int(tenant_id),
        is_read=False,
    ).update({"is_read": True}, synchronize_session=False)


def kyb_review_payload(tenant: Tenant) -> dict:
    invite = _latest_invite(tenant.id)
    profile = TenantKybProfile.query.filter_by(tenant_id=tenant.id).first()
    docs = []
    checks = {}
    if invite:
        docs = (
            TenantKybDocument.query.filter_by(tenant_id=tenant.id, invite_id=invite.id)
            .order_by(TenantKybDocument.id.asc())
            .all()
        )
        if invite.auto_check_json:
            try:
                checks = json.loads(invite.auto_check_json)
            except (TypeError, ValueError):
                checks = {}
        if not checks and profile:
            checks = _auto_check(profile, docs)
    return {
        "success": True,
        "tenant": tenant.to_dict(),
        "invite": invite.to_public_meta() if invite else None,
        "review_note": (invite.review_note if invite else "") or "",
        "profile": profile.to_public_dict() if profile else {},
        "documents": [d.to_public_dict() for d in docs],
        "auto_check": checks or {},
        "can_approve": (tenant.kyc_status or "") == "submitted" and (invite.status if invite else "") == "submitted",
        "can_request_changes": (tenant.kyc_status or "") in ("submitted", "needs_fix"),
    }


def approve_kyb(*, tenant: Tenant, actor_id=None) -> dict:
    invite = _latest_invite(tenant.id)
    if (tenant.kyc_status or "") == "verified" and (tenant.status or "") == "active":
        return kyb_review_payload(tenant)
    if invite is None or invite.status != "submitted" or (tenant.kyc_status or "") != "submitted":
        raise KybError("Nothing to approve. The company must submit KYB first.", status_code=409)
    profile = TenantKybProfile.query.filter_by(tenant_id=tenant.id).first()
    docs = TenantKybDocument.query.filter_by(tenant_id=tenant.id, invite_id=invite.id).all()
    checks = _auto_check(profile, docs) if profile else {}
    if not checks.get("identity_ok") or checks.get("missing_docs"):
        raise KybError(
            checks.get("identity_error") or "Documents or IDs are incomplete. Request changes instead."
        )
    invite.status = "verified"
    invite.reviewer_admin_id = int(actor_id) if actor_id not in (None, "") else None
    invite.reviewed_at = utc_now()
    tenant.kyc_status = "verified"
    tenant.status = "active"
    from .models.deployed_customer import DeployedCustomer

    customer = DeployedCustomer.query.filter_by(slug=tenant.slug).first()
    if customer is not None:
        customer.status = "active"
    _mark_kyb_notifications_read(tenant.id)
    db.session.commit()
    return kyb_review_payload(tenant)


def request_kyb_changes(*, tenant: Tenant, note: str, actor_id=None) -> tuple[dict, str]:
    text = (note or "").strip()
    if len(text) < 8:
        raise KybError("Explain what to fix (at least 8 characters).")
    invite = _latest_invite(tenant.id)
    if invite is None or invite.status not in ("submitted", "needs_fix"):
        raise KybError("KYB is not waiting for review.", status_code=409)
    raw = secrets.token_urlsafe(32)
    invite.token_hash = _hash_token(raw)
    invite.status = "needs_fix"
    invite.review_note = text[:2000]
    invite.reviewer_admin_id = int(actor_id) if actor_id not in (None, "") else None
    invite.reviewed_at = utc_now()
    invite.expires_at = utc_now() + timedelta(days=INVITE_TTL_DAYS)
    invite.revision = int(invite.revision or 1) + 1
    tenant.kyc_status = "needs_fix"
    tenant.status = "provisioning"
    from .models.deployed_customer import DeployedCustomer

    customer = DeployedCustomer.query.filter_by(slug=tenant.slug).first()
    if customer is not None:
        customer.status = "provisioning"
    _mark_kyb_notifications_read(tenant.id)
    db.session.commit()
    try:
        from .email import send_company_kyb_changes_email

        send_company_kyb_changes_email(
            to_email=invite.sent_to_email,
            company_name=tenant.name,
            raw_token=raw,
            note=text,
        )
    except Exception:
        from flask import current_app

        current_app.logger.warning("KYB changes email failed", exc_info=True)
    payload = kyb_review_payload(tenant)
    payload["invite_url"] = kyb_link(raw)
    return payload, raw


def kyb_document_for_admin(*, tenant: Tenant, doc_id: int) -> TenantKybDocument:
    row = TenantKybDocument.query.filter_by(id=int(doc_id), tenant_id=tenant.id).first()
    if row is None:
        raise KybError("Document not found", status_code=404)
    return row


def kyb_document_abs_path(row: TenantKybDocument) -> str:
    path = _uploads_abs(row.storage_key)
    if not os.path.isfile(path):
        raise KybError("File is missing on disk", status_code=404)
    return path
