"""
Helper utilities for ManagerContact: resolve emails from admin_id, exclude applicant for self-approval prevention.
"""
from sqlalchemy import func, or_

from .models.Admin_models import Admin
from .models.manager_model import ManagerContact


def _norm_circle(value):
    return (value or "").strip().lower()


def _norm_email(value):
    return (value or "").strip().lower()


def _emp_type_canon(value):
    """
    Map common role labels to one bucket so e.g. HR, Human Resource, Human Resources match
    manager_contacts.user_type and admins.emp_type even when wording differs.
    """
    t = (value or "").strip().lower().replace("-", " ")
    t = " ".join(t.split())
    if t in ("hr", "human resource", "human resources"):
        return "hr"
    if t in ("account", "accounts", "accountant"):
        return "accounts"
    return t


def circles_equivalent(a, b):
    return _norm_circle(a) == _norm_circle(b)


def emp_types_equivalent(a, b):
    return _emp_type_canon(a) == _emp_type_canon(b)


def resolve_manager_contact_for_employee(target_admin):
    """
    Find ManagerContact for an employee: circle (trim-insensitive) + emp_type (canonical),
    prefer user_email-specific row, else group row (empty user_email).
    Used by homepage manager lookup and manager approval flows.
    """
    if not target_admin:
        return None
    circle_key = _norm_circle(getattr(target_admin, "circle", None))
    if not circle_key or not (getattr(target_admin, "emp_type", None) or "").strip():
        return None
    target_email = _norm_email(getattr(target_admin, "email", None))

    candidates = ManagerContact.query.filter(
        func.lower(func.trim(func.coalesce(ManagerContact.circle_name, ""))) == circle_key,
    ).all()

    matching = [c for c in candidates if emp_types_equivalent(c.user_type, target_admin.emp_type)]

    for c in matching:
        ue = _norm_email(c.user_email)
        if ue and ue == target_email:
            return c
    for c in matching:
        if not (c.user_email or "").strip():
            return c
    return None


def _resolve_email_from_contact(contact, level):
    """Get email for L1/L2/L3 from linked Admin only."""
    admin_id = getattr(contact, f"{level}_admin_id", None)
    if not admin_id:
        return ""
    admin = Admin.query.get(admin_id)
    if admin and admin.email:
        return (admin.email or "").strip()
    return ""


def get_manager_emails(contact, exclude_email=None):
    """
    Return list of manager emails from ManagerContact (via l*_admin_id -> Admin.email).
    Excludes exclude_email (applicant) to prevent self-approval.
    """
    if not contact:
        return []
    emails = []
    for level in ("l1", "l2", "l3"):
        email = _resolve_email_from_contact(contact, level)
        if email and email != (exclude_email or ""):
            emails.append(email)
    return list(dict.fromkeys(emails))


def is_manager_in_contact(contact, admin_or_email):
    """Check if admin (or email string) is L1/L2/L3 in this contact."""
    if not contact:
        return False
    if hasattr(admin_or_email, "id") and getattr(admin_or_email, "id", None):
        aid = admin_or_email.id
        for level in ("l1", "l2", "l3"):
            if getattr(contact, f"{level}_admin_id", None) == aid:
                return True
    email = admin_or_email.email if hasattr(admin_or_email, "email") else (admin_or_email or "").strip()
    if not email:
        return False
    emails = [e.lower() for e in get_manager_emails(contact)]
    return email.lower() in emails


def get_manager_detail(contact, level):
    """
    Get {id, name, email, mobile} for L1/L2/L3 from linked Admin only.
    Inactive/exited admins are not surfaced.
    """
    admin_id = getattr(contact, f"{level}_admin_id", None)
    if admin_id:
        admin = Admin.query.get(admin_id)
        if admin and getattr(admin, "is_active", True) and not getattr(admin, "is_exited", False):
            return {
                "id": admin.id,
                "name": (admin.first_name or admin.email or ""),
                "email": (admin.email or "").strip(),
                "mobile": (admin.mobile or "").strip(),
            }

    return {
        "id": None,
        "name": "",
        "email": "",
        "mobile": "",
    }


def user_has_manager_access(admin):
    """
    Return True if admin is configured as L1/L2/L3 on any ManagerContact row (l*_admin_id only).

    Authorization for each employee is enforced separately via resolve_manager_contact_for_employee
    + is_manager_in_contact.
    """
    if not admin:
        return False
    admin_id = getattr(admin, "id", None)
    if not admin_id:
        return False
    row = ManagerContact.query.filter(
        or_(
            ManagerContact.l1_admin_id == admin_id,
            ManagerContact.l2_admin_id == admin_id,
            ManagerContact.l3_admin_id == admin_id,
        )
    ).first()
    return row is not None
