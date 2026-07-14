# leave_page_summary,apply_leave_api,get_resignation_status,submit_resignation,submit_expense_claim,get_expense_claims,
# attendance_summary,submit_wfh,get_wfh_applications,


#https://solviotec.com/api/leave

from flask import Blueprint, request, current_app, jsonify, json, send_file
from .models.attendance import Punch, WorkFromHomeApplication, LeaveApplication, LeaveBalance, AttendanceRegularization
from flask_jwt_extended import jwt_required, get_jwt
from .models.expense import ExpenseClaimHeader, ExpenseLineItem
from .models.Admin_models import Admin
from .models.seperation import Resignation, Noc_Upload, NocDepartmentRequest
from .models.holiday_calendar import HolidayCalendar
from .models.manager_model import ManagerContact
from sqlalchemy import or_, func
from .email import send_wfh_approval_email_to_managers,send_claim_submission_email,send_resignation_email,send_resignation_revoked_email,send_leave_applied_email,send_noc_request_email
from .expense_utils import claim_attach_storage_name
from .manager_utils import get_manager_emails
from .utility import generate_attendance_excel, send_excel_file
from . import db
from .noc_department_service import reject_pending_noc_rows_for_resignation, NOC_DEPT_LABELS, _effective_noc_row_status
from flask import jsonify
from datetime import date, datetime, timedelta
from .datetime_utils import isoformat_api
from zoneinfo import ZoneInfo
import calendar
import os
from werkzeug.utils import secure_filename
import pytz
import logging

leave = Blueprint('leave', __name__)
logger = logging.getLogger(__name__)

NOTICE_PERIOD_DAYS = 90


def _is_weekend_non_working_for_emp(emp_type: str, d: date) -> bool:
    wd = d.weekday()  # Mon=0 ... Sun=6
    if wd == 6:
        return True
    if wd == 5:
        return (emp_type or "").strip() not in ["Human Resource", "Accounts"]
    return False


def _load_holiday_sets(year: int, start_date: date, end_date: date):
    rows = HolidayCalendar.query.filter(
        HolidayCalendar.year == year,
        HolidayCalendar.is_active.is_(True),
        HolidayCalendar.holiday_date.between(start_date, end_date),
    ).all()
    mandatory = {h.holiday_date for h in rows if not getattr(h, "is_optional", False)}
    optional = {h.holiday_date for h in rows if getattr(h, "is_optional", False)}
    return mandatory, optional


def _parse_leave_year(value):
    try:
        year = int(value)
    except (TypeError, ValueError):
        return None
    if year < 2000 or year > 2100:
        return None
    return year


def _fetch_optional_holiday_rows(year: int):
    rows = (
        HolidayCalendar.query.filter(
            HolidayCalendar.year == year,
            HolidayCalendar.is_active.is_(True),
            HolidayCalendar.is_optional.is_(True),
        )
        .order_by(HolidayCalendar.holiday_date.asc(), HolidayCalendar.id.asc())
        .all()
    )
    if not rows:
        from .Human_resource import _seed_holidays_for_year

        _seed_holidays_for_year(year, overwrite=False)
        rows = (
            HolidayCalendar.query.filter(
                HolidayCalendar.year == year,
                HolidayCalendar.is_active.is_(True),
                HolidayCalendar.is_optional.is_(True),
            )
            .order_by(HolidayCalendar.holiday_date.asc(), HolidayCalendar.id.asc())
            .all()
        )
    return rows


def _optional_holiday_on_date(d: date):
    for row in _fetch_optional_holiday_rows(d.year):
        if row.holiday_date == d:
            return row
    return None


def _serialize_optional_holiday(row):
    dt = row.holiday_date
    return {
        "id": row.id,
        "year": row.year,
        "holiday_name": row.holiday_name,
        "holiday_date": dt.isoformat() if dt else None,
        "display_date": dt.strftime("%d-%m-%Y") if dt else None,
        "is_optional": True,
    }


def _has_optional_leave_for_year(admin_id: int, year: int) -> bool:
    """True if employee already has a Pending/Approved Optional Leave in that calendar year."""
    year_start = date(year, 1, 1)
    year_end = date(year, 12, 31)
    existing = LeaveApplication.query.filter(
        LeaveApplication.admin_id == admin_id,
        LeaveApplication.leave_type == "Optional Leave",
        LeaveApplication.status.in_(["Pending", "Approved"]),
        LeaveApplication.start_date >= year_start,
        LeaveApplication.start_date <= year_end,
    ).first()
    return existing is not None


def _compute_leave_days_with_sandwich(*, emp_type: str, start_date: date, end_date: date) -> float:
    """
    Sandwich leave policy:
    - Count all calendar WORKING days within the range as leave days.
    - Non-working days (weekends + holidays) are counted ONLY if they are sandwiched
      between two counted working leave days within the same request range.
    """
    if end_date < start_date:
        return 0.0

    mandatory_holidays, optional_holidays = _load_holiday_sets(start_date.year, start_date, end_date)

    def _is_non_working(d: date) -> bool:
        # Treat both mandatory and optional holidays as non-working for sandwich computation
        if d in mandatory_holidays or d in optional_holidays:
            return True
        return _is_weekend_non_working_for_emp(emp_type, d)

    all_days = []
    cur = start_date
    while cur <= end_date:
        all_days.append(cur)
        cur += timedelta(days=1)

    working_days = [d for d in all_days if not _is_non_working(d)]
    if not working_days:
        return 0.0

    counted = set(working_days)

    # Sandwich: count non-working days that are strictly between working leave days
    for d in all_days:
        if d in counted:
            continue
        if not _is_non_working(d):
            continue
        before = any(w < d for w in working_days)
        after = any(w > d for w in working_days)
        if before and after:
            counted.add(d)

    return float(len(counted))


def _compute_working_and_sandwich_days(*, emp_type: str, start_date: date, end_date: date):
    """
    Return (working_days, sandwich_days).
    - working_days: days that are calendar working days for this emp_type (holidays + weekends excluded)
    - sandwich_days: non-working days inside the range that are between working_days
    """
    if end_date < start_date:
        return 0.0, 0.0

    mandatory_holidays, optional_holidays = _load_holiday_sets(start_date.year, start_date, end_date)

    def _is_non_working(d: date) -> bool:
        if d in mandatory_holidays or d in optional_holidays:
            return True
        return _is_weekend_non_working_for_emp(emp_type, d)

    all_days = []
    cur = start_date
    while cur <= end_date:
        all_days.append(cur)
        cur += timedelta(days=1)

    working_days = [d for d in all_days if not _is_non_working(d)]
    if not working_days:
        return 0.0, 0.0

    sandwich_days = 0
    for d in all_days:
        if not _is_non_working(d):
            continue
        before = any(w < d for w in working_days)
        after = any(w > d for w in working_days)
        if before and after:
            sandwich_days += 1

    return float(len(working_days)), float(sandwich_days)


def _is_active_resignation_status(status):
    return (status or "").strip().lower() in {"pending", "approved"}


def _serialize_notice(resignation):
    if not resignation or not resignation.resignation_date:
        return {
            "notice_active": False,
            "notice_period_days": NOTICE_PERIOD_DAYS,
            "notice_start_date": None,
            "notice_end_date": None,
            "days_left": 0,
            "can_revoke": False,
        }

    notice_start = resignation.resignation_date
    notice_end = notice_start + timedelta(days=NOTICE_PERIOD_DAYS)
    days_left = max((notice_end - date.today()).days, 0)
    status = (resignation.status or "").strip()
    active = _is_active_resignation_status(status) and days_left > 0

    return {
        "notice_active": active,
        "notice_period_days": NOTICE_PERIOD_DAYS,
        "notice_start_date": notice_start.isoformat(),
        "notice_end_date": notice_end.isoformat(),
        "days_left": days_left,
        "can_revoke": _is_active_resignation_status(status),
    }


def _serialize_department_noc_requests(resignation):
    if not resignation:
        return []
    rows = (
        NocDepartmentRequest.query.filter_by(
            admin_id=resignation.admin_id,
            resignation_id=resignation.id,
        )
        .order_by(NocDepartmentRequest.id.asc())
        .all()
    )
    out = []
    for row in rows:
        dk = (row.department_key or "").strip().upper()
        out.append(
            {
                "department_key": dk,
                "department_label": NOC_DEPT_LABELS.get(dk, dk),
                "status": _effective_noc_row_status(row, resignation),
                "requested_at": isoformat_api(row.requested_at) if row.requested_at else None,
            }
        )
    return out


def _serialize_employee_offboarding(admin):
    if not admin or not getattr(admin, "is_exited", False):
        return None
    from .offboarding_service import get_latest_fnf_status

    return {
        "is_exited": True,
        "exit_date": admin.exit_date.isoformat() if admin.exit_date else None,
        "exit_type": admin.exit_type,
        "login_until": (
            admin.exit_login_until.isoformat()
            if getattr(admin, "exit_login_until", None)
            else None
        ),
        "fnf_status": get_latest_fnf_status(admin.id) or "none",
        "can_download_relieving_letter": True,
        "can_download_experience_letter": True,
    }


_NOC_KEY_LABELS = {
    "HR": "Human Resource",
    "ACCOUNTS": "Accounts",
    "MANAGER": "Reporting Manager(s)",
    "IT": "IT Department",
}


def _normalize_noc_department_key(raw):
    if raw is None:
        return None
    x = str(raw).strip().lower()
    if x in ("hr", "human resource", "human resources"):
        return "HR"
    if x in ("accounts", "account"):
        return "ACCOUNTS"
    if x in ("manager", "reporting manager"):
        return "MANAGER"
    if x in ("it", "it department"):
        return "IT"
    return None


def _admin_emails_for_emp_type_tokens(lower_tokens):
    if not lower_tokens:
        return []
    filters = [func.lower(func.coalesce(Admin.emp_type, "")) == t for t in lower_tokens]
    rows = (
        Admin.query.filter(or_(*filters))
        .filter(or_(Admin.is_exited == False, Admin.is_exited.is_(None)))
        .all()
    )
    out = []
    seen = set()
    for a in rows:
        em = (a.email or "").strip()
        if em and em.lower() not in seen:
            seen.add(em.lower())
            out.append(em)
    return out


def _manager_emails_for_noc(admin):
    mc = ManagerContact.query.filter_by(user_email=admin.email).first()
    if not mc:
        mc = ManagerContact.query.filter_by(
            circle_name=admin.circle,
            user_type=admin.emp_type,
        ).first()
    if not mc:
        return []
    return get_manager_emails(mc, exclude_email=admin.email)


def _expand_noc_email_recipients(admin, ordered_keys):
    """ordered_keys: unique HR | ACCOUNTS | MANAGER | IT in UI order."""
    labels = []
    emails = []
    seen_e = set()

    for nk in ordered_keys:
        labels.append(_NOC_KEY_LABELS.get(nk, nk))
        chunk = []
        if nk == "HR":
            chunk = _admin_emails_for_emp_type_tokens(
                ["human resource", "human resources", "hr"]
            )
        elif nk == "ACCOUNTS":
            chunk = _admin_emails_for_emp_type_tokens(["accounts"])
        elif nk == "IT":
            chunk = _admin_emails_for_emp_type_tokens(["it", "it department"])
        elif nk == "MANAGER":
            chunk = _manager_emails_for_noc(admin)

        for em in chunk:
            el = em.lower()
            if el not in seen_e:
                seen_e.add(el)
                emails.append(em)

    return labels, emails



@leave.route("/attendance/summary", methods=["GET"])
@jwt_required()
def attendance_summary():
    try:
        return _attendance_summary_impl()
    except Exception:
        logger.exception("attendance_summary error")
        return jsonify(success=False, message="Failed to load attendance summary"), 500


def _attendance_summary_impl():
    email = get_jwt().get("email")
    admin = Admin.query.filter_by(email=email).first()

    if not admin:
        return jsonify({"success": False, "message": "Employee not found"}), 404

    today = date.today()

    selected_month = request.args.get("month", today.month, type=int)
    selected_year = request.args.get("year", today.year, type=int)

    calendar.setfirstweekday(calendar.MONDAY)

    first_day = date(selected_year, selected_month, 1)
    last_day = date(
        selected_year,
        selected_month,
        calendar.monthrange(selected_year, selected_month)[1]
    )

    punches = Punch.query.filter(
        Punch.admin_id == admin.id,
        Punch.punch_date.between(first_day, last_day)
    ).all()

    punch_map = {p.punch_date: p for p in punches}

    # Fetch approved and pending leaves
    leaves = LeaveApplication.query.filter(
        LeaveApplication.admin_id == admin.id,
        LeaveApplication.status.in_(["Approved", "Pending"]),
        LeaveApplication.start_date <= last_day,
        LeaveApplication.end_date >= first_day
    ).all()

    # Fetch approved and pending WFH applications
    wfh_apps = WorkFromHomeApplication.query.filter(
        WorkFromHomeApplication.admin_id == admin.id,
        WorkFromHomeApplication.status.in_(["Approved", "Pending"]),
        WorkFromHomeApplication.start_date <= last_day,
        WorkFromHomeApplication.end_date >= first_day
    ).all()
    holidays = HolidayCalendar.query.filter(
        HolidayCalendar.year == selected_year,
        HolidayCalendar.is_active.is_(True),
        HolidayCalendar.holiday_date.between(first_day, last_day),
    ).all()
    holiday_map = {h.holiday_date: h for h in holidays}

    def is_on_leave(d):
        # Only check for APPROVED leave - pending leave will not show as "On Leave"
        return any(lv.start_date <= d <= lv.end_date for lv in leaves if lv.status == "Approved")

    def is_wfh_approved(d):
        return any(wfh.start_date <= d <= wfh.end_date for wfh in wfh_apps if wfh.status == "Approved")

    def is_wfh_pending(d):
        return any(wfh.start_date <= d <= wfh.end_date for wfh in wfh_apps if wfh.status == "Pending")

    # ---------------- SUMMARY DATA ----------------
    # Working days so far (credited days):
    # - calendar working days up to today (or full past month)
    # - count: present / half-day punch / approved WFH / approved paid leave
    # - do NOT count: bare absents (no punch, no leave, no WFH)
    # - unpaid leave / sandwich LWP does not count
    # - sandwich: weekends/holidays between two leave-or-absent working days
    #   (same leave request OR Fri+Mon leave/absent bridge) — unpaid sandwich
    #   reduces the card only when that day is still a calendar working day
    #   (e.g. optional holiday); weekends never enter the card base
    emp_type = (admin.emp_type or "").strip()
    if selected_year == today.year and selected_month == today.month:
        working_days_end = today
    elif (selected_year, selected_month) < (today.year, today.month):
        working_days_end = last_day
    else:
        working_days_end = first_day - timedelta(days=1)

    FULL_DAY_WORK_SECONDS = 8 * 3600

    def _is_weekend_non_working(d):
        weekday = d.weekday()  # Mon=0 ... Sun=6
        return weekday == 6 or (
            weekday == 5 and emp_type not in ("Human Resource", "Accounts")
        )

    def _is_calendar_working_day(d):
        """Card base: exclude weekends + mandatory holidays (optional holidays remain working)."""
        holiday = holiday_map.get(d)
        is_mandatory_holiday = bool(holiday) and not bool(getattr(holiday, "is_optional", False))
        return (not _is_weekend_non_working(d)) and (not is_mandatory_holiday)

    def _is_sandwich_non_working(d):
        """Match leave sandwich policy: weekends + mandatory + optional holidays."""
        holiday = holiday_map.get(d)
        if holiday:
            return True
        return _is_weekend_non_working(d)

    def _leave_working_and_sandwich_days(start_d, end_d):
        if not start_d or not end_d or end_d < start_d:
            return [], []
        all_days = []
        cur = start_d
        while cur <= end_d:
            all_days.append(cur)
            cur += timedelta(days=1)
        working = [d for d in all_days if not _is_sandwich_non_working(d)]
        if not working:
            return [], []
        sandwich = []
        for d in all_days:
            if not _is_sandwich_non_working(d):
                continue
            if any(w < d for w in working) and any(w > d for w in working):
                sandwich.append(d)
        return working, sandwich

    def _punch_work_seconds(p):
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

    paid_leave_units = {}   # date -> 0.5 / 1.0
    unpaid_leave_units = {}  # date -> 0.5 / 1.0
    optional_leave_taken = set()
    unpaid_leave_days = 0.0

    def _add_unit(store, day, unit):
        store[day] = min(1.0, float(store.get(day, 0.0) or 0.0) + float(unit))

    approved_leaves = [lv for lv in leaves if str(lv.status or "").strip().lower() == "approved"]
    for lv in approved_leaves:
        if not lv.start_date or not lv.end_date:
            continue
        if lv.end_date < first_day or lv.start_date > working_days_end:
            continue

        leave_type = str(lv.leave_type or "").strip()
        is_half_day = leave_type.lower() == "half day leave"
        leave_working, leave_sandwich = _leave_working_and_sandwich_days(lv.start_date, lv.end_date)

        requested_paid = float(getattr(lv, "requested_deducted_days", None) or 0.0)
        deducted_total = float(lv.deducted_days or 0.0)
        sandwich_pl = float(getattr(lv, "sandwich_pl_days", None) or 0.0)
        extra = float(lv.extra_days or 0.0)

        def _consume_days(days, paid_quota, unpaid_quota, unit_default=1.0):
            """Split leave days into paid vs unpaid using quotas (working then sandwich)."""
            nonlocal unpaid_leave_days
            paid_left = float(paid_quota)
            unpaid_left = float(unpaid_quota)
            for day in days:
                unit = 0.5 if is_half_day else unit_default
                in_window = first_day <= day <= working_days_end
                affects_card = _is_calendar_working_day(day)
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
                    _add_unit(paid_leave_units, day, use_paid)
                if use_unpaid > 0:
                    _add_unit(unpaid_leave_units, day, use_unpaid)
                    if in_window and affects_card:
                        unpaid_leave_days += use_unpaid

                if is_half_day:
                    break
            return paid_left, unpaid_left

        if leave_type == "Optional Leave":
            # Optional holiday taken → not a credited working day for this employee.
            d = max(lv.start_date, first_day)
            d_end = min(lv.end_date, working_days_end)
            while d <= d_end:
                holiday = holiday_map.get(d)
                if holiday and bool(getattr(holiday, "is_optional", False)):
                    optional_leave_taken.add(d)
                d += timedelta(days=1)
            continue

        if is_half_day:
            paid = 0.0 if extra >= 0.5 else 0.5
            unpaid = 0.5 if extra >= 0.5 else 0.0
            days = [lv.start_date] if lv.start_date else []
            _consume_days(days, paid, unpaid, unit_default=0.5)
            continue

        if leave_type == "Privilege Leave":
            paid = deducted_total if deducted_total > 0 else requested_paid
            unpaid = extra
            ordered = sorted(set(leave_working + leave_sandwich))
            if paid <= 0 and unpaid <= 0 and ordered:
                paid = float(len(ordered))
            _consume_days(ordered, paid, unpaid)
            continue

        # Casual / Comp Off / others:
        # working days paid from leave type; sandwich paid from PL (sandwich_pl_days);
        # remaining sandwich / overflow is unpaid (extra_days).
        working_paid = requested_paid if requested_paid > 0 else max(0.0, deducted_total - sandwich_pl)
        if working_paid <= 0 and leave_working and extra <= 0 and sandwich_pl <= 0:
            working_paid = float(len(leave_working))

        _, unpaid_after_working = _consume_days(leave_working, working_paid, extra)
        _consume_days(leave_sandwich, sandwich_pl, unpaid_after_working)

    # Present / half-day punch maps (complete punch in + out only).
    worked_full_dates = set()
    worked_half_dates = set()
    for p in punches:
        if not p.punch_in or not p.punch_out:
            continue
        if p.punch_date < first_day or p.punch_date > working_days_end:
            continue
        secs = _punch_work_seconds(p)
        if secs >= FULL_DAY_WORK_SECONDS:
            worked_full_dates.add(p.punch_date)
        else:
            worked_half_dates.add(p.punch_date)

    approved_wfh_dates = set()
    for wfh in wfh_apps:
        if str(wfh.status or "").strip().lower() != "approved":
            continue
        d = max(wfh.start_date, first_day)
        d_end = min(wfh.end_date, working_days_end)
        while d <= d_end:
            approved_wfh_dates.add(d)
            d += timedelta(days=1)

    def _is_leave_or_absent_bridge(d):
        """Working day used for sandwich bridges: leave (paid/unpaid) or bare absent."""
        if not _is_calendar_working_day(d) or d in optional_leave_taken:
            return False
        if d in worked_full_dates or d in worked_half_dates or d in approved_wfh_dates:
            return False
        # On leave (paid or unpaid) or absent without coverage.
        return True

    # Attendance sandwich (leave OR absent on both sides): unpaid sandwich days
    # that fall on the card base (optional holidays) reduce credited working days.
    sandwich_bridge_unpaid = 0.0
    abs_bridge_marked = set()
    current = first_day
    while current <= working_days_end and current <= last_day:
        if (
            _is_sandwich_non_working(current)
            and current not in abs_bridge_marked
            and current not in paid_leave_units
            and current not in unpaid_leave_units
        ):
            # Find nearest calendar working days before/after inside month window.
            before = current - timedelta(days=1)
            after = current + timedelta(days=1)
            while before >= first_day and _is_sandwich_non_working(before):
                before -= timedelta(days=1)
            while after <= working_days_end and _is_sandwich_non_working(after):
                after += timedelta(days=1)
            if (
                first_day <= before <= working_days_end
                and first_day <= after <= working_days_end
                and _is_leave_or_absent_bridge(before)
                and _is_leave_or_absent_bridge(after)
            ):
                # Mark contiguous sandwich block between before and after.
                mid = before + timedelta(days=1)
                while mid < after:
                    if _is_sandwich_non_working(mid):
                        abs_bridge_marked.add(mid)
                        if (
                            _is_calendar_working_day(mid)
                            and mid not in optional_leave_taken
                            and mid not in paid_leave_units
                        ):
                            # Optional holiday sandwiched by leave/absent → not credited.
                            sandwich_bridge_unpaid += 1.0
                            _add_unit(unpaid_leave_units, mid, 1.0)
                    mid += timedelta(days=1)
        current += timedelta(days=1)

    unpaid_leave_days = round(unpaid_leave_days + sandwich_bridge_unpaid, 1)

    total_working_days = 0.0
    current = first_day
    while current <= working_days_end and current <= last_day:
        if not _is_calendar_working_day(current):
            current += timedelta(days=1)
            continue
        if current in optional_leave_taken:
            current += timedelta(days=1)
            continue

        unpaid_u = float(unpaid_leave_units.get(current, 0.0) or 0.0)
        paid_u = float(paid_leave_units.get(current, 0.0) or 0.0)

        # Fully unpaid leave / unpaid sandwich → not credited.
        if unpaid_u >= 1.0 - 1e-9:
            current += timedelta(days=1)
            continue

        # Full paid leave → credited working day.
        if paid_u >= 1.0 - 1e-9:
            total_working_days += 1.0
            current += timedelta(days=1)
            continue

        # Half unpaid leave: remaining half needs punch/WFH to credit 0.5.
        if unpaid_u >= 0.5 - 1e-9 and paid_u < 1e-9:
            if current in worked_full_dates or current in worked_half_dates or current in approved_wfh_dates:
                total_working_days += 0.5
            current += timedelta(days=1)
            continue

        # Half paid leave: credit 0.5 + another 0.5 if punched/WFH.
        if paid_u >= 0.5 - 1e-9:
            credit = 0.5
            if current in worked_full_dates or current in worked_half_dates or current in approved_wfh_dates:
                credit += 0.5
            total_working_days += credit
            current += timedelta(days=1)
            continue

        # No leave: present / WFH count; bare absent does not.
        if current in approved_wfh_dates or current in worked_full_dates:
            total_working_days += 1.0
        elif current in worked_half_dates:
            total_working_days += 0.5
        # else absent → 0

        current += timedelta(days=1)

    total_working_days = max(0.0, round(total_working_days, 1))

    # Keep total_present_days as the card value for API compatibility.
    total_present_days = total_working_days

    total_work_seconds = 0
    punch_in_seconds = []
    punch_out_seconds = []

    for p in punches:
        if p.punch_date.weekday() == 6:  # skip Sundays
            continue

        if p.punch_in and p.punch_out:
            if p.today_work:
                try:
                    h, m, s = map(int, str(p.today_work).split(":"))
                    total_work_seconds += h * 3600 + m * 60 + s
                except Exception:
                    pass

            def _to_seconds(dt):
                if dt is None:
                    return 0
                return getattr(dt, 'hour', 0) * 3600 + getattr(dt, 'minute', 0) * 60 + getattr(dt, 'second', 0)

            punch_in_seconds.append(_to_seconds(p.punch_in))
            punch_out_seconds.append(_to_seconds(p.punch_out))

    avg_punch_in = (
        str(timedelta(seconds=sum(punch_in_seconds) // len(punch_in_seconds)))
        if punch_in_seconds else None
    )

    avg_punch_out = (
        str(timedelta(seconds=sum(punch_out_seconds) // len(punch_out_seconds)))
        if punch_out_seconds else None
    )

    total_weekdays = sum(
        1 for day in range(1, last_day.day + 1)
        if date(selected_year, selected_month, day).weekday() < 5
    )

    expected_work_hours = total_weekdays * 9
    expected_work_seconds = expected_work_hours * 3600
    difference_seconds = total_work_seconds - expected_work_seconds

    # ---------------- CALENDAR DATA ----------------
    calendar_data = []
    today = date.today()

    current_day = first_day
    while current_day <= last_day:

        day_status = {
            "date": current_day.isoformat(),
            "day": current_day.day,
            "weekday": current_day.strftime("%A"),
            "status": None,
            "details": {}
        }

        punch = punch_map.get(current_day)
        holiday = holiday_map.get(current_day)
        is_future = current_day > today

        # Priority: Punch record > Holiday > Weekend > WFH/Leave/Absent
        if punch:
                # Has punch record - use punch status
                if punch.punch_in and not punch.punch_out:
                    day_status["status"] = "PENDING_PUNCH_OUT"
                else:
                    work_seconds = 0
                    if punch.today_work:
                        try:
                            h, m, s = map(int, str(punch.today_work).split(":"))
                            work_seconds = h * 3600 + m * 60 + s
                        except:
                            pass
                    # 8 hours threshold: < 8h = HALF_DAY, >= 8h = PRESENT (aligned with Accounts)
                    if work_seconds < (8 * 3600):
                        day_status["status"] = "HALF_DAY"
                    else:
                        day_status["status"] = "PRESENT"
                
                # Mark WFH if punch has is_wfh or if there's an approved WFH application
                if getattr(punch, "is_wfh", False) or is_wfh_approved(current_day):
                    day_status["details"]["wfh"] = True
                # Only show pending WFH for past/current dates
                if not is_future and is_wfh_pending(current_day):
                    day_status["details"]["wfh_pending"] = True
                
                def _fmt_time(t):
                    if t is None:
                        return None
                    return t.strftime("%H:%M:%S") if hasattr(t, 'strftime') else str(t)
                
                day_status["details"].update({
                    "punch_in": _fmt_time(punch.punch_in),
                    "punch_out": _fmt_time(punch.punch_out),
                    "work_hours": str(punch.today_work) if punch.today_work else None
                })

        elif holiday:
            day_status["status"] = "HOLIDAY_OPTIONAL" if holiday.is_optional else "HOLIDAY"
            day_status["details"]["holiday_name"] = holiday.holiday_name
            day_status["details"]["is_optional"] = bool(holiday.is_optional)

        elif current_day.weekday() >= 5:
            day_status["status"] = "WEEKEND"

        # No punch record - check WFH and Leave applications
        elif is_future:
                # For future dates, only show APPROVED leave/WFH
                if is_wfh_approved(current_day):
                    day_status["status"] = "WFH_APPROVED"
                    day_status["details"]["wfh"] = True
                elif is_on_leave(current_day):
                    day_status["status"] = "LEAVE"
                else:
                    # Future dates without approved leave/WFH - keep blank (white background)
                    day_status["status"] = "ABSENT"
        else:
                # Past/current dates - only show APPROVED leave/WFH
                if is_wfh_approved(current_day):
                    day_status["status"] = "WFH_APPROVED"
                    day_status["details"]["wfh"] = True
                
                elif is_wfh_pending(current_day):
                    day_status["status"] = "WFH_PENDING"
                    day_status["details"]["wfh_pending"] = True
                
                elif is_on_leave(current_day):
                    # Only show approved leave as "LEAVE"
                    day_status["status"] = "LEAVE"
                
                else:
                    # Pending leave or no leave/WFH - show as ABSENT
                    day_status["status"] = "ABSENT"

        calendar_data.append(day_status)
        current_day += timedelta(days=1)

    # ---------------- FINAL RESPONSE ----------------
    return jsonify({
        "success": True,
        "month": f"{calendar.month_name[selected_month]} {selected_year}",

        # Summary cards
        "total_present_days": total_present_days,  # credited working days (present/WFH/paid leave; absents & unpaid excluded)
        "total_working_days": total_working_days,
        "unpaid_leave_days": round(unpaid_leave_days, 1),
        "average_punch_in": avg_punch_in,
        "average_punch_out": avg_punch_out,
        "actual_work_hours": str(timedelta(seconds=total_work_seconds)),
        "expected_work_hours": f"{expected_work_hours}:00:00",
        "difference": str(timedelta(seconds=difference_seconds)),

        # 🔹 NEW calendar data
        "calendar": calendar_data
    }), 200


@leave.route("/attendance/download", methods=["GET"])
@jwt_required()
def download_my_attendance_excel():
    email = get_jwt().get("email")
    admin = Admin.query.filter_by(email=email).first()

    if not admin:
        return jsonify({"success": False, "message": "Employee not found"}), 404

    month_str = (request.args.get("month") or "").strip()
    if month_str:
        try:
            year, month = map(int, month_str.split("-"))
        except ValueError:
            return jsonify({"success": False, "message": "Invalid month. Use YYYY-MM"}), 400
    else:
        now = datetime.now()
        year, month = now.year, now.month

    if month < 1 or month > 12:
        return jsonify({"success": False, "message": "Invalid month. Use YYYY-MM"}), 400

    output = generate_attendance_excel(
        admins=[admin],
        emp_type=admin.emp_type or "Employee",
        circle=admin.circle or "NHQ",
        year=year,
        month=month,
        file_prefix="Attendance",
    )
    filename = f"Attendance_{admin.emp_id or admin.id}_{calendar.month_name[month]}_{year}.xlsx"
    return send_excel_file(
        output,
        download_name=filename,
        mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )



@leave.route("/LeaveDetails", methods=["GET"])
@jwt_required()
def leave_page_summary():
    email = get_jwt().get("email")
    admin = Admin.query.filter_by(email=email).first()

    if not admin:
        return jsonify({
            "success": False,
            "message": "Employee not found"
        }), 404

    # -------- FETCH LEAVE BALANCE --------
    leave_balance = LeaveBalance.query.filter_by(
        admin_id=admin.id
    ).first()

    total_pl = leave_balance.privilege_leave_balance if leave_balance else 0.0
    total_cl = leave_balance.casual_leave_balance if leave_balance else 0.0
    from .compoff_utils import get_effective_comp_balance
    total_compoff = get_effective_comp_balance(admin.id)

    # -------- FETCH ALL LEAVE APPLICATIONS --------
    leave_applications = LeaveApplication.query.filter_by(
        admin_id=admin.id
    ).order_by(LeaveApplication.created_at.desc()).all()

    applications = []

    for leave in leave_applications:
        applications.append({
            "id": leave.id,
            "leave_type": leave.leave_type,
            "reason": leave.reason,
            "start_date": leave.start_date.strftime("%Y-%m-%d"),
            "end_date": leave.end_date.strftime("%Y-%m-%d"),
            "status": leave.status,
            "deducted_days": leave.deducted_days,
            "extra_days": leave.extra_days,
            "created_at": leave.created_at.strftime("%Y-%m-%d %H:%M:%S")
        })

    return jsonify({
        "success": True,
        "summary": {
            "PL": total_pl,
            "CL": total_cl,
            "COMPOFF": total_compoff
        },
        "applications": applications
    }), 200


@leave.route("/compoff/ledger", methods=["GET"])
@jwt_required()
def compoff_ledger():
    """Employee Comp Off ledger: credits, expiry, pending applications, usage history."""
    email = get_jwt().get("email")
    admin = Admin.query.filter_by(email=email).first()
    if not admin:
        return jsonify({"success": False, "message": "Employee not found"}), 404

    from .compoff_utils import build_compoff_ledger

    ledger = build_compoff_ledger(admin.id)
    return jsonify({"success": True, "ledger": ledger}), 200


@leave.route("/optional-holidays", methods=["GET"])
@jwt_required()
def list_optional_holidays_for_leave():
    """Optional holidays for leave apply (all authenticated employees)."""
    email = get_jwt().get("email")
    admin = Admin.query.filter_by(email=email).first()
    if not admin:
        return jsonify({"success": False, "message": "Employee not found"}), 404

    year = _parse_leave_year(request.args.get("year", datetime.now(ZoneInfo("Asia/Kolkata")).year))
    if not year:
        return jsonify({
            "success": False,
            "message": "Invalid year. Allowed range: 2000-2100",
        }), 400

    optional_leave_used = _has_optional_leave_for_year(admin.id, year)
    rows = _fetch_optional_holiday_rows(year)
    today_ist = datetime.now(ZoneInfo("Asia/Kolkata")).date()

    return jsonify({
        "success": True,
        "year": year,
        "optional_leave_used": optional_leave_used,
        "holidays": [_serialize_optional_holiday(r) for r in rows],
        "selectable_holidays": [] if optional_leave_used else [
            _serialize_optional_holiday(r)
            for r in rows
            if r.holiday_date and r.holiday_date >= today_ist
        ],
    }), 200


@leave.route("/apply", methods=["POST"])
@jwt_required()
def apply_leave_api():
    email = get_jwt().get("email")

    # -------------------------
    # Fetch employee from Admin
    # -------------------------
    admin = Admin.query.filter_by(email=email).first()
    if not admin:
        return jsonify({
            "success": False,
            "message": "Employee not found"
        }), 404

    leave_balance = LeaveBalance.query.filter_by(
        admin_id=admin.id
    ).first()

    if not leave_balance:
        return jsonify({
            "success": False,
            "message": "Leave balance not configured"
        }), 400

    data = request.get_json(silent=True) or {}

    # -------------------------
    # Validate dates
    # -------------------------
    try:
        start_date = datetime.strptime(
            data.get("start_date"), "%Y-%m-%d"
        ).date()
        end_date = datetime.strptime(
            data.get("end_date"), "%Y-%m-%d"
        ).date()
    except Exception:
        return jsonify({
            "success": False,
            "message": "Invalid date format. Use YYYY-MM-DD"
        }), 400

    if end_date < start_date:
        return jsonify({
            "success": False,
            "message": "End date cannot be before start date"
        }), 400

    today_ist = datetime.now(ZoneInfo("Asia/Kolkata")).date()
    if start_date < today_ist:
        return jsonify({
            "success": False,
            "message": "Cannot apply leave for past dates"
        }), 400
    if end_date < today_ist:
        return jsonify({
            "success": False,
            "message": "End date cannot be in the past"
        }), 400

    leave_type = data.get("leave_type")
    reason = (data.get("reason") or "").strip()

    if not leave_type or not reason:
        return jsonify({
            "success": False,
            "message": "leave_type and reason are required"
        }), 400

    if len(reason) < 20:
        return jsonify({
            "success": False,
            "message": "Reason must be at least 20 characters long"
        }), 400

    # -------------------------
    # 🚫 OPTIONAL LEAVE: Max 1 per year (check FIRST, before overlapping check)
    # -------------------------
    if leave_type == "Optional Leave":
        if _has_optional_leave_for_year(admin.id, start_date.year):
            return jsonify({
                "success": False,
                "message": (
                    f"Optional Leave can only be used once per year. "
                    f"You have already applied for Optional Leave in {start_date.year}."
                )
            }), 400

        if start_date != end_date:
            return jsonify({
                "success": False,
                "message": "Optional Leave can only be applied for one day"
            }), 400

        if not _optional_holiday_on_date(start_date):
            return jsonify({
                "success": False,
                "message": "Selected date is not an optional holiday in the company calendar"
            }), 400

    # -------------------------
    # 🚫 DUPLICATE / SAME DATE CHECK (skip for Optional Leave - it's a special holiday)
    # -------------------------
    if leave_type != "Optional Leave":  # Optional Leave can overlap with other leaves
        overlapping_leave = LeaveApplication.query.filter(
            LeaveApplication.admin_id == admin.id,
            LeaveApplication.status.in_(["Pending", "Approved"]),
            LeaveApplication.start_date <= end_date,
            LeaveApplication.end_date >= start_date
        ).first()

        if overlapping_leave:
            return jsonify({
                "success": False,
                "message": (
                    f"Leave already applied from "
                    f"{overlapping_leave.start_date} to "
                    f"{overlapping_leave.end_date} "
                    f"(Status: {overlapping_leave.status})"
                )
            }), 409

    overlapping_wfh = WorkFromHomeApplication.query.filter(
        WorkFromHomeApplication.admin_id == admin.id,
        WorkFromHomeApplication.status.in_(["Pending", "Approved"]),
        WorkFromHomeApplication.start_date <= end_date,
        WorkFromHomeApplication.end_date >= start_date,
    ).first()

    if overlapping_wfh:
        return jsonify({
            "success": False,
            "message": (
                f"WFH already applied from {overlapping_wfh.start_date} to "
                f"{overlapping_wfh.end_date} (Status: {overlapping_wfh.status}). "
                f"Cannot apply leave on the same dates."
            ),
        }), 409

    # -------------------------
    # Leave calculations (compute requested vs. payable days)
    # NOTE: We ONLY adjust LeaveBalance when manager APPROVES.
    # Here we just compute how many days should be deducted vs. treated as LOP.
    # -------------------------
    emp_type = getattr(admin, "emp_type", None) or ""

    # Sandwich leave policy (all leave types):
    # - working days count against requested leave type
    # - sandwich days (non-working) are deducted from PL if available, else treated as LWP (extra_days)
    # Half Day Leave overrides this to 0.5 below.
    working_days, sandwich_days = _compute_working_and_sandwich_days(
        emp_type=emp_type,
        start_date=start_date,
        end_date=end_date,
    )
    leave_days = float(working_days) + float(sandwich_days)
    deducted_days = 0.0
    extra_days = 0.0
    requested_deducted_days = 0.0
    sandwich_pl_days = 0.0

    # Privilege Leave
    if leave_type == "Privilege Leave":
        available = float(leave_balance.privilege_leave_balance or 0.0)
        if leave_days > available:
            # Part of this leave will be LOP (extra_days)
            extra_days = leave_days - available
            deducted_days = available
        else:
            deducted_days = leave_days
        requested_deducted_days = float(deducted_days)
        sandwich_pl_days = 0.0

    # Casual Leave
    elif leave_type == "Casual Leave":
        # Max 2 CL working days; sandwich days handled separately from PL/LWP.
        if working_days > 2:
            return jsonify({
                "success": False,
                "message": "Casual Leave cannot exceed 2 days"
            }), 400

        available = float(leave_balance.casual_leave_balance or 0.0)
        if working_days > available:
            return jsonify({
                "success": False,
                "message": "Insufficient Casual Leave balance"
            }), 400

        requested_deducted_days = float(working_days)
        deducted_days = requested_deducted_days

    # Half Day Leave
    elif leave_type == "Half Day Leave":
        if (end_date - start_date).days + 1 > 1:
            return jsonify({
                "success": False,
                "message": "Half Day Leave can only be applied for one day"
            }), 400

        # Always a single half day
        leave_days = 0.5
        deducted_days = 0.5
        requested_deducted_days = 0.5
        sandwich_days = 0.0

        cl_available = float(leave_balance.casual_leave_balance or 0.0)
        pl_available = float(leave_balance.privilege_leave_balance or 0.0)
        if cl_available < 0.5 and pl_available < 0.5:
            # No balance available at all → treat fully as LOP
            extra_days = 0.5

    # Compensatory Leave (balance from CompOffGain: non-expired, unused; max 2 per application)
    elif leave_type == "Compensatory Leave":
        from .compoff_utils import (
            get_effective_comp_balance,
            count_compoff_applications_in_month,
            MAX_COMPOFF_APPLICATIONS_PER_MONTH,
            MAX_COMPOFF_DAYS_PER_APPLICATION,
        )
        available = get_effective_comp_balance(admin.id)

        if available <= 0:
            return jsonify({
                "success": False,
                "message": "No Compensatory Leave balance available"
            }), 400

        month_count = count_compoff_applications_in_month(
            admin.id, start_date.year, start_date.month
        )
        if month_count >= MAX_COMPOFF_APPLICATIONS_PER_MONTH:
            return jsonify({
                "success": False,
                "message": (
                    f"Maximum {MAX_COMPOFF_APPLICATIONS_PER_MONTH} Compensatory Leave "
                    f"applications allowed per month. You already have {month_count} "
                    f"in {start_date.strftime('%B %Y')}."
                ),
            }), 400

        # Max 2 CompOff working days; sandwich days handled separately from PL/LWP.
        if working_days > MAX_COMPOFF_DAYS_PER_APPLICATION:
            return jsonify({
                "success": False,
                "message": "Maximum 2 Compensatory Leave days allowed"
            }), 400

        if leave_days > available:
            return jsonify({
                "success": False,
                "message": "Insufficient Compensatory Leave balance"
            }), 400

        requested_deducted_days = float(working_days)
        deducted_days = requested_deducted_days

    # Optional Leave (Optional Holiday) - doesn't deduct from any leave balance
    elif leave_type == "Optional Leave":
        # Optional Leave is a special holiday that doesn't count against leave balances
        # Max 1 per year (enforced by backend validation above)
        if leave_days > 1:
            return jsonify({
                "success": False,
                "message": "Optional Leave can only be applied for one day"
            }), 400

        # Optional Leave doesn't deduct from any balance, just records the application
        # Set deducted_days to 1 (or leave_days) for tracking / display purposes
        deducted_days = float(leave_days)
        extra_days = 0.0
        requested_deducted_days = float(leave_days)
        sandwich_days = 0.0

    else:
        return jsonify({
            "success": False,
            "message": "Invalid leave type"
        }), 400

    # Deduct sandwich days from PL (Leave With Pay) if available; remainder becomes LWP (extra_days).
    if sandwich_days > 0 and leave_type not in ("Privilege Leave", "Optional Leave"):
        pl_available = float(leave_balance.privilege_leave_balance or 0.0)
        pl_used_for_sandwich = min(pl_available, float(sandwich_days))
        sandwich_pl_days = float(pl_used_for_sandwich)
        sandwich_lwp = float(sandwich_days) - float(pl_used_for_sandwich)
        deducted_days = float(deducted_days) + sandwich_pl_days
        extra_days = float(extra_days) + sandwich_lwp

    # -------------------------
    # Save leave application
    # -------------------------
    leave_application = LeaveApplication(
        admin_id=admin.id,
        leave_type=leave_type,
        reason=reason,
        start_date=start_date,
        end_date=end_date,
        status="Pending",
        deducted_days=deducted_days,
        extra_days=extra_days,
        requested_deducted_days=requested_deducted_days,
        sandwich_pl_days=sandwich_pl_days,
    )

    try:
        db.session.add(leave_application)
        db.session.commit()
        
        # Log for debugging
        current_app.logger.info(f"Leave application saved: ID={leave_application.id}, Type={leave_type}, Status={leave_application.status}")
        
        send_leave_applied_email(admin, leave_application)
        return jsonify({
            "success": True,
            "message": "Leave applied successfully",
            "leave_id": leave_application.id,
            "leave_type": leave_type,
            "deducted_days": deducted_days,
            "extra_days": extra_days
        }), 201

    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Leave Apply Error: {e}", exc_info=True)
        return jsonify({
            "success": False,
            "message": f"Unable to apply leave: {str(e)}"
        }), 500



@leave.route("/wfh", methods=["POST"])
@jwt_required()
def submit_wfh():
    email = get_jwt().get("email")
    admin = Admin.query.filter_by(email=email).first()

    if not admin:
        return jsonify({
            "success": False,
            "message": "Employee not found"
        }), 404

    data = request.get_json() or {}

    start_date = data.get("start_date")
    end_date = data.get("end_date")
    reason = data.get("reason")

    if not start_date or not end_date or not reason:
        return jsonify({
            "success": False,
            "message": "Start date, end date and reason are required"
        }), 400

    if not isinstance(reason, str) or not reason.strip():
        return jsonify({
            "success": False,
            "message": "Reason is required"
        }), 400

    try:
        start_d = datetime.strptime(str(start_date).strip(), "%Y-%m-%d").date()
        end_d = datetime.strptime(str(end_date).strip(), "%Y-%m-%d").date()
    except ValueError:
        return jsonify({
            "success": False,
            "message": "Invalid date format. Use YYYY-MM-DD"
        }), 400

    if end_d < start_d:
        return jsonify({
            "success": False,
            "message": "End date must be on or after start date"
        }), 400

    # Prevent re-application for same/overlapping dates (Pending or Approved)
    overlapping_wfh = WorkFromHomeApplication.query.filter(
        WorkFromHomeApplication.admin_id == admin.id,
        WorkFromHomeApplication.status.in_(["Pending", "Approved"]),
        WorkFromHomeApplication.start_date <= end_d,
        WorkFromHomeApplication.end_date >= start_d
    ).first()

    if overlapping_wfh:
        return jsonify({
            "success": False,
            "message": (
                f"WFH already applied from {overlapping_wfh.start_date} to "
                f"{overlapping_wfh.end_date} (Status: {overlapping_wfh.status})"
            )
        }), 409

    overlapping_leave = LeaveApplication.query.filter(
        LeaveApplication.admin_id == admin.id,
        LeaveApplication.status.in_(["Pending", "Approved"]),
        LeaveApplication.start_date <= end_d,
        LeaveApplication.end_date >= start_d,
    ).first()

    if overlapping_leave:
        return jsonify({
            "success": False,
            "message": (
                f"Leave already applied from {overlapping_leave.start_date} to "
                f"{overlapping_leave.end_date} (Status: {overlapping_leave.status}). "
                f"Cannot apply WFH on the same dates."
            ),
        }), 409

    wfh_application = WorkFromHomeApplication(
        admin_id=admin.id,
        start_date=start_d,
        end_date=end_d,
        reason=reason.strip(),
        status="Pending",
        created_at=datetime.now(pytz.timezone("Asia/Kolkata"))
    )

    db.session.add(wfh_application)
    db.session.commit()

    # 🔔 Send approval email
    email_sent = False
    try:
        email_sent = send_wfh_approval_email_to_managers(admin, wfh_application)
    except Exception as e:
        current_app.logger.error(f"WFH email error: {e}")

    return jsonify({
        "success": True,
        "message": "WFH request submitted successfully",
        "email_sent": email_sent,
        "wfh_id": wfh_application.id
    }), 201


@leave.route("/wfh", methods=["GET"])
@jwt_required()
def get_wfh_applications():
    email = get_jwt().get("email")
    admin = Admin.query.filter_by(email=email).first()

    if not admin:
        return jsonify({
            "success": False,
            "message": "Employee not found"
        }), 404

    applications = WorkFromHomeApplication.query.filter_by(
        admin_id=admin.id
    ).order_by(WorkFromHomeApplication.created_at.desc()).all()

    def _iso(d):
        return d.isoformat() if d and hasattr(d, 'isoformat') else str(d)

    return jsonify({
        "success": True,
        "applications": [
            {
                "id": w.id,
                "start_date": _iso(w.start_date),
                "end_date": _iso(w.end_date),
                "reason": w.reason or "",
                "status": w.status or "Pending",
                "created_at": _iso(w.created_at)
            }
            for w in applications
        ]
    }), 200


@leave.route("/requests/<int:leave_id>/cancel", methods=["POST"])
@jwt_required()
def cancel_leave_request(leave_id):
    email = get_jwt().get("email")
    admin = Admin.query.filter_by(email=email).first()
    if not admin:
        return jsonify({"success": False, "message": "Employee not found"}), 404

    leave_obj = LeaveApplication.query.filter_by(
        id=leave_id, admin_id=admin.id
    ).first()
    if not leave_obj:
        return jsonify({"success": False, "message": "Leave request not found"}), 404
    if leave_obj.status != "Pending":
        return jsonify({
            "success": False,
            "message": "Only pending leave requests can be cancelled",
        }), 409

    leave_obj.status = "Cancelled"
    db.session.commit()

    return jsonify({
        "success": True,
        "message": "Leave request cancelled successfully",
    }), 200


@leave.route("/wfh/<int:wfh_id>/cancel", methods=["POST"])
@jwt_required()
def cancel_wfh_request(wfh_id):
    email = get_jwt().get("email")
    admin = Admin.query.filter_by(email=email).first()
    if not admin:
        return jsonify({"success": False, "message": "Employee not found"}), 404

    wfh_obj = WorkFromHomeApplication.query.filter_by(
        id=wfh_id, admin_id=admin.id
    ).first()
    if not wfh_obj:
        return jsonify({"success": False, "message": "WFH request not found"}), 404
    if wfh_obj.status != "Pending":
        return jsonify({
            "success": False,
            "message": "Only pending WFH requests can be cancelled",
        }), 409

    wfh_obj.status = "Cancelled"
    db.session.commit()

    return jsonify({
        "success": True,
        "message": "WFH request cancelled successfully",
    }), 200




@leave.route("/claim-expense", methods=["POST"])
@jwt_required()
def submit_expense_claim():
    email = get_jwt().get("email")

    admin = Admin.query.filter_by(email=email).first()
    if not admin:
        return jsonify({
            "success": False,
            "message": "Employee not found"
        }), 404

    try:
        data = request.form

        # -------------------------
        # Parse expenses safely
        # -------------------------
        try:
            expenses = json.loads(data.get("expenses", "[]"))
            if not isinstance(expenses, list) or not expenses:
                return jsonify({
                    "success": False,
                    "message": "At least one expense item is required"
                }), 400
        except json.JSONDecodeError:
            return jsonify({
                "success": False,
                "message": "Invalid expenses JSON"
            }), 400

        # -------------------------
        # Parse header dates
        # -------------------------
        try:
            travel_from_date = datetime.strptime(
                data.get("travel_from_date"), "%Y-%m-%d"
            ).date()
            travel_to_date = datetime.strptime(
                data.get("travel_to_date"), "%Y-%m-%d"
            ).date()
        except Exception:
            return jsonify({
                "success": False,
                "message": "Invalid travel date format (YYYY-MM-DD)"
            }), 400

        if travel_from_date > travel_to_date:
            return jsonify({
                "success": False,
                "message": "Travel From cannot be after Travel To"
            }), 400

        header = ExpenseClaimHeader(
            admin_id=admin.id,
            employee_name=data.get("employee_name"),
            designation=data.get("designation"),
            emp_id=data.get("emp_id"),
            email=email,
            project_name=data.get("project_name"),
            country_state=data.get("country_state"),
            travel_from_date=travel_from_date,
            travel_to_date=travel_to_date
        )

        db.session.add(header)
        db.session.flush()

        # -------------------------
        # File upload directory
        # -------------------------
        upload_folder = os.path.join(
            current_app.root_path, "static/uploads/expenses"
        )
        os.makedirs(upload_folder, exist_ok=True)

        # -------------------------
        # Save line items
        # -------------------------
        for index, exp in enumerate(expenses):
            filename = None

            file = request.files.get(f"attachments_{index}")
            if file and file.filename:
                sr = exp.get("sr_no") or (index + 1)
                basename = secure_filename(
                    f"{data.get('emp_id')}_{header.id}_{sr}_{file.filename}"
                )
                file.save(os.path.join(upload_folder, basename))
                filename = claim_attach_storage_name(basename)

            try:
                item_date = datetime.strptime(
                    exp.get("date"), "%Y-%m-%d"
                ).date()
            except Exception:
                return jsonify({
                    "success": False,
                    "message": f"Invalid expense date at item {index + 1}"
                }), 400

            if not (travel_from_date <= item_date <= travel_to_date):
                return jsonify({
                    "success": False,
                    "message": (
                        f"Expense item {index + 1} date must be within the travel period "
                        f"({travel_from_date.isoformat()} to {travel_to_date.isoformat()})"
                    )
                }), 400

            item = ExpenseLineItem(
                claim_id=header.id,
                sr_no=exp.get("sr_no"),
                date=item_date,
                purpose=exp.get("purpose"),
                amount=exp.get("amount"),
                currency=exp.get("currency"),
                Attach_file=filename,
                status="Pending"
            )
            db.session.add(item)

        db.session.commit()

        # -------------------------
        # Email (NON-BLOCKING)
        # -------------------------
        try:
            send_claim_submission_email(header)
        except Exception as e:
            current_app.logger.warning(f"Expense email failed: {e}")

        return jsonify({
            "success": True,
            "message": "Expense claim submitted successfully",
            "claim_id": header.id
        }), 201

    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Expense Claim Error: {e}")
        return jsonify({
            "success": False,
            "message": "Unable to submit expense claim"
        }), 500



@leave.route("/claim-expense", methods=["GET"])
@jwt_required()
def get_expense_claims():
    email = get_jwt().get("email")

    admin = Admin.query.filter_by(email=email).first()
    if not admin:
        return jsonify({
            "success": False,
            "message": "Employee not found"
        }), 404

    claims = ExpenseClaimHeader.query.filter_by(
        admin_id=admin.id
    ).order_by(ExpenseClaimHeader.id.desc()).all()

    return jsonify({
        "success": True,
        "claims": [
            {
                "id": claim.id,
                "employee_name": claim.employee_name,
                "emp_id": claim.emp_id,
                "project_name": claim.project_name,
                "country_state": claim.country_state,
                "travel_from_date": claim.travel_from_date.isoformat(),
                "travel_to_date": claim.travel_to_date.isoformat(),
                "items": [
                    {
                        "sr_no": item.sr_no,
                        "date": item.date.isoformat(),
                        "purpose": item.purpose,
                        "amount": item.amount,
                        "currency": item.currency,
                        "file": item.Attach_file,
                        "status": item.status
                    }
                    for item in ExpenseLineItem.query.filter_by(
                        claim_id=claim.id
                    ).all()
                ]
            }
            for claim in claims
        ]
    }), 200
@leave.route("/seperation", methods=["POST"])
@jwt_required()
def submit_resignation():
    email = get_jwt().get("email")
    admin = Admin.query.filter_by(email=email).first()

    if not admin:
        return jsonify({
            "success": False,
            "message": "Employee not found"
        }), 404

    # Prevent duplicate active resignation, but allow re-apply after revoke/reject.
    latest_resignation = Resignation.query.filter_by(admin_id=admin.id).order_by(Resignation.id.desc()).first()
    if latest_resignation and _is_active_resignation_status(latest_resignation.status):
        return jsonify({
            "success": False,
            "message": "You have already submitted a resignation request."
        }), 409

    data = request.get_json() or {}

    resignation_date = data.get("resignation_date")
    reason = data.get("reason")

    if not resignation_date or not reason:
        return jsonify({
            "success": False,
            "message": "Resignation date and reason are required"
        }), 400

    try:
        resignation_date_obj = datetime.strptime(
            resignation_date, "%Y-%m-%d"
        ).date()
    except ValueError:
        return jsonify({
            "success": False,
            "message": "Invalid date format. Use YYYY-MM-DD"
        }), 400

    resignation = Resignation(
        admin_id=admin.id,
        resignation_date=resignation_date_obj,
        reason=reason,
        status="Pending"
    )

    try:
        db.session.add(resignation)
        db.session.commit()

        # 🔔 Email (NON-BLOCKING)
        success, _ = send_resignation_email(admin, resignation)

        return jsonify({
            "success": True,
            "message": "Resignation submitted successfully",
            "email_sent": success
        }), 201

    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Resignation Error: {e}")
        return jsonify({
            "success": False,
            "message": "Unable to submit resignation. Please try again later."
        }), 500


@leave.route("/seperation/noc-request", methods=["POST"])
@jwt_required()
def submit_noc_request_email():
    """Employee applies for NOC: email selected departments + CC chain."""
    email_claim = get_jwt().get("email")
    admin = Admin.query.filter_by(email=email_claim).first()
    if not admin:
        return jsonify({"success": False, "message": "Employee not found"}), 404

    data = request.get_json() or {}
    raw_deps = data.get("departments") or data.get("department")

    if isinstance(raw_deps, str):
        raw_deps = [raw_deps]
    elif not isinstance(raw_deps, list):
        raw_deps = []

    if not raw_deps:
        return jsonify({"success": False, "message": "Select at least one department"}), 400

    resignation = (
        Resignation.query.filter_by(admin_id=admin.id).order_by(Resignation.id.desc()).first()
    )
    if not resignation or not _is_active_resignation_status(resignation.status):
        return jsonify(
            {
                "success": False,
                "message": "No active resignation found. Submit your resignation first.",
            }
        ), 400

    noc_date_obj = resignation.resignation_date
    if noc_date_obj is None:
        return jsonify(
            {"success": False, "message": "Resignation date is missing. Contact HR."}
        ), 400

    normalized_ordered = []
    seen_k = set()
    for raw in raw_deps:
        nk = _normalize_noc_department_key(raw)
        if nk is None:
            return jsonify({"success": False, "message": f"Invalid department: {raw}"}), 400
        if nk not in seen_k:
            seen_k.add(nk)
            normalized_ordered.append(nk)

    labels, recipients = _expand_noc_email_recipients(admin, normalized_ordered)
    if not recipients:
        return jsonify(
            {
                "success": False,
                "mail_sent": False,
                "message": "Mail could not be sent to the selected departments. Please contact HR.",
            }
        ), 200

    # In-app queue rows for selected departments (HR, Accounts, Manager, IT).
    try:
        NocDepartmentRequest.query.filter(
            NocDepartmentRequest.admin_id == admin.id,
            NocDepartmentRequest.resignation_id == resignation.id,
            NocDepartmentRequest.department_key.in_(normalized_ordered),
            NocDepartmentRequest.status == "Pending",
        ).delete(synchronize_session=False)
        now_ts = datetime.now()
        for nk in normalized_ordered:
            db.session.add(
                NocDepartmentRequest(
                    admin_id=admin.id,
                    resignation_id=resignation.id,
                    department_key=nk,
                    noc_date=noc_date_obj,
                    status="Pending",
                    requested_at=now_ts,
                )
            )
        db.session.commit()
    except Exception as e:
        db.session.rollback()
        logger.exception("NOC department request persist failed: %s", e)
        return jsonify(
            {"success": False, "message": "Unable to record NOC department requests. Please try again."}
        ), 500

    ok, _mail_msg = send_noc_request_email(
        admin, resignation, noc_date_obj, labels, recipients
    )
    if not ok:
        return jsonify(
            {
                "success": False,
                "mail_sent": False,
                "message": "Mail could not be sent to the selected departments. Please try again later or contact HR.",
            }
        ), 200

    return jsonify(
        {
            "success": True,
            "mail_sent": True,
            "message": "NOC request email sent.",
        }
    ), 200


@leave.route("/seperation", methods=["GET"])
@jwt_required()
def get_resignation_status():
    try:
        claims = get_jwt()
        email = claims.get("email")
        if not email:
            return jsonify({"success": False, "message": "Invalid token"}), 401

        admin = Admin.query.filter_by(email=email).first()
        if not admin:
            return jsonify({
                "success": False,
                "message": "Employee not found"
            }), 404

        resignation = Resignation.query.filter_by(admin_id=admin.id).order_by(Resignation.id.desc()).first()
        noc_upload = Noc_Upload.query.filter_by(admin_id=admin.id).order_by(Noc_Upload.id.desc()).first()

        # Full history for display under the form
        history_rows = Resignation.query.filter_by(admin_id=admin.id).order_by(
            Resignation.resignation_date.desc(), Resignation.id.desc()
        ).all()
        history = []
        for r in history_rows:
            applied_on = getattr(r, 'applied_on', None)
            created_at_str = isoformat_api(applied_on) if applied_on else None
            history.append({
                "id": r.id,
                "resignation_date": r.resignation_date.isoformat() if r.resignation_date else None,
                "reason": r.reason,
                "status": r.status,
                "created_at": created_at_str,
            })

        if resignation:
            applied_on = getattr(resignation, 'applied_on', None)
            created_at_str = isoformat_api(applied_on) if applied_on else None
            notice_info = _serialize_notice(resignation)

            # Consider "already_submitted" only for active resignations (pending/approved).
            # After revoke/reject, the UI can reopen the form while still showing history.
            status = (resignation.status or "").strip()
            is_active = _is_active_resignation_status(status)

            return jsonify({
                "success": True,
                "already_submitted": is_active,
                "resignation": {
                    "id": resignation.id,
                    "resignation_date": resignation.resignation_date.isoformat(),
                    "reason": resignation.reason,
                    "status": resignation.status,
                    "created_at": created_at_str
                },
                "notice": notice_info,
                "noc": {
                    "uploaded": noc_upload is not None,
                    "filename": os.path.basename(noc_upload.file_path) if noc_upload and noc_upload.file_path else None
                },
                "department_noc": _serialize_department_noc_requests(resignation),
                "employee_offboarding": _serialize_employee_offboarding(admin),
                "history": history
            }), 200

        return jsonify({
            "success": True,
            "already_submitted": False,
            "notice": _serialize_notice(None),
            "today": date.today().isoformat(),
            "employee": {
                "name": admin.first_name,
                "email": admin.email,
                "circle": admin.circle or "",
                "emp_type": admin.emp_type or ""
            },
            "department_noc": [],
            "employee_offboarding": _serialize_employee_offboarding(admin),
            "history": history
        }), 200

    except Exception as e:
        current_app.logger.exception("get_resignation_status error")
        return jsonify({
            "success": False,
            "message": str(e) or "Failed to fetch resignation status"
        }), 500


@leave.route("/seperation/revoke", methods=["POST"])
@jwt_required()
def revoke_resignation():
    try:
        claims = get_jwt()
        email = claims.get("email")
        if not email:
            return jsonify({"success": False, "message": "Invalid token"}), 401

        admin = Admin.query.filter_by(email=email).first()
        if not admin:
            return jsonify({"success": False, "message": "Employee not found"}), 404

        resignation = Resignation.query.filter_by(admin_id=admin.id).order_by(Resignation.id.desc()).first()
        if not resignation:
            return jsonify({"success": False, "message": "No resignation found"}), 404

        if not _is_active_resignation_status(resignation.status):
            return jsonify({
                "success": False,
                "message": f"Cannot revoke when status is {resignation.status}"
            }), 400

        resignation.status = "Revoked"
        reject_pending_noc_rows_for_resignation(resignation.id)
        db.session.commit()

        # Best-effort email notification on revoke
        try:
            send_resignation_revoked_email(admin, resignation)
        except Exception:
            current_app.logger.exception("Failed to send resignation revoked email")

        return jsonify({
            "success": True,
            "message": "Resignation revoked successfully",
            "notice": _serialize_notice(resignation),
        }), 200
    except Exception as e:
        db.session.rollback()
        current_app.logger.exception("revoke_resignation error")
        return jsonify({"success": False, "message": str(e) or "Failed to revoke resignation"}), 500


@leave.route("/noc-document", methods=["GET"])
@jwt_required()
def get_my_noc_document():
    """Let the logged-in employee download their NOC document (only their own)."""
    try:
        claims = get_jwt()
        email = claims.get("email")
        if not email:
            return jsonify({"success": False, "message": "Invalid token"}), 401

        admin = Admin.query.filter_by(email=email).first()
        if not admin:
            return jsonify({"success": False, "message": "Employee not found"}), 404

        noc_upload = Noc_Upload.query.filter_by(admin_id=admin.id).order_by(Noc_Upload.id.desc()).first()
        if not noc_upload or not noc_upload.file_path:
            return jsonify({"success": False, "message": "NOC document not available yet"}), 404

        full_path = os.path.join(current_app.root_path, "static", "uploads", noc_upload.file_path)
        if not os.path.isfile(full_path):
            return jsonify({"success": False, "message": "File not found"}), 404

        from .pdf_watermark import send_download_file

        return send_download_file(
            path=full_path,
            download_name=os.path.basename(noc_upload.file_path),
            as_attachment=True,
        )
    except Exception as e:
        current_app.logger.exception("noc-document download error")
        return jsonify({"success": False, "message": "Failed to download"}), 500


@leave.route("/relieving-letter", methods=["GET"])
@jwt_required()
def download_my_relieving_letter():
    """Exited employee downloads their relieving letter PDF."""
    try:
        claims = get_jwt()
        email = claims.get("email")
        if not email:
            return jsonify({"success": False, "message": "Invalid token"}), 401

        admin = Admin.query.filter_by(email=email).first()
        if not admin:
            return jsonify({"success": False, "message": "Employee not found"}), 404
        if not getattr(admin, "is_exited", False):
            return jsonify({"success": False, "message": "Relieving letter is available after exit"}), 409

        from .relieving_letter_service import generate_relieving_letter_pdf

        pdf_buffer = generate_relieving_letter_pdf(admin.id)
        filename = f"relieving-letter-{admin.emp_id or admin.id}.pdf"
        return send_file(
            pdf_buffer,
            mimetype="application/pdf",
            as_attachment=True,
            download_name=filename,
        )
    except ValueError as e:
        return jsonify({"success": False, "message": str(e)}), 400
    except Exception as e:
        current_app.logger.exception("relieving-letter download error")
        return jsonify({"success": False, "message": "Failed to generate relieving letter"}), 500


@leave.route("/exit-interview", methods=["GET", "POST"])
@jwt_required()
def employee_exit_interview():
    """Employee exit interview feedback (during notice or after exit)."""
    try:
        claims = get_jwt()
        email = claims.get("email")
        if not email:
            return jsonify({"success": False, "message": "Invalid token"}), 401

        admin = Admin.query.filter_by(email=email).first()
        if not admin:
            return jsonify({"success": False, "message": "Employee not found"}), 404

        from .models.exit_interview import ExitInterview
        from .exit_interview_service import submit_exit_interview

        if request.method == "GET":
            row = ExitInterview.query.filter_by(admin_id=admin.id).first()
            return jsonify(
                {
                    "success": True,
                    "exit_interview": row.to_dict() if row else None,
                    "is_exited": bool(getattr(admin, "is_exited", False)),
                }
            ), 200

        data = request.get_json() or {}
        payload = submit_exit_interview(
            admin.id,
            overall_rating=int(data.get("overall_rating") or 0),
            would_recommend=bool(data.get("would_recommend")),
            feedback=(data.get("feedback") or "").strip(),
            reason_for_leaving=data.get("reason_for_leaving"),
        )
        db.session.commit()
        return jsonify({"success": True, "exit_interview": payload}), 200
    except ValueError as e:
        db.session.rollback()
        return jsonify({"success": False, "message": str(e)}), 400
    except Exception as e:
        db.session.rollback()
        current_app.logger.exception("exit-interview error")
        return jsonify({"success": False, "message": str(e) or "Failed to save exit interview"}), 500


@leave.route("/experience-letter", methods=["GET"])
@jwt_required()
def download_my_experience_letter():
    """Exited employee downloads experience certificate PDF."""
    try:
        claims = get_jwt()
        email = claims.get("email")
        if not email:
            return jsonify({"success": False, "message": "Invalid token"}), 401

        admin = Admin.query.filter_by(email=email).first()
        if not admin:
            return jsonify({"success": False, "message": "Employee not found"}), 404
        if not getattr(admin, "is_exited", False):
            return jsonify({"success": False, "message": "Experience letter is available after exit"}), 409

        from .experience_letter_service import generate_experience_letter_pdf

        pdf_buffer = generate_experience_letter_pdf(admin.id)
        filename = f"experience-letter-{admin.emp_id or admin.id}.pdf"
        return send_file(
            pdf_buffer,
            mimetype="application/pdf",
            as_attachment=True,
            download_name=filename,
        )
    except ValueError as e:
        return jsonify({"success": False, "message": str(e)}), 400
    except Exception as e:
        current_app.logger.exception("experience-letter download error")
        return jsonify({"success": False, "message": "Failed to generate experience letter"}), 500


@leave.route("/regularization", methods=["GET"])
@jwt_required()
def list_my_attendance_regularizations():
    email = get_jwt().get("email")
    admin = Admin.query.filter_by(email=email).first()
    if not admin:
        return jsonify({"success": False, "message": "Employee not found"}), 404

    rows = (
        AttendanceRegularization.query.filter_by(admin_id=admin.id)
        .order_by(AttendanceRegularization.created_at.desc(), AttendanceRegularization.id.desc())
        .limit(100)
        .all()
    )
    return jsonify({
        "success": True,
        "requests": [
            {
                "id": r.id,
                "leave_type": r.leave_type,
                "start_date": r.start_date.isoformat() if r.start_date else None,
                "end_date": r.end_date.isoformat() if r.end_date else None,
                "reason": r.reason,
                "status": r.status,
                "hr_comment": r.hr_comment,
                "leave_application_id": r.leave_application_id,
                "created_at": isoformat_api(r.created_at),
                "reviewed_at": isoformat_api(r.reviewed_at) if r.reviewed_at else None,
            }
            for r in rows
        ],
    }), 200


@leave.route("/regularization", methods=["POST"])
@jwt_required()
def submit_attendance_regularization():
    """Employee requests HR to regularize a past absence period."""
    from . import leave_settings as leave_cfg

    email = get_jwt().get("email")
    admin = Admin.query.filter_by(email=email).first()
    if not admin:
        return jsonify({"success": False, "message": "Employee not found"}), 404

    data = request.get_json(silent=True) or {}
    leave_type = (data.get("leave_type") or "").strip()
    reason = (data.get("reason") or "").strip()
    if not leave_type or not reason:
        return jsonify({"success": False, "message": "leave_type and reason are required"}), 400
    if len(reason) < 20:
        return jsonify({"success": False, "message": "Reason must be at least 20 characters long"}), 400

    try:
        start_date = datetime.strptime(data.get("start_date"), "%Y-%m-%d").date()
        end_date = datetime.strptime(data.get("end_date"), "%Y-%m-%d").date()
    except Exception:
        return jsonify({"success": False, "message": "Invalid date format. Use YYYY-MM-DD"}), 400

    if end_date < start_date:
        return jsonify({"success": False, "message": "End date cannot be before start date"}), 400

    today_ist = datetime.now(ZoneInfo("Asia/Kolkata")).date()
    if start_date >= today_ist:
        return jsonify({
            "success": False,
            "message": "Regularization is only for past dates. Use Apply Leave for current/future dates.",
        }), 400

    max_days = leave_cfg.max_regularization_backdate_days()
    if max_days > 0:
        earliest = today_ist - timedelta(days=max_days)
        if start_date < earliest:
            return jsonify({
                "success": False,
                "message": f"Regularization is limited to the last {max_days} days.",
            }), 400

    pending = AttendanceRegularization.query.filter(
        AttendanceRegularization.admin_id == admin.id,
        AttendanceRegularization.status == "Pending",
        AttendanceRegularization.start_date <= end_date,
        AttendanceRegularization.end_date >= start_date,
    ).first()
    if pending:
        return jsonify({
            "success": False,
            "message": "A pending regularization request already exists for overlapping dates.",
        }), 409

    row = AttendanceRegularization(
        admin_id=admin.id,
        leave_type=leave_type,
        start_date=start_date,
        end_date=end_date,
        reason=reason,
        status="Pending",
    )
    try:
        db.session.add(row)
        db.session.commit()
    except Exception as e:
        db.session.rollback()
        current_app.logger.error("regularization submit failed: %s", e, exc_info=True)
        return jsonify({"success": False, "message": "Failed to submit regularization request"}), 500

    return jsonify({
        "success": True,
        "message": "Regularization request submitted to HR for review.",
        "request": {"id": row.id, "status": row.status},
    }), 201

