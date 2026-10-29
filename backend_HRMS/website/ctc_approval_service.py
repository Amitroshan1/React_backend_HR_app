"""CTC draft-until-approve: Finance queue, optional HR/Admin steps, pack adopt."""
from __future__ import annotations

from datetime import date

from flask_jwt_extended import get_jwt

from . import db
from .ctc_settings import load_ctc_settings
from .datetime_utils import utc_now
from .models.ctc_breakup import CTCBreakup
from .models.ctc_change_request import CTCChangeRequest, PENDING_STATUSES
from .plan_features import is_accounts_role, is_finance_role, is_hr_role, is_org_admin
from .tenant_context import get_current_tenant_id, tenant_admin_ids


def approval_settings(tenant_id=None) -> dict:
    s = load_ctc_settings(tenant_id)
    threshold = s.get("require_admin_if_increment_pct_over")
    try:
        threshold = float(threshold) if threshold not in (None, "", 0, "0") else 0.0
    except (TypeError, ValueError):
        threshold = 0.0
    return {
        "require_finance_approve_ctc": bool(s.get("require_finance_approve_ctc", True)),
        "require_hr_prepare": bool(s.get("require_hr_prepare", False)),
        "require_admin_if_increment_pct_over": threshold,
        "allow_self_approve_if_dual_role": bool(s.get("allow_self_approve_if_dual_role", True)),
        "active_statutory_pack_id": s.get("active_statutory_pack_id") or None,
    }


def _claims():
    try:
        return get_jwt() or {}
    except Exception:
        return {}


def actor_is_finance(admin) -> bool:
    claims = _claims()
    if is_finance_role(claims) or is_org_admin(claims):
        return True
    emp = (getattr(admin, "emp_type", None) or "").strip().lower()
    return emp in ("finance", "finance department", "finance team", "admin")


def actor_is_hr(admin) -> bool:
    claims = _claims()
    if is_hr_role(claims) or is_org_admin(claims):
        return True
    emp = (getattr(admin, "emp_type", None) or "").strip().lower()
    return emp in ("hr", "human resource", "human resources", "admin")


def actor_is_accounts(admin) -> bool:
    claims = _claims()
    if is_accounts_role(claims) or is_org_admin(claims):
        return True
    emp = (getattr(admin, "emp_type", None) or "").strip().lower()
    return emp in ("account", "accounts", "accountant", "admin")


def actor_is_admin(admin) -> bool:
    claims = _claims()
    if is_org_admin(claims):
        return True
    emp = (getattr(admin, "emp_type", None) or "").strip().lower()
    return emp == "admin"


def can_self_approve(admin) -> bool:
    cfg = approval_settings()
    if not cfg["allow_self_approve_if_dual_role"]:
        return False
    return actor_is_finance(admin) and (actor_is_accounts(admin) or actor_is_hr(admin) or actor_is_admin(admin))


def increment_pct(old_ctc, new_ctc):
    try:
        old = float(old_ctc or 0)
        new = float(new_ctc or 0)
    except (TypeError, ValueError):
        return None
    if old <= 0:
        return None
    return round((new - old) / old * 100.0, 2)


def pending_for_employee(admin_id: int, kind: str = "employee_ctc"):
    return (
        CTCChangeRequest.query.filter(
            CTCChangeRequest.admin_id == admin_id,
            CTCChangeRequest.kind == kind,
            CTCChangeRequest.status.in_(PENDING_STATUSES),
        )
        .order_by(CTCChangeRequest.id.desc())
        .first()
    )


def pending_adopt():
    tid = get_current_tenant_id()
    q = CTCChangeRequest.query.filter(
        CTCChangeRequest.kind == "statutory_adopt",
        CTCChangeRequest.status.in_(PENDING_STATUSES),
    )
    if tid is not None:
        q = q.filter(CTCChangeRequest.tenant_id == tid)
    return q.order_by(CTCChangeRequest.id.desc()).first()


def _initial_status(admin, *, increment: float | None, kind: str) -> str:
    cfg = approval_settings()
    if not cfg["require_finance_approve_ctc"] or can_self_approve(admin):
        return "approved"
    if kind == "employee_ctc" and cfg["require_hr_prepare"] and not actor_is_hr(admin) and not actor_is_admin(admin):
        return "pending_hr"
    threshold = cfg["require_admin_if_increment_pct_over"]
    if kind == "employee_ctc" and threshold and increment is not None and increment >= threshold and not actor_is_admin(admin):
        return "pending_admin"
    return "pending_finance"


def upsert_pending(*, kind, admin_id, payload, note, effective_from, submitted_by, increment=None):
    if kind == "statutory_adopt":
        row = pending_adopt()
    else:
        row = pending_for_employee(admin_id, kind)
    if row is None:
        row = CTCChangeRequest(
            tenant_id=get_current_tenant_id(),
            admin_id=admin_id,
            kind=kind,
        )
        db.session.add(row)
    row.payload = payload
    row.note = (note or "").strip() or None
    row.effective_from = effective_from
    row.increment_pct = increment
    row.submitted_by_admin_id = submitted_by
    row.reject_reason = None
    row.decided_by_admin_id = None
    row.decided_at = None
    row.updated_at = utc_now()
    return row


def submit_employee_ctc(*, actor, admin_id, payload, note, effective_from):
    live = CTCBreakup.query.filter_by(admin_id=admin_id).first()
    old_ctc = None
    if live:
        old_ctc = live.annual_ctc_computed or live.annual_ctc
    new_ctc = payload.get("annual_ctc") or payload.get("annual_ctc_computed")
    pct = increment_pct(old_ctc, new_ctc)
    payload = {
        **payload,
        "old_annual_ctc": old_ctc,
        "admin_id": admin_id,
    }
    status = _initial_status(actor, increment=pct, kind="employee_ctc")
    row = upsert_pending(
        kind="employee_ctc",
        admin_id=admin_id,
        payload=payload,
        note=note,
        effective_from=effective_from,
        submitted_by=actor.id,
        increment=pct,
    )
    row.status = status
    if status == "approved":
        row.decided_by_admin_id = actor.id
        row.decided_at = utc_now()
    return row, status == "approved"


def submit_statutory_adopt(*, actor, pack_id, include_recalc, note=None):
    from .commands.statutory_pack import list_statutory_packs

    packs = {p["id"]: p for p in list_statutory_packs()}
    if pack_id not in packs:
        raise ValueError("Unknown statutory pack")
    recalc_ids = []
    if include_recalc:
        recalc_ids = [c["admin_id"] for c in recalc_candidates()]
    payload = {
        "pack_id": pack_id,
        "pack_label": packs[pack_id].get("label"),
        "include_recalc": bool(include_recalc),
        "recalc_admin_ids": recalc_ids,
    }
    status = _initial_status(actor, increment=None, kind="statutory_adopt")
    row = upsert_pending(
        kind="statutory_adopt",
        admin_id=None,
        payload=payload,
        note=note or f"Adopt {packs[pack_id].get('label')}",
        effective_from=date.today(),
        submitted_by=actor.id,
    )
    row.status = status
    if status == "approved":
        row.decided_by_admin_id = actor.id
        row.decided_at = utc_now()
    return row, status == "approved"


def recalc_candidates() -> list[dict]:
    """Employees whose PF wage sits above the pre-2026 ceiling (needs 25k pack review)."""
    from .commands.ctc_breakup_logic import pf_wage_monthly
    from .commands.statutory_pack import pack_for_date

    current = pack_for_date()
    cap = float(current.get("pf_wage_cap_monthly") or 25000)
    ids = list(tenant_admin_ids() or [])
    if not ids:
        return []
    rows = CTCBreakup.query.filter(CTCBreakup.admin_id.in_(ids)).all()
    out = []
    for row in rows:
        wage = pf_wage_monthly(row.basic_salary, row.dearness_allowance)
        if wage <= 15000:
            continue
        out.append({
            "admin_id": row.admin_id,
            "employee_name": getattr(row.admin, "first_name", None) if row.admin else None,
            "emp_id": getattr(row.admin, "emp_id", None) if row.admin else None,
            "pf_wage": round(wage, 2),
            "annual_ctc": row.annual_ctc_computed or row.annual_ctc,
            "needs_cap": wage > 15000,
            "over_new_cap": wage > cap,
        })
    return out


def _advance_after_hr(row):
    cfg = approval_settings()
    threshold = cfg["require_admin_if_increment_pct_over"]
    if (
        row.kind == "employee_ctc"
        and threshold
        and row.increment_pct is not None
        and row.increment_pct >= threshold
    ):
        return "pending_admin"
    return "pending_finance"


def decide(row: CTCChangeRequest, *, actor, action: str, reason: str | None, step: str):
    action = (action or "").strip().lower()
    if row.status not in PENDING_STATUSES:
        raise ValueError("This request is no longer pending")
    if action == "cancel":
        if row.submitted_by_admin_id not in (None, actor.id) and not actor_is_admin(actor):
            raise ValueError("Only the submitter can withdraw this request")
        row.status = "cancelled"
        row.decided_by_admin_id = actor.id
        row.decided_at = utc_now()
        return row, False
    if action == "reject":
        if step == "finance" and not actor_is_finance(actor):
            raise ValueError("Finance approval required")
        if step == "hr" and not actor_is_hr(actor):
            raise ValueError("HR approval required")
        if step == "admin" and not actor_is_admin(actor):
            raise ValueError("Admin approval required")
        row.status = "rejected"
        row.reject_reason = (reason or "").strip() or "Rejected"
        row.decided_by_admin_id = actor.id
        row.decided_at = utc_now()
        return row, False
    if action != "approve":
        raise ValueError("action must be approve, reject, or cancel")

    if row.status == "pending_hr":
        if not actor_is_hr(actor):
            raise ValueError("HR must approve this request first")
        row.status = _advance_after_hr(row)
        row.updated_at = utc_now()
        return row, False
    if row.status == "pending_admin":
        if not actor_is_admin(actor):
            raise ValueError("Admin must approve this increment first")
        row.status = "pending_finance"
        row.updated_at = utc_now()
        return row, False
    if row.status == "pending_finance":
        if not actor_is_finance(actor):
            raise ValueError("Finance approval required")
        row.status = "approved"
        row.decided_by_admin_id = actor.id
        row.decided_at = utc_now()
        return row, True
    if row.status == "draft":
        row.status = "pending_finance"
        return row, False
    raise ValueError("Cannot approve in the current state")


def list_queue(status: str | None = None):
    tid = get_current_tenant_id()
    q = CTCChangeRequest.query
    if tid is not None:
        q = q.filter((CTCChangeRequest.tenant_id == tid) | (CTCChangeRequest.tenant_id.is_(None)))
    if status:
        q = q.filter(CTCChangeRequest.status == status)
    else:
        q = q.filter(CTCChangeRequest.status.in_(PENDING_STATUSES))
    return q.order_by(CTCChangeRequest.id.desc()).all()


def pending_count() -> int:
    tid = get_current_tenant_id()
    q = CTCChangeRequest.query.filter(CTCChangeRequest.status.in_(("pending_finance",)))
    if tid is not None:
        q = q.filter((CTCChangeRequest.tenant_id == tid) | (CTCChangeRequest.tenant_id.is_(None)))
    return q.count()
