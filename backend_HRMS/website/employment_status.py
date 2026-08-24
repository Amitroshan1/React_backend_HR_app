"""Employment status (probation / on_role / contract) — not department emp_type."""
from __future__ import annotations

from datetime import date, datetime
from typing import Optional

from .commands.leave_accrual_schedule import PROBATION_MONTHS

STATUS_PROBATION = "probation"
STATUS_ON_ROLE = "on_role"
STATUS_CONTRACT = "contract"
VALID_EMPLOYMENT_STATUSES = (STATUS_PROBATION, STATUS_ON_ROLE, STATUS_CONTRACT)

STATUS_LABELS = {
    STATUS_PROBATION: "Probation",
    STATUS_ON_ROLE: "On Role",
    STATUS_CONTRACT: "Contract",
}

DEFAULT_PROBATION_MONTHS = PROBATION_MONTHS
MAX_PROBATION_MONTHS = 60

_STATUS_ALIASES = {
    "onrole": STATUS_ON_ROLE,
    "on_role": STATUS_ON_ROLE,
    "permanent": STATUS_ON_ROLE,
    "confirmed": STATUS_ON_ROLE,
    "probation": STATUS_PROBATION,
    "contract": STATUS_CONTRACT,
    "contractor": STATUS_CONTRACT,
}


class EmploymentStatusError(ValueError):
    """Invalid employment-status payload."""


def add_calendar_months(start: date, months: int) -> date:
    """Add calendar months, clamping day to month length."""
    import calendar

    if start is None:
        return None
    months = int(months)
    mo = start.month + months
    yr = start.year + (mo - 1) // 12
    mo = (mo - 1) % 12 + 1
    last = calendar.monthrange(yr, mo)[1]
    return date(yr, mo, min(start.day, last))


def parse_iso_date(value, *, field_name="date"):
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    try:
        return datetime.fromisoformat(str(value).strip()[:10]).date()
    except (ValueError, TypeError) as exc:
        raise EmploymentStatusError(f"Invalid {field_name} (use YYYY-MM-DD)") from exc


def parse_duration_months(value, *, required=False):
    if value is None or value == "":
        if required:
            raise EmploymentStatusError("probation_duration_months is required")
        return None
    try:
        months = int(value)
    except (TypeError, ValueError) as exc:
        raise EmploymentStatusError("probation_duration_months must be an integer") from exc
    if months < 1 or months > MAX_PROBATION_MONTHS:
        raise EmploymentStatusError(
            f"probation_duration_months must be between 1 and {MAX_PROBATION_MONTHS}"
        )
    return months


def duration_months_from_dates(start: date, end: date) -> int:
    if not start or not end:
        raise EmploymentStatusError("Probation start and end dates are required")
    if end < start:
        raise EmploymentStatusError("Probation end date cannot be before start date")
    for n in range(1, MAX_PROBATION_MONTHS + 1):
        if add_calendar_months(start, n) == end:
            return n
    raise EmploymentStatusError(
        "Probation end date must equal start date plus a whole number of calendar months"
    )


def normalize_employment_status(value, *, default=STATUS_PROBATION, strict=False):
    raw = value
    if not isinstance(value, str) and value is not None and hasattr(value, "employment_status"):
        raw = getattr(value, "employment_status", None)
    val = (raw or "").strip().lower().replace(" ", "_").replace("-", "_")
    if not val:
        if strict:
            raise EmploymentStatusError(
                "employment_status is required (probation, on_role, or contract)"
            )
        return default
    mapped = _STATUS_ALIASES.get(val, val)
    if mapped not in VALID_EMPLOYMENT_STATUSES:
        if strict:
            raise EmploymentStatusError(
                "employment_status must be probation, on_role, or contract"
            )
        return default
    return mapped


def employment_status_of(admin) -> str:
    return normalize_employment_status(getattr(admin, "employment_status", None) if admin else None)


def is_probation_employment(admin) -> bool:
    return employment_status_of(admin) == STATUS_PROBATION


def is_on_role(admin) -> bool:
    return employment_status_of(admin) == STATUS_ON_ROLE


def is_contract(admin) -> bool:
    return employment_status_of(admin) == STATUS_CONTRACT


def contract_leave_accrual_enabled(admin=None) -> bool:
    from .leave_settings import load_leave_settings

    return bool(load_leave_settings().get("contract_leave_accrual_default", False))


def is_pl_cl_accrual_eligible(admin, run_date=None) -> bool:
    """Normal PL/CL accrual only for On Role (or contract when policy allows)."""
    del run_date  # eligibility is status-driven, not calendar-end-driven
    status = employment_status_of(admin)
    if status == STATUS_ON_ROLE:
        return True
    if status == STATUS_CONTRACT:
        return contract_leave_accrual_enabled(admin)
    return False


def accrual_schedule_anchor_date(admin) -> Optional[date]:
    """Date used as first-eligible-month anchor (same 20th rule as former probation end)."""
    if not admin:
        return None
    if is_pl_cl_accrual_eligible(admin):
        return (
            getattr(admin, "employment_status_effective_from", None)
            or getattr(admin, "doj", None)
        )
    return getattr(admin, "probation_end_date", None) or getattr(admin, "doj", None)


def snapshot_employment(admin) -> dict:
    if not admin:
        return {
            "employment_status": None,
            "employment_status_effective_from": None,
            "probation_start_date": None,
            "probation_end_date": None,
            "probation_duration_months": None,
        }
    return {
        "employment_status": getattr(admin, "employment_status", None),
        "employment_status_effective_from": getattr(admin, "employment_status_effective_from", None),
        "probation_start_date": getattr(admin, "probation_start_date", None),
        "probation_end_date": getattr(admin, "probation_end_date", None),
        "probation_duration_months": getattr(admin, "probation_duration_months", None),
    }


def serialize_employment_fields(admin) -> dict:
    snap = snapshot_employment(admin)
    status = employment_status_of(admin) if admin else None

    def _d(v):
        return v.isoformat() if hasattr(v, "isoformat") else v

    return {
        "employment_status": status,
        "employment_status_label": STATUS_LABELS.get(status or "", status),
        "employment_status_effective_from": _d(snap["employment_status_effective_from"]),
        "probation_start_date": _d(snap["probation_start_date"]),
        "probation_end_date": _d(snap["probation_end_date"]),
        "probation_duration_months": snap["probation_duration_months"],
    }


def employment_fields_changed(before: dict, after: dict) -> dict:
    changed = {}
    keys = (
        "employment_status",
        "employment_status_effective_from",
        "probation_start_date",
        "probation_end_date",
        "probation_duration_months",
    )
    for key in keys:
        if before.get(key) != after.get(key):
            changed[key] = {"from": before.get(key), "to": after.get(key)}
    return changed


def _payload_has_employment_keys(data: dict) -> bool:
    return any(
        k in data
        for k in (
            "employment_status",
            "probation_start_date",
            "probation_end_date",
            "probation_duration_months",
        )
    )


def resolve_probation_dates(
    *,
    doj,
    start=None,
    end=None,
    duration_months=None,
    existing=None,
    start_provided=False,
    end_provided=False,
    duration_provided=False,
):
    """Resolve start/end/duration. End must equal start + duration calendar months."""
    existing_start = getattr(existing, "probation_start_date", None) if existing else None
    existing_end = getattr(existing, "probation_end_date", None) if existing else None
    existing_duration = getattr(existing, "probation_duration_months", None) if existing else None

    resolved_start = start if start_provided else (existing_start or doj)
    if resolved_start is None:
        raise EmploymentStatusError("Probation start date or DOJ is required")

    sent_duration = parse_duration_months(duration_months) if duration_provided else None

    if start_provided and end_provided:
        derived = duration_months_from_dates(resolved_start, end)
        if sent_duration is not None and sent_duration != derived:
            expected = add_calendar_months(resolved_start, sent_duration)
            raise EmploymentStatusError(
                "Probation end date does not match start date plus duration. "
                f"Expected {expected.isoformat()}."
            )
        return resolved_start, end, derived

    if duration_provided and end_provided and not start_provided:
        expected = add_calendar_months(resolved_start, sent_duration)
        if end != expected:
            raise EmploymentStatusError(
                "Probation end date does not match start date plus duration. "
                f"Expected {expected.isoformat()}."
            )
        return resolved_start, end, sent_duration

    if duration_provided and not end_provided:
        return resolved_start, add_calendar_months(resolved_start, sent_duration), sent_duration

    if end_provided and not duration_provided:
        derived = duration_months_from_dates(resolved_start, end)
        return resolved_start, end, derived

    duration = sent_duration or parse_duration_months(existing_duration) or DEFAULT_PROBATION_MONTHS
    if start_provided or not existing_end:
        return resolved_start, add_calendar_months(resolved_start, duration), duration
    expected = add_calendar_months(resolved_start, duration)
    if existing_end != expected:
        duration = duration_months_from_dates(resolved_start, existing_end)
        return resolved_start, existing_end, duration
    return resolved_start, existing_end, duration


def resolve_employment_payload(data: dict, *, doj, existing=None, for_create=False) -> dict:
    """Return canonical employment fields from signup/update JSON."""
    data = data or {}
    if for_create:
        raw_status = (data.get("employment_status") or "").strip() if "employment_status" in data else ""
        status = (
            normalize_employment_status(raw_status, strict=True)
            if raw_status
            else STATUS_PROBATION
        )
    else:
        if not _payload_has_employment_keys(data) and existing is not None:
            return snapshot_employment(existing)
        if "employment_status" in data:
            status = normalize_employment_status(data.get("employment_status"), strict=True)
        else:
            status = employment_status_of(existing) if existing else STATUS_PROBATION

    start_provided = "probation_start_date" in data and data.get("probation_start_date") not in (None, "")
    end_provided = "probation_end_date" in data and data.get("probation_end_date") not in (None, "")
    duration_provided = "probation_duration_months" in data and data.get("probation_duration_months") not in (None, "")
    start = parse_iso_date(data.get("probation_start_date"), field_name="probation_start_date") if start_provided else None
    end = parse_iso_date(data.get("probation_end_date"), field_name="probation_end_date") if end_provided else None
    duration = parse_duration_months(data.get("probation_duration_months")) if duration_provided else None

    if status == STATUS_PROBATION:
        existing_for_dates = existing if (existing and employment_status_of(existing) == STATUS_PROBATION) else None
        p_start, p_end, p_months = resolve_probation_dates(
            doj=doj,
            start=start,
            end=end,
            duration_months=duration,
            existing=existing_for_dates,
            start_provided=start_provided,
            end_provided=end_provided,
            duration_provided=duration_provided,
        )
        effective_from = p_start or doj
        return {
            "employment_status": status,
            "employment_status_effective_from": effective_from,
            "probation_start_date": p_start,
            "probation_end_date": p_end,
            "probation_duration_months": p_months,
        }

    # On Role / Contract: keep existing probation dates as historical unless explicitly sent.
    p_start = start
    p_end = end
    p_months = duration
    if existing is not None:
        if p_start is None:
            p_start = getattr(existing, "probation_start_date", None)
        if p_end is None:
            p_end = getattr(existing, "probation_end_date", None)
        if p_months is None:
            p_months = getattr(existing, "probation_duration_months", None)
    effective_from = doj
    if existing is not None and employment_status_of(existing) == status:
        effective_from = getattr(existing, "employment_status_effective_from", None) or doj
    elif existing is not None and employment_status_of(existing) != status:
        effective_from = date.today()
    return {
        "employment_status": status,
        "employment_status_effective_from": effective_from,
        "probation_start_date": p_start,
        "probation_end_date": p_end,
        "probation_duration_months": p_months,
    }


def _write_history(admin, before: dict, after: dict, *, changed_by, notes):
    from . import db
    from .models.employee_employment_status_history import EmployeeEmploymentStatusHistory

    db.session.add(
        EmployeeEmploymentStatusHistory(
            admin_id=admin.id,
            from_status=before.get("employment_status"),
            to_status=after["employment_status"],
            effective_from=after.get("employment_status_effective_from") or date.today(),
            probation_start_date=after.get("probation_start_date"),
            probation_end_date=after.get("probation_end_date"),
            probation_duration_months=after.get("probation_duration_months"),
            changed_by=changed_by,
            notes=(notes or "")[:500] or None,
        )
    )


def apply_employment_fields(
    admin,
    fields: dict,
    *,
    changed_by: str | None = None,
    notes: str | None = None,
    record_history: bool = True,
    send_email: bool = False,
    skip_status_email: bool = False,
):
    """Write fields onto Admin. Caller commits. Returns change map (empty if none)."""
    before = snapshot_employment(admin)
    admin.employment_status = fields["employment_status"]
    admin.employment_status_effective_from = fields.get("employment_status_effective_from")
    admin.probation_start_date = fields.get("probation_start_date")
    admin.probation_end_date = fields.get("probation_end_date")
    admin.probation_duration_months = fields.get("probation_duration_months")
    after = snapshot_employment(admin)
    changed = employment_fields_changed(before, after)
    if not changed:
        return changed

    if record_history and getattr(admin, "id", None):
        _write_history(admin, before, after, changed_by=changed_by, notes=notes)

    if fields["employment_status"] == STATUS_PROBATION and fields.get("probation_end_date"):
        try:
            from .commands.probation import _cleanup_stale_probation_reviews, _get_or_create_review
            from .models.probation import ProbationReview
            from .probation_utils import STATUS_MANAGER_SUBMITTED, TERMINAL_STATUSES, infer_status_from_row

            rows = ProbationReview.query.filter_by(admin_id=admin.id).all()
            had_open = False
            for row in rows:
                status = infer_status_from_row(row)
                if status in TERMINAL_STATUSES:
                    continue
                if status == STATUS_MANAGER_SUBMITTED and row.reviewed_at:
                    continue
                had_open = True
            _cleanup_stale_probation_reviews(admin, fields["probation_end_date"])
            if had_open:
                _get_or_create_review(admin, fields["probation_end_date"])
        except Exception:
            pass
    if is_pl_cl_accrual_eligible(admin) and before.get("employment_status") != after.get(
        "employment_status"
    ):
        try:
            from .commands.leave_accrual import sync_leave_eligibility_for_admin

            sync_leave_eligibility_for_admin(admin)
        except Exception:
            pass

    if send_email and not skip_status_email:
        from .email import send_employment_status_updated_email

        send_employment_status_updated_email(admin, changed, changed_by=changed_by)
    return changed


def transition_to_on_role(
    admin,
    *,
    effective_from=None,
    changed_by=None,
    notes="HR probation confirmation",
    send_email=False,
):
    """Probation → On Role without sending the generic status-update email."""
    fields = {
        "employment_status": STATUS_ON_ROLE,
        "employment_status_effective_from": effective_from or date.today(),
        "probation_start_date": getattr(admin, "probation_start_date", None),
        "probation_end_date": getattr(admin, "probation_end_date", None),
        "probation_duration_months": getattr(admin, "probation_duration_months", None),
    }
    return apply_employment_fields(
        admin,
        fields,
        changed_by=changed_by,
        notes=notes,
        record_history=True,
        send_email=send_email,
        skip_status_email=True,
    )


def apply_probation_extension(admin, extended_until, *, changed_by=None, notes="Probation extended"):
    start = getattr(admin, "probation_start_date", None) or getattr(admin, "doj", None)
    duration = duration_months_from_dates(start, extended_until) if start else None
    fields = {
        "employment_status": STATUS_PROBATION,
        "employment_status_effective_from": getattr(admin, "employment_status_effective_from", None)
        or start,
        "probation_start_date": start,
        "probation_end_date": extended_until,
        "probation_duration_months": duration,
    }
    return apply_employment_fields(
        admin,
        fields,
        changed_by=changed_by,
        notes=notes,
        record_history=True,
        send_email=False,
        skip_status_email=True,
    )


def infer_legacy_employment_fields(admin, *, today=None) -> dict:
    """Backfill fields for an existing employee. Never infers contract."""
    from .probation_utils import STATUS_HR_CONFIRMED, compute_probation_end_date

    today = today or date.today()
    doj = getattr(admin, "doj", None)
    from .models.probation import ProbationReview

    confirmed = None
    if getattr(admin, "id", None):
        confirmed = (
            ProbationReview.query.filter_by(
                admin_id=admin.id,
                status=STATUS_HR_CONFIRMED,
            )
            .order_by(ProbationReview.hr_decided_at.desc())
            .first()
        )

    start = doj
    if confirmed:
        end = confirmed.probation_end_date or compute_probation_end_date(doj)
        decided = confirmed.hr_decided_at
        if decided and hasattr(decided, "date") and callable(decided.date):
            effective = decided.date()
        elif isinstance(decided, date):
            effective = decided
        else:
            effective = end or doj or today
        duration = None
        if start and end:
            try:
                duration = duration_months_from_dates(start, end)
            except EmploymentStatusError:
                duration = DEFAULT_PROBATION_MONTHS
        return {
            "employment_status": STATUS_ON_ROLE,
            "employment_status_effective_from": effective,
            "probation_start_date": start,
            "probation_end_date": end,
            "probation_duration_months": duration,
        }

    from .probation_utils import effective_probation_end_date

    end = None
    try:
        end = effective_probation_end_date(admin)
    except Exception:
        end = compute_probation_end_date(doj)
    duration = DEFAULT_PROBATION_MONTHS
    if start and end:
        try:
            duration = duration_months_from_dates(start, end)
        except EmploymentStatusError:
            duration = DEFAULT_PROBATION_MONTHS
            if start:
                end = add_calendar_months(start, duration)
    return {
        "employment_status": STATUS_PROBATION,
        "employment_status_effective_from": start or today,
        "probation_start_date": start,
        "probation_end_date": end,
        "probation_duration_months": duration,
    }


def backfill_legacy_employment_status(*, commit=False) -> int:
    """Set employment_status on admins where it is NULL. Does not touch leave balances."""
    from . import db
    from .models.Admin_models import Admin

    updated = 0
    q = Admin.query.filter(
        (Admin.employment_status.is_(None)) | (Admin.employment_status == "")
    )
    for admin in q.all():
        fields = infer_legacy_employment_fields(admin)
        admin.employment_status = fields["employment_status"]
        admin.employment_status_effective_from = fields["employment_status_effective_from"]
        if admin.probation_start_date is None:
            admin.probation_start_date = fields["probation_start_date"]
        if admin.probation_end_date is None:
            admin.probation_end_date = fields["probation_end_date"]
        if admin.probation_duration_months is None:
            admin.probation_duration_months = fields["probation_duration_months"]
        updated += 1
    if commit and updated:
        db.session.commit()
    return updated


def format_status_label(status) -> str:
    return STATUS_LABELS.get(normalize_employment_status(status), status or "")
