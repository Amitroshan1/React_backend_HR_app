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


def _write_data_url(raw: str, tenant_id: int, folder: str) -> str:
    blob, ext = _decode_data_url(raw)
    from ..secure_file_service import static_uploads_root

    root = static_uploads_root()
    name = f"itam/{folder}/{uuid.uuid4().hex}.{ext}"
    abs_path, key = tenant_upload_path(root, name, tenant_id)
    with open(abs_path, "wb") as fh:
        fh.write(blob)
    return key


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


def extract_itam_data_urls(*, apply: bool = False) -> dict:
    """
    Turn stored ``data:`` photos into ``tenants/{company}/itam/`` files.

    Dry run unless ``apply``. A photo that is not a JPG, PNG, WEBP, GIF or PDF,
    or is larger than 8 MB, stays as image data and is counted as skipped.
    """
    from collections import Counter

    from .. import db

    created = []
    counts = Counter()
    bytes_total = 0
    try:
        for model, column, folder, owner_of in _media_targets():
            for row in model.query.order_by(model.id).all():
                value = getattr(row, column)
                if not value:
                    continue
                single = isinstance(value, str)
                items = [value] if single else list(value)
                rewritten = []
                changed = False
                tenant_id = owner_of(row)
                for item in items:
                    raw = _as_text(item)
                    if not raw.startswith("data:"):
                        if raw:
                            rewritten.append(item if not single else raw)
                        continue
                    try:
                        blob, _ext = _decode_data_url(raw)
                    except ValueError:
                        counts["skipped"] += 1
                        rewritten.append(item)
                        continue
                    counts["files"] += 1
                    bytes_total += len(blob)
                    changed = True
                    if apply:
                        key = _write_data_url(raw, tenant_id, folder)
                        created.append(key)
                        rewritten.append(key)
                    else:
                        rewritten.append(item)
                if apply and changed:
                    setattr(row, column, rewritten[0] if single else rewritten)
                    counts["rows"] += 1
                elif changed:
                    counts["rows"] += 1
        if apply:
            db.session.commit()
    except Exception:
        db.session.rollback()
        if created:
            from ..secure_file_service import static_uploads_root

            root = static_uploads_root()
            import os

            for key in created:
                path = os.path.join(root, *key.split("/"))
                if os.path.isfile(path):
                    os.remove(path)
        raise
    return {
        "applied": bool(apply and counts["rows"]),
        "rows": counts["rows"],
        "files": counts["files"],
        "bytes": bytes_total,
        "skipped": counts["skipped"],
    }
