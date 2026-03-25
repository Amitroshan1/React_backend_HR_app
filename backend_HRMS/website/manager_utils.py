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
    """Get email for L1/L2/L3 from contact. Prefers admin_id over legacy l*_email."""
    admin_id = getattr(contact, f"{level}_admin_id", None)
    if admin_id:
        admin = Admin.query.get(admin_id)
        if admin and admin.email:
            return (admin.email or "").strip()
    return (getattr(contact, f"{level}_email", None) or "").strip()


def get_manager_emails(contact, exclude_email=None):
    """
    Return list of manager emails from ManagerContact.
    Prefers admin_id over legacy l*_email fields.
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
    email = admin_or_email.email if hasattr(admin_or_email, "email") else (admin_or_email or "").strip()
    if not email:
        return False
    emails = [e.lower() for e in get_manager_emails(contact)]
    return email.lower() in emails


def get_manager_detail(contact, level):
    """
    Get {id, name, email, mobile} for L1/L2/L3.
    Prefers linked Admin record when it exists AND is active / non-exited.
    Otherwise, returns empty values so exited managers are not surfaced in UI.
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

    # If there is no active, non-exited linked Admin, do not surface legacy details as managers
    return {
        "id": None,
        "name": "",
        "email": "",
        "mobile": "",
    }


def user_has_manager_access(admin):
    """
    Return True if admin appears as L1/L2/L3 in a ManagerContact row whose circle_name
    and user_type match the admin's circle and emp_type. Manager panel is only shown
    for the scope (circle + emp_type) where they are configured as manager.
    """
    if not admin:
        return False
    admin_id = getattr(admin, "id", None)
    email = _norm_email(getattr(admin, "email", None))
    if not admin_id and not email:
        return False
    if not _norm_circle(getattr(admin, "circle", None)):
        return False
    if not (getattr(admin, "emp_type", None) or "").strip():
        return False

    by_id = []
    if admin_id:
        by_id = [
            ManagerContact.l1_admin_id == admin_id,
            ManagerContact.l2_admin_id == admin_id,
            ManagerContact.l3_admin_id == admin_id,
        ]
    by_email = []
    if email:
        by_email = [
            ManagerContact.l1_email.isnot(None)
            & (func.lower(func.trim(ManagerContact.l1_email)) == email),
            ManagerContact.l2_email.isnot(None)
            & (func.lower(func.trim(ManagerContact.l2_email)) == email),
            ManagerContact.l3_email.isnot(None)
            & (func.lower(func.trim(ManagerContact.l3_email)) == email),
        ]
    conditions = by_id + by_email
    if not conditions:
        return False

    for contact in ManagerContact.query.filter(or_(*conditions)).all():
        if circles_equivalent(admin.circle, contact.circle_name) and emp_types_equivalent(
            admin.emp_type, contact.user_type
        ):
            return True
    return False
