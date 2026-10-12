"""
Helper utilities for ManagerContact: resolve emails from admin_id, exclude applicant for self-approval prevention.
"""
from sqlalchemy import func, or_

from .models.manager_model import ManagerContact
from .tenant_context import (
    DEFAULT_TENANT_ID,
    get_admin_in_tenant,
    tenant_id_for_admin,
    tenant_manager_contacts,
)


def manager_contacts_for(admin):
    """ManagerContact query limited to the employee's tenant."""
    return tenant_manager_contacts(tenant_id_for_admin(admin))


def find_manager_contact(admin):
    """Employee-specific row (user_email) first, else the circle + emp_type group row."""
    if not admin:
        return None
    contacts = manager_contacts_for(admin)
    contact = None
    if getattr(admin, "email", None):
        contact = contacts.filter_by(user_email=admin.email).first()
    if not contact:
        contact = manager_contacts_for(admin).filter_by(
            circle_name=admin.circle,
            user_type=admin.emp_type,
        ).first()
    return contact


def _contact_tenant_id(contact):
    tid = getattr(contact, "tenant_id", None)
    return int(tid) if tid is not None else DEFAULT_TENANT_ID


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


def manager_scope_matches_contact(manager_admin, contact):
    """
    Strict manager scope check:
    - manager's Admin.circle must match ManagerContact.circle_name
    - manager's Admin.emp_type must match ManagerContact.user_type (canonical)
    - if ManagerContact.user_email is set, it must match manager email
    """
    if not manager_admin or not contact:
        return False
    if not circles_equivalent(getattr(manager_admin, "circle", None), getattr(contact, "circle_name", None)):
        return False
    if not emp_types_equivalent(getattr(manager_admin, "emp_type", None), getattr(contact, "user_type", None)):
        return False
    contact_user_email = _norm_email(getattr(contact, "user_email", None))
    if contact_user_email:
        return contact_user_email == _norm_email(getattr(manager_admin, "email", None))
    return True


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

    candidates = manager_contacts_for(target_admin).filter(
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
    admin = get_admin_in_tenant(admin_id, _contact_tenant_id(contact))
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
    """
    Check if admin (or email string) is L1/L2/L3 in this contact.

    An Admin matches by id only, and only within the contact's tenant: emails are
    unique per tenant, so an email match could point at another company's manager.
    """
    if not contact:
        return False
    if hasattr(admin_or_email, "id") and getattr(admin_or_email, "id", None):
        if tenant_id_for_admin(admin_or_email) != _contact_tenant_id(contact):
            return False
        aid = admin_or_email.id
        return any(
            getattr(contact, f"{level}_admin_id", None) == aid for level in ("l1", "l2", "l3")
        )
    email = (admin_or_email or "").strip()
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
        admin = get_admin_in_tenant(admin_id, _contact_tenant_id(contact))
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
    rows = manager_contacts_for(admin).filter(
        or_(
            ManagerContact.l1_admin_id == admin_id,
            ManagerContact.l2_admin_id == admin_id,
            ManagerContact.l3_admin_id == admin_id,
        )
    ).all()
    if not rows:
        return False
    # Manager panel access is assignment-based: if user is linked as L1/L2/L3 in any
    # ManagerContact row, grant manager access. Per-employee authorization still uses
    # resolve_manager_contact_for_employee + is_manager_in_contact.
    return True


def manager_can_view_nhq_engineering_team_attendance(manager_admin):
    """NHQ + Engineering managers only: team attendance tab on Manager panel."""
    if not manager_admin:
        return False
    return circles_equivalent(
        getattr(manager_admin, "circle", None), "NHQ"
    ) and emp_types_equivalent(
        getattr(manager_admin, "emp_type", None), "Engineering"
    )
