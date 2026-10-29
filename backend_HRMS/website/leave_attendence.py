# leave_page_summary,apply_leave_api,get_resignation_status,submit_resignation,submit_expense_claim,get_expense_claims,
# attendance_summary,submit_wfh,get_wfh_applications,


#https://solviotec.com/api/leave

from flask import Blueprint, request, current_app, jsonify, json, send_file
from .models.attendance import Punch, WorkFromHomeApplication, LeaveApplication, LeaveBalance, AttendanceRegularization, LEAVE_REASON_MAX_LEN
from flask_jwt_extended import jwt_required, get_jwt, get_jwt_identity
from .models.expense import ExpenseClaimHeader, ExpenseLineItem
from .models.Admin_models import Admin
from .tenant_context import current_admin, tenant_id_for_admin, tenant_scope, tenant_admin_ids
from .models.seperation import Resignation, Noc_Upload, NocDepartmentRequest, NocApplicationRequest
from .models.holiday_calendar import HolidayCalendar
from .master_data_tenancy import holiday_query
from .models.manager_model import ManagerContact
from sqlalchemy import or_, func
from .email import send_wfh_approval_email_to_managers,send_claim_submission_email,send_resignation_email,send_resignation_revoked_email,send_leave_applied_email,send_noc_request_email,send_noc_application_department_email
from .manager_utils import find_manager_contact
from .upload_tenancy import tenant_upload_path
from .utility import generate_attendance_excel, send_excel_file
from .attendance_engine import (
    load_attendance_month_context,
    build_month_calendar,
    calculate_credited_working_days,
    punch_work_seconds,
)
from .punch_aggregate import seconds_to_hms_str
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

def _notice_period_days(admin):
    from .notice_settings import notice_period_days_for

    return notice_period_days_for(admin)


def _is_weekend_non_working_for_emp(emp_type: str, d: date) -> bool:
    wd = d.weekday()  # Mon=0 ... Sun=6
    if wd == 6:
        return True
    if wd == 5:
        return (emp_type or "").strip() not in ["Human Resource", "Accounts"]
    return False


def _load_holiday_sets(year: int, start_date: date, end_date: date, tenant_id=None):
    from .cache import active_holidays_for_year, holiday_as_date
    from .tenant_context import get_current_tenant_id

    tid = tenant_id if tenant_id is not None else get_current_tenant_id()
    dates = []
    for row in active_holidays_for_year(tid, year):
        d = holiday_as_date(row.get("holiday_date"))
        if d is None or d < start_date or d > end_date:
            continue
        dates.append((d, bool(row.get("is_optional"))))
    mandatory = {d for d, optional in dates if not optional}
    optional = {d for d, opt in dates if opt}
    return mandatory, optional


def _parse_leave_year(value):
    try:
        year = int(value)
    except (TypeError, ValueError):
        return None
    if year < 2000 or year > 2100:
        return None
    return year


def _fetch_optional_holiday_rows(year: int, tenant_id=None):
    rows = (
        holiday_query(tenant_id).filter(
            HolidayCalendar.year == year,
            HolidayCalendar.is_active.is_(True),
            HolidayCalendar.is_optional.is_(True),
        )
        .order_by(HolidayCalendar.holiday_date.asc(), HolidayCalendar.id.asc())
        .all()
    )
    if not rows:
        from .Human_resource import _seed_holidays_for_year

        _seed_holidays_for_year(year, overwrite=False, tenant_id=tenant_id)
        rows = (
            holiday_query(tenant_id).filter(
                HolidayCalendar.year == year,
                HolidayCalendar.is_active.is_(True),
                HolidayCalendar.is_optional.is_(True),
            )
            .order_by(HolidayCalendar.holiday_date.asc(), HolidayCalendar.id.asc())
            .all()
        )
    return rows


def _optional_holiday_on_date(d: date, tenant_id=None):
    for row in _fetch_optional_holiday_rows(d.year, tenant_id):
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


def _compute_leave_days_with_sandwich(*, emp_type: str, start_date: date, end_date: date, tenant_id=None) -> float:
    """
    Sandwich leave policy:
    - Count all calendar WORKING days within the range as leave days.
    - Non-working days (weekends + holidays) are counted ONLY if they are sandwiched
      between two counted working leave days within the same request range.
    """
    if end_date < start_date:
        return 0.0

    mandatory_holidays, optional_holidays = _load_holiday_sets(start_date.year, start_date, end_date, tenant_id)

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


def _compute_working_and_sandwich_days(*, emp_type: str, start_date: date, end_date: date, tenant_id=None):
    """
    Return (working_days, sandwich_days).
    - working_days: days that are calendar working days for this emp_type (holidays + weekends excluded)
    - sandwich_days: non-working days inside the range that are between working_days
    """
    if end_date < start_date:
        return 0.0, 0.0

    mandatory_holidays, optional_holidays = _load_holiday_sets(start_date.year, start_date, end_date, tenant_id)

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


def _resolve_admin_from_jwt():
    return current_admin()


def _serialize_notice(resignation, admin=None):
    admin = admin or getattr(resignation, "admin", None)
    notice_period_days = _notice_period_days(admin)
    if not resignation or not resignation.resignation_date:
        return {
            "notice_active": False,
            "notice_period_days": notice_period_days,
            "notice_start_date": None,
            "notice_end_date": None,
            "days_left": 0,
            "can_revoke": False,
        }

    notice_start = resignation.resignation_date
    notice_end = notice_start + timedelta(days=notice_period_days)
    days_left = max((notice_end - date.today()).days, 0)
    status = (resignation.status or "").strip()
    active = _is_active_resignation_status(status) and days_left > 0

    return {
        "notice_active": active,
        "notice_period_days": notice_period_days,
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
    "INVENTORY": "Inventory",
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
    if x in ("inventory", "stores", "store"):
        return "INVENTORY"
    return None


def _admin_emails_for_emp_type_tokens(admin, lower_tokens):
    if not lower_tokens:
        return []
    filters = [func.lower(func.coalesce(Admin.emp_type, "")) == t for t in lower_tokens]
    rows = (
        Admin.query.filter(Admin.id.in_(tenant_admin_ids(tenant_id_for_admin(admin))))
        .filter(or_(*filters))
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
    mc = find_manager_contact(admin)
    if not mc:
        return []
    # Notify the highest available reporting level first, then work down the
    # chain. ManagerContact's generic helper uses L1 -> L2 -> L3, but NOC
    # clearance should reach L3, L2 and L1 in that order when they exist.
    tenant_ids = tenant_admin_ids(tenant_id_for_admin(admin))
    manager_ids = [
        getattr(mc, f"{level}_admin_id", None)
        for level in ("l3", "l2", "l1")
    ]
    rows = {
        manager.id: manager
        for manager in Admin.query.filter(Admin.id.in_(tenant_ids)).filter(
            Admin.id.in_([mid for mid in manager_ids if mid])
        ).all()
    }
    excluded = (admin.email or "").strip().lower()
    emails, seen = [], set()
    for manager_id in manager_ids:
        manager = rows.get(manager_id)
        email = (getattr(manager, "email", None) or "").strip() if manager else ""
        normalized = email.lower()
        if email and normalized != excluded and normalized not in seen:
            seen.add(normalized)
            emails.append(email)
    return emails


def _expand_noc_email_recipients(admin, ordered_keys):
    """ordered_keys: unique HR | ACCOUNTS | MANAGER | IT in UI order."""
    labels = []
    emails = []
    seen_e = set()

    for nk in ordered_keys:
        labels.append(_NOC_KEY_LABELS.get(nk, nk))
        chunk = []
        if nk == "HR":
            chunk = _admin_emails_for_emp_type_tokens(admin,
                ["human resource", "human resources", "hr"]
            )
        elif nk == "ACCOUNTS":
            chunk = _admin_emails_for_emp_type_tokens(admin, ["account", "accounts", "accountant"])
        elif nk == "IT":
            chunk = _admin_emails_for_emp_type_tokens(admin, ["it", "it department", "information technology"])
        elif nk == "INVENTORY":
            chunk = _admin_emails_for_emp_type_tokens(admin, ["inventory", "stores", "store"])
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
    admin = current_admin()

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

    emp_type = (admin.emp_type or "").strip()
    ctx = load_attendance_month_context(
        admin.id, selected_year, selected_month, emp_type=emp_type, today=today
    )
    total_working_days, unpaid_leave_days = calculate_credited_working_days(ctx)
    total_present_days = total_working_days
    calendar_data = build_month_calendar(ctx)
    punches = list(ctx.punch_map.values())

    total_work_seconds = 0
    punch_in_seconds = []
    punch_out_seconds = []

    for p in punches:
        if p.punch_in and p.punch_out:
            total_work_seconds += punch_work_seconds(p)

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
    difference_sign = "-" if difference_seconds < 0 else ""

    return jsonify({
        "success": True,
        "month": f"{calendar.month_name[selected_month]} {selected_year}",
        "total_present_days": total_present_days,
        "total_working_days": total_working_days,
        "unpaid_leave_days": round(unpaid_leave_days, 1),
        "average_punch_in": avg_punch_in,
        "average_punch_out": avg_punch_out,
        "actual_work_hours": seconds_to_hms_str(total_work_seconds),
        "expected_work_hours": f"{expected_work_hours}:00:00",
        "difference": difference_sign + seconds_to_hms_str(abs(difference_seconds)),
        "calendar": calendar_data
    }), 200


@leave.route("/attendance/download", methods=["GET"])
@jwt_required()
def download_my_attendance_excel():
    email = get_jwt().get("email")
    admin = current_admin()

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
    admin = current_admin()

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
    admin = current_admin()
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
    admin = current_admin()
    if not admin:
        return jsonify({"success": False, "message": "Employee not found"}), 404

    year = _parse_leave_year(request.args.get("year", datetime.now(ZoneInfo("Asia/Kolkata")).year))
    if not year:
        return jsonify({
            "success": False,
            "message": "Invalid year. Allowed range: 2000-2100",
        }), 400

    optional_leave_used = _has_optional_leave_for_year(admin.id, year)
    rows = _fetch_optional_holiday_rows(year, tenant_id_for_admin(admin))
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
    admin = current_admin()
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
    if len(reason) > LEAVE_REASON_MAX_LEN:
        return jsonify({
            "success": False,
            "message": f"Reason must be at most {LEAVE_REASON_MAX_LEN} characters"
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

        if not _optional_holiday_on_date(start_date, tenant_id_for_admin(admin)):
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
        tenant_id=tenant_id_for_admin(admin),
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
    admin = current_admin()

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

    reason = reason.strip()
    if len(reason) > LEAVE_REASON_MAX_LEN:
        return jsonify({
            "success": False,
            "message": f"Reason must be at most {LEAVE_REASON_MAX_LEN} characters"
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
        reason=reason,
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
    admin = current_admin()

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
    admin = current_admin()
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
    admin = current_admin()
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

    admin = current_admin()
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
        uploads_root = os.path.join(current_app.root_path, "static", "uploads")
        claim_tenant_id = tenant_id_for_admin(admin)

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
                abs_path, filename = tenant_upload_path(
                    uploads_root, f"expenses/{basename}", claim_tenant_id
                )
                file.save(abs_path)

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

    admin = current_admin()
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
    return _create_separation_request(request.get_json(silent=True) or {})


def _create_separation_request(data):
    admin = _resolve_admin_from_jwt()
    if not admin:
        return jsonify({"success": False, "message": "Employee not found"}), 404

    latest = Resignation.query.filter_by(admin_id=admin.id).order_by(Resignation.id.desc()).first()
    if latest and _is_active_resignation_status(latest.status):
        return jsonify({"success": False, "message": "You have already submitted a resignation request."}), 409

    resignation_date = data.get("resignation_date")
    reason = (data.get("reason") or "").strip()
    if not resignation_date or not reason:
        return jsonify({"success": False, "message": "Resignation date and reason are required"}), 400
    try:
        resignation_date_obj = datetime.strptime(str(resignation_date)[:10], "%Y-%m-%d").date()
    except ValueError:
        return jsonify({"success": False, "message": "Invalid date format. Use YYYY-MM-DD"}), 400

    resignation = Resignation(
        admin_id=admin.id,
        resignation_date=resignation_date_obj,
        reason=reason,
        status="Pending",
    )
    try:
        db.session.add(resignation)
        db.session.commit()
    except Exception as e:
        db.session.rollback()
        current_app.logger.exception("Separation request persist failed: %s", e)
        return jsonify({"success": False, "message": "Unable to submit separation. Please try again later."}), 500

    email_sent = False
    email_message = ""
    try:
        email_sent, email_message = send_resignation_email(admin, resignation)
    except Exception as mail_err:
        current_app.logger.warning("Separation email failed after submit: %s", mail_err)
        email_message = str(mail_err)

    message = "Separation submitted successfully."
    message += " Manager and HR have been notified." if email_sent else " Separation was saved, but Manager/HR notification could not be sent."
    return jsonify({
        "success": True,
        "resignation_id": resignation.id,
        "email_sent": bool(email_sent),
        "separation_email_sent": bool(email_sent),
        "separation_email_message": email_message or None,
        "message": message,
    }), 201


def _parse_noc_department_keys(raw_deps):
    """Return (normalized_ordered_keys, error_message)."""
    if isinstance(raw_deps, str):
        raw_deps = [raw_deps]
    elif not isinstance(raw_deps, list):
        raw_deps = []
    if not raw_deps:
        return None, "Select at least one department for NOC"
    normalized_ordered = []
    seen_k = set()
    for raw in raw_deps:
        nk = _normalize_noc_department_key(raw)
        if nk is None:
            return None, f"Invalid department: {raw}"
        if nk not in seen_k:
            seen_k.add(nk)
            normalized_ordered.append(nk)
    return normalized_ordered, None


@leave.route("/seperation/finalize", methods=["POST"])
@jwt_required()
def finalize_separation():
    """Backward-compatible endpoint; finalizes only the separation request."""
    return _create_separation_request(request.get_json(silent=True) or {})


@leave.route("/seperation/noc-request", methods=["POST"])
@jwt_required()
def submit_noc_request_email():
    """Retained as a compatibility response; employee separations no longer request NOC."""
    return jsonify({
        "success": False,
        "message": "NOC requests are no longer submitted from this page. Please apply for separation only.",
    }), 410


@leave.route("/seperation", methods=["GET"])
@jwt_required()
def get_resignation_status():
    try:
        admin = _resolve_admin_from_jwt()
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
                    "hr_remarks": getattr(resignation, "hr_remarks", None) or "",
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
                "notice": _serialize_notice(None, admin),
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


NOC_APPLICATION_TYPES = {
    "exit_no_dues": "No dues clearance (Exit)",
    "banking_bonafide": "Bonafide letter for banking purpose",
    "travel_bonafide": "Bonafide letter for visa (personal holiday)",
    "other": "Other reason",
}


def _serialize_noc_application(row, department_rows=None, final_noc=None):
    department_rows = department_rows or []
    department_keys = [(department_row.department_key or "").upper() for department_row in department_rows]
    if not department_keys and row.request_type != "exit_no_dues":
        department_keys = ["HR"]
    return {
        "id": row.id,
        "request_type": row.request_type,
        "request_label": NOC_APPLICATION_TYPES.get(row.request_type, row.request_type),
        "other_reason": row.other_reason,
        "details": row.details,
        "status": row.status,
        "hr_remarks": getattr(row, "hr_remarks", None) or "",
        "hr_document": ({
            "filename": os.path.basename(row.hr_document_path),
            "download_url": f"/api/leave/noc-applications/{row.id}/document",
        } if getattr(row, "hr_document_path", None)
        and (row.request_type == "exit_no_dues" or (row.status or "").strip().lower() == "approved")
        else None),
        "created_at": isoformat_api(row.created_at) if row.created_at else None,
        "separation_id": row.separation_id,
        "department_keys": department_keys,
        "department_labels": [_NOC_KEY_LABELS.get(key, key) for key in department_keys],
        "department_requests": [{
            "id": department_row.id,
            "department_key": (department_row.department_key or "").upper(),
            "department_label": _NOC_KEY_LABELS.get(
                (department_row.department_key or "").upper(),
                department_row.department_key or "Department",
            ),
            "status": _effective_noc_row_status(department_row, department_row.resignation),
            "requested_at": isoformat_api(department_row.requested_at) if department_row.requested_at else None,
            "filename": os.path.basename(department_row.file_path) if department_row.file_path else None,
            "download_url": f"/api/leave/noc-department-requests/{department_row.id}/download"
                if department_row.file_path else None,
        } for department_row in department_rows],
        "final_noc": final_noc,
    }


def _noc_application_department_admins(admin, department_key):
    """Resolve in-tenant employee accounts that should receive an in-app notice."""
    ids = tenant_admin_ids(tenant_id_for_admin(admin))
    if department_key == "MANAGER":
        contact = find_manager_contact(admin)
        target_ids = [getattr(contact, f"{level}_admin_id", None) for level in ("l1", "l2", "l3")] if contact else []
        q = Admin.query.filter(Admin.id.in_(ids), Admin.id.in_([i for i in target_ids if i]))
    else:
        tokens = {
            "HR": ["human resource", "human resources", "hr"],
            "ACCOUNTS": ["account", "accounts", "accountant"],
            "IT": ["it", "it department", "information technology"],
            "INVENTORY": ["inventory", "store", "stores"],
        }.get(department_key, [])
        q = Admin.query.filter(
            Admin.id.in_(ids),
            func.lower(func.coalesce(Admin.emp_type, "")).in_(tokens),
        )
    return [recipient for recipient in q.all() if recipient.id != admin.id]


def _noc_application_department_emails(admin, department_key):
    label = _NOC_KEY_LABELS.get(department_key, department_key)
    from .company_mailbox import company_mailbox

    # Match the recipient aliases used by the other HRMS department emails.
    # Try the tenant mailbox first, then the app's .env defaults. Inventory
    # shares the IT inbox. Manager notices remain individually addressed to
    # the employee's configured L1/L2/L3 managers.
    mailbox_keys = {
        "HR": ("ZEPTO_CC_HR", "EMAIL_HR"),
        "ACCOUNTS": ("ZEPTO_CC_ACCOUNT", "EMAIL_ACCOUNTS"),
        "IT": ("ZEPTO_CC_IT", "EMAIL_IT"),
        "INVENTORY": ("ZEPTO_CC_INVENTORY", "EMAIL_INVENTORY", "ZEPTO_CC_IT", "EMAIL_IT"),
    }.get(department_key)
    if not mailbox_keys:
        _, recipients = _expand_noc_email_recipients(admin, [department_key])
        return label, recipients

    tenant_id = tenant_id_for_admin(admin)
    mailbox = ""
    for key in mailbox_keys:
        mailbox = (company_mailbox(key, tenant_id) or "").strip()
        if mailbox:
            break
    if not mailbox:
        for key in mailbox_keys:
            mailbox = (current_app.config.get(key) or "").strip()
            if mailbox:
                break
    if mailbox:
        return label, [mailbox]
    return label, []


@leave.route("/noc-applications", methods=["GET", "POST"])
@jwt_required()
def employee_noc_applications():
    admin = _resolve_admin_from_jwt()
    if not admin:
        return jsonify({"success": False, "message": "Employee not found"}), 404

    # Ensure this additive feature works even where startup schema checks ran
    # before the new model was deployed or were skipped by the host.
    try:
        NocApplicationRequest.__table__.create(bind=db.engine, checkfirst=True)
    except Exception:
        current_app.logger.exception("NOC application table is unavailable")
        return jsonify({
            "success": False,
            "message": "NOC requests are temporarily unavailable because their storage is not ready.",
        }), 503

    latest_separation = (
        Resignation.query.filter_by(admin_id=admin.id)
        .order_by(Resignation.id.desc())
        .first()
    )
    active_separation = (
        latest_separation
        if latest_separation and _is_active_resignation_status(latest_separation.status)
        else None
    )

    if request.method == "GET":
        rows = (
            NocApplicationRequest.query.filter_by(admin_id=admin.id)
            .order_by(NocApplicationRequest.created_at.desc(), NocApplicationRequest.id.desc())
            .all()
        )
        final_noc_upload = Noc_Upload.query.filter_by(admin_id=admin.id).order_by(Noc_Upload.id.desc()).first()
        department_rows = NocDepartmentRequest.query.filter_by(
            admin_id=admin.id,
        ).order_by(NocDepartmentRequest.requested_at.desc(), NocDepartmentRequest.id.desc()).all()
        department_rows_by_separation = {}
        for department_row in department_rows:
            department_rows_by_separation.setdefault(department_row.resignation_id, []).append(department_row)
        latest_exit_request_by_separation = {}
        latest_exit_request_id = None
        for request_row in rows:
            if request_row.request_type == "exit_no_dues":
                latest_exit_request_id = latest_exit_request_id or request_row.id
                if request_row.separation_id:
                    latest_exit_request_by_separation.setdefault(request_row.separation_id, request_row.id)
        final_noc_target_id = latest_exit_request_id or (rows[0].id if rows else None)

        final_noc = ({
            "filename": os.path.basename(final_noc_upload.file_path),
            "download_url": "/api/leave/noc-document",
        } if final_noc_upload and final_noc_upload.file_path else None)
        request_payloads = []
        for request_row in rows:
            is_latest_for_separation = (
                request_row.request_type == "exit_no_dues"
                and latest_exit_request_by_separation.get(request_row.separation_id) == request_row.id
            )
            request_payloads.append(_serialize_noc_application(
                request_row,
                department_rows_by_separation.get(request_row.separation_id, []) if is_latest_for_separation else [],
                final_noc if request_row.id == final_noc_target_id else None,
            ))

        represented_separations = {
            request_row.separation_id
            for request_row in rows
            if request_row.request_type == "exit_no_dues" and request_row.separation_id
        }
        legacy_noc_separations = [
            separation_id for separation_id in department_rows_by_separation
            if separation_id not in represented_separations
        ]
        legacy_final_noc_separation = (
            legacy_noc_separations[0] if legacy_noc_separations and final_noc_target_id is None else None
        )
        for separation_id in legacy_noc_separations:
            clearance_rows = department_rows_by_separation[separation_id]
            resignation = clearance_rows[0].resignation
            request_payloads.append({
                "id": f"legacy-separation-{separation_id}",
                "request_type": "exit_no_dues",
                "request_label": NOC_APPLICATION_TYPES["exit_no_dues"],
                "other_reason": None,
                "details": (resignation.reason or "Department no-dues clearance request") if resignation else "Department no-dues clearance request",
                "hr_remarks": (getattr(resignation, "hr_remarks", None) or "") if resignation else "",
                "status": "Pending",
                "created_at": isoformat_api(clearance_rows[0].requested_at) if clearance_rows[0].requested_at else None,
                "separation_id": separation_id,
                "department_keys": [(clearance.department_key or "").upper() for clearance in clearance_rows],
                "department_labels": [
                    _NOC_KEY_LABELS.get((clearance.department_key or "").upper(), clearance.department_key or "Department")
                    for clearance in clearance_rows
                ],
                "department_requests": [{
                    "id": clearance.id,
                    "department_key": (clearance.department_key or "").upper(),
                    "department_label": _NOC_KEY_LABELS.get(
                        (clearance.department_key or "").upper(), clearance.department_key or "Department"
                    ),
                    "status": _effective_noc_row_status(clearance, clearance.resignation),
                    "requested_at": isoformat_api(clearance.requested_at) if clearance.requested_at else None,
                    "filename": os.path.basename(clearance.file_path) if clearance.file_path else None,
                    "download_url": f"/api/leave/noc-department-requests/{clearance.id}/download"
                        if clearance.file_path else None,
                } for clearance in clearance_rows],
                "final_noc": final_noc if separation_id == legacy_final_noc_separation else None,
            })
        request_payloads.sort(
            key=lambda item: (item.get("created_at") or "", str(item.get("id") or "")),
            reverse=True,
        )
        return jsonify({
            "success": True,
            "today": date.today().isoformat(),
            "employee": {
                "name": (admin.first_name or admin.user_name or "").strip(),
                "email": admin.email or "",
                "employee_id": admin.emp_id or "",
                "circle": admin.circle or "",
            },
            "separation": ({
                "id": active_separation.id,
                "date": active_separation.resignation_date.isoformat() if active_separation.resignation_date else None,
                "reason": active_separation.reason or "",
                "status": active_separation.status or "Pending",
            } if active_separation else None),
            "requests": request_payloads,
            "request_types": NOC_APPLICATION_TYPES,
        }), 200

    data = request.get_json(silent=True) or {}
    request_type = str(data.get("request_type") or "").strip().lower()
    details = str(data.get("details") or "").strip()
    other_reason = str(data.get("other_reason") or "").strip()
    if request_type not in NOC_APPLICATION_TYPES:
        return jsonify({"success": False, "message": "Choose a valid request type."}), 400
    if request_type == "exit_no_dues":
        department_keys, department_error = _parse_noc_department_keys(data.get("department_keys"))
        if department_error:
            return jsonify({"success": False, "message": department_error}), 400
    else:
        department_keys = ["HR"]
    if request_type == "exit_no_dues" and not active_separation:
        return jsonify({
            "success": False,
            "message": "Apply for separation first before requesting no-dues clearance for exit.",
            "separation_required": True,
        }), 400
    if request_type == "other" and not other_reason:
        return jsonify({"success": False, "message": "Please enter the reason for this request."}), 400
    if len(other_reason) > 255:
        return jsonify({"success": False, "message": "Other reason must be 255 characters or fewer."}), 400
    if not details:
        return jsonify({"success": False, "message": "Please provide the additional request details."}), 400
    if len(details) > 5000:
        return jsonify({"success": False, "message": "Request details must be 5000 characters or fewer."}), 400

    row = NocApplicationRequest(
        admin_id=admin.id,
        separation_id=active_separation.id if request_type == "exit_no_dues" else None,
        request_type=request_type,
        other_reason=other_reason or None,
        details=details,
        status="Pending",
    )
    db.session.add(row)
    try:
        db.session.flush()
        if request_type == "exit_no_dues":
            existing = {
                (item.department_key or "").upper()
                for item in NocDepartmentRequest.query.filter_by(
                    admin_id=admin.id,
                    resignation_id=active_separation.id,
                ).all()
            }
            for department_key in department_keys:
                if department_key not in existing:
                    db.session.add(NocDepartmentRequest(
                        admin_id=admin.id,
                        resignation_id=active_separation.id,
                        department_key=department_key,
                        noc_date=active_separation.resignation_date,
                        status="Pending",
                    ))
        db.session.commit()
    except Exception:
        db.session.rollback()
        current_app.logger.exception("NOC application save failed")
        return jsonify({"success": False, "message": "Unable to submit this request. Please try again."}), 500

    notification_admins = {}
    try:
        from .models.notification import Notification
        for department_key in department_keys:
            recipients = _noc_application_department_admins(admin, department_key)
            notification_admins[department_key] = recipients
            for recipient in recipients:
                db.session.add(Notification(
                    recipient_admin_id=recipient.id,
                    notif_type="noc_application",
                    title=f"New {NOC_APPLICATION_TYPES[request_type]} request",
                    body=(
                        f"{admin.first_name or admin.email} ({admin.emp_id or 'no employee ID'}; "
                        f"{admin.email or 'no email'}) submitted a request for {_NOC_KEY_LABELS.get(department_key, department_key)}: {details[:180]}"
                    ),
                    entity_type="noc_application",
                    entity_id=row.id,
                ))
        if any(notification_admins.values()):
            db.session.commit()
    except Exception:
        db.session.rollback()
        current_app.logger.exception("NOC application notification failed after save")

    email_results = []
    for department_key in department_keys:
        label, recipients = _noc_application_department_emails(admin, department_key)
        if not recipients:
            email_results.append((department_key, False, "No department recipient is configured"))
            continue
        for recipient_email in recipients:
            sent, email_message = send_noc_application_department_email(
                admin=admin,
                request_type=request_type,
                request_label=NOC_APPLICATION_TYPES[request_type],
                details=details,
                other_reason=other_reason or None,
                department_label=label,
                recipient_email=recipient_email,
                resignation=active_separation if request_type == "exit_no_dues" else None,
            )
            email_results.append((department_key, sent, email_message))

    all_email_sent = bool(email_results) and all(result[1] for result in email_results)
    response_departments = [key for key in department_keys]
    message = "Your request was submitted successfully."
    message += " Department emails were sent." if all_email_sent else " The request was saved, but one or more department emails could not be sent."
    return jsonify({
        "success": True,
        "message": message,
        "email_sent": all_email_sent,
        "departments": response_departments,
        "request": _serialize_noc_application(row, response_departments),
    }), 201


@leave.route("/noc-applications/<int:application_id>/document", methods=["GET"])
@jwt_required()
def download_my_noc_application_document(application_id):
    admin = _resolve_admin_from_jwt()
    if not admin:
        return jsonify({"success": False, "message": "Employee not found"}), 404
    application = NocApplicationRequest.query.filter_by(
        id=application_id,
        admin_id=admin.id,
    ).first()
    if not application or not application.hr_document_path:
        return jsonify({"success": False, "message": "NOC document not found"}), 404
    if (
        application.request_type != "exit_no_dues"
        and (application.status or "").strip().lower() != "approved"
    ):
        return jsonify({
            "success": False,
            "message": "This document will be available after Admin approval.",
        }), 403

    uploads_root = os.path.realpath(os.path.join(current_app.root_path, "static", "uploads"))
    file_path = os.path.realpath(os.path.join(uploads_root, application.hr_document_path))
    if os.path.commonpath([uploads_root, file_path]) != uploads_root or not os.path.isfile(file_path):
        return jsonify({"success": False, "message": "NOC document not found"}), 404

    from .pdf_watermark import send_download_file
    return send_download_file(
        path=file_path,
        download_name=os.path.basename(application.hr_document_path),
        as_attachment=True,
    )


@leave.route("/seperation/revoke", methods=["POST"])
@jwt_required()
def revoke_resignation():
    """Employee cancels an active resignation (Pending/Approved)."""
    try:
        admin = _resolve_admin_from_jwt()
        if not admin:
            return jsonify({"success": False, "message": "Employee not found"}), 404

        resignation = (
            Resignation.query.filter_by(admin_id=admin.id)
            .order_by(Resignation.id.desc())
            .first()
        )
        if not resignation:
            return jsonify({"success": False, "message": "No resignation found"}), 404

        current_status = (resignation.status or "").strip()
        if not _is_active_resignation_status(current_status):
            return jsonify({
                "success": False,
                "message": f"Cannot revoke when status is {current_status or 'unknown'}",
            }), 400

        resignation_id = int(resignation.id)

        # 1) Persist revoke first — never block this on NOC/email side-effects.
        resignation.status = "Revoked"
        try:
            db.session.commit()
        except Exception as commit_err:
            db.session.rollback()
            current_app.logger.exception(
                "revoke_resignation primary commit failed id=%s", resignation_id
            )
            # Fallback if DB enum/check rejects 'Revoked'.
            try:
                from sqlalchemy import text as sa_text

                db.session.execute(
                    sa_text("UPDATE resignations SET status = :st WHERE id = :id"),
                    {"st": "Revoked", "id": resignation_id},
                )
                db.session.commit()
            except Exception as raw_err:
                db.session.rollback()
                current_app.logger.exception(
                    "revoke_resignation raw update failed id=%s", resignation_id
                )
                return jsonify({
                    "success": False,
                    "message": (
                        "Could not save revoked status. "
                        f"{commit_err.__class__.__name__}/{raw_err.__class__.__name__}"
                    ),
                }), 500

        # 2) Best-effort: cancel pending department NOC lines (separate transaction).
        try:
            reject_pending_noc_rows_for_resignation(resignation_id)
            db.session.commit()
        except Exception:
            db.session.rollback()
            current_app.logger.exception(
                "reject_pending_noc_rows_for_resignation failed during revoke resignation_id=%s",
                resignation_id,
            )

        refreshed = Resignation.query.get(resignation_id)

        response = jsonify({
            "success": True,
            "message": "Resignation revoked successfully",
            "notice": _serialize_notice(refreshed),
            "resignation": {
                "id": resignation_id,
                "status": (refreshed.status if refreshed else "Revoked"),
                "resignation_date": (
                    refreshed.resignation_date.isoformat()
                    if refreshed and refreshed.resignation_date
                    else None
                ),
            },
        })

        # Email after response is built; never block HTTP (proxy timeouts → empty 500).
        try:
            import threading

            app_obj = current_app._get_current_object()
            admin_id = admin.id

            def _send_revoke_email():
                with app_obj.app_context():
                    try:
                        adm = Admin.query.get(admin_id)
                        resig = Resignation.query.get(resignation_id)
                        if adm and resig:
                            with tenant_scope(tenant_id_for_admin(adm)):
                                send_resignation_revoked_email(adm, resig)
                    except Exception:
                        app_obj.logger.exception(
                            "Failed to send resignation revoked email (async)"
                        )

            threading.Thread(target=_send_revoke_email, daemon=True).start()
        except Exception:
            current_app.logger.exception("Failed to schedule resignation revoked email")

        return response, 200
    except Exception as e:
        db.session.rollback()
        current_app.logger.exception("revoke_resignation error")
        return jsonify({
            "success": False,
            "message": str(e) or "Failed to revoke resignation",
        }), 500


@leave.route("/noc-department-requests/<int:department_request_id>/download", methods=["GET"])
@jwt_required()
def download_my_department_noc_document(department_request_id):
    """Allow an employee to download a clearance file uploaded for their NOC."""
    admin = _resolve_admin_from_jwt()
    if not admin:
        return jsonify({"success": False, "message": "Employee not found"}), 404

    department_request = NocDepartmentRequest.query.filter_by(
        id=department_request_id,
        admin_id=admin.id,
    ).first()
    if not department_request or not department_request.file_path:
        return jsonify({"success": False, "message": "Department NOC file not found"}), 404

    uploads_root = os.path.realpath(os.path.join(current_app.root_path, "static", "uploads"))
    file_path = os.path.realpath(os.path.join(uploads_root, department_request.file_path))
    if os.path.commonpath([uploads_root, file_path]) != uploads_root or not os.path.isfile(file_path):
        return jsonify({"success": False, "message": "Department NOC file not found"}), 404

    from .pdf_watermark import send_download_file

    return send_download_file(
        path=file_path,
        download_name=os.path.basename(department_request.file_path),
        as_attachment=True,
    )


@leave.route("/noc-document", methods=["GET"])
@jwt_required()
def get_my_noc_document():
    """Let the logged-in employee download their NOC document (only their own)."""
    try:
        claims = get_jwt()
        email = claims.get("email")
        if not email:
            return jsonify({"success": False, "message": "Invalid token"}), 401

        admin = current_admin()
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

        admin = current_admin()
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

        admin = current_admin()
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

        admin = current_admin()
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
    admin = current_admin()
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
    admin = current_admin()
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

