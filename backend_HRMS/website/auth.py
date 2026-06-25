# save_upload_docs,create_or_update_education,create_or_update_employee,
# punch_out,punch_in,employee_homepage,validate_user



#https://solviotec.com/api/auth


import os
import re
import json
import urllib.request
from math import radians, cos, sin, atan2, sqrt
import requests
from werkzeug.utils import secure_filename
from flask import Blueprint, request, redirect, url_for, current_app, jsonify
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from .email import send_login_alert_email
from .models.Admin_models import Admin
from . import db
from .models.emp_detail_models import Employee
from .models.attendance import Punch, PunchSession, Location, LeaveBalance, LeaveApplication
from .compoff_utils import get_effective_comp_balance
from .leave_balance_utils import leave_balance_payload, sync_leave_balance_totals
from .models.news_feed import NewsFeed, PaySlip
from .models.monthly_payroll import MonthlyPayroll
from .models.query import Query
from .models.education import Education, UploadDoc
from .models.employee_accounts import EmployeeAccounts
from .document_identity import (
    normalize_aadhaar,
    normalize_pan,
    normalize_ifsc,
    validate_aadhaar,
    validate_pan,
    validate_ifsc,
    validate_bank_account,
    normalize_bank_branch_code,
    validate_bank_branch_code,
)
from .models.prev_com import PreviousCompany
from .models.master_data import MasterData
from datetime import datetime, date, timedelta
from .datetime_utils import utc_now, isoformat_api, isoformat_punch_clock, IST, ensure_utc
from flask_jwt_extended import create_access_token, get_jwt_identity, get_jwt, jwt_required
import logging
from flask_jwt_extended import jwt_required, get_jwt_identity, get_jwt
from flask import jsonify
from .utility import is_wfh_allowed, is_on_leave
from .punch_aggregate import (
    ensure_punch_sessions_backfill,
    recompute_punch_aggregate,
    hms_to_seconds,
    seconds_to_hms_str,
    open_punch_session_for_punch,
    open_punch_session_for_admin,
    serialize_punch_sessions,
    sessions_for_punch_date,
)
from .punch_auto_close import (
    AUTO_CAP_REASON,
    capped_daily_work_seconds,
    close_punch_session,
    evaluate_auto_close,
    repair_attendance_integrity_for_admin,
    validate_manual_punch_out_extended_reason,
)
from . import tax_declaration_service as tax_decl

auth = Blueprint('auth', __name__)

# ------------------------
# LOGGER SETUP
# ------------------------
logger = logging.getLogger(__name__)
logger.setLevel(logging.DEBUG)
ch = logging.StreamHandler()
ch.setLevel(logging.DEBUG)
formatter = logging.Formatter('%(asctime)s - %(levelname)s - %(message)s')
ch.setFormatter(formatter)
logger.addHandler(ch)




# ===================================================
# Master options (departments / circles) for any authenticated user
# FINAL URL → GET /api/auth/master-options
@auth.route("/master-options", methods=["GET"])
@jwt_required()
def get_master_options():
    """Return department and circle names from MasterData for dropdowns (Queries, Admin, etc.)."""
    dept_rows = (
        MasterData.query.filter_by(master_type="department", is_active=True)
        .order_by(MasterData.name.asc())
        .all()
    )
    circle_rows = (
        MasterData.query.filter_by(master_type="circle", is_active=True)
        .order_by(MasterData.name.asc())
        .all()
    )
    from .plan_features import filter_query_departments

    departments = filter_query_departments([r.name for r in dept_rows])

    return jsonify({
        "success": True,
        "departments": departments,
        "circles": [r.name for r in circle_rows],
    }), 200


@auth.route("/tax-declaration/self", methods=["GET"])
def get_tax_declaration_self_auth():
    return tax_decl.get_tax_declaration_self()


@auth.route("/tax-declaration/self", methods=["POST"])
def save_tax_declaration_self_auth():
    return tax_decl.save_tax_declaration_self()


@auth.route("/tax-declaration/form-schema", methods=["GET"])
def get_tax_declaration_form_schema_auth():
    return tax_decl.get_tax_declaration_form_schema()


@auth.route("/tax-declaration/financial-years", methods=["GET"])
def list_tax_declaration_financial_years_auth():
    return tax_decl.list_tax_declaration_financial_years()


@auth.route("/tax-declaration/self/documents", methods=["POST"])
def upload_tax_declaration_document_auth():
    return tax_decl.upload_tax_declaration_document()


@auth.route("/tax-declaration/self/documents/<int:doc_id>", methods=["DELETE"])
def delete_tax_declaration_document_auth(doc_id):
    return tax_decl.delete_tax_declaration_document(doc_id)


@auth.route("/tax-declaration/self/history", methods=["GET"])
def list_tax_declaration_self_history_auth():
    return tax_decl.list_tax_declaration_self_history()


@auth.route("/tax-declaration/<int:decl_id>", methods=["GET"])
def get_tax_declaration_detail_auth(decl_id):
    return tax_decl.get_tax_declaration_detail(decl_id)


@auth.route("/tax-declaration/self/final-proof", methods=["GET"])
def get_final_proof_self_auth():
    return tax_decl.get_final_proof_self()


@auth.route("/tax-declaration/self/final-proof", methods=["POST"])
def save_final_proof_self_auth():
    return tax_decl.save_final_proof_self()


@auth.route("/tax-declaration/deadline", methods=["GET"])
def get_declaration_deadline_auth():
    return tax_decl.get_declaration_deadline_route()


@auth.route("/form16/reconciliation", methods=["GET"])
@jwt_required()
def form16_reconciliation_self():
    from .Accounts import form16_reconciliation
    email = get_jwt().get("email")
    admin = Admin.query.filter_by(email=email).first()
    if not admin:
        return jsonify({"success": False, "message": "Unauthorized user"}), 401
    return form16_reconciliation(admin.id)


@auth.route("/tds/projection", methods=["POST"])
@jwt_required()
def tds_projection_auth():
    from .Accounts import tds_projection
    return tds_projection()


@auth.route("/tds/variance", methods=["POST"])
@jwt_required()
def tds_variance_auth():
    from .Accounts import tds_variance
    return tds_variance()


@auth.route("/form16/summary", methods=["GET"])
@jwt_required()
def form16_summary_self():
    from .Accounts import form16_summary
    email = get_jwt().get("email")
    admin = Admin.query.filter_by(email=email).first()
    if not admin:
        return jsonify({"success": False, "message": "Unauthorized user"}), 401
    return form16_summary(admin.id)


@auth.route("/form16/summary/download", methods=["GET"])
@jwt_required()
def form16_summary_download_self():
    from .Accounts import form16_summary_download
    email = get_jwt().get("email")
    admin = Admin.query.filter_by(email=email).first()
    if not admin:
        return jsonify({"success": False, "message": "Unauthorized user"}), 401
    return form16_summary_download(admin.id)


# ===================================================
# Set password via reset token (public; link from HR reset email, expires in 1 hour)
# FINAL URL → POST /api/auth/set-password
@auth.route("/set-password", methods=["POST"])
def set_password_by_token():
    data = request.get_json(silent=True) or {}
    token = (data.get("token") or "").strip()
    password = data.get("password")
    confirm_password = data.get("confirm_password")

    if not token:
        return jsonify({"success": False, "message": "Token is required"}), 400
    if not password or not confirm_password:
        return jsonify({"success": False, "message": "Password and confirm password are required"}), 400
    if password != confirm_password:
        return jsonify({"success": False, "message": "Passwords do not match"}), 400
    if len(password) < 8:
        return jsonify({"success": False, "message": "Password must be at least 8 characters"}), 400

    admin = Admin.query.filter_by(password_reset_token=token).first()
    if not admin:
        return jsonify({"success": False, "message": "Invalid or expired link"}), 400
    if not admin.password_reset_expiry or admin.password_reset_expiry < utc_now():
        admin.password_reset_token = None
        admin.password_reset_expiry = None
        db.session.commit()
        return jsonify({"success": False, "message": "This link has expired. Please ask HR to send a new one."}), 400

    admin.set_password(password)
    admin.password_reset_token = None
    admin.password_reset_expiry = None
    db.session.commit()

    return jsonify({"success": True, "message": "Password updated successfully. You can now log in."}), 200


# ===================================================
# ✅ 1️⃣ VALIDATE USER (EMAIL/MOBILE + PASSWORD)
# FINAL URL → POST /api/auth/validate-user
@auth.route("/validate-user", methods=["POST"])
def validate_user():
    data = request.get_json(silent=True) or {}

    identifier = data.get("identifier")
    password = data.get("password")
    
    if not identifier or not password:
        return jsonify({
            "success": False,
            "message": "Missing credentials"
        }), 400
    
    admin = None
    if identifier.isdigit():
        # Treat all-digit identifier as either mobile or emp_id
        from sqlalchemy import or_
        admin = Admin.query.filter(
            or_(Admin.mobile == identifier, Admin.emp_id == identifier)
        ).first()
    elif "@" in identifier:
        # Email-based login
        admin = Admin.query.filter_by(email=identifier).first()

    # Validate credentials first
    if not admin or not admin.check_password(password):
        return jsonify({
            "success": False,
            "message": "Invalid credentials"
        }), 400

    # Block exited or inactive users from logging in
    if getattr(admin, "is_exited", False):
        return jsonify({
            "success": False,
            "message": "Your account has been exited. Please contact HR."
        }), 403

    if getattr(admin, "is_active", True) is False:
        return jsonify({
            "success": False,
            "message": "Your account is inactive. Please contact HR."
        }), 403

    access_token = create_access_token(
        identity=str(admin.id),
        additional_claims={
            "email": admin.email,
            "emp_type": admin.emp_type
        }
    )


    from .plan_features import plan_payload

    return jsonify({
        "success": True,
        "token": access_token,
        **plan_payload(),
    }), 200


def _safe_doj(admin):
    """Return admin.doj as string for JSON; None-safe."""
    d = getattr(admin, "doj", None)
    if d is None:
        return None
    return isoformat_api(d) if d is not None else None


@auth.route('/employee/homepage', methods=['GET'])
@jwt_required()
def employee_homepage():
    try:
        return _employee_homepage_impl()
    except Exception as e:
        logger.exception("employee_homepage error")
        return jsonify({
            "success": False,
            "message": "Failed to load homepage",
            "error": str(e) if current_app.debug else None
        }), 500


def _employee_homepage_impl():
    from .plan_features import plan_payload

    try:
        raw_id = get_jwt_identity()
        admin_id = int(raw_id) if raw_id is not None else None
    except (TypeError, ValueError):
        return jsonify({"success": False, "message": "Invalid token"}), 401

    if admin_id is None:
        return jsonify({"success": False, "message": "Invalid token"}), 401

    # ------------------------
    # 1. ADMIN DATA
    # ------------------------
    admin = Admin.query.get(admin_id)
    if not admin:
        return jsonify({
            "success": False,
            "message": "User not found"
        }), 404

    # ------------------------
    # 2. EMPLOYEE DATA
    # ------------------------
    employee = Employee.query.filter_by(admin_id=admin.id).first()

    # ------------------------
    # 3. PUNCH / night shift (open session may belong to prior calendar day)
    # ------------------------
    today = date.today()
    working_hours = None
    punch_in_display = None
    punch_out_display = None
    has_open_session = False
    requires_repeat_punch_reason = False
    overnight_attendance_date = None
    punch_row_for_detail = None

    try:
        repair_attendance_integrity_for_admin(admin.id)
    except Exception:
        db.session.rollback()

    global_open = open_punch_session_for_admin(admin.id)
    if global_open and global_open.punch_id:
        pp = global_open.punch
        if pp:
            try:
                if ensure_punch_sessions_backfill(pp):
                    db.session.commit()
            except Exception:
                db.session.rollback()
            global_open = open_punch_session_for_admin(admin.id)

    if global_open:
        open_sess = global_open
        pp = open_sess.punch
        if not pp:
            global_open = None
        else:
            has_open_session = True
            punch_in_display = open_sess.clock_in
            punch_out_display = None
            if pp.punch_date and pp.punch_date < today:
                overnight_attendance_date = pp.punch_date.isoformat()
            total_secs = capped_daily_work_seconds(open_sess)
            working_hours = seconds_to_hms_str(total_secs)
            requires_repeat_punch_reason = False
            punch_row_for_detail = pp

    if not global_open:
        punch = Punch.query.filter_by(
            admin_id=admin.id,
            punch_date=today,
        ).first()

        if punch and punch.id:
            try:
                if ensure_punch_sessions_backfill(punch):
                    db.session.commit()
                    punch = Punch.query.filter_by(admin_id=admin.id, punch_date=today).first()
            except Exception:
                db.session.rollback()

        if punch and punch.id:
            day_sessions = sessions_for_punch_date(punch)
            open_sess = next((s for s in day_sessions if s.clock_out is None), None)
            has_open_session = open_sess is not None
            closed_today = [s for s in day_sessions if s.clock_out is not None]
            closed_cnt = len(closed_today)
            requires_repeat_punch_reason = closed_cnt > 0 and not has_open_session

            closed_secs = 0
            for s in closed_today:
                closed_secs += int((s.clock_out - s.clock_in).total_seconds())

            if has_open_session:
                punch_in_display = open_sess.clock_in
                punch_out_display = None
                total_secs = capped_daily_work_seconds(open_sess)
                working_hours = seconds_to_hms_str(total_secs)
                punch_row_for_detail = punch
            elif closed_cnt > 0:
                punch_in_display = min(s.clock_in for s in day_sessions)
                punch_out_display = max(s.clock_out for s in closed_today)
                working_hours = seconds_to_hms_str(closed_secs)
                punch_row_for_detail = punch
            else:
                # Stale punch row (e.g. misdated sessions moved on repair) — treat as fresh day
                punch_in_display = None
                punch_out_display = None
                working_hours = seconds_to_hms_str(0)
                requires_repeat_punch_reason = False
                punch_row_for_detail = None

    punch_sessions_json = (
        serialize_punch_sessions(punch_row_for_detail, attendance_day_only=True)
        if punch_row_for_detail
        else []
    )
    session_attendance_date = (
        punch_row_for_detail.punch_date.isoformat()
        if punch_row_for_detail and getattr(punch_row_for_detail, "punch_date", None)
        else None
    )

    # ------------------------
    # 4. LEAVE BALANCE + USAGE (from LeaveBalance table)
    # ------------------------
    leave_balance = LeaveBalance.query.filter_by(admin_id=admin.id).first()
    comp_balance = get_effective_comp_balance(admin.id) if admin else 0.0
    if leave_balance and sync_leave_balance_totals(leave_balance):
        try:
            db.session.commit()
        except Exception:
            db.session.rollback()

    # ------------------------
    # 5. MANAGER DETAILS (ManagerContact)
    # Look up by (circle, user_type, user_email). Use stripped + case-insensitive match
    # so DB "NHQ"/"Software Developer" matches admin "nhq"/"software developer".
    # Fall back to group-level (user_email is None or '') if no employee-specific row.
    # ------------------------
    from .manager_utils import resolve_manager_contact_for_employee

    manager_contact = resolve_manager_contact_for_employee(admin)

    managers = {}
    if manager_contact:
        from .manager_utils import get_manager_detail
        for key in ("l1", "l2", "l3"):
            d = get_manager_detail(manager_contact, key)
            if d.get("name") or d.get("email"):
                managers[key] = {
                    "name": d["name"],
                    "email": d["email"],
                    "mobile": d["mobile"]
                }

    from .manager_utils import user_has_manager_access
    has_manager_access = user_has_manager_access(admin)

    # ------------------------
    # 6. LAST LEAVE & LAST PAYSLIP
    # ------------------------
    last_leave = LeaveApplication.query.filter_by(admin_id=admin.id).order_by(
        LeaveApplication.start_date.desc()
    ).first()
    last_leave_data = None
    if last_leave:
        last_leave_data = {
            "id": last_leave.id,
            "leave_type": last_leave.leave_type,
            "start_date": last_leave.start_date.isoformat() if last_leave.start_date else None,
            "end_date": last_leave.end_date.isoformat() if last_leave.end_date else None,
            "status": last_leave.status,
            "deducted_days": last_leave.deducted_days,
        }

    last_payslip = PaySlip.query.filter_by(admin_id=admin.id).order_by(
        PaySlip.id.desc()
    ).first()
    last_payslip_data = None
    if last_payslip:
        last_payslip_data = {
            "id": last_payslip.id,
            "month": last_payslip.month,
            "year": last_payslip.year,
            "file_path": last_payslip.file_path,
        }

    from .plan_features import has_feature

    my_payroll_history = []
    if has_feature("payslip_payroll_history"):
        payroll_rows = (
            MonthlyPayroll.query
            .filter_by(admin_id=admin.id)
            .order_by(
                MonthlyPayroll.year.desc(),
                MonthlyPayroll.month_num.desc(),
                MonthlyPayroll.id.desc(),
            )
            .limit(12)
            .all()
        )
        for row in payroll_rows:
            my_payroll_history.append({
                "id": row.id,
                "month": row.month,
                "month_num": row.month_num,
                "year": row.year,
                "actual_working_days": float(row.actual_working_days or 0),
                "gross_salary_for_month": float(row.gross_salary_for_month or 0),
                "epf_final": float(row.epf_final or 0),
                "ptax_final": float(row.ptax_final or 0),
                "esic_final": float(row.esic_final or 0),
                "tds_final": float(row.tds_final if row.tds_final is not None else row.tds_computed or 0),
                "deductions_total_final": float(row.deductions_total_final or 0),
                "net_salary_final": float(row.net_salary_final or 0),
                "created_at": isoformat_api(row.created_at),
            })

    # ------------------------
    # 7. JOINING INFO (DOJ + years of service)
    # ------------------------
    years_of_service = None
    if admin.doj:
        years_of_service = today.year - admin.doj.year
        # If current date is before this year's anniversary, subtract one year
        if (today.month, today.day) < (admin.doj.month, admin.doj.day):
            years_of_service -= 1

    # ------------------------
    # RESPONSE
    # ------------------------
    def _punch_iso_val(val):
        if val is None:
            return None
        return isoformat_punch_clock(val)

    # Display name: first_name, else user_name, else email prefix, else "User" (so HR/any user shows in header)
    _first = (getattr(admin, "first_name", None) or "").strip()
    _uname = (getattr(admin, "user_name", None) or "").strip()
    _email = (getattr(admin, "email", None) or "").strip()
    display_name = _first or _uname or (_email.split("@")[0] if _email else None) or "User"

    photo_url = None
    if employee:
        photo_fn = (getattr(employee, "photo_filename", None) or "").strip()
        if photo_fn:
            try:
                photo_url = url_for("static", filename=f"uploads/{photo_fn}", _external=True)
            except Exception:
                photo_url = f"/static/uploads/{photo_fn}"

    from .probation_utils import build_employee_probation_status

    probation = build_employee_probation_status(admin, run_date=today)

    return jsonify({
        "success": True,
        "user": {
            "id": admin.id,
            "name": display_name,
            "first_name": getattr(admin, "first_name", None),
            "user_name": getattr(admin, "user_name", None),
            "email": getattr(admin, "email", None),
            "emp_id": getattr(admin, "emp_id", None),
            "emp_type": getattr(admin, "emp_type", None),
            "mobile": getattr(admin, "mobile", None),
            # Prefer employee job title for UI/routing when emp_type is generic (e.g. Super Admin + HR role).
            "designation": (getattr(employee, "designation", None) if employee else None),
            "department": getattr(admin, "emp_type", None),
            "circle": getattr(admin, "circle", None),
            "doj": _safe_doj(admin),
            "has_manager_access": has_manager_access,
            "photo_url": photo_url
        },
        "employee": {
            "designation": employee.designation if employee else None
        },
        "punch": {
            "punch_in": _punch_iso_val(punch_in_display),
            "punch_out": _punch_iso_val(punch_out_display),
            "working_hours": working_hours,
            "has_open_session": has_open_session,
            "requires_repeat_punch_reason": requires_repeat_punch_reason,
            "overnight_attendance_date": overnight_attendance_date,
            "sessions": punch_sessions_json,
            "session_attendance_date": session_attendance_date,
        },
        "joining_info": {
            "doj": _safe_doj(admin),
            "years_of_service": years_of_service,
            "is_joining_today": bool(admin.doj and admin.doj == today),
        },
        "leave_balance": leave_balance_payload(
            leave_balance,
            comp_balance=comp_balance,
            sync=False,
        ),
        "managers": managers,
        "last_leave": last_leave_data,
        "last_payslip": last_payslip_data,
        "my_payroll_history": my_payroll_history,
        "probation": probation,
        **plan_payload(),
    }), 200


NEWS_FEED_VISIBLE_DAYS = 6


def _is_news_post_visible(created_at) -> bool:
    """Hide HR announcement posts older than NEWS_FEED_VISIBLE_DAYS (IST calendar days)."""
    if not created_at:
        return False
    dt = ensure_utc(created_at)
    post_date = dt.astimezone(IST).date()
    cutoff = datetime.now(IST).date() - timedelta(days=NEWS_FEED_VISIBLE_DAYS)
    return post_date >= cutoff


@auth.route("/news-feed", methods=["GET"])
@jwt_required()
def get_news_feed():
    """Return news feed posts for the logged-in employee, filtered by their circle and emp_type.
    Also includes birthdays and work anniversaries for users in the same circle."""
    try:
        admin_id = int(get_jwt_identity())
    except (TypeError, ValueError):
        return jsonify({"success": False, "message": "Invalid token"}), 401
    admin = Admin.query.get(admin_id)
    if not admin:
        return jsonify({"success": False, "message": "User not found"}), 404

    from sqlalchemy import or_
    user_circle = (getattr(admin, "circle", None) or "").strip()
    user_emp_type = getattr(admin, "emp_type", None) or ""
    today = date.today()
    current_month, current_day = today.month, today.day

    items = []

    # 1. Birthdays (Employee.dob) – same circle
    if user_circle:
        bday_admins = Admin.query.join(Employee, Admin.id == Employee.admin_id).filter(
            db.func.lower(db.func.coalesce(Admin.circle, "")) == user_circle.lower(),
            db.extract("month", Employee.dob) == current_month,
            db.extract("day", Employee.dob) == current_day
        ).all()
        for a in bday_admins:
            emp = Employee.query.filter_by(admin_id=a.id).first()
            name = (emp and emp.name) or a.first_name or "A colleague"
            items.append({
                "id": f"birthday-{a.id}",
                "type": "birthday",
                "title": "Happy Birthday!",
                "content": f"{name} celebrates their birthday today.",
                "file_path": None,
                "created_at": today.isoformat(),
            })

    # 2. Work anniversaries & joinings today (Admin.doj) – same circle
    if user_circle:
        anniv_admins = Admin.query.filter(
            db.func.lower(db.func.coalesce(Admin.circle, "")) == user_circle.lower(),
            Admin.doj.isnot(None),
            db.extract("month", Admin.doj) == current_month,
            db.extract("day", Admin.doj) == current_day
        ).all()
        for a in anniv_admins:
            years = today.year - a.doj.year if a.doj else 0
            name = a.first_name or "A colleague"

            if years <= 0:
                # Joining / onboarding info when DOJ is today (not a work anniversary yet)
                items.append({
                    "id": f"joining-{a.id}",
                    "type": "joining",
                    "title": "Welcome Onboard!",
                    "content": f"Congratulations {name}, welcome to the team!",
                    "file_path": None,
                    "created_at": today.isoformat(),
                })
            else:
                # True work anniversary (at least 1 year completed)
                items.append({
                    "id": f"anniversary-{a.id}",
                    "type": "anniversary",
                    "title": "Work Anniversary!",
                    "content": f"{name} completes {years} year(s) with us today.",
                    "file_path": None,
                    "created_at": today.isoformat(),
                })

    # 3. Regular news feed posts (visible for NEWS_FEED_VISIBLE_DAYS only)
    posts = NewsFeed.query.filter(
        or_(NewsFeed.circle == user_circle, NewsFeed.circle == "All"),
        or_(NewsFeed.emp_type == user_emp_type, NewsFeed.emp_type == "All")
    ).order_by(NewsFeed.created_at.desc()).limit(50).all()

    items.extend([
        {
            "id": p.id,
            "type": "post",
            "title": p.title,
            "content": p.content,
            "file_path": p.file_path,
            # Full URL for attachment, used by frontend
            "file_url": p.file_url(),
            "circle": p.circle,
            "emp_type": p.emp_type,
            "created_at": isoformat_api(p.created_at),
        }
        for p in posts
        if _is_news_post_visible(p.created_at)
    ])
    return jsonify({
        "success": True,
        "news_feed": items,
        "visible_days": NEWS_FEED_VISIBLE_DAYS,
    }), 200


def _parse_postal_pincode_payload(payload):
    """Map postalpincode.in JSON to city, district, state."""
    if not isinstance(payload, list) or not payload:
        return None
    block = payload[0]
    if block.get('Status') != 'Success':
        return None
    offices = block.get('PostOffice') or []
    if not offices:
        return None
    office = offices[0]
    district = (office.get('District') or '').strip()
    state = (office.get('State') or '').strip()
    city = (
        (office.get('Block') or '').strip()
        or (office.get('Name') or '').strip()
        or district
    )
    return {
        "city": city[:100],
        "district": district[:100],
        "state": state[:100],
    }


def _fetch_postal_pincode_json(pin):
    """Fetch pincode data; requests first, then urllib fallback."""
    url = f'https://api.postalpincode.in/pincode/{pin}'
    headers = {'User-Agent': 'Mozilla/5.0 (compatible; SaffoHRMS/1.0)'}
    try:
        resp = requests.get(url, timeout=15, headers=headers)
        resp.raise_for_status()
        return resp.json()
    except requests.RequestException:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=15) as raw:
            return json.loads(raw.read().decode('utf-8'))


@auth.route('/pincode/<pincode>', methods=['GET'])
def pincode_lookup(pincode):
    """Look up Indian postal pincode → city, district, state (India Post data via postalpincode.in)."""
    pin = str(pincode or '').strip()
    if not re.match(r'^\d{6}$', pin):
        return jsonify({"success": False, "message": "Enter a valid 6-digit pincode"}), 400

    try:
        payload = _fetch_postal_pincode_json(pin)
    except Exception:
        logging.exception("pincode_lookup request failed for %s", pin)
        return jsonify({
            "success": False,
            "message": "Could not reach pincode service. Try again.",
        }), 502

    parsed = _parse_postal_pincode_payload(payload)
    if not parsed:
        block = payload[0] if isinstance(payload, list) and payload else {}
        return jsonify({
            "success": False,
            "message": block.get('Message') or 'Pincode not found',
        }), 404

    return jsonify({
        "success": True,
        "pincode": pin,
        **parsed,
    }), 200


@auth.route('/employee/profile', methods=['GET'])
@jwt_required()
def employee_profile():
    """Return full profile for the logged-in employee (admin + employee details + education + previous companies + documents)."""
    try:
        admin_id = int(get_jwt_identity())
    except (TypeError, ValueError):
        return jsonify({"success": False, "message": "Invalid token"}), 401
    admin = Admin.query.get(admin_id)
    if not admin:
        return jsonify({"success": False, "message": "User not found"}), 404

    employee = Employee.query.filter_by(admin_id=admin.id).first()

    # Reporting manager: always resolve from ManagerContact (L1) based on Admin
    reporting_manager_name = ""
    try:
        from .manager_utils import get_manager_detail, resolve_manager_contact_for_employee

        manager_contact = resolve_manager_contact_for_employee(admin)
        if manager_contact:
            l1 = get_manager_detail(manager_contact, "l1")
            reporting_manager_name = (l1.get("name") or "").strip()
    except Exception:
        pass
    education_list = Education.query.filter_by(admin_id=admin.id).all()
    prev_companies = PreviousCompany.query.filter_by(admin_id=admin.id).all()
    upload_doc = UploadDoc.query.filter_by(admin_id=admin.id).first()

    def _date_iso(d):
        return isoformat_api(d) if d else None

    profile = {
        "admin": {
            "id": admin.id,
            "first_name": admin.first_name,
            "user_name": admin.user_name,
            "email": admin.email,
            "mobile": admin.mobile,
            "emp_id": admin.emp_id,
            "doj": _date_iso(admin.doj),
            "emp_type": admin.emp_type,
            "circle": admin.circle or "",
            "reporting_manager": reporting_manager_name,
        },
        "employee": None,
        "education": [],
        "previous_employment": [],
        "documents": None,
    }

    if employee:
        photo_url = None
        photo_fn = (getattr(employee, "photo_filename", None) or "").strip()
        if photo_fn:
            try:
                photo_url = url_for("static", filename=f"uploads/{photo_fn}", _external=True)
            except Exception:
                photo_url = f"/static/uploads/{photo_fn}"
        profile["employee"] = {
            "name": employee.name,
            "email": employee.email,
            "father_name": employee.father_name,
            "mother_name": employee.mother_name,
            "marital_status": employee.marital_status,
            "dob": _date_iso(employee.dob),
            "emp_id": employee.emp_id,
            "mobile": employee.mobile,
            "gender": employee.gender,
            "emergency_mobile": employee.emergency_mobile,
            "nationality": employee.nationality,
            "blood_group": employee.blood_group,
            "designation": employee.designation,
            "permanent_address_line1": employee.permanent_address_line1,
            "permanent_pincode": employee.permanent_pincode,
            "permanent_city": employee.permanent_city or "",
            "permanent_district": employee.permanent_district or "",
            "permanent_state": employee.permanent_state or "",
            "present_address_line1": employee.present_address_line1,
            "present_pincode": employee.present_pincode,
            "present_city": employee.present_city or "",
            "present_district": employee.present_district or "",
            "present_state": employee.present_state or "",
            "photo_url": photo_url,
        }

    for edu in education_list:
        profile["education"].append({
            "id": edu.id,
            "qualification": edu.qualification,
            "institution": edu.institution,
            "university": (edu.board or ""),
            "board": edu.board,
            "start": _date_iso(edu.start),
            "end": _date_iso(edu.end),
            "marks": edu.marks,
            "doc_file": edu.doc_file,
        })

    for pc in prev_companies:
        doj = pc.doj
        dol = pc.dol
        years = ""
        if doj and dol and hasattr(doj, 'year') and hasattr(dol, 'year'):
            delta = (dol - doj).days if hasattr(dol, '__sub__') else 0
            years = str(round(delta / 365.25, 1)) if delta else ""
        profile["previous_employment"].append({
            "id": pc.id,
            "companyName": pc.com_name,
            "designation": pc.designation,
            "doj": _date_iso(pc.doj),
            "dateOfLeaving": _date_iso(pc.dol),
            "experienceYears": years,
            "reason": pc.reason,
        })

    if upload_doc:
        profile["documents"] = _upload_doc_profile_dict(upload_doc)

    from .probation_utils import build_employee_probation_status

    profile["probation"] = build_employee_probation_status(admin, run_date=date.today())

    return jsonify({"success": True, "profile": profile}), 200


def _upload_doc_profile_dict(upload_doc):
    """Serialize UploadDoc for profile / HR / Accounts APIs."""
    if not upload_doc:
        return {}
    return {
        "aadhaar_number": upload_doc.aadhaar_number,
        "pan_number": upload_doc.pan_number,
        "bank_account_number": upload_doc.bank_account_number,
        "bank_name": upload_doc.bank_name,
        "bank_branch_code": upload_doc.bank_branch_code,
        "ifsc_code": upload_doc.ifsc_code,
        "aadhaar_front": upload_doc.aadhaar_front,
        "aadhaar_back": upload_doc.aadhaar_back,
        "pan_front": upload_doc.pan_front,
        "pan_back": upload_doc.pan_back,
        "appointment_letter": upload_doc.appointment_letter,
        "passbook_front": upload_doc.passbook_front,
    }


def _validate_upload_doc_identity_payload(data):
    """Return (normalized_dict, error_message)."""
    out = {}
    if "aadhaar_number" in data:
        val = normalize_aadhaar(data.get("aadhaar_number"))
        if val and not validate_aadhaar(val):
            return None, "Aadhaar number must be 12 digits."
        out["aadhaar_number"] = val or None
    if "pan_number" in data:
        val = normalize_pan(data.get("pan_number"))
        if val and not validate_pan(val):
            return None, "PAN must be in format ABCDE1234F."
        out["pan_number"] = val or None
    if "bank_account_number" in data:
        raw = str(data.get("bank_account_number") or "").strip()
        digits = re.sub(r"\D", "", raw)
        if digits and not validate_bank_account(digits):
            return None, "Bank account number must be 9–18 digits."
        out["bank_account_number"] = digits or None
    if "bank_name" in data:
        name = str(data.get("bank_name") or "").strip()[:120]
        out["bank_name"] = name or None
    if "bank_branch_code" in data:
        code = normalize_bank_branch_code(data.get("bank_branch_code"))
        if code and not validate_bank_branch_code(code):
            return None, "Bank branch code must be 2–20 letters or numbers."
        out["bank_branch_code"] = code or None
    if "ifsc_code" in data:
        val = normalize_ifsc(data.get("ifsc_code"))
        if val and not validate_ifsc(val):
            return None, "IFSC must be 11 characters (e.g. SBIN0001234)."
        out["ifsc_code"] = val or None
    return out, None


def _sync_upload_doc_to_employee_accounts(admin, upload_doc):
    """Keep EmployeeAccounts PAN / bank_details aligned with uploaded identity."""
    if not admin or not upload_doc:
        return
    emp_no = (admin.emp_id or "").strip() or None
    rec = EmployeeAccounts.query.filter_by(admin_id=admin.id).first()
    if not rec and emp_no:
        rec = EmployeeAccounts.query.filter_by(employee_number=emp_no).first()
    if not rec:
        rec = EmployeeAccounts(admin_id=admin.id, employee_number=emp_no)
        db.session.add(rec)
    elif not rec.admin_id:
        rec.admin_id = admin.id
    if upload_doc.pan_number:
        rec.pan = upload_doc.pan_number
    bank_lines = []
    if upload_doc.bank_account_number:
        bank_lines.append(f"Account: {upload_doc.bank_account_number}")
    if upload_doc.bank_name:
        bank_lines.append(f"Bank: {upload_doc.bank_name}")
    if upload_doc.bank_branch_code:
        bank_lines.append(f"Branch Code: {upload_doc.bank_branch_code}")
    if upload_doc.ifsc_code:
        bank_lines.append(f"IFSC: {upload_doc.ifsc_code}")
    if bank_lines:
        rec.bank_details = "\n".join(bank_lines)


def _static_upload_photo_url(filename):
    """Relative URL so the Vite dev proxy can serve /static from Flask."""
    return f"/static/uploads/{filename}"


def _photo_extension_from_upload(photo):
    """Resolve a safe extension from filename or Content-Type."""
    allowed = {'png', 'jpg', 'jpeg', 'gif', 'webp'}
    ext = ''
    if photo.filename and '.' in photo.filename:
        ext = photo.filename.rsplit('.', 1)[-1].lower()
    if ext not in allowed:
        ct = (photo.content_type or '').lower()
        if 'jpeg' in ct or 'jpg' in ct:
            ext = 'jpg'
        elif 'png' in ct:
            ext = 'png'
        elif 'gif' in ct:
            ext = 'gif'
        elif 'webp' in ct:
            ext = 'webp'
    return ext if ext in allowed else None


def _ensure_employee_for_admin(admin):
    """
    Ensure an Employee row exists for profile photo storage.
    IT/admin users may have Admin data only until they complete profile sections.
    """
    employee = Employee.query.filter_by(admin_id=admin.id).first()
    if employee:
        return employee

    name = ((admin.first_name or admin.user_name or "Employee") or "Employee").strip()[:100]
    email = (admin.email or "").strip()
    if not email:
        email = f"user{admin.id}@local.saffotech.com"
    else:
        taken = Employee.query.filter(
            func.lower(Employee.email) == email.lower()
        ).first()
        if taken:
            email = f"user{admin.id}@local.saffotech.com"

    emp_id = ((admin.emp_id or f"EMP{admin.id}") or f"EMP{admin.id}").strip()[:50]
    if Employee.query.filter_by(emp_id=emp_id).first():
        emp_id = f"EMP{admin.id}"

    mobile = (admin.mobile or "0000000000").strip()[:20] or "0000000000"

    employee = Employee(
        admin_id=admin.id,
        name=name,
        email=email[:100],
        father_name="N/A",
        mother_name="N/A",
        marital_status="Single",
        dob=date(1990, 1, 1),
        emp_id=emp_id,
        mobile=mobile,
        gender="prefer_not_to_say",
        emergency_mobile=mobile[:50],
        nationality="Indian",
        blood_group="O+",
        designation="Not Specified",
    )
    db.session.add(employee)
    try:
        db.session.flush()
    except IntegrityError:
        db.session.rollback()
        raise
    return employee


@auth.route('/employee/upload-photo', methods=['POST'])
@jwt_required()
def upload_profile_photo():
    """Upload profile photo for the logged-in employee."""
    try:
        admin_id = int(get_jwt_identity())
    except (TypeError, ValueError):
        return jsonify({"success": False, "message": "Invalid token"}), 401

    admin = Admin.query.get(admin_id)
    if not admin:
        return jsonify({"success": False, "message": "User not found"}), 404

    if 'photo' not in request.files:
        return jsonify({"success": False, "message": "No photo file provided"}), 400

    photo = request.files['photo']
    if not photo:
        return jsonify({"success": False, "message": "Invalid photo file"}), 400

    ext = _photo_extension_from_upload(photo)
    if not ext:
        return jsonify({"success": False, "message": "Invalid file type. Allowed: png, jpg, jpeg, gif, webp"}), 400

    try:
        employee = _ensure_employee_for_admin(admin)
    except IntegrityError:
        db.session.rollback()
        return jsonify({
            "success": False,
            "message": "Could not create employee profile for photo. Save personal details first, then try again.",
        }), 400

    emp_slug = secure_filename(str(admin.emp_id or admin.id))
    filename = secure_filename(f"profile_{admin.id}_{emp_slug}.{ext}")
    upload_dir = os.path.join(current_app.static_folder, "uploads")
    os.makedirs(upload_dir, exist_ok=True)
    photo_path = os.path.join(upload_dir, filename)
    photo.save(photo_path)

    employee.photo_filename = filename
    try:
        db.session.commit()
    except Exception:
        db.session.rollback()
        logging.exception("upload_profile_photo commit failed")
        return jsonify({"success": False, "message": "Failed to save photo"}), 500

    photo_url = _static_upload_photo_url(filename)
    return jsonify({"success": True, "message": "Photo uploaded successfully", "photo_url": photo_url}), 200


def _normalize_working_hours(val):
    """Convert today_work to HH:MM:SS format. Handles Interval/datetime serialization quirks."""
    if val is None:
        return None
    s = str(val).strip()
    if not s:
        return None
    # Reject datetime-like strings (e.g. "0000-04-22 00:00:00" from Interval)
    if re.match(r"^\d{4}-\d{2}-\d{2}", s):
        return None
    # Accept "HH:MM:SS" or "H:M:S"
    m = re.match(r"^(\d{1,2}):(\d{2})(?::(\d{2}))?$", s)
    if m:
        h, mi, sec = int(m.group(1)), int(m.group(2)), int(m.group(3) or 0)
        return f"{h:02d}:{mi:02d}:{sec:02d}"
    return None


def calculate_distance(lat1, lon1, lat2, lon2):
    R = 6371000  # meters
    dLat = radians(lat2 - lat1)
    dLon = radians(lon2 - lon1)
    a = sin(dLat/2)**2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dLon/2)**2
    c = 2 * atan2(sqrt(a), sqrt(1-a))
    return R * c

GEOFENCE_GRACE_METERS = 100
DEFAULT_OFFICE_RADIUS_METERS = 100


def _parse_lat(val):
    if val is None or val == "":
        return None
    try:
        f = float(val)
        if -90 <= f <= 90:
            return f
    except (TypeError, ValueError):
        pass
    return None


def _parse_lon(val):
    if val is None or val == "":
        return None
    try:
        f = float(val)
        if -180 <= f <= 180:
            return f
    except (TypeError, ValueError):
        pass
    return None


def compute_zone(distance, radius, grace=GEOFENCE_GRACE_METERS):
    if distance is None:
        return "NO_GPS"
    if radius is None:
        radius = DEFAULT_OFFICE_RADIUS_METERS
    if distance <= radius:
        return "INSIDE"
    if distance <= (radius + grace):
        return "NEAR"
    return "OUTSIDE"


def zone_to_location_status(zone):
    """DB label for punch session geo — outside_geofence only when truly outside."""
    return {
        "INSIDE": "inside_geofence",
        "NEAR": "inside_geofence",
        "OUTSIDE": "outside_geofence",
        "NO_GPS": "gps_unavailable",
        "NO_OFFICE_CONFIG": "office_not_configured",
    }.get(zone or "", "location_not_captured")


def resolve_geofence_for_coordinates(lat, lon):
    """
    Pick best office from all configured locations (same logic as /employee/location-check).
    Returns zone, distance_meters, radius_meters, in_range, location_status.
    """
    user_lat = _parse_lat(lat)
    user_lon = _parse_lon(lon)
    if user_lat is None or user_lon is None:
        return {
            "zone": "NO_GPS",
            "distance_meters": None,
            "radius_meters": None,
            "in_range": False,
            "location_status": zone_to_location_status("NO_GPS"),
        }

    offices = Location.query.all()
    if not offices:
        return {
            "zone": "NO_OFFICE_CONFIG",
            "distance_meters": None,
            "radius_meters": None,
            "in_range": False,
            "location_status": zone_to_location_status("NO_OFFICE_CONFIG"),
        }

    best_zone = None
    best_distance = None
    best_radius = None

    for office in offices:
        if office.latitude is None or office.longitude is None:
            continue
        radius = office.radius if office.radius is not None else DEFAULT_OFFICE_RADIUS_METERS
        distance = calculate_distance(
            user_lat, user_lon, office.latitude, office.longitude
        )
        zone = compute_zone(distance, radius)

        if best_zone is None:
            best_zone = zone
            best_distance = distance
            best_radius = radius
            continue

        current_in_range = zone in ("INSIDE", "NEAR")
        best_in_range = best_zone in ("INSIDE", "NEAR")
        if current_in_range and not best_in_range:
            best_zone = zone
            best_distance = distance
            best_radius = radius
        elif current_in_range == best_in_range and distance < best_distance:
            best_zone = zone
            best_distance = distance
            best_radius = radius

    if best_zone is None:
        return {
            "zone": "NO_OFFICE_CONFIG",
            "distance_meters": None,
            "radius_meters": None,
            "in_range": False,
            "location_status": zone_to_location_status("NO_OFFICE_CONFIG"),
        }

    return {
        "zone": best_zone,
        "distance_meters": int(best_distance) if best_distance is not None else None,
        "radius_meters": best_radius,
        "in_range": best_zone in ("INSIDE", "NEAR"),
        "location_status": zone_to_location_status(best_zone),
    }


def needs_reason_for_zone(zone):
    return zone in ["OUTSIDE", "NO_GPS"]


@auth.route('/employee/location-check', methods=['GET'])
@jwt_required()
def location_check():
    """Check if user's lat/lon is within office range. Used by dashboard for punch-in/out buttons."""
    lat = request.args.get("lat")
    lon = request.args.get("lon")
    geo = resolve_geofence_for_coordinates(lat, lon)
    zone = geo["zone"]
    return jsonify({
        "success": True,
        "zone": zone,
        "in_range": geo["in_range"],
        "distance_meters": geo["distance_meters"],
        "radius_meters": geo["radius_meters"],
        "grace_meters": GEOFENCE_GRACE_METERS,
        "requires_reason": needs_reason_for_zone(zone),
        "message": f"{zone} zone",
    }), 200


@auth.route('/employee/punch-in', methods=['POST'])
@jwt_required()
def punch_in():

    data = request.get_json() or {}

    user_lat = _parse_lat(data.get("lat"))
    user_lon = _parse_lon(data.get("lon"))
    is_wfh = bool(data.get("is_wfh", False))
    geo_reason = (data.get("geo_reason") or "").strip()

    # Logged-in user
    email = get_jwt().get("email")
    employee = Admin.query.filter_by(email=email).first()

    if not employee:
        return jsonify({"success": False, "message": "Employee not found"}), 404

    today = date.today()

    # ❌ Leave check
    if is_on_leave(employee.id, today):
        return jsonify({
            "success": False,
            "message": "You are on approved leave today"
        }), 403

    # ❌ WFH not approved
    if is_wfh and not is_wfh_allowed(employee.id):
        return jsonify({
            "success": False,
            "message": "WFH mode is not approved for today"
        }), 403

    existing_open = open_punch_session_for_admin(employee.id)
    if existing_open:
        pd = existing_open.punch.punch_date if existing_open.punch else None
        if pd == today:
            return jsonify({
                "success": False,
                "message": "Punch out before starting another punch in",
            }), 400
        pd_str = pd.isoformat() if pd else "a previous day"
        return jsonify({
            "success": False,
            "message": (
                f"You still have an open shift from {pd_str} (night shift). "
                "Punch out to complete it before starting a new punch in."
            ),
        }), 400

    punch = Punch.query.filter_by(
        admin_id=employee.id,
        punch_date=today
    ).first()

    if not punch:
        punch = Punch(admin_id=employee.id, punch_date=today)
        db.session.add(punch)
        db.session.flush()

    if ensure_punch_sessions_backfill(punch):
        db.session.commit()
        punch = Punch.query.filter_by(admin_id=employee.id, punch_date=today).first()

    closed_count = (
        PunchSession.query.filter(
            PunchSession.punch_id == punch.id,
            PunchSession.clock_out.isnot(None),
        ).count()
    )
    repeat_reason = (data.get("repeat_punch_reason") or data.get("repeat_reason") or "").strip()
    if closed_count > 0 and len(repeat_reason) < 3:
        return jsonify({
            "success": False,
            "message": "Repeat punch reason is required (at least 3 characters).",
            "requires_repeat_punch_reason": True,
        }), 400

    geo = resolve_geofence_for_coordinates(user_lat, user_lon)
    zone = geo["zone"]
    location_status = geo["location_status"]

    now = datetime.now()
    sess = PunchSession(
        punch_id=punch.id,
        clock_in=now,
        clock_out=None,
        repeat_reason=repeat_reason if closed_count > 0 else None,
        is_wfh=is_wfh,
        lat=user_lat,
        lon=user_lon,
        location_status=location_status,
        location_status_in=location_status,
        location_status_out=None,
    )
    db.session.add(sess)
    punch.lat = user_lat
    punch.lon = user_lon
    recompute_punch_aggregate(punch)
    db.session.commit()

    punch_in_str = isoformat_punch_clock(now)
    tw = punch.today_work or "0:00:00"
    return jsonify({
        "success": True,
        "message": "Punched in; pending geo review" if zone in ["OUTSIDE", "NO_GPS"] else "Punched in successfully",
        "punch_in": punch_in_str,
        "today_work": tw,
        "is_wfh": is_wfh,
        "zone": zone,
        "location_status": location_status,
        "location_status_in": location_status,
        "needs_review": zone in ["OUTSIDE", "NO_GPS"],
        "requires_repeat_punch_reason": False,
    }), 200



@auth.route('/employee/punch-out', methods=['POST'])
@jwt_required()
def punch_out():
    try:
        data = request.get_json() or {}
        
        user_lat = _parse_lat(data.get("lat"))
        user_lon = _parse_lon(data.get("lon"))
        geo_reason = (data.get("geo_reason") or "").strip()

        # Get logged-in user email from JWT
        email = get_jwt().get("email")
        employee = Admin.query.filter_by(email=email).first()

        if not employee:
            return jsonify({"success": False, "message": "Employee not found"}), 404

        open_sess = open_punch_session_for_admin(employee.id)
        if not open_sess:
            return jsonify({"success": False, "message": "No active punch-in found"}), 400

        punch = open_sess.punch
        if not punch or not punch.id:
            return jsonify({"success": False, "message": "No punch-in found"}), 400

        if ensure_punch_sessions_backfill(punch):
            db.session.commit()
            open_sess = open_punch_session_for_admin(employee.id)
            punch = Punch.query.filter_by(id=punch.id).first()
            if not open_sess or not punch:
                return jsonify({"success": False, "message": "No active punch-in found"}), 400

        geo = resolve_geofence_for_coordinates(user_lat, user_lon)
        zone = geo["zone"]
        location_status = geo["location_status"]

        now = datetime.now()
        is_auto = data.get("auto_system_punch_out") is True

        err_body, err_code = validate_manual_punch_out_extended_reason(open_sess, data, now)
        if err_body:
            return jsonify(err_body), err_code

        ext_reason = None
        clock_out_at = None
        if is_auto:
            ext_trim = (data.get("extended_hours_reason") or "").strip()
            ext_reason = ext_trim or None
            should_cap, cap_reason, cap_at = evaluate_auto_close(open_sess, now)
            if should_cap:
                clock_out_at = cap_at
                if not ext_reason:
                    ext_reason = cap_reason or AUTO_CAP_REASON
        else:
            ext_trim = (data.get("extended_hours_reason") or "").strip()
            if len(ext_trim) >= 3:
                ext_reason = ext_trim

        close_punch_session(
            open_sess,
            punch,
            is_auto=is_auto,
            lat=user_lat,
            lon=user_lon,
            location_status_out=location_status,
            extended_hours_reason=ext_reason,
            now=now,
            clock_out_at=clock_out_at,
        )
        db.session.commit()

        today_work_str = punch.today_work or "0:00:00"
        out_display = open_sess.clock_out or clock_out_at or now
        punch_out_str = isoformat_punch_clock(out_display)
        auto_cap_msg = (
            "Auto punch-out at 10-hour daily cap"
            if is_auto and clock_out_at
            else ("Punched out; pending geo review" if zone in ["OUTSIDE", "NO_GPS"] else "Punched out successfully")
        )
        return jsonify({
            "success": True,
            "message": auto_cap_msg,
            "punch_out": punch_out_str,
            "today_work": today_work_str,
            "zone": zone,
            "location_status": location_status,
            "location_status_out": location_status,
            "needs_review": zone in ["OUTSIDE", "NO_GPS"]
        }), 200
    except Exception as e:
        db.session.rollback()
        logger.exception("Punch-out error")
        return jsonify({
            "success": False,
            "message": str(e) or "Punch-out failed"
        }), 500



def _parse_date(value):
    """Parse string or None to date. Returns None if invalid or empty."""
    if value is None:
        return None
    if hasattr(value, "year"):
        return value
    s = str(value).strip()
    if not s:
        return None
    try:
        return datetime.strptime(s[:10], "%Y-%m-%d").date()
    except (ValueError, TypeError):
        return None


@auth.route("/employee", methods=["POST"])
@jwt_required()
def create_or_update_employee():
    data = request.get_json()

    if not data:
        return jsonify({"success": False, "message": "Missing JSON body"}), 400

    try:
        token_admin_id = int(get_jwt_identity())
    except (TypeError, ValueError):
        return jsonify({"success": False, "message": "Invalid token"}), 401

    admin_id = data.get("admin_id")
    if not admin_id:
        return jsonify({"success": False, "message": "admin_id is required"}), 400

    try:
        admin_id = int(admin_id)
    except (TypeError, ValueError):
        return jsonify({"success": False, "message": "admin_id must be an integer"}), 400

    if admin_id != token_admin_id:
        return jsonify({
            "success": False,
            "message": "You can only update your own profile",
        }), 403

    # Early validation: street address max length (400 chars) - return user-friendly message before any DB ops
    for key in ("permanent_address_line1", "present_address_line1"):
        val = data.get(key)
        if val is not None and len(str(val).strip()) > 400:
            return jsonify({"success": False, "message": "Street address cannot exceed 400 characters."}), 400

    employee = Employee.query.filter_by(admin_id=admin_id).first()
    new_email_raw = (data.get("email") or data.get("personalEmail") or "").strip()
    new_email = new_email_raw.lower() if new_email_raw else ""

    # Proactive duplicate email check (Employee and Admin tables) - case-insensitive
    dup_msg = "This email is already taken. Please use a different email."
    if new_email:
        existing_emp = Employee.query.filter(func.lower(Employee.email) == new_email).first()
        if existing_emp and (not employee or existing_emp.admin_id != admin_id):
            return jsonify({"success": False, "message": dup_msg}), 400
        existing_admin = Admin.query.filter(Admin.email.isnot(None), func.lower(Admin.email) == new_email).first()
        if existing_admin and existing_admin.id != admin_id:
            return jsonify({"success": False, "message": dup_msg}), 400

    try:
        if employee:
            required_string_fields = {
                "name", "email", "father_name", "marital_status",
                "emp_id", "mobile", "gender", "nationality",
                "blood_group",
                "permanent_address_line1", "permanent_pincode",
                "present_address_line1", "present_pincode",
            }
            optional_string_fields = {"mother_name", "emergency_mobile"}
            optional_address_fields = {
                "permanent_city", "permanent_district", "permanent_state",
                "present_city", "present_district", "present_state"
            }

            for field in [
                "name", "email", "father_name", "mother_name", "marital_status",
                "dob", "emp_id", "mobile", "gender", "emergency_mobile",
                "nationality", "blood_group",
                "permanent_address_line1", "permanent_pincode",
                "permanent_city", "permanent_district", "permanent_state",
                "present_address_line1", "present_pincode",
                "present_city", "present_district", "present_state"
            ]:
                if field not in data:
                    continue
                val = data[field]
                if field == "dob":
                    parsed = _parse_date(val)
                    if val is not None and str(val).strip() and parsed is None:
                        return jsonify({"success": False, "message": "Invalid date of birth format (use YYYY-MM-DD)"}), 400
                    if parsed is None:
                        continue
                    val = parsed
                elif field in required_string_fields:
                    s = (val or "").strip() if val is not None else ""
                    if not s:
                        continue
                    if field == "mobile" and len(s) > 20:
                        s = s[-20:]
                    elif field == "emergency_mobile" and len(s) > 50:
                        s = s[-50:]
                    elif field == "gender" and len(s) > 50:
                        s = s[:50]
                    elif field in ("permanent_address_line1", "present_address_line1") and len(s) > 400:
                        return jsonify({"success": False, "message": "Street address cannot exceed 400 characters."}), 400
                    val = s
                elif field in optional_string_fields:
                    val = (val or "").strip() if val is not None else ""
                    if field == "emergency_mobile" and len(val) > 50:
                        val = val[:50]
                elif field in optional_address_fields:
                    val = (val or "").strip() if val is not None else None
                    if val and len(val) > 100:
                        label = "District" if "district" in field else ("State" if "state" in field else "City")
                        return jsonify({"success": False, "message": f"{label} cannot exceed 100 characters."}), 400
                    if val == "":
                        val = None
                setattr(employee, field, val)

            # Ensure optional fields can be cleared: explicitly set when present in request
            if "mother_name" in data:
                employee.mother_name = (data.get("mother_name") or "").strip()
            if "emergency_mobile" in data:
                em = (data.get("emergency_mobile") or "").strip()
                employee.emergency_mobile = em[:50] if len(em) > 50 else em

            # Update Admin.emp_type and Admin.email if provided (stored on Admin)
            admin_obj = Admin.query.get(admin_id)
            if admin_obj:
                emp_type_val = data.get("emp_type") or data.get("employment_type")
                if emp_type_val is not None:
                    admin_obj.emp_type = (str(emp_type_val).strip() or None) if str(emp_type_val).strip() else None
                if new_email and "email" in data:
                    admin_obj.email = (data.get("email") or data.get("personalEmail") or "").strip() or None

            try:
                db.session.commit()
            except IntegrityError:
                db.session.rollback()
                return jsonify({"success": False, "message": "This email is already taken. Please use a different email."}), 400
            return jsonify({"success": True, "message": "Employee updated successfully"}), 200

        # Create new employee
        dob = _parse_date(data.get("dob"))
        if not dob:
            return jsonify({"success": False, "message": "Valid date of birth (YYYY-MM-DD) is required"}), 400

        def _str(v, default=""):
            return (v or default).strip() if v is not None else default

        # User-friendly validation messages for first-time create.
        # Keep this list minimal so profile can be created card-by-card.
        required = [
            ("name", "Full name"),
            ("email", "Email"),
            ("father_name", "Father's name"),
            ("mother_name", "Mother's name"),
            ("emp_id", "Employee ID"),
            ("mobile", "Mobile number"),
            ("gender", "Gender"),
            ("emergency_mobile", "Emergency contact"),
            ("nationality", "Nationality"),
            ("blood_group", "Blood group"),
            # Address fields are optional on first save; can be filled later.
        ]
        for key, label in required:
            if not _str(data.get(key)):
                return jsonify({"success": False, "message": f"Please fill in: {label}"}), 400

        # Designation can be empty on first save; default to "Not Specified"
        designation_val = _str(data.get("designation")) or "Not Specified"

        # Address field length validation (create path)
        for key in ("permanent_address_line1", "present_address_line1"):
            s = _str(data.get(key))
            if s and len(s) > 400:
                return jsonify({"success": False, "message": "Street address cannot exceed 400 characters."}), 400
        for key in (
            "permanent_city", "permanent_district", "permanent_state",
            "present_city", "present_district", "present_state",
        ):
            s = _str(data.get(key))
            if s and len(s) > 100:
                if "district" in key:
                    label = "District"
                elif "state" in key:
                    label = "State"
                else:
                    label = "City"
                return jsonify({"success": False, "message": f"{label} cannot exceed 100 characters."}), 400

        def _mobile(s, max_len=20):
            s = _str(s)
            return s[-max_len:] if len(s) > max_len else s

        employee = Employee(
            admin_id=admin_id,
            name=_str(data.get("name")),
            email=_str(data.get("email")),
            father_name=_str(data.get("father_name")),
            mother_name=_str(data.get("mother_name")),
            marital_status=_str(data.get("marital_status"), "Single"),
            dob=dob,
            emp_id=_str(data.get("emp_id")),
            mobile=_mobile(data.get("mobile")),
            gender=_str(data.get("gender"))[:50],
            emergency_mobile=_mobile(data.get("emergency_mobile"), 50),
            nationality=_str(data.get("nationality")),
            blood_group=_str(data.get("blood_group")),
            designation=designation_val,

            permanent_address_line1=_str(data.get("permanent_address_line1")),
            permanent_pincode=_str(data.get("permanent_pincode")),
            permanent_city=data.get("permanent_city") or None,
            permanent_district=data.get("permanent_district") or None,
            permanent_state=data.get("permanent_state") or None,

            present_address_line1=_str(data.get("present_address_line1")),
            present_pincode=_str(data.get("present_pincode")),
            present_city=data.get("present_city") or None,
            present_district=data.get("present_district") or None,
            present_state=data.get("present_state") or None,
        )

        db.session.add(employee)
        try:
            db.session.commit()
        except IntegrityError:
            db.session.rollback()
            return jsonify({"success": False, "message": "This email is already taken. Please use a different email."}), 400
        return jsonify({"success": True, "message": "Employee created successfully"}), 201

    except IntegrityError:
        db.session.rollback()
        return jsonify({"success": False, "message": "This email is already taken. Please use a different email."}), 400
    except Exception as e:
        db.session.rollback()
        logging.exception("Employee create/update error")
        return jsonify({"success": False, "message": str(e)}), 500




@auth.route("/education", methods=["POST"])
@jwt_required()
def create_or_update_education():
    data = request.get_json()

    if not data:
        return jsonify({"success": False, "message": "Missing JSON body"}), 400

    try:
        token_admin_id = int(get_jwt_identity())
    except (TypeError, ValueError):
        return jsonify({"success": False, "message": "Invalid token"}), 401

    admin_id = data.get("admin_id")
    if not admin_id:
        return jsonify({"success": False, "message": "admin_id is required"}), 400

    try:
        admin_id = int(admin_id)
    except (TypeError, ValueError):
        return jsonify({"success": False, "message": "admin_id must be an integer"}), 400

    if admin_id != token_admin_id:
        return jsonify({
            "success": False,
            "message": "You can only update your own education records",
        }), 403

    # Check if education record exists for this admin
    education = Education.query.filter_by(admin_id=admin_id).first()

    try:
        # ------------ UPDATE ------------
        if education:
            update_fields = [
                "qualification", "institution", "board",
                "start", "end", "marks", "doc_file"
            ]

            for field in update_fields:
                if field in data:
                    setattr(education, field, data[field])

            db.session.commit()
            return jsonify({"success": True, "message": "Education updated successfully"}), 200

        # ------------ CREATE ------------
        education = Education(
            admin_id=admin_id,
            qualification=data["qualification"],
            institution=data["institution"],
            board=data["board"],
            start=data["start"],
            end=data["end"],
            marks=data["marks"],
            doc_file=data.get("doc_file")  # optional file path
        )

        db.session.add(education)
        db.session.commit()
        return jsonify({"success": True, "message": "Education created successfully"}), 201

    except Exception as e:
        db.session.rollback()
        return jsonify({"success": False, "message": str(e)}), 500


def _parse_education_date(val):
    """Parse date string to date or None."""
    if not val:
        return None
    if hasattr(val, "year"):
        return val
    s = str(val).strip()[:10]
    if not s:
        return None
    try:
        return datetime.strptime(s, "%Y-%m-%d").date()
    except (ValueError, TypeError):
        return None


@auth.route("/education-replace", methods=["POST"])
@jwt_required()
def replace_education():
    """Replace all education records for the logged-in user. Accepts list of {qualification, institution, university/board, fromDate, start, toDate, end, marks, certificate/doc_file}."""
    data = request.get_json()
    if not data:
        return jsonify({"success": False, "message": "Missing JSON body"}), 400

    try:
        admin_id = int(get_jwt_identity())
    except (TypeError, ValueError):
        return jsonify({"success": False, "message": "Invalid token"}), 401

    admin = Admin.query.get(admin_id)
    if not admin:
        return jsonify({"success": False, "message": "User not found"}), 404

    items = data.get("items", [])
    if not isinstance(items, list):
        return jsonify({"success": False, "message": "items must be an array"}), 400

    try:
        Education.query.filter_by(admin_id=admin_id).delete()

        for item in items:
            qual = (item.get("qualification") or "").strip()
            inst = (item.get("institution") or "").strip()
            board_val = (item.get("board") or item.get("university") or "").strip() or "-"
            start_val = _parse_education_date(item.get("start") or item.get("fromDate"))
            end_val = _parse_education_date(item.get("end") or item.get("toDate"))
            marks_val = (item.get("marks") or "").strip() or "-"
            doc_file = (item.get("doc_file") or item.get("certificate") or "").strip() or None

            if not qual or not inst or not start_val or not end_val:
                continue

            edu = Education(
                admin_id=admin_id,
                qualification=qual,
                institution=inst,
                board=board_val,
                start=start_val,
                end=end_val,
                marks=marks_val,
                doc_file=doc_file,
            )
            db.session.add(edu)

        db.session.commit()
        return jsonify({"success": True, "message": "Education records saved successfully"}), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({"success": False, "message": str(e)}), 500


def _prev_employment_row_is_empty(item):
    """True when the client sent a blank previous-employment card (no real data)."""
    if not isinstance(item, dict):
        return True
    com = (item.get("companyName") or "").strip()
    des = (item.get("designation") or "").strip()
    dol_str = (item.get("dateOfLeaving") or "").strip()
    exp = str(item.get("experienceYears") or "").strip()
    if com in ("", "-") and des in ("", "-") and not dol_str and not exp:
        return True
    return False


@auth.route("/previous-companies", methods=["POST"])
@jwt_required()
def save_previous_companies():
    """Replace all previous companies for the logged-in user. Accepts list of {companyName, designation, dateOfLeaving, experienceYears}."""
    data = request.get_json()
    if not data:
        return jsonify({"success": False, "message": "Missing JSON body"}), 400

    try:
        admin_id = int(get_jwt_identity())
    except (TypeError, ValueError):
        return jsonify({"success": False, "message": "Invalid token"}), 401

    admin = Admin.query.get(admin_id)
    if not admin:
        return jsonify({"success": False, "message": "User not found"}), 404

    items = data.get("items", [])
    if not isinstance(items, list):
        return jsonify({"success": False, "message": "items must be an array"}), 400

    try:
        PreviousCompany.query.filter_by(admin_id=admin_id).delete()

        for item in items:
            if _prev_employment_row_is_empty(item):
                continue

            com_name = (item.get("companyName") or "").strip()
            designation = (item.get("designation") or "").strip()
            dol_str = (item.get("dateOfLeaving") or "").strip()
            exp_years = str(item.get("experienceYears") or "").strip()

            if not com_name or com_name == "-":
                return jsonify({
                    "success": False,
                    "message": "Company name is required for each previous employment entry.",
                }), 400
            if not designation or designation == "-":
                return jsonify({
                    "success": False,
                    "message": "Designation is required for each previous employment entry.",
                }), 400
            if not dol_str:
                return jsonify({
                    "success": False,
                    "message": "Date of leaving is required for each previous employment entry.",
                }), 400

            try:
                dol = datetime.strptime(dol_str.split("T")[0], "%Y-%m-%d").date()
            except (ValueError, AttributeError):
                return jsonify({
                    "success": False,
                    "message": "Invalid date of leaving. Use YYYY-MM-DD.",
                }), 400

            doj = dol
            if exp_years:
                try:
                    yrs = float(str(exp_years).replace(",", "."))
                    from datetime import timedelta
                    doj = dol - timedelta(days=int(365.25 * yrs))
                except (ValueError, TypeError):
                    pass

            pc = PreviousCompany(
                admin_id=admin_id,
                com_name=com_name,
                designation=designation,
                doj=doj,
                dol=dol,
                reason="-",
                salary="-",
                pan="-",
                contact="-",
                name_contact="-",
                pf_num="-",
                address="-",
            )
            db.session.add(pc)

        db.session.commit()
        return jsonify({"success": True, "message": "Previous employment saved"}), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({"success": False, "message": str(e)}), 500


@auth.route("/upload-profile-file", methods=["POST"])
@jwt_required()
def upload_profile_file():
    """Upload a single profile document (Aadhaar, PAN, etc). Saves to static/uploads/profile/ and returns relative path."""
    admin_id = request.form.get("admin_id")
    field = request.form.get("field")  # aadharFront, aadharBack, panFront, panBack, appointmentLetter, passbookFront
    if not admin_id or not field:
        return jsonify({"success": False, "message": "admin_id and field are required"}), 400

    # Verify user owns this admin_id (or is HR)
    try:
        token_admin_id = int(get_jwt_identity())
        token_admin = Admin.query.get(token_admin_id)
        if not token_admin or (token_admin_id != int(admin_id) and (token_admin.emp_type or "").lower() != "human resource"):
            return jsonify({"success": False, "message": "Unauthorized"}), 403
    except (TypeError, ValueError):
        return jsonify({"success": False, "message": "Invalid token"}), 401

    file = request.files.get("file")
    if not file or not file.filename:
        return jsonify({"success": False, "message": "No file provided"}), 400

    allowed = ("aadharFront", "aadharBack", "panFront", "panBack", "appointmentLetter", "passbookFront")
    education_cert = field.startswith("education_certificate") if isinstance(field, str) else False
    if field not in allowed and not education_cert:
        return jsonify({"success": False, "message": "Invalid field"}), 400

    allowed_extensions = {".pdf", ".jpg", ".jpeg", ".png"}
    ext = os.path.splitext(secure_filename(file.filename))[1].lower() or ".pdf"
    if field in allowed and ext not in allowed_extensions:
        return jsonify({
            "success": False,
            "message": "Document must be .pdf, .jpg, .jpeg, or .png only.",
        }), 400
    if education_cert and ext not in allowed_extensions:
        return jsonify({"success": False, "message": "Certificate must be .pdf, .jpg, or .png"}), 400

    upload_dir = os.path.join(current_app.root_path, "static", "uploads", "profile")
    os.makedirs(upload_dir, exist_ok=True)
    filename = f"{admin_id}_{field}_{datetime.now().strftime('%Y%m%d_%H%M%S')}{ext}"
    file_path = os.path.join(upload_dir, filename)
    file.save(file_path)
    rel_path = f"profile/{filename}"
    return jsonify({"success": True, "path": rel_path}), 201


@auth.route("/upload-docs", methods=["POST"])
@jwt_required()
def save_upload_docs():
    data = request.get_json()

    if not data:
        return jsonify({"success": False, "message": "Missing JSON body"}), 400

    try:
        token_admin_id = int(get_jwt_identity())
    except (TypeError, ValueError):
        return jsonify({"success": False, "message": "Invalid token"}), 401

    admin_id = data.get("admin_id")
    if not admin_id:
        return jsonify({"success": False, "message": "admin_id is required"}), 400

    try:
        admin_id = int(admin_id)
    except (TypeError, ValueError):
        return jsonify({"success": False, "message": "admin_id must be an integer"}), 400

    if admin_id != token_admin_id:
        return jsonify({
            "success": False,
            "message": "You can only update your own documents",
        }), 403

    identity_fields = (
        "aadhaar_number",
        "pan_number",
        "bank_account_number",
        "bank_name",
        "bank_branch_code",
        "ifsc_code",
    )
    file_fields = (
        "aadhaar_front",
        "aadhaar_back",
        "pan_front",
        "pan_back",
        "appointment_letter",
        "passbook_front",
    )

    normalized_identity, identity_err = _validate_upload_doc_identity_payload(data)
    if identity_err:
        return jsonify({"success": False, "message": identity_err}), 400

    upload_doc = UploadDoc.query.filter_by(admin_id=admin_id).first()

    # Require identity numbers before accepting matching file uploads
    aadhaar_no = normalized_identity.get("aadhaar_number") or (
        upload_doc.aadhaar_number if upload_doc else None
    )
    pan_no = normalized_identity.get("pan_number") or (
        upload_doc.pan_number if upload_doc else None
    )
    bank_ac = normalized_identity.get("bank_account_number") or (
        upload_doc.bank_account_number if upload_doc else None
    )
    bank_name = normalized_identity.get("bank_name") or (
        upload_doc.bank_name if upload_doc else None
    )
    branch_code = normalized_identity.get("bank_branch_code") or (
        upload_doc.bank_branch_code if upload_doc else None
    )
    ifsc = normalized_identity.get("ifsc_code") or (
        upload_doc.ifsc_code if upload_doc else None
    )

    if data.get("aadhaar_front") and not aadhaar_no:
        return jsonify({"success": False, "message": "Enter Aadhaar number before uploading Aadhaar images."}), 400
    if data.get("aadhaar_back") and not aadhaar_no:
        return jsonify({"success": False, "message": "Enter Aadhaar number before uploading Aadhaar images."}), 400
    if data.get("pan_front") and not pan_no:
        return jsonify({"success": False, "message": "Enter PAN before uploading PAN images."}), 400
    if data.get("pan_back") and not pan_no:
        return jsonify({"success": False, "message": "Enter PAN before uploading PAN images."}), 400
    if data.get("passbook_front") and not (bank_ac and bank_name and branch_code and ifsc):
        return jsonify({
            "success": False,
            "message": "Enter account number, bank name, branch code, and IFSC before uploading passbook/cheque.",
        }), 400

    admin = Admin.query.get(admin_id)

    try:
        if upload_doc:
            for field in file_fields:
                if field in data:
                    setattr(upload_doc, field, data[field])
            for field in identity_fields:
                if field in normalized_identity:
                    setattr(upload_doc, field, normalized_identity[field])
            if admin:
                _sync_upload_doc_to_employee_accounts(admin, upload_doc)
            db.session.commit()
            return jsonify({"success": True, "message": "Documents updated successfully"}), 200

        upload_doc = UploadDoc(
            admin_id=admin_id,
            aadhaar_number=normalized_identity.get("aadhaar_number"),
            pan_number=normalized_identity.get("pan_number"),
            bank_account_number=normalized_identity.get("bank_account_number"),
            bank_name=normalized_identity.get("bank_name"),
            bank_branch_code=normalized_identity.get("bank_branch_code"),
            ifsc_code=normalized_identity.get("ifsc_code"),
            aadhaar_front=data.get("aadhaar_front"),
            aadhaar_back=data.get("aadhaar_back"),
            pan_front=data.get("pan_front"),
            pan_back=data.get("pan_back"),
            appointment_letter=data.get("appointment_letter"),
            passbook_front=data.get("passbook_front"),
        )
        db.session.add(upload_doc)
        if admin:
            _sync_upload_doc_to_employee_accounts(admin, upload_doc)
        db.session.commit()
        return jsonify({"success": True, "message": "Documents saved successfully"}), 201

    except Exception as e:
        db.session.rollback()
        logging.exception("save_upload_docs error")
        return jsonify({"success": False, "message": str(e)}), 500



