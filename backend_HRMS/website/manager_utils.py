"""
Helper utilities for ManagerContact: resolve emails from admin_id, exclude applicant for self-approval prevention.
"""
from sqlalchemy import func, or_

from .models.Admin_models import Admin
from .models.manager_model import ManagerContact


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
    """Get {id, name, email, mobile} for L1/L2/L3. Prefers admin_id."""
    admin_id = getattr(contact, f"{level}_admin_id", None)
    if admin_id:
        admin = Admin.query.get(admin_id)
        if admin:
            return {
                "id": admin.id,
                "name": (admin.first_name or admin.email or ""),
                "email": (admin.email or "").strip(),
                "mobile": (admin.mobile or "").strip(),
            }
    return {
        "id": None,
        "name": (getattr(contact, f"{level}_name", None) or "").strip(),
        "email": (getattr(contact, f"{level}_email", None) or "").strip(),
        "mobile": (getattr(contact, f"{level}_mobile", None) or "").strip(),
    }


def user_has_manager_access(admin):
    """
    Return True if admin appears in any ManagerContact row as L1, L2, or L3
    (by l1/l2/l3_admin_id or legacy l1/l2/l3_email). Used as single source of truth
    for Manager panel access; emp_type is not required.
    """
    if not admin:
        return False
    admin_id = getattr(admin, "id", None)
    email = (getattr(admin, "email", None) or "").strip().lower()
    if not admin_id and not email:
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
            ManagerContact.l1_email.isnot(None) & (func.lower(ManagerContact.l1_email) == email),
            ManagerContact.l2_email.isnot(None) & (func.lower(ManagerContact.l2_email) == email),
            ManagerContact.l3_email.isnot(None) & (func.lower(ManagerContact.l3_email) == email),
        ]
    conditions = by_id + by_email
    if not conditions:
        return False
    return ManagerContact.query.filter(or_(*conditions)).first() is not None
