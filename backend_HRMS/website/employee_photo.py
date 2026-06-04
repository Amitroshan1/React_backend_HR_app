"""Resolve profile photo URL for an Admin from linked Employee.photo_filename."""

from flask import url_for

from .models.emp_detail_models import Employee


def photo_url_for_admin_id(admin_id):
    if not admin_id:
        return ""
    emp = Employee.query.filter_by(admin_id=admin_id).first()
    if not emp:
        return ""
    photo_fn = (getattr(emp, "photo_filename", None) or "").strip()
    if not photo_fn:
        return ""
    try:
        return url_for("static", filename=f"uploads/{photo_fn}", _external=False)
    except Exception:
        return f"/static/uploads/{photo_fn}"


def photo_url_for_admin(admin):
    if not admin:
        return ""
    return photo_url_for_admin_id(getattr(admin, "id", None))
