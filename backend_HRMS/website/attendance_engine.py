"""
Shared attendance rules for calendar, HR 360, Excel exports, and Accounts totals.

Single source of truth for:
  - Weekend rules (Saturday working for HR/Accounts)
  - 8-hour full / half-day punch threshold
  - Mandatory vs optional holidays
  - Approved leave / WFH / pending WFH display
  - Credited working days (employee calendar summary)
  - Expected working days + absent days (Accounts payroll)
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from typing import Dict, Optional, Set, Tuple
from zoneinfo import ZoneInfo

import calendar

from .models.Admin_models import Admin
from .models.attendance import LeaveApplication, Punch, WorkFromHomeApplication
from .models.holiday_calendar import HolidayCalendar

FULL_DAY_WORK_SECONDS = 8 * 3600
HR_ACCOUNTS_EMP_TYPES = ("Human Resource", "Accounts")


def is_weekend_non_working(d: date, emp_type: str) -> bool:
    """Sunday is always off; Saturday off except for HR/Accounts."""
    weekday = d.weekday()  # Mon=0 ... Sun=6
    if weekday == 6:
        return True
    if weekday == 5:
        return (emp_type or "").strip() not in HR_ACCOUNTS_EMP_TYPES
    return False


def punch_work_seconds(p) -> int:
    if getattr(p, "today_work", None) and str(p.today_work).strip():
        try:
            parts = str(p.today_work).strip().split(":")
            h = int(parts[0]) if len(parts) > 0 else 0
            m = int(parts[1]) if len(parts) > 1 else 0
            sec = int(parts[2]) if len(parts) > 2 else 0
            return h * 3600 + m * 60 + sec
        except (ValueError, IndexError):
            pass
    if p.punch_in and p.punch_out:
        return max(0, int((p.punch_out - p.punch_in).total_seconds()))
    return 0


def _month_end_date(year: int, month: int) -> date:
    return date(year, month, calendar.monthrange(year, month)[1])


def _working_days_end(year: int, month: int, today: date, last_day: date, first_day: date) -> date:
    if year == today.year and month == today.month:
        return today
    if (year, month) < (today.year, today.month):
        return last_day
    return first_day - timedelta(days=1)


def status_display_label(status: str, details: Optional[dict] = None) -> str:
    """Human-readable label aligned with employee calendar."""
    details = details or {}
    mapping = {
        "PRESENT": "Present",
        "ABSENT": "Absent",
        "LEAVE": "On Leave",
        "LEAVE_PENDING": "Leave Pending",
        "HALF_DAY": "Half Day",
        "PENDING_PUNCH_OUT": "Pending Punch Out",
        "WFH_APPROVED": "Work From Home",
        "WFH_PENDING": "WFH Pending",
        "HOLIDAY": "Public Holiday",
        "HOLIDAY_OPTIONAL": "Optional Holiday",
        "WEEKEND": "Weekend",
    }
    if status == "PRESENT" and details.get("wfh"):
        return "Work From Home"
    return mapping.get(status or "", status or "—")


@dataclass
class AttendanceMonthContext:
    admin_id: int
    emp_type: str
    year: int
    month: int
    first_day: date
    last_day: date
    today: date
    working_days_end: date
    punch_map: Dict[date, Punch] = field(default_factory=dict)
    holiday_map: Dict[date, HolidayCalendar] = field(default_factory=dict)
    leaves: list = field(default_factory=list)
    wfh_apps: list = field(default_factory=list)
    paid_leave_units: Dict[date, float] = field(default_factory=dict)
    unpaid_leave_units: Dict[date, float] = field(default_factory=dict)
    optional_leave_taken: Set[date] = field(default_factory=set)
    worked_full_dates: Set[date] = field(default_factory=set)
    worked_half_dates: Set[date] = field(default_factory=set)
    approved_wfh_dates: Set[date] = field(default_factory=set)
    leave_units_accounts: Dict[date, float] = field(default_factory=dict)
    accounts_lop_total: float = 0.0
    summary_unpaid_accumulator: float = 0.0

    def is_on_leave_approved(self, d: date) -> bool:
        return any(
            lv.start_date <= d <= lv.end_date
            for lv in self.leaves
            if str(lv.status or "").strip().lower() == "approved"
            and str(lv.leave_type or "").strip().lower() != "half day leave"
        )

    def is_on_half_day_leave_approved(self, d: date) -> bool:
        return any(
            lv.start_date <= d <= lv.end_date
            for lv in self.leaves
            if str(lv.status or "").strip().lower() == "approved"
            and str(lv.leave_type or "").strip().lower() == "half day leave"
        )

    def is_wfh_approved(self, d: date) -> bool:
        return d in self.approved_wfh_dates

    def is_wfh_pending(self, d: date) -> bool:
        return any(
            wfh.start_date <= d <= wfh.end_date
            for wfh in self.wfh_apps
            if str(wfh.status or "").strip().lower() == "pending"
        )

    def is_calendar_working_day(self, d: date) -> bool:
        holiday = self.holiday_map.get(d)
        is_mandatory = bool(holiday) and not bool(getattr(holiday, "is_optional", False))
        return (not is_weekend_non_working(d, self.emp_type)) and (not is_mandatory)

    def is_sandwich_non_working(self, d: date) -> bool:
        if self.holiday_map.get(d):
            return True
        return is_weekend_non_working(d, self.emp_type)

    @property
    def mandatory_holidays(self) -> Set[date]:
        return {
            h.holiday_date
            for h in self.holiday_map.values()
            if not getattr(h, "is_optional", False)
        }

    @property
    def optional_holidays(self) -> Set[date]:
        return {
            h.holiday_date
            for h in self.holiday_map.values()
            if getattr(h, "is_optional", False)
        }


def load_attendance_month_context(
    admin_id: int,
    year: int,
    month: int,
    emp_type: Optional[str] = None,
    *,
    include_pending: bool = True,
    today: Optional[date] = None,
) -> AttendanceMonthContext:
    """Load punches, leaves, WFH, holidays and precompute month totals inputs."""
    if emp_type is None:
        admin = Admin.query.get(admin_id)
        emp_type = (admin.emp_type or "").strip() if admin else ""

    today = today or datetime.now(ZoneInfo("Asia/Kolkata")).date()
    first_day = date(year, month, 1)
    last_day = _month_end_date(year, month)
    working_days_end = _working_days_end(year, month, today, last_day, first_day)

    punches = Punch.query.filter(
        Punch.admin_id == admin_id,
        Punch.punch_date.between(first_day, last_day),
    ).all()
    punch_map = {p.punch_date: p for p in punches}

    leave_statuses = ["Approved", "Pending"] if include_pending else ["Approved"]
    leaves = LeaveApplication.query.filter(
        LeaveApplication.admin_id == admin_id,
        LeaveApplication.status.in_(leave_statuses),
        LeaveApplication.start_date <= last_day,
        LeaveApplication.end_date >= first_day,
    ).all()

    wfh_statuses = ["Approved", "Pending"] if include_pending else ["Approved"]
    wfh_apps = WorkFromHomeApplication.query.filter(
        WorkFromHomeApplication.admin_id == admin_id,
        WorkFromHomeApplication.status.in_(wfh_statuses),
        WorkFromHomeApplication.start_date <= last_day,
        WorkFromHomeApplication.end_date >= first_day,
    ).all()

    holidays = HolidayCalendar.query.filter(
        HolidayCalendar.year == year,
        HolidayCalendar.is_active.is_(True),
        HolidayCalendar.holiday_date.between(first_day, last_day),
    ).all()
    holiday_map = {h.holiday_date: h for h in holidays}

    ctx = AttendanceMonthContext(
        admin_id=admin_id,
        emp_type=emp_type,
        year=year,
        month=month,
        first_day=first_day,
        last_day=last_day,
        today=today,
        working_days_end=working_days_end,
        punch_map=punch_map,
        holiday_map=holiday_map,
        leaves=leaves,
        wfh_apps=wfh_apps,
    )

    _process_leave_units(ctx)
    _process_punch_dates(ctx)
    _process_wfh_dates(ctx)
    _process_accounts_leave_units(ctx)
    return ctx


def _add_unit(store: dict, day: date, unit: float) -> None:
    store[day] = min(1.0, float(store.get(day, 0.0) or 0.0) + float(unit))


def _leave_working_and_sandwich_days(ctx: AttendanceMonthContext, start_d: date, end_d: date):
    if not start_d or not end_d or end_d < start_d:
        return [], []
    all_days = []
    cur = start_d
    while cur <= end_d:
        all_days.append(cur)
        cur += timedelta(days=1)
    working = [d for d in all_days if not ctx.is_sandwich_non_working(d)]
    if not working:
        return [], []
    sandwich = []
    for d in all_days:
        if not ctx.is_sandwich_non_working(d):
            continue
        if any(w < d for w in working) and any(w > d for w in working):
            sandwich.append(d)
    return working, sandwich


def _process_leave_units(ctx: AttendanceMonthContext) -> None:
    """Paid/unpaid leave units for credited-days summary (calendar card)."""
    approved_leaves = [
        lv for lv in ctx.leaves if str(lv.status or "").strip().lower() == "approved"
    ]

    def _consume_days(days, paid_quota, unpaid_quota, unit_default=1.0, is_half_day=False):
        paid_left = float(paid_quota)
        unpaid_left = float(unpaid_quota)
        for day in days:
            unit = 0.5 if is_half_day else unit_default
            in_window = ctx.first_day <= day <= ctx.working_days_end
            affects_card = ctx.is_calendar_working_day(day)
            use_paid = 0.0
            use_unpaid = 0.0

            if paid_left + 1e-9 >= unit:
                use_paid = unit
                paid_left -= unit
            elif unpaid_left + 1e-9 >= unit:
                use_unpaid = unit
                unpaid_left -= unit
            else:
                use_paid = max(0.0, paid_left)
                use_unpaid = max(0.0, min(unpaid_left, unit - use_paid))
                paid_left = 0.0
                unpaid_left = max(0.0, unpaid_left - use_unpaid)

            if use_paid > 0:
                _add_unit(ctx.paid_leave_units, day, use_paid)
            if use_unpaid > 0:
                _add_unit(ctx.unpaid_leave_units, day, use_unpaid)
                if in_window and affects_card:
                    ctx.summary_unpaid_accumulator += use_unpaid

            if is_half_day:
                break
        return paid_left, unpaid_left

    for lv in approved_leaves:
        if not lv.start_date or not lv.end_date:
            continue
        if lv.end_date < ctx.first_day or lv.start_date > ctx.working_days_end:
            continue

        leave_type = str(lv.leave_type or "").strip()
        is_half_day = leave_type.lower() == "half day leave"
        leave_working, leave_sandwich = _leave_working_and_sandwich_days(
            ctx, lv.start_date, lv.end_date
        )

        requested_paid = float(getattr(lv, "requested_deducted_days", None) or 0.0)
        deducted_total = float(lv.deducted_days or 0.0)
        sandwich_pl = float(getattr(lv, "sandwich_pl_days", None) or 0.0)
        extra = float(lv.extra_days or 0.0)

        if leave_type == "Optional Leave":
            d = max(lv.start_date, ctx.first_day)
            d_end = min(lv.end_date, ctx.working_days_end)
            while d <= d_end:
                holiday = ctx.holiday_map.get(d)
                if holiday and bool(getattr(holiday, "is_optional", False)):
                    ctx.optional_leave_taken.add(d)
                d += timedelta(days=1)
            continue

        if is_half_day:
            paid = 0.0 if extra >= 0.5 else 0.5
            unpaid = 0.5 if extra >= 0.5 else 0.0
            days = [lv.start_date] if lv.start_date else []
            _consume_days(days, paid, unpaid, unit_default=0.5, is_half_day=True)
            continue

        if leave_type == "Privilege Leave":
            paid = deducted_total if deducted_total > 0 else requested_paid
            unpaid = extra
            ordered = sorted(set(leave_working + leave_sandwich))
            if paid <= 0 and unpaid <= 0 and ordered:
                paid = float(len(ordered))
            _consume_days(ordered, paid, unpaid)
            continue

        working_paid = requested_paid if requested_paid > 0 else max(0.0, deducted_total - sandwich_pl)
        if working_paid <= 0 and leave_working and extra <= 0 and sandwich_pl <= 0:
            working_paid = float(len(leave_working))

        _, unpaid_after_working = _consume_days(leave_working, working_paid, extra)
        _consume_days(leave_sandwich, sandwich_pl, unpaid_after_working)


def _process_accounts_leave_units(ctx: AttendanceMonthContext) -> None:
    """Simpler leave units for Accounts absent-day calculation."""
    end_date = ctx.working_days_end
    start_date = ctx.first_day
    optional_holidays = ctx.optional_holidays
    lop_total = 0.0
    leave_units = {}

    approved = [
        lv for lv in ctx.leaves if str(lv.status or "").strip().lower() == "approved"
    ]
    for leave in approved:
        d_start = max(leave.start_date, start_date)
        d_end = min(leave.end_date, end_date)

        span_days = (leave.end_date - leave.start_date).days + 1
        overlap_days = (d_end - d_start).days + 1 if d_end >= d_start else 0
        if span_days > 0 and overlap_days > 0 and float(getattr(leave, "extra_days", 0) or 0) > 0:
            lop_total += float(leave.extra_days or 0) * (overlap_days / span_days)

        if leave.leave_type == "Optional Leave":
            d = d_start
            while d <= d_end:
                if d in optional_holidays:
                    ctx.optional_leave_taken.add(d)
                d += timedelta(days=1)
            continue

        if leave.leave_type == "Half Day Leave":
            if d_start <= d_end:
                leave_units[d_start] = max(leave_units.get(d_start, 0.0), 0.5)
            continue

        d = d_start
        while d <= d_end:
            leave_units[d] = max(leave_units.get(d, 0.0), 1.0)
            d += timedelta(days=1)

    ctx.leave_units_accounts = leave_units
    ctx.accounts_lop_total = lop_total


def _process_punch_dates(ctx: AttendanceMonthContext) -> None:
    for p in ctx.punch_map.values():
        if not p.punch_in or not p.punch_out:
            continue
        if p.punch_date < ctx.first_day or p.punch_date > ctx.working_days_end:
            continue
        secs = punch_work_seconds(p)
        if secs >= FULL_DAY_WORK_SECONDS:
            ctx.worked_full_dates.add(p.punch_date)
        else:
            ctx.worked_half_dates.add(p.punch_date)


def _process_wfh_dates(ctx: AttendanceMonthContext) -> None:
    for wfh in ctx.wfh_apps:
        if str(wfh.status or "").strip().lower() != "approved":
            continue
        d = max(wfh.start_date, ctx.first_day)
        d_end = min(wfh.end_date, ctx.working_days_end)
        while d <= d_end:
            ctx.approved_wfh_dates.add(d)
            d += timedelta(days=1)


def resolve_day_status(ctx: AttendanceMonthContext, current_day: date) -> dict:
    """Return calendar-compatible {status, details} for one day."""
    day_status = {"status": None, "details": {}}
    punch = ctx.punch_map.get(current_day)
    holiday = ctx.holiday_map.get(current_day)
    is_future = current_day > ctx.today

    if punch:
        if punch.punch_in and not punch.punch_out:
            day_status["status"] = "PENDING_PUNCH_OUT"
        else:
            work_seconds = punch_work_seconds(punch)
            day_status["status"] = (
                "HALF_DAY" if work_seconds < FULL_DAY_WORK_SECONDS else "PRESENT"
            )

        if getattr(punch, "is_wfh", False) or ctx.is_wfh_approved(current_day):
            day_status["details"]["wfh"] = True
        if not is_future and ctx.is_wfh_pending(current_day):
            day_status["details"]["wfh_pending"] = True

        def _fmt_time(t):
            if t is None:
                return None
            return t.strftime("%H:%M:%S") if hasattr(t, "strftime") else str(t)

        day_status["details"].update({
            "punch_in": _fmt_time(punch.punch_in),
            "punch_out": _fmt_time(punch.punch_out),
            "work_hours": str(punch.today_work) if punch.today_work else None,
        })

    elif holiday:
        day_status["status"] = "HOLIDAY_OPTIONAL" if holiday.is_optional else "HOLIDAY"
        day_status["details"]["holiday_name"] = holiday.holiday_name
        day_status["details"]["is_optional"] = bool(holiday.is_optional)

    elif is_weekend_non_working(current_day, ctx.emp_type):
        day_status["status"] = "WEEKEND"

    elif is_future:
        if ctx.is_wfh_approved(current_day):
            day_status["status"] = "WFH_APPROVED"
            day_status["details"]["wfh"] = True
        elif ctx.is_on_leave_approved(current_day):
            day_status["status"] = "LEAVE"
        else:
            day_status["status"] = "ABSENT"
    else:
        if ctx.is_wfh_approved(current_day):
            day_status["status"] = "WFH_APPROVED"
            day_status["details"]["wfh"] = True
        elif ctx.is_wfh_pending(current_day):
            day_status["status"] = "WFH_PENDING"
            day_status["details"]["wfh_pending"] = True
        elif ctx.is_on_leave_approved(current_day):
            day_status["status"] = "LEAVE"
        elif ctx.is_on_half_day_leave_approved(current_day):
            day_status["status"] = "LEAVE"
            day_status["details"]["half_day_leave"] = True
        else:
            day_status["status"] = "ABSENT"

    return day_status


def build_month_calendar(ctx: AttendanceMonthContext) -> list:
    calendar_data = []
    current_day = ctx.first_day
    while current_day <= ctx.last_day:
        resolved = resolve_day_status(ctx, current_day)
        calendar_data.append({
            "date": current_day.isoformat(),
            "day": current_day.day,
            "weekday": current_day.strftime("%A"),
            "status": resolved["status"],
            "details": resolved.get("details") or {},
        })
        current_day += timedelta(days=1)
    return calendar_data


def calculate_credited_working_days(ctx: AttendanceMonthContext) -> Tuple[float, float]:
    """
    Credited working days for employee calendar summary card.
    Returns (total_working_days, unpaid_leave_days).
    """
    def _is_leave_or_absent_bridge(d):
        if not ctx.is_calendar_working_day(d) or d in ctx.optional_leave_taken:
            return False
        if (
            d in ctx.worked_full_dates
            or d in ctx.worked_half_dates
            or d in ctx.approved_wfh_dates
        ):
            return False
        return True

    unpaid_leave_days = float(ctx.summary_unpaid_accumulator)
    sandwich_bridge_unpaid = 0.0
    abs_bridge_marked = set()
    current = ctx.first_day

    while current <= ctx.working_days_end and current <= ctx.last_day:
        if (
            ctx.is_sandwich_non_working(current)
            and current not in abs_bridge_marked
            and current not in ctx.paid_leave_units
            and current not in ctx.unpaid_leave_units
        ):
            before = current - timedelta(days=1)
            after = current + timedelta(days=1)
            while before >= ctx.first_day and ctx.is_sandwich_non_working(before):
                before -= timedelta(days=1)
            while after <= ctx.working_days_end and ctx.is_sandwich_non_working(after):
                after += timedelta(days=1)
            if (
                ctx.first_day <= before <= ctx.working_days_end
                and ctx.first_day <= after <= ctx.working_days_end
                and _is_leave_or_absent_bridge(before)
                and _is_leave_or_absent_bridge(after)
            ):
                mid = before + timedelta(days=1)
                while mid < after:
                    if ctx.is_sandwich_non_working(mid):
                        abs_bridge_marked.add(mid)
                        if (
                            ctx.is_calendar_working_day(mid)
                            and mid not in ctx.optional_leave_taken
                            and mid not in ctx.paid_leave_units
                        ):
                            sandwich_bridge_unpaid += 1.0
                            _add_unit(ctx.unpaid_leave_units, mid, 1.0)
                    mid += timedelta(days=1)
        current += timedelta(days=1)

    unpaid_leave_days = round(unpaid_leave_days + sandwich_bridge_unpaid, 1)

    total_working_days = 0.0
    current = ctx.first_day
    while current <= ctx.working_days_end and current <= ctx.last_day:
        if not ctx.is_calendar_working_day(current):
            current += timedelta(days=1)
            continue
        if current in ctx.optional_leave_taken:
            current += timedelta(days=1)
            continue

        unpaid_u = float(ctx.unpaid_leave_units.get(current, 0.0) or 0.0)
        paid_u = float(ctx.paid_leave_units.get(current, 0.0) or 0.0)

        if unpaid_u >= 1.0 - 1e-9:
            current += timedelta(days=1)
            continue

        if paid_u >= 1.0 - 1e-9:
            total_working_days += 1.0
            current += timedelta(days=1)
            continue

        if unpaid_u >= 0.5 - 1e-9 and paid_u < 1e-9:
            if (
                current in ctx.worked_full_dates
                or current in ctx.worked_half_dates
                or current in ctx.approved_wfh_dates
            ):
                total_working_days += 0.5
            current += timedelta(days=1)
            continue

        if paid_u >= 0.5 - 1e-9:
            credit = 0.5
            if (
                current in ctx.worked_full_dates
                or current in ctx.worked_half_dates
                or current in ctx.approved_wfh_dates
            ):
                credit += 0.5
            total_working_days += credit
            current += timedelta(days=1)
            continue

        if current in ctx.approved_wfh_dates or current in ctx.worked_full_dates:
            total_working_days += 1.0
        elif current in ctx.worked_half_dates:
            total_working_days += 0.5

        current += timedelta(days=1)

    return max(0.0, round(total_working_days, 1)), unpaid_leave_days


def calculate_accounts_totals(ctx: AttendanceMonthContext) -> Tuple[float, float]:
    """
    Expected working days and absent days (Accounts payroll / internal Excel).
    Uses month-to-date cutoff for the current month.
    """
    expected_working_days = 0.0
    absent_days = 0.0
    end_date = ctx.working_days_end
    leave_units = ctx.leave_units_accounts

    current = ctx.first_day
    while current <= end_date:
        is_weekend = is_weekend_non_working(current, ctx.emp_type)
        is_mandatory = current in ctx.mandatory_holidays
        is_calendar_working = (not is_weekend) and (not is_mandatory)

        if not is_calendar_working:
            current += timedelta(days=1)
            continue

        if current in ctx.optional_leave_taken:
            current += timedelta(days=1)
            continue

        expected_working_days += 1.0

        if current in ctx.worked_full_dates or current in ctx.approved_wfh_dates:
            current += timedelta(days=1)
            continue

        if current in ctx.worked_half_dates:
            absent_days += 0.5
            current += timedelta(days=1)
            continue

        units = float(leave_units.get(current, 0.0) or 0.0)
        if units >= 1.0:
            current += timedelta(days=1)
            continue
        if units == 0.5:
            absent_days += 0.5
            current += timedelta(days=1)
            continue

        absent_days += 1.0
        current += timedelta(days=1)

    if ctx.accounts_lop_total > 0:
        absent_days = min(
            expected_working_days, absent_days + float(ctx.accounts_lop_total)
        )

    return expected_working_days, absent_days


def load_context_for_month(admin_id: int, year: int, month: int, emp_type: Optional[str] = None):
    """Convenience alias used by utility/HR modules."""
    return load_attendance_month_context(admin_id, year, month, emp_type=emp_type)
