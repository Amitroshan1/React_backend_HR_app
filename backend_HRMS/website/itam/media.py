"""
IT photos and receipts are files under ``tenants/{company}/itam/``.

The screens still send image data (``data:image/...;base64,...``). Saving turns that into a
file and stores the key. Reading hands back a signed link the existing ``<img>`` tags can use.
A value that is already this company's ``itam/`` key (or a signed link to one) is kept.
Older rows that still hold image data are left as they are, so current photos keep showing.
"""
from __future__ import annotations

import base64
import re
import uuid
from typing import Optional, Union
from urllib.parse import unquote, urlparse

from ..tenant_context import get_current_tenant_id
from ..upload_tenancy import split_tenant_rel, tenant_upload_path

MAX_MEDIA_BYTES = 8 * 1024 * 1024
_DATA_URL_RE = re.compile(r"^data:([^;,]+)?(;base64)?,(.*)$", re.DOTALL)
_MIME_EXT = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "application/pdf": "pdf",
}
MediaValue = Union[str, dict, None]


def _as_text(item: MediaValue) -> str:
    if isinstance(item, str):
        return item.strip()
    if isinstance(item, dict):
        return str(item.get("data") or item.get("url") or "").strip()
    return ""


def _client_key(raw: str) -> str:
    from ..secure_file_service import normalize_upload_rel

    text = raw.strip()
    if text.startswith(("http://", "https://")):
        text = urlparse(text).path or ""
    text = text.split("?", 1)[0]
    marker = "/api/files/signed/"
    if marker in text:
        text = text.split(marker, 1)[1]
    return normalize_upload_rel(unquote(text))


def _own_itam_key(raw: str, tenant_id: int) -> Optional[str]:
    key = _client_key(raw)
    pref, inner = split_tenant_rel(key)
    if pref == int(tenant_id) and inner.startswith("itam/"):
        return key
    return None


def _decode_data_url(raw: str) -> tuple[bytes, str]:
    match = _DATA_URL_RE.match(raw)
    if not match or not match.group(2):
        raise ValueError("Photo must be an uploaded image or PDF.")
    mime = (match.group(1) or "").split(";")[0].strip().lower()
    ext = _MIME_EXT.get(mime)
    if not ext:
        raise ValueError("Photo must be a JPG, PNG, WEBP, GIF, or PDF.")
    try:
        blob = base64.b64decode(match.group(3), validate=False)
    except (ValueError, TypeError) as exc:
        raise ValueError("Photo could not be read.") from exc
    if not blob:
        raise ValueError("Photo is empty.")
    if len(blob) > MAX_MEDIA_BYTES:
        raise ValueError("Photo is larger than 8 MB.")
    return blob, ext


def _write_blob(blob: bytes, ext: str, tenant_id: int, folder: str, *, durable: bool = False) -> str:
    import os

    from ..secure_file_service import static_uploads_root

    root = static_uploads_root()
    name = f"itam/{folder}/{uuid.uuid4().hex}.{ext}"
    abs_path, key = tenant_upload_path(root, name, tenant_id)
    with open(abs_path, "wb") as fh:
        fh.write(blob)
        if durable:
            fh.flush()
            os.fsync(fh.fileno())
    if durable and os.path.getsize(abs_path) != len(blob):
        os.remove(abs_path)
        raise OSError(f"Short write for {key}")
    return key


def _write_data_url(raw: str, tenant_id: int, folder: str) -> str:
    blob, ext = _decode_data_url(raw)
    return _write_blob(blob, ext, tenant_id, folder)


def persist_itam_media(value, folder: str, tenant_id: Optional[int] = None):
    """Stored key, or a list of keys. ``value`` may be one item or a list."""
    tid = int(tenant_id if tenant_id is not None else get_current_tenant_id())
    single = isinstance(value, (str, dict)) or value is None
    items = [value] if single else list(value or [])
    stored = []
    for item in items:
        raw = _as_text(item)
        if not raw:
            continue
        if raw.startswith(("http://", "https://")) and "/api/files/signed/" not in raw:
            stored.append(raw)
            continue
        if raw.startswith("data:"):
            stored.append(_write_data_url(raw, tid, folder))
            continue
        key = _own_itam_key(raw, tid)
        if key:
            stored.append(key)
    return (stored[0] if stored else None) if single else stored


def present_itam_media(value, tenant_id: Optional[int] = None):
    """Signed link for a stored key. Image data and external links pass through."""
    from ..secure_file_service import secure_public_url_for_upload

    tid = int(tenant_id if tenant_id is not None else get_current_tenant_id())
    single = isinstance(value, str)
    items = [value] if single else list(value or [])
    shown = []
    for item in items:
        raw = item.strip() if isinstance(item, str) else _as_text(item)
        if not raw:
            continue
        if raw.startswith("data:") or (
            raw.startswith(("http://", "https://")) and "/api/files/signed/" not in raw
        ):
            shown.append(raw)
            continue
        key = _own_itam_key(raw, tid)
        if not key:
            continue
        url = secure_public_url_for_upload(key)
        if url:
            shown.append(url)
    return (shown[0] if shown else None) if single else shown


def _row_tenant(row) -> int:
    from ..tenant_context import DEFAULT_TENANT_ID

    tid = getattr(row, "tenant_id", None)
    return int(tid) if tid is not None else DEFAULT_TENANT_ID


def _export_item_tenant(row) -> int:
    parent = getattr(row, "parcel_export", None)
    return _row_tenant(parent) if parent is not None else _row_tenant(row)


def _media_targets():
    from ..models.it_models import (
        ITAssetReturnRequest,
        ITAssetUnit,
        ITInventoryItem,
        ITParcelExport,
        ITParcelExportItem,
        ITParcelImport,
        ITRemovedAsset,
    )

    return (
        (ITInventoryItem, "photos_json", "inventory", _row_tenant),
        (ITInventoryItem, "receipts_json", "receipts", _row_tenant),
        (ITAssetUnit, "photos_json", "units", _row_tenant),
        (ITAssetUnit, "assignment_photos_json", "assignments", _row_tenant),
        (ITRemovedAsset, "photos_json", "removed", _row_tenant),
        (ITParcelImport, "photos_json", "parcels", _row_tenant),
        (ITParcelExport, "parcel_photos_json", "parcels", _row_tenant),
        (ITParcelExportItem, "individual_photo_json", "parcels", _export_item_tenant),
        (ITAssetReturnRequest, "photos_json", "returns", _row_tenant),
    )


def _remove_files(keys) -> None:
    import os

    from ..secure_file_service import static_uploads_root

    root = static_uploads_root()
    for key in keys:
        path = os.path.join(root, *key.split("/"))
        if os.path.isfile(path):
            os.remove(path)


def _rewrite_media_value(value, tenant_id: int, folder: str, *, apply: bool, created: list):
    """(new value, files, bytes, skipped). Files are only written when ``apply``."""
    single = isinstance(value, str)
    items = [value] if single else list(value)
    rewritten = []
    files = nbytes = skipped = 0
    for item in items:
        raw = _as_text(item)
        if not raw.startswith("data:"):
            if raw:
                rewritten.append(item if not single else raw)
            continue
        try:
            blob, ext = _decode_data_url(raw)
        except ValueError:
            skipped += 1
            rewritten.append(item)
            continue
        files += 1
        nbytes += len(blob)
        if apply:
            key = _write_blob(blob, ext, tenant_id, folder, durable=True)
            created.append(key)
            rewritten.append(key)
        else:
            rewritten.append(item)
    return (rewritten[0] if single else rewritten), files, nbytes, skipped


def _set_keeping_updated_at(row, column: str, value) -> None:
    """A data move is not an edit: send the current updated_at so onupdate does not bump it."""
    from sqlalchemy.orm.attributes import flag_modified

    setattr(row, column, value)
    if "updated_at" in row.__table__.columns:
        flag_modified(row, "updated_at")


def default_backup_dir() -> str:
    import os

    from flask import current_app

    return os.path.join(current_app.instance_path, "itam_photo_backups")


def extract_itam_data_urls(*, apply: bool = False, batch_size: int = 10, backup_dir: Optional[str] = None) -> dict:
    """
    Turn stored ``data:`` photos into ``tenants/{company}/itam/`` files.

    Dry run unless ``apply``. A photo that is not a JPG, PNG, WEBP, GIF or PDF,
    or is larger than 8 MB, stays as image data and is counted as skipped.

    Rows are read ``batch_size`` at a time and each batch is committed on its own, so a
    stopped run keeps finished batches and the next run continues with what is left.
    Before a batch is committed, every changed row's old and new value is appended to a
    backup file (``restore_itam_photos`` puts the old values back). Clears the session.
    """
    import json
    import os
    from collections import Counter
    from datetime import datetime, timezone

    from .. import db

    batch_size = max(1, int(batch_size or 10))
    counts = Counter()
    tables = {}
    backup_path = None
    backup_fh = None
    if apply:
        folder_path = backup_dir or default_backup_dir()
        os.makedirs(folder_path, exist_ok=True)
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
        backup_path = os.path.join(folder_path, f"itam_photos_{stamp}.jsonl")
        backup_fh = open(backup_path, "a", encoding="utf-8")
    try:
        for model, column, folder, owner_of in _media_targets():
            stats = tables.setdefault(f"{model.__tablename__}.{column}", Counter())
            ids = sorted(row_id for (row_id,) in db.session.query(model.id))
            for start in range(0, len(ids), batch_size):
                chunk = ids[start:start + batch_size]
                created = []
                try:
                    changed_rows = []
                    for row in sorted(model.query.filter(model.id.in_(chunk)), key=lambda r: r.id):
                        value = getattr(row, column)
                        if not value:
                            continue
                        new_value, files, nbytes, skipped = _rewrite_media_value(
                            value, owner_of(row), folder, apply=apply, created=created
                        )
                        counts["skipped"] += skipped
                        if not files:
                            continue
                        for bucket in (counts, stats):
                            bucket["rows"] += 1
                            bucket["files"] += files
                            bucket["bytes"] += nbytes
                        if apply:
                            changed_rows.append((row, value, new_value))
                    if apply and changed_rows:
                        for row, old, new in changed_rows:
                            backup_fh.write(json.dumps({
                                "table": model.__tablename__,
                                "column": column,
                                "id": row.id,
                                "old": old,
                                "new": new,
                            }) + "\n")
                            _set_keeping_updated_at(row, column, new)
                        backup_fh.flush()
                        os.fsync(backup_fh.fileno())
                        db.session.commit()
                except Exception:
                    db.session.rollback()
                    _remove_files(created)
                    raise
                finally:
                    db.session.expunge_all()
    finally:
        if backup_fh is not None:
            backup_fh.close()
            if not counts["rows"]:
                os.remove(backup_path)
                backup_path = None
    result = {
        "applied": bool(apply and counts["rows"]),
        "rows": counts["rows"],
        "files": counts["files"],
        "bytes": counts["bytes"],
        "skipped": counts["skipped"],
        "tables": {name: dict(c) for name, c in tables.items() if c["rows"]},
    }
    if backup_path:
        result["backup"] = backup_path
    return result


def restore_itam_photos(backup_path: str, *, apply: bool = False, batch_size: int = 10) -> dict:
    """
    Put back the image data saved by ``extract_itam_data_urls``.

    Only rows still holding the value the extraction wrote are restored; a row edited
    since then is counted as ``changed_since`` and left alone. The files stay on disk.
    """
    import json
    from collections import Counter

    from .. import db

    columns = {(m.__tablename__, c): m for m, c, _folder, _owner in _media_targets()}
    counts = Counter()
    pending = 0
    try:
        with open(backup_path, encoding="utf-8") as fh:
            for line in fh:
                if not line.strip():
                    continue
                entry = json.loads(line)
                model = columns.get((entry.get("table"), entry.get("column")))
                if model is None:
                    counts["unknown"] += 1
                    continue
                row = db.session.get(model, entry["id"])
                if row is None:
                    counts["missing"] += 1
                    continue
                current = getattr(row, entry["column"])
                if current == entry["old"]:
                    counts["already"] += 1
                    continue
                if current != entry["new"]:
                    counts["changed_since"] += 1
                    continue
                counts["rows"] += 1
                if apply:
                    _set_keeping_updated_at(row, entry["column"], entry["old"])
                    pending += 1
                    if pending >= batch_size:
                        db.session.commit()
                        db.session.expunge_all()
                        pending = 0
        if apply and pending:
            db.session.commit()
    except Exception:
        db.session.rollback()
        raise
    finally:
        db.session.expunge_all()
    return {
        "applied": bool(apply and counts["rows"]),
        "rows": counts["rows"],
        "changed_since": counts["changed_since"],
        "already": counts["already"],
        "missing": counts["missing"],
        "unknown": counts["unknown"],
    }
