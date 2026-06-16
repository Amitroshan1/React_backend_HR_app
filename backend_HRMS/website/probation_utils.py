"""Shared probation date math, statuses, and helpers."""
from datetime import date, timedelta

from .commands.leave_accrual_schedule import PROBATION_MONTHS, probation_end_date
from .datetime_utils import isoformat_api

REMINDER_DAYS_BEFORE = 15
FOLLOWUP_DAYS_BEFORE = 7
RECENT_CONFIRMATION_DAYS = 60

STATUS_REMINDER_SENT = "reminder_sent"
STATUS_MANAGER_SUBMITTED = "manager_submitted"
STATUS_HR_CONFIRMED = "hr_confirmed"
STATUS_HR_EXTENDED = "hr_extended"
STATUS_HR_FAILED = "hr_failed"

MANAGER_REC_CONFIRM = "confirm"
MANAGER_REC_EXTEND = "extend"
MANAGER_REC_NOT_RECOMMEND = "not_recommend"
MANAGER_RECOMMENDATIONS = {
    MANAGER_REC_CONFIRM,
    MANAGER_REC_EXTEND,
    MANAGER_REC_NOT_RECOMMEND,
}

HR_DECISION_CONFIRMED = "confirmed"
HR_DECISION_EXTENDED = "extended"
HR_DECISION_FAILED = "failed"
HR_DECISIONS = {HR_DECISION_CONFIRMED, HR_DECISION_EXTENDED, HR_DECISION_FAILED}

TERMINAL_STATUSES = {STATUS_HR_CONFIRMED, STATUS_HR_EXTENDED, STATUS_HR_FAILED}

EMPLOYEE_STATUS_LABELS = {
    "on_probation": "On probation",
    "review_pending": "Review in progress",
    "awaiting_hr": "Awaiting HR decision",
    "confirmed": "Confirmed",
    "extended": "Probation extended",
    "failed": "Probation not cleared",
}


def _serialize_date(value):
    if not value:
        return None
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return str(value)


def compute_probation_end_date(doj):
    """Alias for the canonical DOJ + 6 calendar months calculation."""
    return probation_end_date(doj)


def effective_probation_end_date(admin):
    """
    Date after which the employee is eligible for leave accrual.
    Uses the latest open probation cycle end when probation was extended.
    """
    base = compute_probation_end_date(getattr(admin, "doj", None))
    if not admin:
        return base

    from .models.probation import ProbationReview

    confirmed = ProbationReview.query.filter_by(
        admin_id=admin.id,
        status=STATUS_HR_CONFIRMED,
    ).first()
    if confirmed:
        return base

    latest_row = (
        ProbationReview.query.filter_by(admin_id=admin.id)
        .order_by(ProbationReview.probation_end_date.desc())
        .first()
    )
    if latest_row and latest_row.probation_end_date:
        if base is None or latest_row.probation_end_date > base:
            return latest_row.probation_end_date
    return base


def infer_status_from_row(row):
    """Backfill status for legacy rows that predate the status column."""
    if not row:
        return None
    status = (getattr(row, "status", None) or "").strip()
    if status:
        return status
    if getattr(row, "hr_decision", None):
        decision = (row.hr_decision or "").strip()
        if decision == HR_DECISION_CONFIRMED:
            return STATUS_HR_CONFIRMED
        if decision == HR_DECISION_EXTENDED:
            return STATUS_HR_EXTENDED
        if decision == HR_DECISION_FAILED:
            return STATUS_HR_FAILED
    if getattr(row, "reviewed_at", None):
        return STATUS_MANAGER_SUBMITTED
    if getattr(row, "reminder_sent_at", None):
        return STATUS_REMINDER_SENT
    return None


def _current_cycle_review(admin, effective_end):
    from .models.probation import ProbationReview

    if not admin or not effective_end:
        return None
    row = ProbationReview.query.filter_by(
        admin_id=admin.id,
        probation_end_date=effective_end,
    ).first()
    if row:
        return row
    return (
        ProbationReview.query.filter_by(admin_id=admin.id)
        .order_by(ProbationReview.probation_end_date.desc())
        .first()
    )


def build_employee_probation_status(admin, run_date=None):
    """Employee-facing probation summary for dashboard and profile."""
    run_date = run_date or date.today()
    doj = getattr(admin, "doj", None)
    if not doj:
        return {"applicable": False, "show_on_dashboard": False}

    from .models.probation import ProbationReview

    base_end = compute_probation_end_date(doj)
    effective_end = effective_probation_end_date(admin)
    confirmed_row = (
        ProbationReview.query.filter_by(admin_id=admin.id, status=STATUS_HR_CONFIRMED)
        .order_by(ProbationReview.hr_decided_at.desc())
        .first()
    )
    if confirmed_row:
        confirmed_at = confirmed_row.hr_decided_at
        recent = False
        if confirmed_at:
            decided_date = (
                confirmed_at.date()
                if hasattr(confirmed_at, "date") and callable(confirmed_at.date)
                else confirmed_at
            )
            recent = decided_date >= run_date - timedelta(days=RECENT_CONFIRMATION_DAYS)
        return {
            "applicable": True,
            "show_on_dashboard": recent,
            "on_probation": False,
            "status": "confirmed",
            "status_label": EMPLOYEE_STATUS_LABELS["confirmed"],
            "message": "You have been confirmed as a permanent employee.",
            "probation_start_date": _serialize_date(doj),
            "probation_end_date": _serialize_date(confirmed_row.probation_end_date or effective_end),
            "days_remaining": 0,
            "confirmed_at": isoformat_api(confirmed_at),
            "hr_decision": HR_DECISION_CONFIRMED,
        }

    failed_row = (
        ProbationReview.query.filter_by(admin_id=admin.id, status=STATUS_HR_FAILED)
        .order_by(ProbationReview.hr_decided_at.desc())
        .first()
    )
    if failed_row:
        return {
            "applicable": True,
            "show_on_dashboard": True,
            "on_probation": False,
            "status": "failed",
            "status_label": EMPLOYEE_STATUS_LABELS["failed"],
            "message": "Your probation was not cleared. Please contact HR for next steps.",
            "probation_start_date": _serialize_date(doj),
            "probation_end_date": _serialize_date(failed_row.probation_end_date or effective_end),
            "days_remaining": 0,
            "hr_decision": HR_DECISION_FAILED,
            "hr_decided_at": isoformat_api(failed_row.hr_decided_at),
        }

    on_probation = bool(effective_end and run_date < effective_end)
    days_remaining = max((effective_end - run_date).days, 0) if effective_end and run_date <= effective_end else 0
    cycle = _current_cycle_review(admin, effective_end)
    cycle_status = infer_status_from_row(cycle)

    if cycle_status == STATUS_MANAGER_SUBMITTED and cycle and not cycle.hr_decision:
        employee_status = "awaiting_hr"
        message = "Your manager has submitted a probation review. HR will record the final decision soon."
    elif cycle_status == STATUS_HR_EXTENDED and cycle and cycle.extended_until:
        employee_status = "extended"
        message = f"Your probation has been extended until {_serialize_date(cycle.extended_until)}."
    elif on_probation:
        employee_status = "on_probation"
        message = (
            f"Your probation ends on {_serialize_date(effective_end)}. "
            f"{days_remaining} day(s) remaining."
        )
    else:
        employee_status = "review_pending"
        message = (
            "Your probation period has ended. Confirmation is being processed by HR."
        )

    return {
        "applicable": True,
        "show_on_dashboard": True,
        "on_probation": on_probation,
        "status": employee_status,
        "status_label": EMPLOYEE_STATUS_LABELS.get(employee_status, employee_status),
        "message": message,
        "probation_start_date": _serialize_date(doj),
        "probation_end_date": _serialize_date(effective_end),
        "base_probation_end_date": _serialize_date(base_end),
        "days_remaining": days_remaining,
        "manager_review_submitted": bool(cycle and cycle.reviewed_at),
        "awaiting_hr_decision": employee_status == "awaiting_hr",
        "extended_until": _serialize_date(cycle.extended_until) if cycle else None,
        "probation_months": PROBATION_MONTHS,
    }


def add_calendar_months(start: date, months: int) -> date:
    """Add calendar months, clamping day to month length."""
    import calendar

    mo = start.month + months
    yr = start.year + (mo - 1) // 12
    mo = (mo - 1) % 12 + 1
    last = calendar.monthrange(yr, mo)[1]
    return date(yr, mo, min(start.day, last))
