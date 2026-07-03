"""Payroll lock/approval workflow, audit trail, statutory bonus payout."""
from __future__ import annotations

from datetime import datetime

from . import db
from .commands.ctc_breakup_logic import statutory_bonus_monthly, statutory_bonus_yearly
from .commands.payroll_governance_logic import (
    PAYROLL_STATUS_DRAFT,
    READONLY_STATUSES,
    REGENERATE_BLOCKED_STATUSES,
    TRACKED_PAYROLL_FIELDS,
    VALID_STATUSES,
    assert_status_transition,
    diff_payroll_fields,
    normalize_payroll_status,
)
from .commands.payroll_logic import payroll_earnings_factor
from .ctc_settings import load_ctc_settings
from .models.ctc_breakup import CTCBreakup
from .models.monthly_payroll import MonthlyPayroll
from .models.payroll_audit_log import PayrollAuditLog
from . import payroll_tds_service as payroll_tds


def assert_payroll_editable(row: MonthlyPayroll) -> None:
    if normalize_payroll_status(getattr(row, "status", None)) in READONLY_STATUSES:
        raise ValueError(
            f"Payroll is {normalize_payroll_status(row.status)} and cannot be edited. "
            "Reopen as draft to make changes."
        )


def assert_payroll_regeneratable(row: MonthlyPayroll) -> None:
    if normalize_payroll_status(getattr(row, "status", None)) in REGENERATE_BLOCKED_STATUSES:
        raise ValueError(
            f"Payroll is {normalize_payroll_status(row.status)} and cannot be regenerated."
        )


def snapshot_payroll_fields(row: MonthlyPayroll) -> dict:
    return {f: getattr(row, f, None) for f in TRACKED_PAYROLL_FIELDS}


def log_payroll_audit(
    row: MonthlyPayroll,
    action: str,
    actor_admin_id: int | None,
    *,
    from_status: str | None = None,
    to_status: str | None = None,
    field_changes: dict | None = None,
    comment: str | None = None,
) -> PayrollAuditLog:
    entry = PayrollAuditLog(
        payroll_id=row.id,
        action=action,
        from_status=from_status,
        to_status=to_status,
        actor_admin_id=actor_admin_id,
        field_changes=field_changes or None,
        comment=(comment or "").strip() or None,
    )
    db.session.add(entry)
    return entry


def transition_payroll_status(
    row: MonthlyPayroll,
    to_status: str,
    actor_admin_id: int | None,
    *,
    comment: str | None = None,
) -> None:
    from_status = normalize_payroll_status(row.status)
    assert_status_transition(from_status, to_status)
    to_status = normalize_payroll_status(to_status)
    if to_status == from_status:
        return

    row.status = to_status
    row.status_changed_at = datetime.now()
    row.status_changed_by_admin_id = actor_admin_id
    log_payroll_audit(
        row,
        "status_change",
        actor_admin_id,
        from_status=from_status,
        to_status=to_status,
        comment=comment,
    )


def _bonus_pct_for_ctc(ctc: CTCBreakup | None) -> float:
    policy = load_ctc_settings()
    return float(policy.get("statutory_bonus_pct", 8.33))


def compute_statutory_bonus_amount(
    admin_id: int,
    row: MonthlyPayroll,
    *,
    payout_mode: str = "monthly",
) -> float:
    ctc = CTCBreakup.query.filter_by(admin_id=admin_id).first()
    if not ctc:
        return 0.0
    basic = float(ctc.basic_salary or 0)
    da = float(ctc.dearness_allowance or 0)
    if basic <= 0 and da <= 0:
        return 0.0

    bonus_pct = _bonus_pct_for_ctc(ctc)
    mode = (payout_mode or "monthly").strip().lower()

    if mode == "annual":
        stored = float(getattr(ctc, "statutory_bonus_yearly", 0) or 0)
        amount = stored if stored > 0 else statutory_bonus_yearly(basic, da, bonus_pct)
        return round(max(0.0, amount), 2)

    stored_m = float(getattr(ctc, "statutory_bonus_monthly", 0) or 0)
    monthly = stored_m if stored_m > 0 else statutory_bonus_monthly(basic, da, bonus_pct)
    cal_days = int(row.calendar_days or 0) or 30
    payable = float(row.actual_working_days or 0)
    factor = payroll_earnings_factor(payable, cal_days) if payable > 0 else 1.0
    return round(max(0.0, monthly * factor), 2)


def apply_statutory_bonus_to_row(
    row: MonthlyPayroll,
    *,
    payout_mode: str = "monthly",
    actor_admin_id: int | None = None,
) -> float:
    assert_payroll_editable(row)
    before = snapshot_payroll_fields(row)
    amount = compute_statutory_bonus_amount(row.admin_id, row, payout_mode=payout_mode)
    row.statutory_bonus_computed = amount
    row.statutory_bonus_final = amount
    payroll_tds.recompute_payroll_deduction_totals(row)
    after = snapshot_payroll_fields(row)
    changes = diff_payroll_fields(before, after)
    log_payroll_audit(
        row,
        "statutory_bonus_run",
        actor_admin_id,
        field_changes=changes or {
            "statutory_bonus_final": {"from": before.get("statutory_bonus_final"), "to": amount}
        },
        comment=f"payout_mode={payout_mode}",
    )
    return amount


def list_payroll_audit(payroll_id: int, *, limit: int = 50) -> list[dict]:
    rows = (
        PayrollAuditLog.query.filter_by(payroll_id=payroll_id)
        .order_by(PayrollAuditLog.created_at.desc(), PayrollAuditLog.id.desc())
        .limit(limit)
        .all()
    )
    return [r.to_dict() for r in rows]
