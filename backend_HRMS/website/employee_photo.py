"""Resolve profile photo URL for an Admin from linked Employee.photo_filename."""

from .models.emp_detail_models import Employee
from .secure_file_service import secure_public_url_for_upload


def photo_url_for_admin_id(admin_id):
    if not admin_id:
        return ""
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
