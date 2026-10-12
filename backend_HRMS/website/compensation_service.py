"""Increment cycles and compensation proposals."""
from __future__ import annotations

from datetime import date

from . import db
from .datetime_utils import utc_now
from .models.increment_cycle import IncrementCycle
from .models.salary_revision_request import SalaryRevisionRequest
from .models.Admin_models import Admin
from .manager_utils import resolve_manager_contact_for_employee, is_manager_in_contact
from .tenant_context import get_current_tenant_id, tenant_column_clause


def cycle_query(tenant_id=None):
    return IncrementCycle.query.filter(tenant_column_clause(IncrementCycle.tenant_id, tenant_id))


def list_cycles() -> list[dict]:
    rows = cycle_query().order_by(IncrementCycle.created_at.desc()).all()
    return [r.to_dict() for r in rows]


def create_cycle(data: dict, *, created_by: str) -> IncrementCycle:
    name = (data.get("name") or "").strip()
    fiscal_year = (data.get("fiscal_year") or "").strip()
    if not name or not fiscal_year:
        raise ValueError("name and fiscal_year are required")
    row = IncrementCycle(
        tenant_id=get_current_tenant_id(),
        name=name,
        fiscal_year=fiscal_year,
        status=(data.get("status") or "open").strip().lower(),
        created_by=created_by,
    )
    if data.get("window_start"):
        row.window_start = date.fromisoformat(str(data["window_start"])[:10])
    if data.get("window_end"):
        row.window_end = date.fromisoformat(str(data["window_end"])[:10])
    db.session.add(row)
    db.session.commit()
    return row


def _proposal_for_approver(approver: Admin, proposal_id: int) -> SalaryRevisionRequest:
    from .tenant_context import admin_id_in_tenant, tenant_id_for_admin

    row = db.session.get(SalaryRevisionRequest, proposal_id)
    if not row or not admin_id_in_tenant(row.admin_id, tenant_id_for_admin(approver)):
        raise ValueError("Proposal not found")
    return row


def list_proposals(
    *,
    tenant_id: int,
    status: str | None = None,
    revision_type: str | None = None,
) -> list[dict]:
    from .tenant_context import tenant_admin_ids

    q = SalaryRevisionRequest.query.filter(
        SalaryRevisionRequest.admin_id.in_(tenant_admin_ids(tenant_id))
    ).order_by(SalaryRevisionRequest.created_at.desc())
    if status and status.lower() != "all":
        q = q.filter(SalaryRevisionRequest.status == status.lower())
    if revision_type and revision_type.lower() != "all":
        q = q.filter(SalaryRevisionRequest.revision_type == revision_type.lower())
    return [r.to_dict() for r in q.limit(300).all()]


def manager_propose_increment(
    manager_admin: Admin,
    *,
    target_admin_id: int,
    proposed_annual_ctc: float,
    effective_from: date | None,
    manager_notes: str | None,
    increment_cycle_id: int | None = None,
) -> SalaryRevisionRequest:
    from .tenant_context import get_admin_in_tenant, tenant_id_for_admin

    target = get_admin_in_tenant(target_admin_id, tenant_id_for_admin(manager_admin))
    if not target:
        raise ValueError("Employee not found")
    contact = resolve_manager_contact_for_employee(target)
    if not contact or not is_manager_in_contact(contact, manager_admin):
        raise ValueError("You are not the manager for this employee")
    if increment_cycle_id is not None and not cycle_query(tenant_id_for_admin(manager_admin)).filter(
        IncrementCycle.id == increment_cycle_id
    ).first():
        raise ValueError("Increment cycle not found")

    existing = SalaryRevisionRequest.query.filter_by(
        admin_id=target_admin_id,
        status="pending",
        revision_type="increment",
    ).first()
    if existing:
        raise ValueError("A pending increment proposal already exists for this employee")

    band_err = None
    try:
        from .compensation_band_service import validate_proposed_ctc
        band_err = validate_proposed_ctc(target, proposed_annual_ctc)
    except Exception:
        band_err = None
    if band_err:
        raise ValueError(band_err)

    row = SalaryRevisionRequest(
        admin_id=target_admin_id,
        increment_cycle_id=increment_cycle_id,
        revision_type="increment",
        status="pending",
        proposed_annual_ctc=proposed_annual_ctc,
        effective_from=effective_from or date.today(),
        manager_notes=(manager_notes or "").strip() or None,
        manager_proposed_at=utc_now(),
        manager_proposed_by_admin_id=manager_admin.id,
        notes="Manager increment proposal — awaiting HR approval",
    )
    db.session.add(row)
    db.session.commit()

    try:
        from .email import send_manager_increment_proposed_email
        send_manager_increment_proposed_email(manager_admin, target, row)
    except Exception:
        pass

    return row


def hr_approve_proposal(hr_admin: Admin, proposal_id: int, *, notes: str | None = None) -> SalaryRevisionRequest:
    row = _proposal_for_approver(hr_admin, proposal_id)
    if row.status != "pending":
        raise ValueError("Proposal is not pending")
    row.hr_approved_at = utc_now()
    row.hr_approved_by_admin_id = hr_admin.id
    if notes:
        row.notes = notes.strip()
    db.session.commit()

    try:
        from .email import send_salary_revision_accounts_email
        send_salary_revision_accounts_email(row)
    except Exception:
        pass

    return row


def hr_reject_proposal(hr_admin: Admin, proposal_id: int, *, notes: str | None = None) -> SalaryRevisionRequest:
    row = _proposal_for_approver(hr_admin, proposal_id)
    row.status = "dismissed"
    row.hr_approved_at = utc_now()
    row.hr_approved_by_admin_id = hr_admin.id
    if notes:
        row.notes = notes.strip()
    db.session.commit()
    return row
