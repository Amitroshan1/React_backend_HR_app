"""Payroll status workflow and field diff (pure functions)."""
from __future__ import annotations

PAYROLL_STATUS_DRAFT = "draft"
PAYROLL_STATUS_REVIEWED = "reviewed"
PAYROLL_STATUS_PAID = "paid"
PAYROLL_STATUS_LOCKED = "locked"

VALID_STATUSES = frozenset(
    {PAYROLL_STATUS_DRAFT, PAYROLL_STATUS_REVIEWED, PAYROLL_STATUS_PAID, PAYROLL_STATUS_LOCKED}
)

VALID_TRANSITIONS: dict[str, frozenset[str]] = {
    PAYROLL_STATUS_DRAFT: frozenset({PAYROLL_STATUS_REVIEWED}),
    PAYROLL_STATUS_REVIEWED: frozenset({PAYROLL_STATUS_DRAFT, PAYROLL_STATUS_PAID}),
    PAYROLL_STATUS_PAID: frozenset({PAYROLL_STATUS_LOCKED}),
    PAYROLL_STATUS_LOCKED: frozenset(),
}

READONLY_STATUSES = frozenset(
    {PAYROLL_STATUS_REVIEWED, PAYROLL_STATUS_PAID, PAYROLL_STATUS_LOCKED}
)
REGENERATE_BLOCKED_STATUSES = frozenset(
    {PAYROLL_STATUS_REVIEWED, PAYROLL_STATUS_PAID, PAYROLL_STATUS_LOCKED}
)

TRACKED_PAYROLL_FIELDS = (
    "epf_final",
    "esic_final",
    "ptax_final",
    "lwf_final",
    "tds_final",
    "arrears_gross_final",
    "leave_encashment_final",
    "loan_recovery_final",
    "reimbursement_final",
    "statutory_bonus_final",
    "actual_working_days",
    "gross_salary_for_month",
    "net_salary_final",
    "status",
)


def normalize_payroll_status(status: str | None) -> str:
    s = (status or PAYROLL_STATUS_DRAFT).strip().lower()
    return s if s in VALID_STATUSES else PAYROLL_STATUS_DRAFT


def assert_status_transition(from_status: str, to_status: str) -> None:
    from_s = normalize_payroll_status(from_status)
    to_s = normalize_payroll_status(to_status)
    if to_s == from_s:
        return
    allowed = VALID_TRANSITIONS.get(from_s, frozenset())
    if to_s not in allowed:
        raise ValueError(f"Cannot transition payroll from {from_s} to {to_s}")


def diff_payroll_fields(before: dict, after: dict) -> dict:
    changes = {}
    for key in TRACKED_PAYROLL_FIELDS:
        old = before.get(key)
        new = after.get(key)
        if old != new:
            changes[key] = {"from": old, "to": new}
    return changes
