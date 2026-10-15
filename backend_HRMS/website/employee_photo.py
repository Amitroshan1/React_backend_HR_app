"""Resolve profile photo URL for an Admin from linked Employee.photo_filename."""

from flask import g, has_request_context

from . import db
from .models.emp_detail_models import Employee
from .secure_file_service import secure_public_url_for_upload

_CACHE_KEY = "_admin_photo_filenames"
_CHUNK = 1000


def prime_photo_urls(admin_ids):
    """Load photo filenames for many admins in one query; lookups later in this request reuse them."""
    if not has_request_context():
        return
    cache = g.setdefault(_CACHE_KEY, {})
    missing = sorted({int(i) for i in admin_ids if i} - cache.keys())
    for start in range(0, len(missing), _CHUNK):
        chunk = missing[start:start + _CHUNK]
        found = dict(
            db.session.query(Employee.admin_id, Employee.photo_filename)
            .filter(Employee.admin_id.in_(chunk))
            .all()
        )
        for admin_id in chunk:
            cache[admin_id] = found.get(admin_id)


def photo_url_for_admin_id(admin_id):
    if not admin_id:
        return ""
    cache = g.get(_CACHE_KEY) if has_request_context() else None
    if cache is not None and int(admin_id) in cache:
        photo_fn = (cache[int(admin_id)] or "").strip()
    else:
        emp = Employee.query.filter_by(admin_id=admin_id).first()
        if not emp:
            return ""
        photo_fn = (getattr(emp, "photo_filename", None) or "").strip()
    if not photo_fn:
        return ""
    # Signed URL — works in <img src> without exposing bare /static/uploads/
    return secure_public_url_for_upload(photo_fn)


def photo_url_for_admin(admin):
    if not admin:
        return ""
    return photo_url_for_admin_id(getattr(admin, "id", None))
