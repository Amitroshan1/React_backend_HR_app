# signup_api,reset_password, hr_dashboard_api, mark_employee_exit,employee_archive_list,
# get_archived_employee_profile,search_employees,
# download_excel_hr_api, display_details_api,get_employee
# assign_asset, update_asset_api, search_employee_api,
# get_employee_api, update_employee_api, delete_employee_api
# Employee_exit,list_employee_archive


#https://solviotec.com/api/HumanResource

import secrets
import hashlib
import json
import base64
import mimetypes
import uuid
from flask import Blueprint, request, current_app, jsonify, send_file, send_from_directory
from flask_jwt_extended import jwt_required, get_jwt, get_jwt_identity
from .email import send_email_via_zeptomail, send_welcome_email, send_ex_employee_documents_email
from .models.Admin_models import Admin, EmployeeArchive, AuditLog, EmployeeExitHistory
from .models.employee_circle_history import EmployeeCircleHistory
from datetime import datetime,date,timedelta
from zoneinfo import ZoneInfo
import calendar
from sqlalchemy import and_, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import joinedload
from flask_login import current_user
from .email import (
    update_asset_email,
    send_asset_assigned_email,
    send_password_set_email,
    send_password_reset_email,
    send_hr_leave_updation_email,
    send_assessment_invite_email,
    send_assessment_submitted_email_to_hr,
)
from .utility import generate_attendance_excel,send_excel_file,calculate_month_summary
from .circle_transfer_utils import fetch_admins_for_attendance_export
from .models.emp_detail_models import Employee,Asset
from .models.family_models import FamilyDetails
from .models.prev_com import PreviousCompany
from .models.education import UploadDoc, Education
from .models.attendance import (
    Punch,
    PunchSession,
    LeaveApplication,
    LeaveBalance,
    Location,
    WorkFromHomeApplication,
)
from .models.news_feed import NewsFeed
from .models.seperation import Noc, Noc_Upload, Resignation
from .noc_department_service import download_noc_document, list_noc_requests, upload_noc_document
from .models.master_data import MasterData
from .models.leave_accrual_log import LeaveAccrualLog
from .models.holiday_calendar import HolidayCalendar
from werkzeug.security import generate_password_hash
import os
from urllib.parse import unquote
from . import db
from .punch_aggregate import (
    sync_punch_after_hr_manual_edit,
    recompute_punch_aggregate,
    serialize_punch_sessions,
)
from werkzeug.utils import secure_filename
from .leave_attendence import _compute_working_and_sandwich_days
from .compoff_utils import deduct_comp_leave, restore_comp_leave
from .models.ex_employee_documents import ExEmployeeDocFile, ExEmployeeDocShare
from .models.assessment import AssessmentInvite

hr = Blueprint('HumanResource', __name__)

EX_EMPLOYEE_LINK_TTL_HOURS = 48


@hr.before_request
def _hr_plan_guard():
    from flask import request
    from .plan_features import has_feature, plan_forbidden_response

    if request.method == "OPTIONS":
        return None
    path = request.path or ""
    if "/assessment/public" in path:
        return None
    if "/assessment/" in path and not has_feature("hr_assessment_invite"):
        return plan_forbidden_response("hr_assessment_invite")
    if "/ex-employee-documents/" in path and not has_feature("hr_ex_employee_docs"):
        return plan_forbidden_response("hr_ex_employee_docs")
    if request.method == "POST" and "/master/" in path and not has_feature("hr_add_dept_circle"):
        return plan_forbidden_response("hr_add_dept_circle")
    return None


def _hr_session_geo_in(sess):
    """Location label for punch-in (matches utility.py session helpers)."""
    if not sess:
        return ""
    v = (getattr(sess, "location_status_in", None) or "").strip()
    if v:
        return v
    if sess.clock_out is None:
        return (getattr(sess, "location_status", None) or "").strip()
    return ""


def _hr_session_geo_out(sess):
    """Location label for punch-out (matches utility.py session helpers)."""
    if not sess:
        return ""
    v = (getattr(sess, "location_status_out", None) or "").strip()
    if v:
        return v
    if sess.clock_out is not None:
        return (getattr(sess, "location_status", None) or "").strip()
    return ""


def _enabled_non_exited_admin_filters():
    """Enabled employees: not exited and not explicitly disabled (is_active=False)."""
    return (
        or_(Admin.is_exited == False, Admin.is_exited.is_(None)),
        or_(Admin.is_active == True, Admin.is_active.is_(None)),
    )


def _hr_punch_location_in_out(punch):
    """First session → in status; last session → out status."""
    if not punch:
        return "", ""
    sessions = getattr(punch, "sessions", None) or []
    if not sessions:
        return "", ""
    ordered = sorted(sessions, key=lambda s: s.clock_in)
    first, last = ordered[0], ordered[-1]
    return _hr_session_geo_in(first), _hr_session_geo_out(last)


def _hash_ex_employee_token(raw_token: str) -> str:
    return hashlib.sha256(raw_token.encode("utf-8")).hexdigest()


def _ex_employee_uploads_base_dir():
    return os.path.join(current_app.root_path, "static", "uploads", "ex_employee_docs")


def _abs_path_from_rel(rel: str):
    return os.path.normpath(os.path.join(current_app.root_path, "static", "uploads", rel))


def _delete_ex_share_and_files(share: ExEmployeeDocShare):
    """Remove DB rows and stored files for a share."""
    sid = share.id
    file_rows = ExEmployeeDocFile.query.filter_by(share_id=sid).all()
    for f in file_rows:
        path = _abs_path_from_rel(f.stored_rel_path)
        try:
            if os.path.isfile(path):
                os.remove(path)
        except OSError:
            pass
        db.session.delete(f)
    fresh = ExEmployeeDocShare.query.get(sid)
    if fresh:
        db.session.delete(fresh)
    db.session.commit()
    try:
        d = os.path.join(_ex_employee_uploads_base_dir(), str(sid))
        if os.path.isdir(d) and not os.listdir(d):
            os.rmdir(d)
    except OSError:
        pass


from functools import wraps

def hr_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        claims = get_jwt()
        emp_type = (claims.get("emp_type") or "").strip().lower().replace("-", " ")
        emp_type = " ".join(emp_type.split())
        # Accept common HR labels stored in Admin.emp_type / JWT claims.
        if emp_type not in {"human resource", "human resources", "hr"}:
            return jsonify({
                "success": False,
                "message": "HR access required"
            }), 403
        return fn(*args, **kwargs)
    return wrapper


def _delete_punch_for_admin_on_date(admin_id, punch_date):
    """
    Remove the Punch row and all PunchSession rows for this employee + calendar date.
    Returns True if a punch row existed and was removed.
    """
    punch = Punch.query.filter_by(admin_id=admin_id, punch_date=punch_date).first()
    if not punch:
        return False
    PunchSession.query.filter_by(punch_id=punch.id).delete(synchronize_session=False)
    db.session.delete(punch)
    return True


MASTER_TYPE_DEPARTMENT = "department"
MASTER_TYPE_CIRCLE = "circle"
MASTER_TYPES = {MASTER_TYPE_DEPARTMENT, MASTER_TYPE_CIRCLE}


def _norm_circle_name(value):
    return (value or "").strip().lower()


def _serialize_circle_history_row(row, admin=None):
    adm = admin or row.admin
    return {
        "id": row.id,
        "admin_id": row.admin_id,
        "emp_id": getattr(adm, "emp_id", None) if adm else None,
        "employee_name": getattr(adm, "first_name", None) if adm else None,
        "employee_email": getattr(adm, "email", None) if adm else None,
        "from_circle": row.from_circle,
        "to_circle": row.to_circle,
        "effective_from": row.effective_from.isoformat() if row.effective_from else None,
        "effective_to": row.effective_to.isoformat() if row.effective_to else None,
        "notes": row.notes,
        "recorded_by": row.recorded_by,
        "recorded_at": row.recorded_at.isoformat() if row.recorded_at else None,
    }


def _close_open_circle_segment(admin_id, new_effective_from):
    open_row = (
        EmployeeCircleHistory.query.filter_by(admin_id=admin_id, effective_to=None)
        .order_by(EmployeeCircleHistory.effective_from.desc())
        .first()
    )
    if not open_row or not new_effective_from:
        return
    prev_end = new_effective_from - timedelta(days=1)
    if open_row.effective_from and prev_end >= open_row.effective_from:
        open_row.effective_to = prev_end
    else:
        open_row.effective_to = new_effective_from


def _log_initial_circle_assignment(admin, recorded_by, notes=None):
    circle = (getattr(admin, "circle", None) or "").strip()
    if not circle or not getattr(admin, "id", None):
        return
    effective = getattr(admin, "doj", None) or date.today()
    db.session.add(
        EmployeeCircleHistory(
            admin_id=admin.id,
            from_circle=None,
            to_circle=circle[:50],
            effective_from=effective,
            effective_to=None,
            notes=(notes or "Initial circle on onboarding")[:500],
            recorded_by=recorded_by,
        )
    )


def _apply_circle_transfer(admin, new_circle, effective_from, recorded_by, notes=None):
    """Update admin.circle and append history when circle actually changes."""
    old_circle = (getattr(admin, "circle", None) or "").strip()
    new_circle = (new_circle or "").strip()
    if not new_circle:
        return False, "New circle is required."
    if _norm_circle_name(old_circle) == _norm_circle_name(new_circle):
        admin.circle = new_circle[:50]
        return True, None

    if not effective_from:
        return False, "circle_effective_from is required when changing circle."

    if getattr(admin, "doj", None) and effective_from < admin.doj:
        return False, "Effective date cannot be before date of joining."

    _close_open_circle_segment(admin.id, effective_from)
    db.session.add(
        EmployeeCircleHistory(
            admin_id=admin.id,
            from_circle=old_circle[:50] if old_circle else None,
            to_circle=new_circle[:50],
            effective_from=effective_from,
            effective_to=None,
            notes=(notes or "").strip()[:500] or None,
            recorded_by=recorded_by,
        )
    )
    admin.circle = new_circle[:50]
    return True, None


HOLIDAY_DATE_TEMPLATES = [
    {"holiday_name": "NEW YEAR DAY", "month": 1, "day": 1, "is_optional": False},
    {"holiday_name": "REPUBLIC DAY", "month": 1, "day": 26, "is_optional": False},
    {"holiday_name": "HOLI", "month": 3, "day": 3, "is_optional": False},
    {"holiday_name": "GUDI PADWA", "month": 3, "day": 19, "is_optional": True},
    {"holiday_name": "EID", "month": 3, "day": 21, "is_optional": True},
    {"holiday_name": "MAHARASHTRA DAY", "month": 5, "day": 1, "is_optional": False},
    {"holiday_name": "INDEPENDENCE DAY", "month": 8, "day": 15, "is_optional": False},
    {"holiday_name": "GANESH CHATURTHI", "month": 9, "day": 14, "is_optional": False},
    {"holiday_name": "GANDHI JAYANTI", "month": 10, "day": 2, "is_optional": False},
    {"holiday_name": "DUSSERA", "month": 10, "day": 20, "is_optional": False},
    {"holiday_name": "DIWALI", "month": 11, "day": 8, "is_optional": False},
    {"holiday_name": "GOVARDHAN PUJA", "month": 11, "day": 10, "is_optional": False},
    {"holiday_name": "BHAUBIJ", "month": 11, "day": 11, "is_optional": False},
    {"holiday_name": "CHRISTMAS DAY", "month": 12, "day": 25, "is_optional": True},
]

DAY_NAMES = {
    0: "MONDAY",
    1: "TUESDAY",
    2: "WEDNESDAY",
    3: "THURSDAY",
    4: "FRIDAY",
    5: "SATURDAY",
    6: "SUNDAY",
}


def _clean_master_name(value):
    return str(value or "").strip()


def _master_type_or_400(raw_type):
    master_type = str(raw_type or "").strip().lower()
    if master_type not in MASTER_TYPES:
        return None
    return master_type


def _get_master_values(master_type):
    rows = (
        MasterData.query.filter_by(master_type=master_type, is_active=True)
        .order_by(MasterData.name.asc())
        .all()
    )
    return [row.name for row in rows]


def _is_allowed_master_value(master_type, value):
    val = _clean_master_name(value)
    if not val:
        return False
    count = (
        MasterData.query.filter(
            MasterData.master_type == master_type,
            MasterData.is_active.is_(True),
            db.func.lower(MasterData.name) == val.lower(),
        ).count()
    )
    return count > 0


def _parse_year_or_400(value):
    try:
        year = int(value)
    except (TypeError, ValueError):
        return None
    if year < 2000 or year > 2100:
        return None
    return year


def _serialize_holiday(row, sr_no=None):
    dt = row.holiday_date
    day_name = DAY_NAMES.get(dt.weekday(), "")
    return {
        "id": row.id,
        "sr_no": sr_no,
        "year": row.year,
        "holiday_name": row.holiday_name,
        "holiday_date": dt.isoformat() if dt else None,
        "display_date": dt.strftime("%d-%m-%Y") if dt else None,
        "day": day_name,
        "is_optional": bool(row.is_optional),
        "is_active": bool(row.is_active),
    }


def _seed_holidays_for_year(year, overwrite=False):
    existing = HolidayCalendar.query.filter(HolidayCalendar.year == year).all()
    if existing and not overwrite:
        return existing

    if overwrite and existing:
        HolidayCalendar.query.filter(HolidayCalendar.year == year).delete(synchronize_session=False)
        db.session.flush()

    rows = []
    for item in HOLIDAY_DATE_TEMPLATES:
        rows.append(
            HolidayCalendar(
                year=year,
                holiday_name=item["holiday_name"],
                holiday_date=date(year, item["month"], item["day"]),
                is_optional=bool(item["is_optional"]),
                is_active=True,
            )
        )
    db.session.add_all(rows)
    db.session.commit()
    return rows


@hr.route("/holidays", methods=["GET"])
@jwt_required()
@hr_required
def list_holidays_for_year():
    year = _parse_year_or_400(request.args.get("year", date.today().year))
    if not year:
        return jsonify({"success": False, "message": "Invalid year. Allowed range: 2000-2100"}), 400

    auto_seed = str(request.args.get("auto_seed", "1")).strip() != "0"
    rows = (
        HolidayCalendar.query.filter(
            HolidayCalendar.year == year,
            HolidayCalendar.is_active.is_(True),
        )
        .order_by(HolidayCalendar.holiday_date.asc(), HolidayCalendar.id.asc())
        .all()
    )
    if not rows and auto_seed:
        _seed_holidays_for_year(year, overwrite=False)
        rows = (
            HolidayCalendar.query.filter(
                HolidayCalendar.year == year,
                HolidayCalendar.is_active.is_(True),
            )
            .order_by(HolidayCalendar.holiday_date.asc(), HolidayCalendar.id.asc())
            .all()
        )

    return jsonify(
        {
            "success": True,
            "year": year,
            "holidays": [_serialize_holiday(r, idx + 1) for idx, r in enumerate(rows)],
        }
    ), 200


@hr.route("/holidays/user", methods=["GET"])
@jwt_required()
def list_holidays_for_user_view():
    from .models.Admin_models import Admin
    claims = get_jwt()
    email = (claims.get("email") or "").strip()
    admin = Admin.query.filter_by(email=email).first()
    if not admin or (admin.circle or "").strip().upper() != "NHQ":
        return jsonify({"success": False, "message": "Holiday calendar is restricted to NHQ users"}), 403

    year = _parse_year_or_400(request.args.get("year", date.today().year))
    if not year:
        return jsonify({"success": False, "message": "Invalid year. Allowed range: 2000-2100"}), 400

    auto_seed = str(request.args.get("auto_seed", "1")).strip() != "0"
    rows = (
        HolidayCalendar.query.filter(
            HolidayCalendar.year == year,
            HolidayCalendar.is_active.is_(True),
        )
        .order_by(HolidayCalendar.holiday_date.asc(), HolidayCalendar.id.asc())
        .all()
    )
    if not rows and auto_seed:
        _seed_holidays_for_year(year, overwrite=False)
        rows = (
            HolidayCalendar.query.filter(
                HolidayCalendar.year == year,
                HolidayCalendar.is_active.is_(True),
            )
            .order_by(HolidayCalendar.holiday_date.asc(), HolidayCalendar.id.asc())
            .all()
        )

    return jsonify(
        {
            "success": True,
            "year": year,
            "holidays": [_serialize_holiday(r, idx + 1) for idx, r in enumerate(rows)],
        }
    ), 200


@hr.route("/holidays/seed-year", methods=["POST"])
@jwt_required()
@hr_required
def seed_holidays_for_year():
    data = request.get_json(silent=True) or {}
    year = _parse_year_or_400(data.get("year"))
    if not year:
        return jsonify({"success": False, "message": "Invalid year. Allowed range: 2000-2100"}), 400

    overwrite = bool(data.get("overwrite", False))
    _seed_holidays_for_year(year, overwrite=overwrite)
    rows = (
        HolidayCalendar.query.filter(
            HolidayCalendar.year == year,
            HolidayCalendar.is_active.is_(True),
        )
        .order_by(HolidayCalendar.holiday_date.asc(), HolidayCalendar.id.asc())
        .all()
    )
    return jsonify(
        {
            "success": True,
            "message": "Holiday list generated successfully",
            "year": year,
            "holidays": [_serialize_holiday(r, idx + 1) for idx, r in enumerate(rows)],
        }
    ), 200


@hr.route("/holidays", methods=["POST"])
@jwt_required()
@hr_required
def create_holiday():
    data = request.get_json(silent=True) or {}
    year = _parse_year_or_400(data.get("year"))
    if not year:
        return jsonify({"success": False, "message": "Invalid year. Allowed range: 2000-2100"}), 400

    holiday_name = str(data.get("holiday_name") or "").strip()
    if not holiday_name:
        return jsonify({"success": False, "message": "holiday_name is required"}), 400

    raw_date = str(data.get("holiday_date") or "").strip()
    if not raw_date:
        return jsonify({"success": False, "message": "holiday_date is required (YYYY-MM-DD)"}), 400
    try:
        parsed_date = datetime.fromisoformat(raw_date[:10]).date()
    except (ValueError, TypeError):
        return jsonify({"success": False, "message": "holiday_date must be YYYY-MM-DD"}), 400
    if parsed_date.year != year:
        return jsonify(
            {
                "success": False,
                "message": f"holiday_date year ({parsed_date.year}) must match selected year ({year})",
            }
        ), 400

    is_optional = bool(data.get("is_optional", False))

    existing = HolidayCalendar.query.filter(
        HolidayCalendar.year == year,
        db.func.lower(HolidayCalendar.holiday_name) == holiday_name.lower(),
    ).first()
    if existing:
        if existing.is_active:
            return jsonify(
                {
                    "success": False,
                    "message": f"Holiday '{holiday_name}' already exists for {year}",
                }
            ), 409
        existing.holiday_name = holiday_name[:120]
        existing.holiday_date = parsed_date
        existing.is_optional = is_optional
        existing.is_active = True
        db.session.commit()
        return jsonify(
            {
                "success": True,
                "message": "Holiday restored",
                "holiday": _serialize_holiday(existing),
            }
        ), 200

    row = HolidayCalendar(
        year=year,
        holiday_name=holiday_name[:120],
        holiday_date=parsed_date,
        is_optional=is_optional,
        is_active=True,
    )
    try:
        db.session.add(row)
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        return jsonify(
            {
                "success": False,
                "message": f"Holiday '{holiday_name}' already exists for {year}",
            }
        ), 409

    return jsonify(
        {
            "success": True,
            "message": "Holiday added successfully",
            "holiday": _serialize_holiday(row),
        }
    ), 201


@hr.route("/holidays/<int:holiday_id>", methods=["PUT"])
@jwt_required()
@hr_required
def update_holiday(holiday_id):
    row = HolidayCalendar.query.get(holiday_id)
    if not row:
        return jsonify({"success": False, "message": "Holiday not found"}), 404

    data = request.get_json(silent=True) or {}

    if "holiday_name" in data:
        holiday_name = str(data.get("holiday_name") or "").strip()
        if not holiday_name:
            return jsonify({"success": False, "message": "holiday_name cannot be empty"}), 400
        dup = HolidayCalendar.query.filter(
            HolidayCalendar.year == row.year,
            HolidayCalendar.id != row.id,
            HolidayCalendar.is_active.is_(True),
            db.func.lower(HolidayCalendar.holiday_name) == holiday_name.lower(),
        ).first()
        if dup:
            return jsonify(
                {
                    "success": False,
                    "message": f"Holiday '{holiday_name}' already exists for {row.year}",
                }
            ), 409
        row.holiday_name = holiday_name[:120]

    if "holiday_date" in data:
        raw_date = str(data.get("holiday_date") or "").strip()
        try:
            parsed_date = datetime.fromisoformat(raw_date[:10]).date()
        except (ValueError, TypeError):
            return jsonify({"success": False, "message": "holiday_date must be YYYY-MM-DD"}), 400
        if parsed_date.year != row.year:
            return jsonify({"success": False, "message": f"holiday_date year must remain {row.year}"}), 400
        row.holiday_date = parsed_date

    if "is_optional" in data:
        row.is_optional = bool(data.get("is_optional"))

    if "is_active" in data:
        row.is_active = bool(data.get("is_active"))

    db.session.commit()
    return jsonify({"success": True, "holiday": _serialize_holiday(row)}), 200


@hr.route("/holidays/<int:holiday_id>", methods=["DELETE"])
@jwt_required()
@hr_required
def delete_holiday(holiday_id):
    row = HolidayCalendar.query.get(holiday_id)
    if not row:
        return jsonify({"success": False, "message": "Holiday not found"}), 404
    if not row.is_active:
        return jsonify({"success": False, "message": "Holiday already removed"}), 409

    row.is_active = False
    db.session.commit()
    return jsonify(
        {
            "success": True,
            "message": f"Removed: {row.holiday_name}",
        }
    ), 200


@hr.route("/master/options", methods=["GET"])
@jwt_required()
@hr_required
def master_options():
    departments = _get_master_values(MASTER_TYPE_DEPARTMENT)
    circles = _get_master_values(MASTER_TYPE_CIRCLE)
    return jsonify(
        {
            "success": True,
            "departments": departments,
            "circles": circles,
        }
    ), 200


@hr.route("/master/<string:master_type>", methods=["GET"])
@jwt_required()
@hr_required
def list_master_data(master_type):
    parsed_type = _master_type_or_400(master_type)
    if not parsed_type:
        return jsonify({"success": False, "message": "Invalid master type"}), 400

    rows = (
        MasterData.query.filter_by(master_type=parsed_type, is_active=True)
        .order_by(MasterData.name.asc())
        .all()
    )
    return jsonify(
        {
            "success": True,
            "master_type": parsed_type,
            "items": [{"id": row.id, "name": row.name} for row in rows],
        }
    ), 200


@hr.route("/master/<string:master_type>", methods=["POST"])
@jwt_required()
@hr_required
def create_master_data(master_type):
    parsed_type = _master_type_or_400(master_type)
    if not parsed_type:
        return jsonify({"success": False, "message": "Invalid master type"}), 400

    data = request.get_json() or {}
    name = _clean_master_name(data.get("name"))
    if not name:
        return jsonify({"success": False, "message": "name is required"}), 400

    existing = MasterData.query.filter(
        MasterData.master_type == parsed_type,
        db.func.lower(MasterData.name) == name.lower(),
    ).first()

    if existing and existing.is_active:
        return jsonify({"success": False, "message": "Value already exists"}), 409

    if existing and not existing.is_active:
        existing.is_active = True
        existing.name = name
        db.session.commit()
        return jsonify(
            {
                "success": True,
                "message": "Value restored successfully",
                "item": {"id": existing.id, "name": existing.name},
            }
        ), 200

    row = MasterData(master_type=parsed_type, name=name, is_active=True)
    db.session.add(row)
    db.session.commit()
    return jsonify(
        {
            "success": True,
            "message": "Value added successfully",
            "item": {"id": row.id, "name": row.name},
        }
    ), 201


@hr.route("/master/<string:master_type>/<int:item_id>", methods=["DELETE"])
@jwt_required()
@hr_required
def delete_master_data(master_type, item_id):
    parsed_type = _master_type_or_400(master_type)
    if not parsed_type:
        return jsonify({"success": False, "message": "Invalid master type"}), 400

    row = MasterData.query.filter_by(id=item_id, master_type=parsed_type, is_active=True).first()
    if not row:
        return jsonify({"success": False, "message": "Item not found"}), 404

    if parsed_type == MASTER_TYPE_DEPARTMENT:
        in_use = (
            Admin.query.filter(db.func.lower(db.func.coalesce(Admin.emp_type, "")) == row.name.lower()).count()
            > 0
        )
    else:
        in_use = (
            Admin.query.filter(db.func.lower(db.func.coalesce(Admin.circle, "")) == row.name.lower()).count()
            > 0
        )

    if in_use:
        return jsonify(
            {
                "success": False,
                "message": "Cannot delete value because it is in use by existing employees",
            }
        ), 409

    row.is_active = False
    db.session.commit()
    return jsonify({"success": True, "message": "Value deleted successfully"}), 200


@hr.route("/signup", methods=["POST"])
@jwt_required()
@hr_required
def signup_api():
    data = request.get_json() or {}

    required_fields = [
        "email",
        "first_name",
        "user_name",
        "mobile",
        "emp_id",
        "doj",
        "emp_type",
        "circle"
    ]

    missing = [f for f in required_fields if not data.get(f)]
    if missing:
        return jsonify({
            "success": False,
            "message": f"Missing fields: {', '.join(missing)}"
        }), 400

    # -------------------------
    # DOJ validation
    # -------------------------
    try:
        doj = datetime.fromisoformat(str(data["doj"]).strip()[:10]).date()
    except (ValueError, TypeError):
        return jsonify({
            "success": False,
            "message": "Invalid DOJ format (YYYY-MM-DD)"
        }), 400

    # Trim to fit DB column lengths (Admin: mobile=15, emp_id=10)
    email = str(data["email"]).strip()
    first_name = str(data["first_name"]).strip()[:150]
    user_name = str(data["user_name"]).strip()[:120]
    mobile = str(data["mobile"]).strip().replace(" ", "")[:15]
    emp_id = str(data["emp_id"]).strip()[:10]
    emp_type = str(data["emp_type"]).strip()[:50] if data.get("emp_type") else ""
    circle = str(data["circle"]).strip()[:50] if data.get("circle") else ""

    if not _is_allowed_master_value(MASTER_TYPE_DEPARTMENT, emp_type):
        return jsonify({
            "success": False,
            "message": "Invalid employee type. Please add it from Add Department first."
        }), 400

    if not _is_allowed_master_value(MASTER_TYPE_CIRCLE, circle):
        return jsonify({
            "success": False,
            "message": "Invalid circle. Please add it from Add Circle first."
        }), 400

    hr_email = get_jwt().get("email")

    try:
        # Pre-check for duplicate identifiers to avoid raw IntegrityError messages
        existing_conflict = Admin.query.filter(
            (Admin.email == email) |
            (Admin.user_name == user_name) |
            (Admin.mobile == mobile) |
            (Admin.emp_id == emp_id)
        ).first()

        if existing_conflict and existing_conflict.password:
            conflict_msg = "Email, User name, Mobile or Employee ID already exists. Use different values."
            return jsonify({"success": False, "message": conflict_msg}), 409

        admin = Admin.query.filter_by(email=email).first()

        # ======================================================
        # CASE 1: Existing user (partial record, e.g. no password yet)
        # ======================================================
        if admin:
            if admin.password:
                return jsonify({
                    "success": False,
                    "message": "User already fully registered"
                }), 409

            # Upgrade existing user
            admin.first_name = first_name
            admin.user_name = user_name
            admin.mobile = mobile
            admin.emp_id = emp_id
            admin.doj = doj
            admin.emp_type = emp_type
            admin.is_active = True
            admin.is_exited = False

            if _norm_circle_name(admin.circle) != _norm_circle_name(circle):
                eff_raw = data.get("circle_effective_from")
                try:
                    eff_date = (
                        datetime.fromisoformat(str(eff_raw).strip()[:10]).date()
                        if eff_raw
                        else (admin.doj or date.today())
                    )
                except (ValueError, TypeError):
                    return jsonify({
                        "success": False,
                        "message": "Invalid circle_effective_from (YYYY-MM-DD)",
                    }), 400
                ok, err = _apply_circle_transfer(
                    admin,
                    circle,
                    eff_date,
                    hr_email,
                    data.get("circle_transfer_notes"),
                )
                if not ok:
                    return jsonify({"success": False, "message": err}), 400
            else:
                admin.circle = circle

            # Password logic
            if data.get("password"):
                admin.set_password(data["password"])
            else:
                send_password_set_email(admin)

            action = "UPGRADE_EXISTING_USER"

        # ======================================================
        # CASE 2: Brand new employee
        # ======================================================
        else:
            admin = Admin(
                email=email,
                first_name=first_name,
                user_name=user_name,
                mobile=mobile,
                emp_id=emp_id,
                doj=doj,
                emp_type=emp_type,
                circle=circle,
                is_active=True,
                is_exited=False
            )

            # Password logic
            if data.get("password"):
                admin.set_password(data["password"])
            else:
                send_password_set_email(admin)

            db.session.add(admin)
            db.session.flush()  # get admin.id

            # Initialize leave balance (all NOT NULL columns — matches leave_accrual / compoff_utils)
            leave_balance = LeaveBalance(
                admin_id=admin.id,
                privilege_leave_balance=0.0,
                casual_leave_balance=0.0,
                compensatory_leave_balance=0.0,
                total_privilege_leave=0.0,
                total_casual_leave=0.0,
                total_compensatory_leave=0.0,
                used_privilege_leave=0.0,
                used_casual_leave=0.0,
                used_comp_leave=0.0,
            )
            db.session.add(leave_balance)

            action = "CREATE_NEW_EMPLOYEE"
            _log_initial_circle_assignment(admin, hr_email)

        # ======================================================
        # AUDIT LOG
        # ======================================================
        audit = AuditLog(
            action=action,
            performed_by=hr_email,
            target_email=admin.email
        )
        db.session.add(audit)

        db.session.commit()

        try:
            send_welcome_email(admin, data)
        except Exception as mail_err:
            current_app.logger.warning(f"Welcome email failed (employee still created): {mail_err}")

        return jsonify({
            "success": True,
            "message": "Employee onboarded successfully",
            "employee_id": admin.id,
            "action": action
        }), 201

    except IntegrityError:
        db.session.rollback()
        # Duplicate key from DB: return friendly message instead of 500
        return jsonify({
            "success": False,
            "message": "Email, User name, Mobile or Employee ID already exists. Use different values."
        }), 409
    except Exception as e:
        db.session.rollback()
        current_app.logger.exception("Signup error")
        err_msg = str(e)
        if "Duplicate" in err_msg or "unique" in err_msg.lower() or "1062" in err_msg:
            return jsonify({
                "success": False,
                "message": "Email, User name, Mobile or Employee ID already exists. Use different values."
            }), 409
        return jsonify({
            "success": False,
            "message": err_msg or "Unable to onboard employee"
        }), 500


@hr.route("/send-password-reset", methods=["POST"])
@jwt_required()
@hr_required
def send_password_reset():
    """HR sends a password reset link to an employee. Link expires in 1 hour; user sets their own password."""
    data = request.get_json() or {}
    employee_email = (data.get("employee_email") or "").strip()
    if not employee_email:
        return jsonify({"success": False, "message": "employee_email is required"}), 400

    admin = Admin.query.filter_by(email=employee_email).first()
    if not admin:
        return jsonify({"success": False, "message": "Employee not found"}), 404
    if getattr(admin, "is_exited", False):
        return jsonify({"success": False, "message": "Cannot reset password for exited employee"}), 400
    if not getattr(admin, "is_active", True):
        return jsonify({"success": False, "message": "Employee account is inactive"}), 400

    token = secrets.token_urlsafe(32)
    admin.password_reset_token = token
    admin.password_reset_expiry = datetime.utcnow() + timedelta(hours=1)
    db.session.commit()

    if not send_password_reset_email(admin, token):
        return jsonify({"success": False, "message": "Failed to send email. Please try again."}), 500

    return jsonify({
        "success": True,
        "message": "Password reset link sent. It expires in 1 hour.",
    }), 200


@hr.route("/reset-password", methods=["POST"])
@jwt_required()
def reset_password():
    """
    Reset password for the currently authenticated HR/Admin user.

    NOTE: This route is JWT-protected, so we should NOT rely on
    Flask-Login's current_user (which will be AnonymousUserMixin when
    no session cookie is present). Instead, resolve the Admin from the
    JWT claims.
    """
    claims = get_jwt()
    email = claims.get("email")
    if not email:
        return jsonify({
            "success": False,
            "message": "Invalid token"
        }), 401

    user = Admin.query.filter_by(email=email).first()
    if not user:
        return jsonify({
            "success": False,
            "message": "User not found"
        }), 404

    data = request.get_json() or {}

    password = data.get("password")
    confirm_password = data.get("confirm_password")

    if not password or not confirm_password:
        return jsonify({
            "success": False,
            "message": "Password and confirm password are required"
        }), 400

    if password != confirm_password:
        return jsonify({
            "success": False,
            "message": "Passwords do not match"
        }), 400

    user.set_password(password)
    db.session.commit()

    return jsonify({
        "success": True,
        "message": "Password updated successfully"
    }), 200


@hr.route("/dashboard", methods=["GET"])
@jwt_required()
def hr_dashboard_api():
    today = date.today()
    current_day = today.day
    current_month = today.month

    # 1️⃣ Work Anniversaries (Admin DOJ - only if at least 1 year completed)
    # Compute a cut-off date one year ago; only employees who joined on this
    # month/day in a prior year are treated as having a work anniversary.
    try:
        one_year_ago = today.replace(year=today.year - 1)
    except ValueError:
        # Handle Feb 29 edge case by falling back one year and clamping to Feb 28
        if current_month == 2 and current_day == 29:
            one_year_ago = date(today.year - 1, 2, 28)
        else:
            one_year_ago = date(today.year - 1, current_month, current_day)

    employees_with_anniversaries = Admin.query.filter(
        db.extract("month", Admin.doj) == current_month,
        db.extract("day", Admin.doj) == current_day,
        Admin.doj <= one_year_ago
    ).all()

    # 1️⃣.b Joinings Today (Admin DOJ exactly today, active/non-exited only)
    employees_joining_today = Admin.query.filter(
        Admin.doj == today,
        *_enabled_non_exited_admin_filters(),
    ).all()

    # 2️⃣ Birthdays (Employee DOB)
    employees_with_birthdays = Employee.query.filter(
        db.extract("month", Employee.dob) == current_month,
        db.extract("day", Employee.dob) == current_day
    ).all()

    # 3️⃣ Total Employees (enabled only — same rules as /search and /employee/search)
    enabled_filters = _enabled_non_exited_admin_filters()
    total_employees = Admin.query.filter(*enabled_filters).count()

    # 4️⃣ New Joinees (last 30 days, enabled only)
    thirty_days_ago = today - timedelta(days=30)
    new_joinees_count = Admin.query.filter(
        Admin.doj >= thirty_days_ago,
        *enabled_filters,
    ).count()

    # 5️⃣ Today's Punch-in Count (enabled employees only)
    today_punch_count = (
        Punch.query.join(Admin, Punch.admin_id == Admin.id)
        .filter(
            Punch.punch_date == today,
            Punch.punch_in.isnot(None),
            *enabled_filters,
        )
        .count()
    )

    anniversaries_list = []
    for e in employees_with_anniversaries:
        emp_detail = Employee.query.filter_by(admin_id=e.id).first()
        anniversaries_list.append({
            "emp_id": e.emp_id,
            "name": e.first_name,
            "email": e.email,
            "doj": e.doj.isoformat() if e.doj else None,
            "designation": emp_detail.designation if emp_detail else None
        })

    joinings_today_list = []
    for e in employees_joining_today:
        emp_detail = Employee.query.filter_by(admin_id=e.id).first()
        joinings_today_list.append({
            "emp_id": e.emp_id,
            "name": e.first_name,
            "email": e.email,
            "doj": e.doj.isoformat() if e.doj else None,
            "designation": emp_detail.designation if emp_detail else None
        })

    birthdays_list = [
        {
            "name": e.name,
            "email": e.email,
            "dob": e.dob.isoformat() if e.dob else None,
            "designation": e.designation or None
        }
        for e in employees_with_birthdays
    ]

    return jsonify({
        "success": True,
        "date": today.isoformat(),
        "counts": {
            "total_employees": total_employees,
            "enabled_employees": total_employees,
            "new_joinees_last_30_days": new_joinees_count,
            "today_punch_in_count": today_punch_count,
        },
        "anniversaries": anniversaries_list,
        "birthdays": birthdays_list,
        "joinings_today": joinings_today_list
    }), 200



# --------------------------------------------------
# MARK EMPLOYEE AS EXITED
# --------------------------------------------------
@hr.route("/employees/active", methods=["GET"])
@jwt_required()
@hr_required
def list_active_employees():
    """List active (non-exited) employees for HR Exit flow."""
    emp_type = (request.args.get("emp_type") or "").strip()
    circle = (request.args.get("circle") or "").strip()
    email = (request.args.get("email") or "").strip().lower()

    # Latest resignation (separation) per admin, if any.
    # If separation is revoked/cancelled, don't show a separation date on Exit Employees page.
    latest_resignation_subq = (
        db.session.query(
            Resignation.admin_id.label("admin_id"),
            db.func.max(Resignation.id).label("max_id"),
        )
        .filter(db.func.lower(db.func.coalesce(Resignation.status, "")) != "revoked")
        .group_by(Resignation.admin_id)
        .subquery()
    )

    q = (
        db.session.query(Admin, Resignation)
        .outerjoin(latest_resignation_subq, latest_resignation_subq.c.admin_id == Admin.id)
        .outerjoin(Resignation, Resignation.id == latest_resignation_subq.c.max_id)
        .filter(db.func.coalesce(Admin.is_exited, False) == False)
    )

    if emp_type:
        q = q.filter(db.func.lower(db.func.coalesce(Admin.emp_type, "")) == emp_type.lower())
    if circle:
        q = q.filter(db.func.lower(db.func.coalesce(Admin.circle, "")) == circle.lower())
    if email:
        q = q.filter(db.func.lower(db.func.coalesce(Admin.email, "")) == email)

    rows = q.order_by(Admin.first_name.asc(), Admin.id.asc()).all()

    employees = []
    for admin_row, res in rows:
        employees.append(
            {
                "id": admin_row.id,
                "emp_id": admin_row.emp_id,
                "name": admin_row.first_name,
                "email": admin_row.email,
                "circle": admin_row.circle,
                "emp_type": admin_row.emp_type,
                "resignation_date": res.resignation_date.isoformat() if res and res.resignation_date else None,
            }
        )

    return jsonify(
        {
            "success": True,
            "count": len(employees),
            "employees": employees,
        }
    ), 200


@hr.route("/mark-exit", methods=["POST"])
@jwt_required()
@hr_required
def mark_employee_exit():
    data = request.get_json() or {}

    email = data.get("employee_email")
    exit_type = data.get("exit_type")
    exit_reason = data.get("exit_reason")
    exit_date_str = data.get("exit_date")

    if not email or not exit_type or not exit_date_str:
        return jsonify({
            "success": False,
            "message": "employee_email, exit_type and exit_date are required"
        }), 400

    try:
        exit_date = datetime.fromisoformat(exit_date_str).date()
    except ValueError:
        return jsonify({
            "success": False,
            "message": "Invalid exit_date format (YYYY-MM-DD)"
        }), 400

    admin = Admin.query.filter_by(email=email).first()
    if not admin:
        return jsonify({
            "success": False,
            "message": "Employee not found"
        }), 404

    if admin.is_exited:
        return jsonify({
            "success": False,
            "message": "Employee already marked as exited"
        }), 409

    try:
        # --------------------------------------------------
        # MARK EXIT (current state)
        # --------------------------------------------------
        admin.is_active = False
        admin.is_exited = True

        # --------------------------------------------------
        # EXIT AUDIT/HISTORY (Option B)
        # --------------------------------------------------
        hr_email = get_jwt().get("email")
        exit_row = EmployeeExitHistory(
            admin_id=admin.id,
            exit_date=exit_date,
            exit_type=str(exit_type)[:30] if exit_type else None,
            exit_reason=exit_reason,
            created_by=hr_email,
        )
        db.session.add(exit_row)

        # Keep Admin fields as a "latest exit" cache (backward compatible)
        admin.exit_date = exit_date
        admin.exit_type = str(exit_type)[:30] if exit_type else None
        admin.exit_reason = exit_reason

        # --------------------------------------------------
        # AUDIT LOG
        # --------------------------------------------------
        audit = AuditLog(
            action="EMPLOYEE_EXITED",
            performed_by=hr_email,
            target_email=admin.email
        )
        db.session.add(audit)

        db.session.commit()

        return jsonify({
            "success": True,
            "message": "Employee marked as exited successfully",
            "employee_id": admin.id
        }), 200

    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Exit error: {e}")
        return jsonify({
            "success": False,
            "message": "Unable to mark employee exit"
        }), 500
    


@hr.route("/archive/employee/<int:admin_id>/rejoin", methods=["POST"])
@jwt_required()
@hr_required
def rejoin_archived_employee(admin_id):
    """
    Restore an exited employee to active status. Profile/related data unchanged;
    EmployeeExitHistory rows are kept for audit. Clears latest exit fields on Admin.
    """
    admin = Admin.query.get(admin_id)
    if not admin:
        return jsonify({"success": False, "message": "Employee not found"}), 404
    if not getattr(admin, "is_exited", None):
        return jsonify(
            {
                "success": False,
                "message": "This employee is not in the exit archive (already active or not exited).",
            }
        ), 409

    try:
        hr_email = get_jwt().get("email")
        admin.is_exited = False
        admin.is_active = True
        admin.exit_date = None
        admin.exit_type = None
        admin.exit_reason = None

        db.session.add(
            AuditLog(
                action="EMPLOYEE_REJOINED",
                performed_by=hr_email,
                target_email=admin.email,
            )
        )
        db.session.commit()
        return jsonify(
            {
                "success": True,
                "message": "Employee restored as active. All profile data is preserved; past exit history remains for audit.",
                "admin_id": admin.id,
            }
        ), 200
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Rejoin error: {e}")
        return jsonify({"success": False, "message": "Unable to restore employee"}), 500


@hr.route("/employee-archive", methods=["GET"])
@jwt_required()
@hr_required
def employee_archive_list():
    """
    Returns list of exited employees (archive)
    HR only
    """

    try:
        # Latest exit record per employee (by max history id)
        latest_exit_id_subq = (
            db.session.query(
                EmployeeExitHistory.admin_id.label("admin_id"),
                db.func.max(EmployeeExitHistory.id).label("max_id"),
            )
            .group_by(EmployeeExitHistory.admin_id)
            .subquery()
        )

        exited_employees = (
            db.session.query(Admin, EmployeeExitHistory)
            .outerjoin(latest_exit_id_subq, latest_exit_id_subq.c.admin_id == Admin.id)
            .outerjoin(EmployeeExitHistory, EmployeeExitHistory.id == latest_exit_id_subq.c.max_id)
            .filter(Admin.is_exited == True)
            .order_by(
                db.case(
                    (db.func.coalesce(EmployeeExitHistory.exit_date, Admin.exit_date).is_(None), 1),
                    else_=0,
                ),
                db.func.coalesce(EmployeeExitHistory.exit_date, Admin.exit_date).desc(),
                Admin.id.desc(),
            )
            .all()
        )

        employees = []
        for (emp, exit_row) in exited_employees:
            effective_exit_date = (exit_row.exit_date if exit_row else emp.exit_date)
            effective_exit_type = (exit_row.exit_type if exit_row else emp.exit_type)
            employees.append({
                "admin_id": emp.id,
                "name": emp.first_name,
                "email": emp.email,
                "mobile": emp.mobile,
                "emp_id": emp.emp_id,
                "circle": emp.circle,
                "emp_type": emp.emp_type,
                "exit_date": effective_exit_date.isoformat() if effective_exit_date else None,
                "exit_type": effective_exit_type
            })

        return jsonify({
            "success": True,
            "count": len(employees),
            "employees": employees
        }), 200

    except Exception as e:
        return jsonify({
            "success": False,
            "message": "Failed to load employee archive",
            "error": str(e)
        }), 500


@hr.route("/employees/<int:admin_id>/exit-history", methods=["GET"])
@jwt_required()
@hr_required
def get_employee_exit_history(admin_id):
    admin = Admin.query.get(admin_id)
    if not admin:
        return jsonify({"success": False, "message": "Employee not found"}), 404

    rows = (
        EmployeeExitHistory.query.filter_by(admin_id=admin_id)
        .order_by(EmployeeExitHistory.exit_date.desc(), EmployeeExitHistory.id.desc())
        .all()
    )
    return jsonify(
        {
            "success": True,
            "admin_id": admin_id,
            "count": len(rows),
            "history": [
                {
                    "id": r.id,
                    "exit_date": r.exit_date.isoformat() if r.exit_date else None,
                    "exit_type": r.exit_type,
                    "exit_reason": r.exit_reason,
                    "created_by": r.created_by,
                    "created_at": r.created_at.isoformat() if getattr(r, "created_at", None) else None,
                }
                for r in rows
            ],
        }
    ), 200





def _archive_upload_docs_payload(admin):
    """UploadDoc rows use fixed columns (aadhaar_front, pan_front, …), not doc_type/file_path."""
    out = []
    for row in admin.document_details:
        pairs = [
            ("Aadhaar (front)", getattr(row, "aadhaar_front", None)),
            ("Aadhaar (back)", getattr(row, "aadhaar_back", None)),
            ("PAN (front)", getattr(row, "pan_front", None)),
            ("PAN (back)", getattr(row, "pan_back", None)),
            ("Appointment letter", getattr(row, "appointment_letter", None)),
            ("Passbook (front)", getattr(row, "passbook_front", None)),
        ]
        for doc_type, path in pairs:
            if path:
                out.append({"doc_type": doc_type, "file": path, "uploaded_at": None})
    return out


@hr.route("/archive/employee/<int:employee_id>", methods=["GET"])
@jwt_required()
@hr_required
def get_archived_employee_profile(employee_id):

    admin = Admin.query.get(employee_id)

    if not admin or not getattr(admin, "is_exited", None):
        return jsonify({
            "success": False,
            "message": "Archived employee not found"
        }), 404

    # ---------------- BASIC PROFILE ----------------
    basic = {
        "id": admin.id,
        "name": admin.first_name,
        "email": admin.email,
        "mobile": admin.mobile,
        "username": admin.user_name
    }

    # ---------------- EMPLOYMENT ----------------
    employment = {
        "emp_id": admin.emp_id,
        "circle": admin.circle,
        "emp_type": admin.emp_type,
        "doj": admin.doj.isoformat() if admin.doj else None
    }

    # ---------------- EXIT INFO ----------------
    exit_info = {
        "exit_date": admin.exit_date.isoformat() if admin.exit_date else None,
        "exit_type": admin.exit_type,
        "exit_reason": admin.exit_reason
    }

    # ---------------- FAMILY ----------------
    family = [{
        "name": f.name,
        "relation": f.relation,
        "dob": f.dob.isoformat() if f.dob else None
    } for f in admin.family_details]

    # ---------------- DOCUMENTS (UploadDoc schema) ----------------
    documents = _archive_upload_docs_payload(admin)

    # ---------------- EDUCATION (Education model: qualification, institution, …) ----------------
    education = []
    for e in admin.education_details:
        education.append({
            "degree": e.qualification,
            "institute": e.institution,
            "year": str(e.end.year) if getattr(e, "end", None) else None,
        })

    # ---------------- PREVIOUS EMPLOYMENT (archive UI) ----------------
    previous_employment = [{
        "companyName": pc.com_name,
        "designation": pc.designation,
        "doj": pc.doj.isoformat() if pc.doj else None,
        "dateOfLeaving": pc.dol.isoformat() if pc.dol else None,
        "experienceYears": None,
    } for pc in admin.previous_companies]

    # ---------------- LEAVES ----------------
    leaves = [{
        "type": l.leave_type,
        "start": l.start_date.isoformat(),
        "end": l.end_date.isoformat(),
        "status": l.status
    } for l in admin.leave_applications]

    # ---------------- ASSETS ----------------
    assets = [{
        "asset_name": a.name,
        "assigned_date": a.issue_date.isoformat() if a.issue_date else None
    } for a in admin.assets]

    # ---------------- PERFORMANCE ----------------
    performance = []
    for p in admin.performances:
        rev_payload = None
        try:
            rv = getattr(p, "review", None)
            if rv is not None:
                rev_payload = {
                    "manager_id": rv.manager_id,
                    "rating": rv.rating,
                    "comments": rv.comments,
                    "reviewed_at": rv.reviewed_at.isoformat() if rv.reviewed_at else None,
                }
        except Exception:
            rev_payload = None
        performance.append({
            "id": p.id,
            "month": p.month,
            "achievements": p.achievements,
            "challenges": p.challenges,
            "goals_next_month": p.goals_next_month,
            "suggestion_improvement": p.suggestion_improvement,
            "status": p.status,
            "submitted_at": p.submitted_at.isoformat() if p.submitted_at else None,
            "review": rev_payload,
        })

    # ---------------- QUERIES ----------------
    queries = [{
        "title": q.title,
        "status": q.status,
        "created_at": q.created_at.isoformat()
    } for q in admin.queries]

    return jsonify({
        "success": True,
        "employee": {
            "basic": basic,
            "employment": employment,
            "exit": exit_info,
            "family": family,
            "documents": documents,
            "education": education,
            "previous_employment": previous_employment,
            "leaves": leaves,
            "assets": assets,
            "performance": performance,
            "queries": queries
        }
    }), 200



@hr.route("/search", methods=["GET"])
@jwt_required()
def search_employees():
    circle = request.args.get("circle")
    emp_type = request.args.get("emp_type")

    if not circle or not emp_type:
        return jsonify({
            "success": False,
            "message": "circle and emp_type are required"
        }), 400

    admins = (
        Admin.query.filter_by(circle=circle, emp_type=emp_type)
        .filter(db.func.coalesce(Admin.is_exited, False) == False)
        .filter(db.func.coalesce(Admin.is_active, True) == True)
        .all()
    )

    if not admins:
        return jsonify({
            "success": False,
            "message": "No matching employees found"
        }), 404

    return jsonify({
        "success": True,
        "circle": circle,
        "emp_type": emp_type,
        "count": len(admins),
        "employees": [
            {
                "id": admin.id,
                "name": admin.first_name,
                "email": admin.email
            }
            for admin in admins
        ]
    }), 200


@hr.route("/download-excel", methods=["GET"])
@jwt_required()
@hr_required
def download_excel_hr_api():
    circle = request.args.get("circle")
    emp_type = request.args.get("emp_type")
    month_str = request.args.get("month")

    if not circle or not emp_type:
        return jsonify({
            "success": False,
            "message": "circle and emp_type are required"
        }), 400

    # Step 1: Resolve month
    if month_str:
        try:
            year, month = map(int, month_str.split("-"))
        except ValueError:
            return jsonify({
                "success": False,
                "message": "Invalid month format. Use YYYY-MM"
            }), 400
    else:
        now = datetime.now(ZoneInfo("Asia/Kolkata"))
        year, month = now.year, now.month

    # Step 2: Employees in this circle during the month (incl. mid-month transfers)
    admins = fetch_admins_for_attendance_export(circle, emp_type, year, month)

    if not admins:
        return jsonify({
            "success": False,
            "message": "No employees found"
        }), 404

    # Step 3: Generate Excel
    output = generate_attendance_excel(
        admins=admins,
        emp_type=emp_type,
        circle=circle,
        year=year,
        month=month,
        file_prefix="HR"
    )

    filename = (
        f"HR_Attendance_{circle}_{emp_type}_"
        f"{calendar.month_name[month]}_{year}.xlsx"
    )

    # Step 4: Return file
    return send_excel_file(
        output,
        download_name=filename,
        mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )







def serialize(queryset):
    return [item.to_dict() for item in queryset]


@hr.route("/display-details", methods=["GET"])
@jwt_required()
def display_details_api():
    user_id = request.args.get("user_id", type=int)
    detail_type = request.args.get("detail_type")
    month = request.args.get("month", type=int)
    year = request.args.get("year", type=int)

    if not user_id or not detail_type:
        return jsonify({
            "success": False,
            "message": "user_id and detail_type are required"
        }), 400

    admin = Admin.query.get(user_id)
    if not admin:
        return jsonify({
            "success": False,
            "message": "Employee not found"
        }), 404

    # Default month/year
    now = datetime.now()
    month = month or now.month
    year = year or now.year

    # ------------------------------------------------
    # SIMPLE DETAIL TYPES
    # ------------------------------------------------
    if detail_type == "Family Details":
        details = FamilyDetails.query.filter_by(admin_id=user_id).all()
        return jsonify({"success": True, "details": serialize(details)})

    if detail_type == "Previous_company":
        details = PreviousCompany.query.filter_by(admin_id=user_id).all()
        return jsonify({"success": True, "details": serialize(details)})

    if detail_type == "Employee Details":
        details = Employee.query.filter_by(admin_id=user_id).all()
        return jsonify({"success": True, "details": serialize(details)})

    if detail_type == "Education":
        details = Education.query.filter_by(admin_id=user_id).all()
        return jsonify({"success": True, "details": serialize(details)})

    if detail_type == "Document":
        details = UploadDoc.query.filter_by(admin_id=user_id).all()
        return jsonify({"success": True, "details": serialize(details)})

    if detail_type == "Leave Details":
        details = LeaveApplication.query.filter_by(admin_id=user_id).all()
        return jsonify({"success": True, "details": serialize(details)})

    # ------------------------------------------------
    # ATTENDANCE (FIXED & OPTIMIZED)
    # ------------------------------------------------
    if detail_type == "Attendance":
        num_days = calendar.monthrange(year, month)[1]
        month_start = date(year, month, 1)
        month_end = date(year, month, num_days)

        punches = (
            Punch.query.options(joinedload(Punch.sessions))
            .filter(
                Punch.admin_id == user_id,
                Punch.punch_date.between(month_start, month_end),
            )
            .all()
        )

        leaves = LeaveApplication.query.filter(
            LeaveApplication.admin_id == user_id,
            LeaveApplication.status == "Approved",
            LeaveApplication.start_date <= month_end,
            LeaveApplication.end_date >= month_start
        ).all()

        wfh_apps = WorkFromHomeApplication.query.filter(
            WorkFromHomeApplication.admin_id == user_id,
            WorkFromHomeApplication.status == "Approved",
            WorkFromHomeApplication.start_date <= month_end,
            WorkFromHomeApplication.end_date >= month_start
        ).all()

        punch_map = {p.punch_date: p for p in punches}

        attendance = []
        for d in range(1, num_days + 1):
            current_day = date(year, month, d)
            punch = punch_map.get(current_day)
            is_wfh = any(wfh.start_date <= current_day <= wfh.end_date for wfh in wfh_apps)
            on_leave = any(lv.start_date <= current_day <= lv.end_date for lv in leaves)

            loc_in, loc_out = _hr_punch_location_in_out(punch) if punch else ("", "")
            legacy_loc = (getattr(punch, "location_status", None) or "").strip() if punch else ""
            if punch and not loc_in and not loc_out and legacy_loc:
                loc_in = loc_out = legacy_loc

            if on_leave:
                punch_in_s = "On leave"
                punch_out_s = "On leave"
                if not loc_in:
                    loc_in = "–"
                if not loc_out:
                    loc_out = "–"
            else:
                punch_in_s = punch.punch_in.strftime("%H:%M:%S") if punch and punch.punch_in else ""
                punch_out_s = punch.punch_out.strftime("%H:%M:%S") if punch and punch.punch_out else ""

            if loc_in and loc_out:
                combined_loc = f"{loc_in} / {loc_out}"
            elif loc_in or loc_out:
                combined_loc = loc_in or loc_out
            else:
                combined_loc = legacy_loc

            attendance.append({
                "date": current_day.isoformat(),
                "punch_in": punch_in_s,
                "punch_out": punch_out_s,
                "location_status": combined_loc or legacy_loc,
                "location_status_in": loc_in,
                "location_status_out": loc_out,
                "today_work": str(punch.today_work) if punch and punch.today_work else "",
                "is_wfh": is_wfh,
                "on_leave": on_leave,
            })

        summary = calculate_month_summary(user_id, year, month)

        return jsonify({
            "success": True,
            "month": month,
            "year": year,
            "attendance": attendance,
            "summary": summary
        }), 200

    return jsonify({
        "success": False,
        "message": "Invalid detail_type"
    }), 400


# --------------------------------------------------
# HR: Employee profile by admin_id (view/edit for HR)
# --------------------------------------------------
@hr.route("/employee/profile/<int:admin_id>", methods=["GET"])
@jwt_required()
@hr_required
def get_employee_profile_hr(admin_id):
    """Return full profile for an employee by admin_id. HR only."""
    admin = Admin.query.get(admin_id)
    if not admin:
        return jsonify({"success": False, "message": "Employee not found"}), 404
    employee = Employee.query.filter_by(admin_id=admin_id).first()
    education_list = Education.query.filter_by(admin_id=admin_id).all()
    prev_companies = PreviousCompany.query.filter_by(admin_id=admin_id).all()
    upload_doc = UploadDoc.query.filter_by(admin_id=admin_id).first()

    def _date_iso(d):
        return d.isoformat() if d and hasattr(d, "isoformat") else (str(d) if d else None)

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
        },
        "employee": None,
        "education": [],
        "previous_employment": [],
        "documents": None,
    }
    if employee:
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
            "permanent_district": employee.permanent_district or "",
            "permanent_state": employee.permanent_state or "",
            "present_address_line1": employee.present_address_line1,
            "present_pincode": employee.present_pincode,
            "present_district": employee.present_district or "",
            "present_state": employee.present_state or "",
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
        doj, dol = pc.doj, pc.dol
        years = ""
        if doj and dol and hasattr(doj, "year") and hasattr(dol, "year"):
            delta = (dol - doj).days if hasattr(dol, "__sub__") else 0
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
        profile["documents"] = {
            "aadhaar_front": upload_doc.aadhaar_front,
            "aadhaar_back": upload_doc.aadhaar_back,
            "pan_front": upload_doc.pan_front,
            "pan_back": upload_doc.pan_back,
            "appointment_letter": upload_doc.appointment_letter,
            "passbook_front": upload_doc.passbook_front,
        }
    return jsonify({"success": True, "profile": profile}), 200


# --------------------------------------------------
# HR: Download attendance excel for one employee
# --------------------------------------------------
@hr.route("/employee/attendance-download/<int:admin_id>", methods=["GET"])
@jwt_required()
@hr_required
def download_employee_attendance(admin_id):
    admin = Admin.query.get(admin_id)
    if not admin:
        return jsonify({"success": False, "message": "Employee not found"}), 404
    month_str = request.args.get("month")
    if month_str:
        try:
            year, month = map(int, month_str.split("-"))
        except ValueError:
            return jsonify({"success": False, "message": "Invalid month. Use YYYY-MM"}), 400
    else:
        now = datetime.now(ZoneInfo("Asia/Kolkata"))
        year, month = now.year, now.month
    output = generate_attendance_excel(
        admins=[admin],
        emp_type=admin.emp_type or "Employee",
        circle=admin.circle or "NHQ",
        year=year,
        month=month,
        file_prefix="Employee",
    )
    filename = f"Attendance_{admin.emp_id}_{admin.first_name}_{calendar.month_name[month]}_{year}.xlsx"
    return send_excel_file(
        output,
        download_name=filename,
        mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )


# --------------------------------------------------
# HR: Create or update punch for an employee (forgot to punch)
# --------------------------------------------------
@hr.route("/employee/punch/<int:admin_id>", methods=["POST"])
@jwt_required()
@hr_required
def hr_update_employee_punch(admin_id):
    """Create or update punch in/out for an employee. HR use only."""
    admin = Admin.query.get(admin_id)
    if not admin:
        return jsonify({"success": False, "message": "Employee not found"}), 404
    data = request.get_json() or {}
    date_str = data.get("date")
    punch_in_str = data.get("punch_in")
    punch_out_str = data.get("punch_out")
    if not date_str:
        return jsonify({"success": False, "message": "date is required (YYYY-MM-DD)"}), 400
    try:
        punch_date = datetime.strptime(date_str, "%Y-%m-%d").date()
    except ValueError:
        return jsonify({"success": False, "message": "Invalid date format"}), 400
    if not punch_in_str and not punch_out_str:
        return jsonify({"success": False, "message": "Provide at least punch_in or punch_out"}), 400

    def parse_time(s):
        if not s:
            return None
        s = s.strip()
        for fmt in ("%H:%M:%S", "%H:%M"):
            try:
                return datetime.strptime(s, fmt).time()
            except ValueError:
                continue
        return None

    punch_in_time = parse_time(punch_in_str)
    punch_out_time = parse_time(punch_out_str)

    punch = Punch.query.filter_by(admin_id=admin_id, punch_date=punch_date).first()
    if not punch:
        punch = Punch(admin_id=admin_id, punch_date=punch_date)
        db.session.add(punch)

    if punch_in_time is not None:
        punch.punch_in = datetime.combine(punch_date, punch_in_time)
    if punch_out_time is not None:
        punch.punch_out = datetime.combine(punch_date, punch_out_time)

    try:
        sync_punch_after_hr_manual_edit(punch)
        db.session.commit()
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Punch update error: {e}")
        return jsonify({"success": False, "message": "Failed to save punch"}), 500
    return jsonify({
        "success": True,
        "message": "Punch updated successfully",
        "punch": {
            "date": punch_date.isoformat(),
            "punch_in": punch.punch_in.isoformat() if punch.punch_in else None,
            "punch_out": punch.punch_out.isoformat() if punch.punch_out else None,
            "today_work": punch.today_work,
        },
    }), 200


@hr.route("/employee/punch/<int:admin_id>", methods=["GET"])
@jwt_required()
@hr_required
def hr_get_employee_punch(admin_id):
    """Fetch punch + punch_sessions for a specific date (HR use only)."""
    admin = Admin.query.get(admin_id)
    if not admin:
        return jsonify({"success": False, "message": "Employee not found"}), 404
    date_str = (request.args.get("date") or "").strip()
    if not date_str:
        return jsonify({"success": False, "message": "date is required (YYYY-MM-DD)"}), 400
    try:
        punch_date = datetime.strptime(date_str, "%Y-%m-%d").date()
    except ValueError:
        return jsonify({"success": False, "message": "Invalid date format"}), 400

    punch = Punch.query.filter_by(admin_id=admin_id, punch_date=punch_date).first()
    sessions = serialize_punch_sessions(punch) if punch else []
    return jsonify(
        {
            "success": True,
            "punch": {
                "date": punch_date.isoformat(),
                "punch_in": punch.punch_in.isoformat() if punch and punch.punch_in else None,
                "punch_out": punch.punch_out.isoformat() if punch and punch.punch_out else None,
                "today_work": punch.today_work if punch else None,
                "sessions": sessions,
            },
        }
    ), 200


@hr.route("/employee/punch/<int:admin_id>", methods=["DELETE"])
@jwt_required()
@hr_required
def hr_delete_employee_punch_for_date(admin_id):
    """Remove all attendance (punch + sessions) for the employee on the given date."""
    admin = Admin.query.get(admin_id)
    if not admin:
        return jsonify({"success": False, "message": "Employee not found"}), 404
    date_str = (request.args.get("date") or "").strip()
    if not date_str:
        return jsonify({"success": False, "message": "date is required (YYYY-MM-DD)"}), 400
    try:
        punch_date = datetime.strptime(date_str, "%Y-%m-%d").date()
    except ValueError:
        return jsonify({"success": False, "message": "Invalid date format"}), 400

    try:
        deleted = _delete_punch_for_admin_on_date(admin_id, punch_date)
        db.session.commit()
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"HR punch delete error: {e}")
        return jsonify({"success": False, "message": "Failed to delete attendance for this date"}), 500

    return jsonify(
        {
            "success": True,
            "message": (
                "Attendance removed for this date."
                if deleted
                else "No attendance was recorded for this date."
            ),
            "deleted": deleted,
            "date": punch_date.isoformat(),
        }
    ), 200


@hr.route("/employee/punch/<int:admin_id>/sessions", methods=["POST"])
@jwt_required()
@hr_required
def hr_replace_employee_punch_sessions(admin_id):
    """
    Replace punch_sessions for a given date, then recompute Punch roll-ups.
    Payload:
      { date: "YYYY-MM-DD", sessions: [{ clock_in: "HH:MM", clock_out: "HH:MM"|null,
                                        repeat_reason?: str, extended_hours_reason?: str }] }
    If sessions is [], all attendance for that date is removed (no Punch row).
    """
    admin = Admin.query.get(admin_id)
    if not admin:
        return jsonify({"success": False, "message": "Employee not found"}), 404
    data = request.get_json() or {}
    date_str = (data.get("date") or "").strip()
    if not date_str:
        return jsonify({"success": False, "message": "date is required (YYYY-MM-DD)"}), 400
    try:
        punch_date = datetime.strptime(date_str, "%Y-%m-%d").date()
    except ValueError:
        return jsonify({"success": False, "message": "Invalid date format"}), 400

    sessions_in = data.get("sessions")
    if not isinstance(sessions_in, list):
        return jsonify({"success": False, "message": "sessions must be a list"}), 400

    if len(sessions_in) == 0:
        try:
            _delete_punch_for_admin_on_date(admin_id, punch_date)
            db.session.commit()
        except Exception as e:
            db.session.rollback()
            current_app.logger.error(f"Punch sessions clear error: {e}")
            return jsonify({"success": False, "message": "Failed to clear attendance for this date"}), 500
        return jsonify(
            {
                "success": True,
                "message": "Attendance cleared for this date (no punch data).",
                "punch": {
                    "date": punch_date.isoformat(),
                    "punch_in": None,
                    "punch_out": None,
                    "today_work": None,
                    "sessions": [],
                },
            }
        ), 200

    def _parse_time(s):
        if s is None:
            return None
        s = str(s).strip()
        if not s:
            return None
        for fmt in ("%H:%M:%S", "%H:%M"):
            try:
                return datetime.strptime(s, fmt).time()
            except ValueError:
                continue
        return None

    punch = Punch.query.filter_by(admin_id=admin_id, punch_date=punch_date).first()
    if not punch:
        punch = Punch(admin_id=admin_id, punch_date=punch_date)
        db.session.add(punch)
        db.session.flush()

    try:
        # Replace all existing sessions for this day.
        PunchSession.query.filter_by(punch_id=punch.id).delete(synchronize_session=False)
        db.session.flush()

        new_rows = []
        for i, s in enumerate(sessions_in):
            cin_t = _parse_time(s.get("clock_in"))
            if cin_t is None:
                return jsonify({"success": False, "message": f"Session {i+1}: clock_in is required (HH:MM)"}), 400
            cout_t = _parse_time(s.get("clock_out"))
            cin = datetime.combine(punch_date, cin_t)
            cout = datetime.combine(punch_date, cout_t) if cout_t is not None else None
            if cout is not None and cout < cin:
                # Night shift within same attendance day: allow crossing midnight
                cout = cout + timedelta(days=1)
            new_rows.append(
                PunchSession(
                    punch_id=punch.id,
                    clock_in=cin,
                    clock_out=cout,
                    repeat_reason=(s.get("repeat_reason") or "").strip() or None,
                    extended_hours_reason=(s.get("extended_hours_reason") or "").strip() or None,
                    is_wfh=bool(getattr(punch, "is_wfh", False)),
                )
            )
        # Ensure deterministic ordering
        new_rows.sort(key=lambda r: r.clock_in)
        for r in new_rows:
            db.session.add(r)

        recompute_punch_aggregate(punch)
        db.session.commit()
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Punch sessions update error: {e}")
        return jsonify({"success": False, "message": "Failed to save punch sessions"}), 500

    punch = Punch.query.filter_by(admin_id=admin_id, punch_date=punch_date).first()
    return jsonify(
        {
            "success": True,
            "message": "Punch sessions updated successfully",
            "punch": {
                "date": punch_date.isoformat(),
                "punch_in": punch.punch_in.isoformat() if punch and punch.punch_in else None,
                "punch_out": punch.punch_out.isoformat() if punch and punch.punch_out else None,
                "today_work": punch.today_work if punch else None,
                "sessions": serialize_punch_sessions(punch) if punch else [],
            },
        }
    ), 200


@hr.route("/employee/<emp_id>", methods=["GET"])
@jwt_required()
def get_employee(emp_id):
    emp = Employee.query.filter_by(emp_id=emp_id).first()
    if not emp:
        return jsonify({
            "success": False,
            "message": "Employee not found"
        }), 404

    return jsonify({
        "success": True,
        "employee": emp.to_dict()
    }), 200

@hr.route("/employee/<emp_id>", methods=["PUT"])
@jwt_required()
def update_employee_api(emp_id):
    emp = Employee.query.filter_by(emp_id=emp_id).first()
    if not emp:
        return jsonify({
            "success": False,
            "message": "Employee not found"
        }), 404

    data = request.form

    # Update scalar fields safely
    for field in [
        "name", "email", "father_name", "mother_name", "marital_status",
        "dob", "mobile", "gender", "emergency_mobile",
        "nationality", "blood_group", "designation",
        "permanent_address_line1", "permanent_pincode",
        "permanent_district", "permanent_state",
        "present_address_line1", "present_pincode",
        "present_district", "present_state"
    ]:
        if field in data:
            setattr(emp, field, data.get(field))

    # Handle photo upload
    if "photo" in request.files:
        photo = request.files["photo"]
        if photo and photo.filename:
            filename = secure_filename(photo.filename)
            upload_dir = os.path.join(current_app.static_folder, "uploads")
            os.makedirs(upload_dir, exist_ok=True)

            photo_path = os.path.join(upload_dir, filename)
            photo.save(photo_path)

            emp.photo_filename = filename

    db.session.commit()

    return jsonify({
        "success": True,
        "message": "Employee details updated successfully",
        "employee": emp.to_dict()
    }), 200

@hr.route("/leave-balance/<int:employee_id>", methods=["GET"])
@jwt_required()
@hr_required
def get_leave_balance(employee_id):
    """employee_id = Admin.id (admin_id)."""
    admin = Admin.query.get(employee_id)

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
            "message": "Leave balance not found"
        }), 404

    return jsonify({
        "success": True,
        "employee": {
            "id": admin.id,
            "emp_id": admin.emp_id,
            "name": admin.first_name,
            "email": admin.email
        },
        "leave_balance": {
            "privilege_leave_balance": leave_balance.privilege_leave_balance,
            "casual_leave_balance": leave_balance.casual_leave_balance,
            "compensatory_leave_balance": leave_balance.compensatory_leave_balance
        }
    }), 200


@hr.route("/leave-balance/<int:employee_id>", methods=["PUT"])
@jwt_required()
@hr_required
def update_leave_balance(employee_id):
    """employee_id = Admin.id (admin_id)."""
    leave_balance = LeaveBalance.query.filter_by(admin_id=employee_id).first()

    if not leave_balance:
        return jsonify({
            "success": False,
            "message": "Leave balance not found"
        }), 404

    data = request.get_json() or {}

    if "privilege_leave_balance" in data:
        leave_balance.privilege_leave_balance = float(data["privilege_leave_balance"])
    if "casual_leave_balance" in data:
        leave_balance.casual_leave_balance = float(data["casual_leave_balance"])
    if "compensatory_leave_balance" in data:
        leave_balance.compensatory_leave_balance = float(data["compensatory_leave_balance"])

    try:
        db.session.commit()
        return jsonify({
            "success": True,
            "message": "Leave balance updated successfully"
        }), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({
            "success": False,
            "message": str(e) or "Database error"
        }), 500


def _round_leave_value(value):
    return round(float(value or 0.0), 2)


def _serialize_leave_updation_row(row):
    admin = row.admin
    return {
        "id": row.id,
        "admin_id": row.admin_id,
        "employee_name": admin.first_name if admin else None,
        "employee_email": admin.email if admin else None,
        "emp_id": admin.emp_id if admin else None,
        "circle": admin.circle if admin else None,
        "emp_type": admin.emp_type if admin else None,
        "leave_type": row.leave_type,
        "reason": row.reason,
        "start_date": row.start_date.isoformat() if row.start_date else None,
        "end_date": row.end_date.isoformat() if row.end_date else None,
        "status": row.status,
        "deducted_days": _round_leave_value(row.deducted_days),
        "extra_days": _round_leave_value(row.extra_days),
        "requested_deducted_days": _round_leave_value(getattr(row, "requested_deducted_days", 0.0)),
        "sandwich_pl_days": _round_leave_value(getattr(row, "sandwich_pl_days", 0.0)),
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "request_type": "leave",
    }


def _serialize_wfh_updation_row(row):
    admin = row.admin
    return {
        "id": row.id,
        "admin_id": row.admin_id,
        "employee_name": admin.first_name if admin else None,
        "employee_email": admin.email if admin else None,
        "emp_id": admin.emp_id if admin else None,
        "circle": admin.circle if admin else None,
        "emp_type": admin.emp_type if admin else None,
        "leave_type": "Work From Home",
        "reason": row.reason,
        "start_date": row.start_date.isoformat() if row.start_date else None,
        "end_date": row.end_date.isoformat() if row.end_date else None,
        "status": row.status,
        "deducted_days": None,
        "extra_days": None,
        "requested_deducted_days": None,
        "sandwich_pl_days": None,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "request_type": "wfh",
    }


def _parse_leave_date_or_400(raw_value, field_name):
    try:
        return datetime.strptime(str(raw_value or ""), "%Y-%m-%d").date(), None
    except Exception:
        return None, f"Invalid {field_name}. Use YYYY-MM-DD format."


def _reverse_approved_leave_effect(leave_obj, leave_balance):
    if not leave_balance or (leave_obj.status or "") != "Approved":
        return

    leave_type = leave_obj.leave_type
    deducted = float(leave_obj.deducted_days or 0.0)
    requested_deducted = float(getattr(leave_obj, "requested_deducted_days", 0.0) or 0.0)
    sandwich_pl = float(getattr(leave_obj, "sandwich_pl_days", 0.0) or 0.0)
    extra_days = float(leave_obj.extra_days or 0.0)

    if leave_type == "Privilege Leave" and deducted > 0:
        leave_balance.privilege_leave_balance = float(leave_balance.privilege_leave_balance or 0.0) + deducted
        leave_balance.used_privilege_leave = max(0.0, float(leave_balance.used_privilege_leave or 0.0) - deducted)
    elif leave_type == "Casual Leave" and requested_deducted > 0:
        leave_balance.casual_leave_balance = float(leave_balance.casual_leave_balance or 0.0) + requested_deducted
        leave_balance.used_casual_leave = max(0.0, float(leave_balance.used_casual_leave or 0.0) - requested_deducted)
    elif leave_type == "Compensatory Leave" and requested_deducted > 0:
        restore_comp_leave(leave_obj.admin_id, requested_deducted)
        leave_balance.used_comp_leave = max(0.0, float(leave_balance.used_comp_leave or 0.0) - requested_deducted)
    elif leave_type == "Half Day Leave" and extra_days < 0.5:
        if float(leave_balance.used_casual_leave or 0.0) >= 0.5:
            leave_balance.casual_leave_balance = float(leave_balance.casual_leave_balance or 0.0) + 0.5
            leave_balance.used_casual_leave = max(0.0, float(leave_balance.used_casual_leave or 0.0) - 0.5)
        else:
            leave_balance.privilege_leave_balance = float(leave_balance.privilege_leave_balance or 0.0) + 0.5
            leave_balance.used_privilege_leave = max(0.0, float(leave_balance.used_privilege_leave or 0.0) - 0.5)

    if sandwich_pl > 0 and leave_type not in ("Privilege Leave", "Optional Leave"):
        leave_balance.privilege_leave_balance = float(leave_balance.privilege_leave_balance or 0.0) + sandwich_pl
        leave_balance.used_privilege_leave = max(0.0, float(leave_balance.used_privilege_leave or 0.0) - sandwich_pl)


def _compute_leave_projection(*, admin, leave_balance, leave_type, start_date, end_date):
    if end_date < start_date:
        return None, "End date cannot be before start date."
    if not leave_type:
        return None, "leave_type is required."

    working_days, sandwich_days = _compute_working_and_sandwich_days(
        emp_type=getattr(admin, "emp_type", None) or "",
        start_date=start_date,
        end_date=end_date,
    )
    leave_days = float(working_days) + float(sandwich_days)
    deducted_days = 0.0
    extra_days = 0.0
    requested_deducted_days = 0.0
    sandwich_pl_days = 0.0

    if leave_type == "Privilege Leave":
        available = float(leave_balance.privilege_leave_balance or 0.0)
        if leave_days > available:
            extra_days = leave_days - available
            deducted_days = available
        else:
            deducted_days = leave_days
        requested_deducted_days = float(deducted_days)

    elif leave_type == "Casual Leave":
        if working_days > 2:
            return None, "Casual Leave cannot exceed 2 working days."
        available = float(leave_balance.casual_leave_balance or 0.0)
        if working_days > available:
            return None, "Insufficient Casual Leave balance."
        requested_deducted_days = float(working_days)
        deducted_days = requested_deducted_days

    elif leave_type == "Half Day Leave":
        if (end_date - start_date).days + 1 > 1:
            return None, "Half Day Leave can only be one day."
        leave_days = 0.5
        deducted_days = 0.5
        requested_deducted_days = 0.5
        sandwich_days = 0.0
        cl_available = float(leave_balance.casual_leave_balance or 0.0)
        pl_available = float(leave_balance.privilege_leave_balance or 0.0)
        if cl_available < 0.5 and pl_available < 0.5:
            extra_days = 0.5

    elif leave_type == "Compensatory Leave":
        available = float(leave_balance.compensatory_leave_balance or 0.0)
        if available <= 0:
            return None, "No Compensatory Leave balance available."
        if working_days > 2:
            return None, "Maximum 2 Compensatory Leave working days allowed."
        if leave_days > available:
            return None, "Insufficient Compensatory Leave balance."
        requested_deducted_days = float(working_days)
        deducted_days = requested_deducted_days

    elif leave_type == "Optional Leave":
        if leave_days > 1:
            return None, "Optional Leave can only be one day."
        deducted_days = float(leave_days)
        requested_deducted_days = float(leave_days)
        sandwich_days = 0.0
    else:
        return None, "Invalid leave type."

    if sandwich_days > 0 and leave_type not in ("Privilege Leave", "Optional Leave"):
        pl_available = float(leave_balance.privilege_leave_balance or 0.0)
        pl_used_for_sandwich = min(pl_available, float(sandwich_days))
        sandwich_pl_days = float(pl_used_for_sandwich)
        sandwich_lwp = float(sandwich_days) - float(pl_used_for_sandwich)
        deducted_days = float(deducted_days) + sandwich_pl_days
        extra_days = float(extra_days) + sandwich_lwp

    return {
        "deducted_days": _round_leave_value(deducted_days),
        "extra_days": _round_leave_value(extra_days),
        "requested_deducted_days": _round_leave_value(requested_deducted_days),
        "sandwich_pl_days": _round_leave_value(sandwich_pl_days),
    }, None


def _apply_approved_leave_effect(leave_obj, leave_balance):
    leave_type = leave_obj.leave_type
    deducted = float(leave_obj.deducted_days or 0.0)
    requested_deducted = float(getattr(leave_obj, "requested_deducted_days", 0.0) or 0.0)
    sandwich_pl = float(getattr(leave_obj, "sandwich_pl_days", 0.0) or 0.0)

    if leave_type == "Privilege Leave" and deducted > 0:
        if float(leave_balance.privilege_leave_balance or 0.0) < deducted:
            return "Insufficient Privilege Leave balance for approval."
        leave_balance.privilege_leave_balance = max(0.0, float(leave_balance.privilege_leave_balance or 0.0) - deducted)
        leave_balance.used_privilege_leave = float(leave_balance.used_privilege_leave or 0.0) + deducted
    elif leave_type == "Casual Leave" and requested_deducted > 0:
        if float(leave_balance.casual_leave_balance or 0.0) < requested_deducted:
            return "Insufficient Casual Leave balance for approval."
        leave_balance.casual_leave_balance = max(0.0, float(leave_balance.casual_leave_balance or 0.0) - requested_deducted)
        leave_balance.used_casual_leave = float(leave_balance.used_casual_leave or 0.0) + requested_deducted
    elif leave_type == "Compensatory Leave" and requested_deducted > 0:
        if not deduct_comp_leave(leave_obj.admin_id, requested_deducted):
            return "Insufficient Compensatory Leave balance (may have expired)."
        leave_balance.used_comp_leave = float(leave_balance.used_comp_leave or 0.0) + requested_deducted
    elif leave_type == "Half Day Leave":
        extra = float(leave_obj.extra_days or 0.0)
        if extra < 0.5:
            if float(leave_balance.casual_leave_balance or 0.0) >= 0.5:
                leave_balance.casual_leave_balance = float(leave_balance.casual_leave_balance or 0.0) - 0.5
                leave_balance.used_casual_leave = float(leave_balance.used_casual_leave or 0.0) + 0.5
            elif float(leave_balance.privilege_leave_balance or 0.0) >= 0.5:
                leave_balance.privilege_leave_balance = float(leave_balance.privilege_leave_balance or 0.0) - 0.5
                leave_balance.used_privilege_leave = float(leave_balance.used_privilege_leave or 0.0) + 0.5

    if sandwich_pl > 0 and leave_type not in ("Privilege Leave", "Optional Leave"):
        if float(leave_balance.privilege_leave_balance or 0.0) < sandwich_pl:
            return "Insufficient Privilege Leave balance for sandwich adjustment."
        leave_balance.privilege_leave_balance = max(0.0, float(leave_balance.privilege_leave_balance or 0.0) - sandwich_pl)
        leave_balance.used_privilege_leave = float(leave_balance.used_privilege_leave or 0.0) + sandwich_pl
    return None


@hr.route("/leave-updation/requests", methods=["GET"])
@jwt_required()
@hr_required
def list_leave_updation_requests():
    status = (request.args.get("status") or "all").strip().lower()
    circle = (request.args.get("circle") or "").strip()
    emp_type = (request.args.get("emp_type") or "").strip()
    request_type = (request.args.get("request_type") or "all").strip().lower()

    rows_out = []

    if request_type in ("all", "leave"):
        q = LeaveApplication.query.join(Admin, LeaveApplication.admin_id == Admin.id)
        if status != "all":
            q = q.filter(db.func.lower(LeaveApplication.status) == status)
        if circle:
            q = q.filter(Admin.circle == circle)
        if emp_type:
            q = q.filter(Admin.emp_type == emp_type)
        leave_rows = q.order_by(LeaveApplication.created_at.desc(), LeaveApplication.id.desc()).limit(500).all()
        rows_out.extend(_serialize_leave_updation_row(r) for r in leave_rows)

    if request_type in ("all", "wfh"):
        q_wfh = WorkFromHomeApplication.query.join(Admin, WorkFromHomeApplication.admin_id == Admin.id)
        if status != "all":
            q_wfh = q_wfh.filter(db.func.lower(WorkFromHomeApplication.status) == status)
        if circle:
            q_wfh = q_wfh.filter(Admin.circle == circle)
        if emp_type:
            q_wfh = q_wfh.filter(Admin.emp_type == emp_type)
        wfh_rows = (
            q_wfh.order_by(WorkFromHomeApplication.created_at.desc(), WorkFromHomeApplication.id.desc())
            .limit(500)
            .all()
        )
        rows_out.extend(_serialize_wfh_updation_row(r) for r in wfh_rows)

    rows_out.sort(
        key=lambda x: (x.get("created_at") or "", x.get("id") or 0),
        reverse=True,
    )
    return jsonify({"success": True, "requests": rows_out[:500]}), 200


@hr.route("/leave-updation/requests/<int:leave_id>", methods=["PATCH"])
@jwt_required()
@hr_required
def update_leave_application_by_hr(leave_id):
    leave_obj = LeaveApplication.query.get(leave_id)
    if not leave_obj:
        return jsonify({"success": False, "message": "Leave request not found"}), 404

    payload = request.get_json(silent=True) or {}
    next_leave_type = (payload.get("leave_type") or leave_obj.leave_type or "").strip()
    next_status = (payload.get("status") or leave_obj.status or "").strip().title()
    if next_status not in {"Pending", "Approved", "Rejected"}:
        return jsonify({"success": False, "message": "status must be Pending, Approved or Rejected"}), 400

    next_start_date = leave_obj.start_date
    next_end_date = leave_obj.end_date
    if "start_date" in payload:
        parsed, err = _parse_leave_date_or_400(payload.get("start_date"), "start_date")
        if err:
            return jsonify({"success": False, "message": err}), 400
        next_start_date = parsed
    if "end_date" in payload:
        parsed, err = _parse_leave_date_or_400(payload.get("end_date"), "end_date")
        if err:
            return jsonify({"success": False, "message": err}), 400
        next_end_date = parsed

    admin = leave_obj.admin
    if not admin:
        return jsonify({"success": False, "message": "Employee not found for this leave request"}), 404
    leave_balance = admin.leave_balance
    if not leave_balance:
        return jsonify({"success": False, "message": "Leave balance not configured for employee"}), 400

    old_data = {
        "status": leave_obj.status,
        "start_date": leave_obj.start_date.isoformat() if leave_obj.start_date else None,
        "end_date": leave_obj.end_date.isoformat() if leave_obj.end_date else None,
        "deducted_days": _round_leave_value(leave_obj.deducted_days),
        "extra_days": _round_leave_value(leave_obj.extra_days),
    }
    reversal_applied = (leave_obj.status or "") == "Approved"
    _reverse_approved_leave_effect(leave_obj, leave_balance)

    projection, err = _compute_leave_projection(
        admin=admin,
        leave_balance=leave_balance,
        leave_type=next_leave_type,
        start_date=next_start_date,
        end_date=next_end_date,
    )
    if err:
        db.session.rollback()
        return jsonify({"success": False, "message": err}), 400

    leave_obj.leave_type = next_leave_type
    leave_obj.start_date = next_start_date
    leave_obj.end_date = next_end_date
    leave_obj.status = next_status
    if "reason" in payload and str(payload.get("reason") or "").strip():
        leave_obj.reason = str(payload.get("reason")).strip()
    leave_obj.deducted_days = projection["deducted_days"]
    leave_obj.extra_days = projection["extra_days"]
    leave_obj.requested_deducted_days = projection["requested_deducted_days"]
    leave_obj.sandwich_pl_days = projection["sandwich_pl_days"]

    if next_status == "Approved":
        apply_err = _apply_approved_leave_effect(leave_obj, leave_balance)
        if apply_err:
            db.session.rollback()
            return jsonify({"success": False, "message": apply_err}), 400

    try:
        db.session.commit()
    except Exception as exc:
        db.session.rollback()
        return jsonify({"success": False, "message": str(exc) or "Failed to update leave request"}), 500

    try:
        hr_email = (get_jwt() or {}).get("email")
        hr_admin = Admin.query.filter_by(email=hr_email).first() if hr_email else None
        send_hr_leave_updation_email(
            leave_obj=leave_obj,
            hr_admin=hr_admin,
            old_data=old_data,
            adjustment_data={
                "paid_adjustment": _round_leave_value(float(leave_obj.deducted_days or 0.0) - float(old_data["deducted_days"] or 0.0)),
                "lwp_adjustment": _round_leave_value(float(leave_obj.extra_days or 0.0) - float(old_data["extra_days"] or 0.0)),
                "reversal_applied": reversal_applied,
            },
        )
    except Exception:
        current_app.logger.warning("send_hr_leave_updation_email failed for leave_id=%s", leave_obj.id)

    try:
        hr_email = (get_jwt() or {}).get("email") or "unknown"
        compact_reason = str(leave_obj.reason or "").replace("|", "/").replace("\n", " ").strip()
        if len(compact_reason) > 120:
            compact_reason = compact_reason[:117] + "..."
        audit_action = (
            f"LEAVE_UPDATION|leave_id={leave_obj.id}|"
            f"status:{old_data.get('status')}->{leave_obj.status}|"
            f"dates:{old_data.get('start_date')}->{leave_obj.start_date.isoformat()},{old_data.get('end_date')}->{leave_obj.end_date.isoformat()}|"
            f"paid:{old_data.get('deducted_days')}->{_round_leave_value(leave_obj.deducted_days)}|"
            f"lwp:{old_data.get('extra_days')}->{_round_leave_value(leave_obj.extra_days)}|"
            f"reason:{compact_reason}"
        )
        db.session.add(
            AuditLog(
                action=audit_action,
                performed_by=hr_email,
                target_email=admin.email,
            )
        )
        db.session.commit()
    except Exception:
        db.session.rollback()
        current_app.logger.warning("Failed to insert leave updation audit log for leave_id=%s", leave_obj.id)

    return jsonify({
        "success": True,
        "message": "Leave request updated successfully.",
        "request": _serialize_leave_updation_row(leave_obj),
        "leave_balance": {
            "privilege_leave_balance": _round_leave_value(leave_balance.privilege_leave_balance),
            "casual_leave_balance": _round_leave_value(leave_balance.casual_leave_balance),
            "compensatory_leave_balance": _round_leave_value(leave_balance.compensatory_leave_balance),
        },
    }), 200


@hr.route("/leave-updation/requests/<int:leave_id>/audit", methods=["GET"])
@jwt_required()
@hr_required
def get_leave_updation_audit(leave_id):
    leave_obj = LeaveApplication.query.get(leave_id)
    if not leave_obj:
        return jsonify({"success": False, "message": "Leave request not found"}), 404

    pattern = f"LEAVE_UPDATION|leave_id={leave_id}|%"
    rows = (
        AuditLog.query.filter(AuditLog.action.like(pattern))
        .order_by(AuditLog.created_at.desc(), AuditLog.id.desc())
        .all()
    )
    items = []
    for row in rows:
        items.append(
            {
                "id": row.id,
                "action": row.action,
                "performed_by": row.performed_by,
                "target_email": row.target_email,
                "created_at": row.created_at.isoformat() if row.created_at else None,
            }
        )
    return jsonify({"success": True, "audit": items}), 200


@hr.route("/leave-updation/wfh-requests/<int:wfh_id>", methods=["PATCH"])
@jwt_required()
@hr_required
def update_wfh_application_by_hr(wfh_id):
    wfh_obj = WorkFromHomeApplication.query.get(wfh_id)
    if not wfh_obj:
        return jsonify({"success": False, "message": "WFH request not found"}), 404

    payload = request.get_json(silent=True) or {}
    next_status = (payload.get("status") or wfh_obj.status or "").strip().title()
    if next_status not in {"Pending", "Approved", "Rejected"}:
        return jsonify({"success": False, "message": "status must be Pending, Approved or Rejected"}), 400

    next_start_date = wfh_obj.start_date
    next_end_date = wfh_obj.end_date
    if "start_date" in payload:
        parsed, err = _parse_leave_date_or_400(payload.get("start_date"), "start_date")
        if err:
            return jsonify({"success": False, "message": err}), 400
        next_start_date = parsed
    if "end_date" in payload:
        parsed, err = _parse_leave_date_or_400(payload.get("end_date"), "end_date")
        if err:
            return jsonify({"success": False, "message": err}), 400
        next_end_date = parsed
    if next_end_date < next_start_date:
        return jsonify({"success": False, "message": "End date cannot be before start date."}), 400

    old_data = {
        "status": wfh_obj.status,
        "start_date": wfh_obj.start_date.isoformat() if wfh_obj.start_date else None,
        "end_date": wfh_obj.end_date.isoformat() if wfh_obj.end_date else None,
        "reason": wfh_obj.reason or "",
    }

    wfh_obj.start_date = next_start_date
    wfh_obj.end_date = next_end_date
    wfh_obj.status = next_status
    if "reason" in payload and str(payload.get("reason") or "").strip():
        wfh_obj.reason = str(payload.get("reason")).strip()

    try:
        db.session.commit()
    except Exception as exc:
        db.session.rollback()
        return jsonify({"success": False, "message": str(exc) or "Failed to update WFH request"}), 500

    try:
        hr_email = (get_jwt() or {}).get("email") or "unknown"
        compact_reason = str(wfh_obj.reason or "").replace("|", "/").replace("\n", " ").strip()
        if len(compact_reason) > 120:
            compact_reason = compact_reason[:117] + "..."
        audit_action = (
            f"WFH_UPDATION|wfh_id={wfh_obj.id}|"
            f"status:{old_data.get('status')}->{wfh_obj.status}|"
            f"dates:{old_data.get('start_date')}->{wfh_obj.start_date.isoformat()},"
            f"{old_data.get('end_date')}->{wfh_obj.end_date.isoformat()}|"
            f"reason:{compact_reason}"
        )
        db.session.add(
            AuditLog(
                action=audit_action,
                performed_by=hr_email,
                target_email=wfh_obj.admin.email if wfh_obj.admin else None,
            )
        )
        db.session.commit()
    except Exception:
        db.session.rollback()
        current_app.logger.warning("Failed to insert WFH updation audit log for wfh_id=%s", wfh_obj.id)

    return jsonify(
        {
            "success": True,
            "message": "WFH request updated successfully.",
            "request": _serialize_wfh_updation_row(wfh_obj),
        }
    ), 200


@hr.route("/leave-updation/wfh-requests/<int:wfh_id>/audit", methods=["GET"])
@jwt_required()
@hr_required
def get_wfh_updation_audit(wfh_id):
    wfh_obj = WorkFromHomeApplication.query.get(wfh_id)
    if not wfh_obj:
        return jsonify({"success": False, "message": "WFH request not found"}), 404

    pattern = f"WFH_UPDATION|wfh_id={wfh_id}|%"
    rows = (
        AuditLog.query.filter(AuditLog.action.like(pattern))
        .order_by(AuditLog.created_at.desc(), AuditLog.id.desc())
        .all()
    )
    items = []
    for row in rows:
        items.append(
            {
                "id": row.id,
                "action": row.action,
                "performed_by": row.performed_by,
                "target_email": row.target_email,
                "created_at": row.created_at.isoformat() if row.created_at else None,
            }
        )
    return jsonify({"success": True, "audit": items}), 200


ASSESSMENT_LINK_TTL_MINUTES = 15
ASSESSMENT_DURATION_MINUTES = 180
ASSESSMENT_ANY_OPTION_CORRECT_QS = tuple(range(26, 34))
ASSESSMENT_MANUAL_QS = tuple(range(34, 63))
ASSESSMENT_FIGURE_BASE = "/api/HumanResource/assessment/public/figures"
ASSESSMENT_QUESTIONS_WITH_FIGURES = (3, 4, 5, 6, 7, 12, 23)
ASSESSMENT_FIGURE_FILES = {
    3: "q03.png",
    4: "q04.svg",
    5: "q05.svg",
    6: "q06.svg",
    7: "q07.svg",
    12: "q12.svg",
    23: "q23.svg",
}
ASSESSMENT_FIGURE_FILENAMES = frozenset(ASSESSMENT_FIGURE_FILES.values())

ASSESSMENT_OBJECTIVE_ANSWER_KEY = {
    1: 2, 2: 1, 3: 3, 4: 4, 5: 2, 6: 3, 7: 3, 8: 1, 9: 3, 10: 1,
    11: 2, 12: 4, 13: 2, 14: 3, 15: 1, 16: 1, 17: 3, 18: 4, 19: 2, 20: 3,
    21: 2, 22: 3, 23: 3, 24: 3, 25: 4,
    63: 2, 64: 2, 65: 2, 66: 3, 67: 3, 68: 2, 69: 4, 70: 2, 71: 4, 72: 3,
    73: 2, 74: 1, 75: 4, 76: 3, 77: 1, 78: 2, 79: 3, 80: 4, 81: 4, 82: 3,
    83: 2, 84: 4, 85: 1, 86: 4, 87: 2,
}


def _assessment_figures_directory():
    here = os.path.dirname(os.path.abspath(__file__))
    repo_root = os.path.abspath(os.path.join(here, "..", ".."))
    candidates = [
        os.path.join(repo_root, "frontend", "public", "assessment-figures"),
        os.path.join(current_app.root_path, "static", "assessment-figures"),
    ]
    for path in candidates:
        if os.path.isdir(path):
            return path
    return candidates[0]


def _assessment_attach_figures(questions):
    for q in questions:
        num = q.get("number")
        if num in ASSESSMENT_FIGURE_FILES:
            q["image_url"] = f"{ASSESSMENT_FIGURE_BASE}/{ASSESSMENT_FIGURE_FILES[int(num)]}"
    return questions


def _assessment_questions_payload():
    section_1 = [
        {"number": 1, "type": "mcq", "question": "Round off 1.26 to the nearest tenth (i.e. to 1 decimal place).", "options": ["1.2", "1.3", "1", "2"]},
        {"number": 2, "type": "mcq", "question": "What is 15 % of 200?", "options": ["30", "15", "1.5", "3.0"]},
        {"number": 3, "type": "mcq", "question": "Identify the figure that completes the pattern.", "options": ["1", "2", "3", "4"]},
        {"number": 4, "type": "mcq", "question": "Ratio of total sales of branch B2 (both years) to B4 (both years).", "options": ["2.3", "3.5", "4.5", "7.9"]},
        {"number": 5, "type": "mcq", "question": "Choose the alternative that resembles the mirror image.", "options": ["1", "2", "3", "4"]},
        {"number": 6, "type": "mcq", "question": "Find the number of triangles in the figure.", "options": ["16", "22", "28", "32"]},
        {"number": 7, "type": "mcq", "question": "Which one will replace the question mark?", "options": ["25", "35", "41", "47"]},
        {"number": 8, "type": "mcq", "question": "If sugar content of Batch A with 100 ml of extract is 10 percent, batch B: 200 ml, 12 percent, Batch C: 500 ml, 18 percent ; Batch D : 700 ml, 22 percent, what is the weighted average sugar content of all the batches together?", "options": ["69.5", "79.5", "65.5", "70"]},
        {"number": 9, "type": "mcq", "question": "Weighted average for exams (82%, 84%, final 91% weighted twice).", "options": ["84.75%", "85.25%", "87%", "85.67%"]},
        {"number": 10, "type": "mcq", "question": "Teacher weight when class mean increases by 0.5 kg.", "options": ["63 KG", "74 KG", "84 KG", "65 KG"]},
        {"number": 11, "type": "mcq", "question": "Correct mean after 165 was miscopied as 135.", "options": ["145 cm", "151 cm", "160 cm", "165 cm"]},
        {"number": 12, "type": "mcq", "question": "Find the number of triangles in the figure.", "options": ["8", "10", "12", "14"]},
        {"number": 13, "type": "mcq", "question": "0.032 / 100", "options": ["3.2", "0.00032", "0.0032", "32"]},
        {"number": 14, "type": "mcq", "question": "New person weight if avg of 8 increases by 2.5 kg (replacing 65 kg).", "options": ["76 kg", "76.5 kg", "85 kg", "Data inadequate", "None of these"]},
        {"number": 15, "type": "mcq", "question": "Required 6th month sale for average Rs. 6500.", "options": ["4991", "5991", "6001", "6991"]},
        {"number": 16, "type": "mcq", "question": "Correct average when 37 kg was read as 73 kg.", "options": ["49 kg", "51 kg", "50.5 kg", "None of these"]},
        {"number": 17, "type": "mcq", "question": "Mix 10% and 50% salt solutions to make 200 ml at 25%.", "options": ["65 mL + 135 mL", "50 mL + 150 mL", "75 mL + 125 mL", "80 mL + 120 mL"]},
        {"number": 18, "type": "mcq", "question": "Average of 4 numbers is 20; remove one gives 15. Removed number?", "options": ["10", "15", "30", "35", "45"]},
        {"number": 19, "type": "mcq", "question": "Average mass of 50 cars (1200 kg) and 10 trucks (3000 kg).", "options": ["1200 kg", "1500 kg", "1800 kg", "2100 kg", "2400 kg"]},
        {"number": 20, "type": "mcq", "question": "Garden length with 10x12 trees and given spacing.", "options": ["20 m", "22 m", "24 m", "26 m"]},
        {"number": 21, "type": "mcq", "question": "Average of 7 is 18; first 3 avg 14, last 3 avg 19. Middle number?", "options": ["42", "57", "27", "None of these"]},
        {"number": 22, "type": "mcq", "question": "If sugar content of Batch A with 100 ml of extract is 10 percent, batch B: 200 ml, 12 percent, Batch C: 500 ml, 18 percent ; Batch D : 700 ml, 22 percent, what is the total extracted volume of liquid?", "options": ["1212", "1111", "1222", "1122"]},
        {"number": 23, "type": "mcq", "question": "The following table shows the prices per 100 gram of coffee of different brands. Using quantities as weights find the Weighted Average.", "options": ["4.49", "2.46", "3.46", "3.49"]},
        {"number": 24, "type": "mcq", "question": "Runs needed in 10th innings to raise mean from 58 to 61.", "options": ["75", "85", "88", "90"]},
        {"number": 25, "type": "mcq", "question": "(1+2) x 3 - 4 /5", "options": ["31/5", "1", "-3/5", "41/5"]},
    ]

    section_2 = [
        {"number": 26, "type": "mcq", "question": "I get my best ideas by", "options": ["talking to others", "thinking by myself in my own space", "going to the net and researching", "reading"]},
        {"number": 27, "type": "mcq", "question": "If a question is asked by your Boss that you have no clue about, you will", "options": ["ask colleagues for the answer", "ask your Boss for the answer", "Research on the net for the answer", "Buy some books and research the question."]},
        {"number": 28, "type": "mcq", "question": "My preferred way of learning and understanding things is", "options": ["Conversing with people to have different opinions", "Learning and understanding by myself without engaging or interacting with people", "Reading extensively on the subject by buying books, on the internet, and researching articles."]},
        {"number": 29, "type": "mcq", "question": "What are your lifelong dreams?", "options": ["Learning over Earning", "Earning over Learning", "To enjoy life to the fullest", "Retire early"]},
        {"number": 30, "type": "mcq", "question": "How will your juniors describe you?", "options": ["An easy-going boss", "A boss who is very tough on deadlines and execution", "A boss who demands 200 percent hard work, drives you relentlessly, and is always after achievement of targets", "A boss who is very likable, easy to convince, and not very demanding"]},
        {"number": 31, "type": "mcq", "question": "How would your superiors describe you?", "options": ["A meticulous planner", "A laid-back character", "An absolute execution machine: give him/her a job and he/she will do it perfectly without reminders or supervision", "A nice, easy-going person", "A brilliant thinker and problem solver, but a poor executor"]},
        {"number": 32, "type": "mcq", "question": "What was the assessment of your school/college teachers about you", "options": ["Brilliant student", "Good student", "Average student", "Below average student"]},
        {"number": 33, "type": "mcq", "question": "Which describes you best", "options": ["An easy-going, fun-loving person", "An average person", "A very driven, hard-charging individual", "Willing to go through any hardship and unlimited hard work to secure success"]},
        {"number": 34, "type": "subjective", "question": "How will you organize your relevant department (steps in serial order)?"},
        {"number": 35, "type": "subjective", "question": "Write an application for sudden leave and reasons for the same."},
        {"number": 36, "type": "subjective", "question": "How do you track task completion and pending tasks?"},
        {"number": 37, "type": "subjective", "question": "Biggest challenge of your life and how you overcame it."},
        {"number": 38, "type": "subjective", "question": "Most interesting thing you have done in your professional career."},
        {"number": 39, "type": "subjective", "question": "Last book you read and key learnings."},
        {"number": 40, "type": "subjective", "question": "Competitive sport experience and learnings (if any)."},
        {"number": 41, "type": "subjective", "question": "Tools/apps/checklists you use to plan and track tasks."},
        {"number": 42, "type": "subjective", "question": "Example where others said it would not work, but you succeeded."},
        {"number": 43, "type": "subjective", "question": "Biggest achievement in life and professional life."},
        {"number": 44, "type": "subjective", "question": "Favorite subject and why."},
        {"number": 45, "type": "subjective", "question": "Biggest disappointment and whether due to inability or bad luck."},
        {"number": 46, "type": "subjective", "question": "Highest number of hours worked in a day and days at a stretch."},
        {"number": 47, "type": "subjective", "question": "Maximum daily and weekly working hours you are prepared for."},
        {"number": 48, "type": "subjective", "question": "Major weaknesses and how you will convert them to strengths."},
        {"number": 49, "type": "subjective", "question": "Most interesting thing you learned in the past 1 year."},
        {"number": 50, "type": "subjective", "question": "Characteristics of the best boss you ever had."},
        {"number": 51, "type": "subjective", "question": "New-you strengths vs old-you (three years ago)."},
        {"number": 52, "type": "subjective", "question": "Who do you go to for advice and why?"},
        {"number": 53, "type": "subjective", "question": "On a scale of 1-10, how lucky are you? Why?"},
        {"number": 54, "type": "subjective", "question": "Three areas of improvement you want to work on."},
        {"number": 55, "type": "subjective", "question": "A time when you got tough/brutal feedback from your boss."},
        {"number": 56, "type": "subjective", "question": "Looking back, what would you do differently in life?"},
        {"number": 57, "type": "subjective", "question": "Describe your biggest work failure and how you handled it."},
        {"number": 58, "type": "subjective", "question": "A goal you recently achieved and what worked in your plan."},
        {"number": 59, "type": "subjective", "question": "A time you suggested an improvement in your project."},
        {"number": 60, "type": "subjective", "question": "A time you had to handle several projects at once."},
        {"number": 61, "type": "subjective", "question": "A disagreement with another engineer and how you resolved it."},
        {"number": 62, "type": "subjective", "question": "A major obstacle during a project and the steps you took."},
    ]

    section_3 = [
        {"number": 63, "type": "mcq", "question": "Choose the correctly spelled word.", "options": ["conspicuos", "conspicuous", "cospicuous", "conspiuous"]},
        {"number": 64, "type": "mcq", "question": "Find the correct spelling.", "options": ["Battallion", "Battalion", "Bettalion", "Battalean"]},
        {"number": 65, "type": "mcq", "question": "Find the correct spelling.", "options": ["Ammalgamation", "Amalgamation", "Amallgamation", "Amalgamattion"]},
        {"number": 66, "type": "mcq", "question": "With little money but ___ time you can visit ___ museums.", "options": ["little, much", "few, little", "much, few", "much, little"]},
        {"number": 67, "type": "mcq", "question": "If your requests are met with repeated ___, leave him/her alone.", "options": ["hypotheses", "negatives", "rebuffs", "blunts"]},
        {"number": 68, "type": "mcq", "question": "Peter is a good friend ___ lives in Italy, a country ___ I have never visited.", "options": ["who, what", "who, which", "that, which", "and, which"]},
        {"number": 69, "type": "mcq", "question": "In each question below, there is a sentence, of which some parts have been jumbled up. Rearrange these parts labelled P, Q, R and S to produce the correct sequence. (I saw that ...)", "options": ["QPSR", "QRPS", "SPQR", "SRPQ"]},
        {"number": 70, "type": "mcq", "question": "Which the following sentences contains an error? A. The design was one of the most unique. B. The design was the most unique. C. The design was unique.", "options": ["A and C", "A and B", "B and C", "None"]},
        {"number": 71, "type": "mcq", "question": "He ___ a glass of fruit juice before he ___ to the airport.", "options": ["drink, drive", "drink, drove", "drinking, drive", "drank, drove"]},
        {"number": 72, "type": "mcq", "question": "When she ___ learning English she ___ already learned French.", "options": ["Start, Has already learne", "Starts, Has already learning", "Started, Had already learned", "Start, Has already learned"]},
        {"number": 73, "type": "mcq", "question": "I ___ school dances; they're loud, hot and crowded.", "options": ["not enjoy", "don't enjoy", "doesn't enjoy", "am not enjoying"]},
        {"number": 74, "type": "mcq", "question": "Conjugate correctly: When he ___, his mother ___ breakfast.", "options": ["Woke up; Had already prepared", "Wake up; Had already prepared", "Woke up; Had prepared", "Woke up; Had prepared already"]},
        {"number": 75, "type": "mcq", "question": "Mishra ___ for Bombay before Praveen reached the station.", "options": ["have left", "has left", "left", "had left"]},
        {"number": 76, "type": "mcq", "question": "The president ___ for about half an hour when trouble started.", "options": ["has been speaking", "have been speaking", "had been speaking", "was speaking"]},
        {"number": 77, "type": "mcq", "question": "Come with me.", "options": ["Home", "Over", "Into the store"]},
        {"number": 78, "type": "mcq", "question": "I've decided to go ___ business with John Clarke.", "options": ["Over", "Into", "Around", "With"]},
        {"number": 79, "type": "mcq", "question": "Fill prepositions: ... arrived ___ the party.", "options": ["on,at,in,on", "at,in,on,at", "on,in,on,at", "at,in,on,in"]},
        {"number": 80, "type": "mcq", "question": "English ___ all over the world.", "options": ["Speaks", "Is Speak", "Is Speaking", "Is Spoken"]},
        {"number": 81, "type": "mcq", "question": "Synonyms of Fostering", "options": ["Safeguarding", "Neglecting", "Ignoring", "Nuturing"]},
        {"number": 82, "type": "mcq", "question": "Our Sir teaches Mathematics ___ English.", "options": ["Across", "Beside", "Besides", "Both"]},
        {"number": 83, "type": "mcq", "question": "Antonym of Foremost.", "options": ["Hindmost", "Unimportant", "Disposed", "Mature"]},
        {"number": 84, "type": "mcq", "question": "Ram was/ senior to / Sam in college (error spotting).", "options": ["Ram was", "Senior to", "Sam in college", "No Error"]},
        {"number": 85, "type": "mcq", "question": "Find the correct spelling.", "options": ["Obsolete", "Obsoliete", "Obsolite", "Obsoletie"]},
        {"number": 86, "type": "mcq", "question": "Find the correct spelling.", "options": ["Accquaintance", "Acqquaintance", "Acquainttance", "Acquaintance"]},
        {"number": 87, "type": "mcq", "question": "You should always be faithful ___ your promise.", "options": ["on", "to", "with", "over"]},
    ]

    return {
        "section_1": _assessment_attach_figures(section_1),
        "section_2": section_2,
        "section_3": section_3,
    }


def _assessment_hash_token(raw_token: str) -> str:
    return hashlib.sha256((raw_token or "").encode("utf-8")).hexdigest()


def _assessment_load_answers(invite):
    if not invite or not invite.answers_json:
        return {}
    try:
        parsed = json.loads(invite.answers_json)
        if isinstance(parsed, dict):
            return parsed
    except Exception:
        pass
    return {}


def _assessment_answers_for_scoring(answers):
    """Strip reserved meta keys (e.g. __integrity) from stored answers before auto-scoring."""
    if not isinstance(answers, dict):
        return {}
    return {str(k): v for k, v in answers.items() if not str(k).startswith("__")}


def _assessment_integrity_summary(invite):
    """Compact counts for list views (parsed from stored answers_json)."""
    data = _assessment_load_answers(invite)
    if not isinstance(data, dict):
        return None
    meta = data.get("__integrity")
    if not isinstance(meta, dict):
        return None

    def _count(seq, key):
        if meta.get(key) is not None:
            try:
                return max(0, int(meta.get(key)))
            except (TypeError, ValueError):
                pass
        if isinstance(seq, list):
            return len(seq)
        return 0

    tab_ts = meta.get("tab_hide_timestamps_utc") or []
    blur_ts = meta.get("window_blur_timestamps_utc") or []
    paste_ts = meta.get("paste_attempt_timestamps_utc") or []
    tab_n = _count(tab_ts, "tab_hide_count")
    blur_n = _count(blur_ts, "window_blur_count")
    paste_n = _count(paste_ts, "paste_attempt_count")
    try:
        clip_n = max(0, int(meta.get("clipboard_shortcut_blocks") or 0))
    except (TypeError, ValueError):
        clip_n = 0
    try:
        ctx_n = max(0, int(meta.get("context_menu_blocks") or 0))
    except (TypeError, ValueError):
        ctx_n = 0
    dq = bool(meta.get("disqualified"))
    if not dq and tab_n == 0 and blur_n == 0 and paste_n == 0 and clip_n == 0 and ctx_n == 0:
        return None
    return {
        "disqualified": dq,
        "tab_hide_count": tab_n,
        "window_blur_count": blur_n,
        "paste_attempt_count": paste_n,
        "clipboard_shortcut_blocks": clip_n,
        "context_menu_blocks": ctx_n,
    }


def _assessment_save_selfie(invite_id, selfie_data_url):
    if not selfie_data_url or not isinstance(selfie_data_url, str):
        return None, "Selfie image is required."
    payload = selfie_data_url.strip()
    if "," in payload:
        _meta, payload = payload.split(",", 1)
    try:
        raw = base64.b64decode(payload, validate=True)
    except Exception:
        return None, "Invalid selfie image format."

    uploads_root = current_app.config.get("UPLOAD_FOLDER")
    if not uploads_root:
        uploads_root = os.path.join(current_app.root_path, "static", "uploads")
    target_dir = os.path.join(uploads_root, "assessment_selfies")
    os.makedirs(target_dir, exist_ok=True)
    filename = f"assessment_{invite_id}_{uuid.uuid4().hex}.jpg"
    path = os.path.join(target_dir, filename)
    with open(path, "wb") as f:
        f.write(raw)
    return f"assessment_selfies/{filename}", None


ASSESSMENT_RECORDING_MAX_BYTES = 800 * 1024 * 1024  # 800 MB — long tests; tune server/proxy if needed
# Days after first HR view of the recording before the file is removed (disk + DB path).
ASSESSMENT_RECORDING_HR_RETENTION_DAYS = 3


def _assessment_uploads_root():
    custom = (current_app.config.get("UPLOADS_ROOT") or "").strip()
    if custom:
        uploads_root = os.path.abspath(custom)
    else:
        uploads_root = os.path.abspath(os.path.join(current_app.root_path, "static", "uploads"))
    os.makedirs(uploads_root, exist_ok=True)
    return uploads_root


def _assessment_remove_recording_disk(uploads_root, rel):
    rel = (rel or "").strip()
    if not rel:
        return
    abs_rec = os.path.join(uploads_root, rel.replace("/", os.sep))
    if os.path.isfile(abs_rec):
        try:
            os.remove(abs_rec)
        except OSError as e:
            current_app.logger.warning("Failed to remove assessment recording file %s: %s", abs_rec, e)


def _assessment_clear_recording_fields(invite, uploads_root=None):
    """Remove recording file from disk and clear path + first-view timestamp on the invite."""
    root = uploads_root if uploads_root is not None else _assessment_uploads_root()
    rel = (getattr(invite, "recording_path", None) or "").strip()
    _assessment_remove_recording_disk(root, rel)
    invite.recording_path = None
    invite.recording_first_viewed_at = None


def _assessment_recording_hr_retention_expired(invite):
    viewed = getattr(invite, "recording_first_viewed_at", None)
    if not viewed:
        return False
    return datetime.utcnow() - viewed >= timedelta(days=ASSESSMENT_RECORDING_HR_RETENTION_DAYS)


def purge_expired_assessment_recordings():
    """Remove session recordings past HR first-view retention. Safe to run from the daily scheduler."""
    cutoff = datetime.utcnow() - timedelta(days=ASSESSMENT_RECORDING_HR_RETENTION_DAYS)
    uploads_root = _assessment_uploads_root()
    rows = (
        AssessmentInvite.query.filter(
            and_(
                AssessmentInvite.recording_path.isnot(None),
                AssessmentInvite.recording_path != "",
                AssessmentInvite.recording_first_viewed_at.isnot(None),
                AssessmentInvite.recording_first_viewed_at <= cutoff,
            )
        )
        .all()
    )
    if not rows:
        return 0
    for inv in rows:
        try:
            _assessment_clear_recording_fields(inv, uploads_root)
        except Exception as e:
            current_app.logger.warning("purge_expired_assessment_recordings invite %s: %s", inv.id, e)
    try:
        db.session.commit()
    except Exception as e:
        current_app.logger.warning("purge_expired_assessment_recordings commit: %s", e)
        db.session.rollback()
        return 0
    return len(rows)


def _assessment_save_recording_file(invite_id, file_storage):
    """Persist candidate session recording; returns relative path under uploads root."""
    if not file_storage:
        return None, "No recording file provided."
    try:
        uploads_root = _assessment_uploads_root()
    except OSError as e:
        current_app.logger.exception("assessment recording: uploads root unavailable")
        return None, f"Server cannot store recordings: {e}"
    target_dir = os.path.join(uploads_root, "assessment_recordings")
    try:
        os.makedirs(target_dir, exist_ok=True)
    except OSError as e:
        current_app.logger.exception("assessment recording: cannot create directory")
        return None, f"Server cannot store recordings: {e}"
    raw_name = getattr(file_storage, "filename", None) or "session.webm"
    safe_base = secure_filename(raw_name) or "recording.webm"
    lower = safe_base.lower()
    if not lower.endswith((".webm", ".mp4", ".mkv")):
        safe_base = f"{safe_base}.webm"
    filename = f"assessment_{invite_id}_{uuid.uuid4().hex}_{safe_base}"
    abs_path = os.path.join(target_dir, filename)
    try:
        file_storage.save(abs_path)
    except OSError as e:
        current_app.logger.exception("assessment recording save failed invite=%s", invite_id)
        return None, f"Could not save recording on server: {e}"
    try:
        sz = os.path.getsize(abs_path)
    except OSError:
        sz = 0
    if sz > ASSESSMENT_RECORDING_MAX_BYTES:
        try:
            os.remove(abs_path)
        except OSError:
            pass
        return None, "Recording file is too large."
    if sz < 32:
        try:
            os.remove(abs_path)
        except OSError:
            pass
        return None, "Recording file is empty or invalid."
    return f"assessment_recordings/{filename}", None


def _assessment_auto_score(answers):
    answers = _assessment_answers_for_scoring(answers or {})
    score = 0
    breakdown = {}
    for qn, expected in ASSESSMENT_OBJECTIVE_ANSWER_KEY.items():
        got = answers.get(str(qn))
        try:
            got_int = int(got)
        except Exception:
            got_int = None
        ok = got_int == expected
        breakdown[str(qn)] = {"expected": expected, "given": got_int, "correct": bool(ok)}
        if ok:
            score += 1
    for qn in ASSESSMENT_ANY_OPTION_CORRECT_QS:
        got = answers.get(str(qn))
        try:
            got_int = int(got)
        except Exception:
            got_int = None
        ok = got_int is not None and got_int > 0
        breakdown[str(qn)] = {
            "expected": "Any selected option",
            "given": got_int,
            "correct": bool(ok),
        }
        if ok:
            score += 1
    return float(score), breakdown


def _assessment_session_deadline(invite):
    """End of in-progress attempt (started_at + test duration)."""
    if not invite.started_at:
        return None
    dur = int(invite.duration_minutes or ASSESSMENT_DURATION_MINUTES)
    return invite.started_at + timedelta(minutes=dur)


def _assessment_link_open_expired(invite, now=None):
    """True if invite was never started and the 15-minute open window passed."""
    now = now or datetime.utcnow()
    if invite.started_at or invite.status in ("submitted", "disqualified", "expired"):
        return False
    return bool(invite.expires_at and now > invite.expires_at)


def _assessment_session_expired(invite, now=None):
    """True if a started attempt ran past its allowed test duration."""
    now = now or datetime.utcnow()
    if invite.status in ("submitted", "disqualified"):
        return False
    deadline = _assessment_session_deadline(invite)
    if not deadline:
        return _assessment_link_open_expired(invite, now)
    return now > deadline


def _assessment_public_access_expired(invite, now=None):
    if invite.status in ("submitted", "disqualified"):
        return False
    if invite.started_at:
        return _assessment_session_expired(invite, now)
    return _assessment_link_open_expired(invite, now)


def _assessment_extend_session_expiry(invite):
    """After start, link TTL becomes full test duration (not 15 minutes)."""
    if not invite.started_at:
        return
    dur = int(invite.duration_minutes or ASSESSMENT_DURATION_MINUTES)
    session_end = invite.started_at + timedelta(minutes=dur)
    if not invite.expires_at or invite.expires_at < session_end:
        invite.expires_at = session_end


def _assessment_invite_public_payload(invite):
    now = datetime.utcnow()
    if invite.status in ("submitted", "disqualified"):
        deadline = invite.expires_at
    elif invite.started_at:
        deadline = _assessment_session_deadline(invite)
    else:
        deadline = invite.expires_at
    seconds_left = max(0, int((deadline - now).total_seconds())) if deadline else 0
    return {
        "id": invite.id,
        "full_name": invite.full_name,
        "candidate_email": invite.candidate_email,
        "department": invite.department,
        "status": invite.status,
        "disqualified": invite.status == "disqualified",
        "duration_minutes": invite.duration_minutes,
        "expires_at": invite.expires_at.isoformat() if invite.expires_at else None,
        "started_at": invite.started_at.isoformat() if invite.started_at else None,
        "submitted_at": invite.submitted_at.isoformat() if invite.submitted_at else None,
        "seconds_left_to_expiry": seconds_left,
        "link_open_minutes": ASSESSMENT_LINK_TTL_MINUTES,
        "attempt_no": invite.attempt_no,
        "camera_granted": bool(invite.camera_granted),
        "mic_granted": bool(invite.mic_granted),
    }


@hr.route("/assessment/invite", methods=["POST"])
@jwt_required()
@hr_required
def create_assessment_invite():
    data = request.get_json(silent=True) or {}
    full_name = (data.get("full_name") or data.get("name") or "").strip()
    department = (data.get("department") or "").strip()
    candidate_email = (data.get("email") or "").strip().lower()
    if not full_name or not department or not candidate_email:
        return jsonify({"success": False, "message": "name, department and email are required"}), 400
    if "@" not in candidate_email:
        return jsonify({"success": False, "message": "Invalid email"}), 400

    raw_token = secrets.token_urlsafe(48)
    token_hash = _assessment_hash_token(raw_token)
    invite = AssessmentInvite(
        full_name=full_name,
        department=department,
        candidate_email=candidate_email,
        token_hash=token_hash,
        expires_at=datetime.utcnow() + timedelta(minutes=ASSESSMENT_LINK_TTL_MINUTES),
        duration_minutes=ASSESSMENT_DURATION_MINUTES,
        status="invited",
    )
    db.session.add(invite)
    db.session.commit()

    mail_ok, provider_msg = send_assessment_invite_email(
        to_email=candidate_email,
        candidate_name=full_name,
        department=department,
        token=raw_token,
        valid_minutes=ASSESSMENT_LINK_TTL_MINUTES,
        cc_emails=[
            (get_jwt() or {}).get("email"),
            current_app.config.get("ZEPTO_CC_HR"),
            current_app.config.get("EMAIL_HR"),
        ],
    )
    if not mail_ok:
        current_app.logger.warning(
            "Assessment invite email send failed for %s. Provider response: %s",
            candidate_email,
            provider_msg,
        )

    base_url = (current_app.config.get("BASE_URL") or "").rstrip("/")
    link = f"{base_url}/assessment?t={raw_token}"
    return jsonify(
        {
            "success": True,
            "message": (
                "Assessment link sent successfully."
                if mail_ok
                else "Invite created, but email delivery failed. Please verify recipient/SMTP and retry."
            ),
            "email_sent": bool(mail_ok),
            "email_provider_message": provider_msg or "",
            "invite": {
                "id": invite.id,
                "full_name": invite.full_name,
                "email": invite.candidate_email,
                "department": invite.department,
                "status": invite.status,
                "expires_at": invite.expires_at.isoformat() if invite.expires_at else None,
                "duration_minutes": invite.duration_minutes,
                "link": link,
            },
        }
    ), 200


@hr.route("/assessment/invites", methods=["GET"])
@jwt_required()
@hr_required
def list_assessment_invites():
    rows = (
        AssessmentInvite.query.order_by(AssessmentInvite.created_at.desc(), AssessmentInvite.id.desc())
        .limit(500)
        .all()
    )
    out = []
    for r in rows:
        out.append(
            {
                "id": r.id,
                "full_name": r.full_name,
                "candidate_email": r.candidate_email,
                "department": r.department,
                "status": r.status,
                "attempt_no": r.attempt_no,
                "expires_at": r.expires_at.isoformat() if r.expires_at else None,
                "started_at": r.started_at.isoformat() if r.started_at else None,
                "submitted_at": r.submitted_at.isoformat() if r.submitted_at else None,
                "auto_score": r.auto_score,
                "manual_score": r.manual_score,
                "total_score": r.total_score,
                "avg_score": r.avg_score,
                "integrity_summary": _assessment_integrity_summary(r),
                "has_recording": bool((getattr(r, "recording_path", None) or "").strip()),
                "has_selfie": bool((getattr(r, "selfie_path", None) or "").strip()),
            }
        )
    return jsonify({"success": True, "invites": out}), 200


@hr.route("/assessment/invites/<int:invite_id>", methods=["GET"])
@jwt_required()
@hr_required
def get_assessment_invite_detail(invite_id):
    invite = AssessmentInvite.query.get(invite_id)
    if not invite:
        return jsonify({"success": False, "message": "Invite not found"}), 404
    answers = dict(_assessment_load_answers(invite))
    integrity = answers.pop("__integrity", None)
    auto_score, breakdown = _assessment_auto_score(answers)
    manual_marks = {}
    if invite.manual_marks_json:
        try:
            parsed = json.loads(invite.manual_marks_json)
            if isinstance(parsed, dict):
                manual_marks = parsed
        except Exception:
            manual_marks = {}
    return jsonify(
        {
            "success": True,
            "invite": {
                "id": invite.id,
                "full_name": invite.full_name,
                "candidate_email": invite.candidate_email,
                "department": invite.department,
                "status": invite.status,
                "attempt_no": invite.attempt_no,
                "duration_minutes": invite.duration_minutes,
                "expires_at": invite.expires_at.isoformat() if invite.expires_at else None,
                "started_at": invite.started_at.isoformat() if invite.started_at else None,
                "submitted_at": invite.submitted_at.isoformat() if invite.submitted_at else None,
                "selfie_path": invite.selfie_path,
                "has_selfie": bool((getattr(invite, "selfie_path", None) or "").strip()),
                "has_recording": bool((invite.recording_path or "").strip()),
                "camera_granted": bool(invite.camera_granted),
                "mic_granted": bool(invite.mic_granted),
                "answers": answers,
                "integrity": integrity,
                "auto_breakdown": breakdown,
                "auto_score": auto_score,
                "manual_marks": manual_marks,
                "manual_score": invite.manual_score,
                "total_score": invite.total_score,
                "avg_score": invite.avg_score,
                "questions": _assessment_questions_payload(),
            },
        }
    ), 200


@hr.route("/assessment/invites/<int:invite_id>/recording", methods=["GET"])
@jwt_required()
@hr_required
def get_assessment_invite_recording(invite_id):
    """HR-only: stream session recording captured during the test.

    Sets ``recording_first_viewed_at`` on first successful open; removes the file after
    ``ASSESSMENT_RECORDING_HR_RETENTION_DAYS`` from that moment (enforced here and by daily purge).
    """
    invite = AssessmentInvite.query.get(invite_id)
    if not invite:
        return jsonify({"success": False, "message": "Invite not found"}), 404
    rel = (getattr(invite, "recording_path", None) or "").strip()
    if not rel:
        return jsonify({"success": False, "message": "No session recording for this invite"}), 404
    uploads_root = _assessment_uploads_root()

    if _assessment_recording_hr_retention_expired(invite):
        _assessment_clear_recording_fields(invite, uploads_root)
        db.session.commit()
        return jsonify(
            {
                "success": False,
                "message": "This recording was removed after the retention period from the first HR view.",
            }
        ), 404

    abs_path = os.path.join(uploads_root, rel.replace("/", os.sep))
    if not os.path.isfile(abs_path):
        return jsonify({"success": False, "message": "Recording file missing"}), 404

    if invite.recording_first_viewed_at is None:
        invite.recording_first_viewed_at = datetime.utcnow()
        db.session.commit()

    mt, _enc = mimetypes.guess_type(abs_path)
    if not mt or not mt.startswith("video/"):
        mt = "video/webm"
    return send_file(
        abs_path,
        mimetype=mt,
        as_attachment=False,
        download_name=os.path.basename(abs_path),
        conditional=True,
    )


@hr.route("/assessment/invites/<int:invite_id>/selfie", methods=["GET"])
@jwt_required()
@hr_required
def get_assessment_invite_selfie(invite_id):
    """HR-only: pre-test verification photo saved when the candidate started the test."""
    invite = AssessmentInvite.query.get(invite_id)
    if not invite:
        return jsonify({"success": False, "message": "Invite not found"}), 404
    rel = (getattr(invite, "selfie_path", None) or "").strip()
    if not rel:
        return jsonify({"success": False, "message": "No verification photo for this invite"}), 404
    uploads_root = current_app.config.get("UPLOAD_FOLDER")
    if not uploads_root:
        uploads_root = os.path.join(current_app.root_path, "static", "uploads")
    abs_path = os.path.join(uploads_root, rel.replace("/", os.sep))
    if not os.path.isfile(abs_path):
        return jsonify({"success": False, "message": "Photo file missing"}), 404
    mt, _enc = mimetypes.guess_type(abs_path)
    if not mt or not mt.startswith("image/"):
        mt = "image/jpeg"
    return send_file(
        abs_path,
        mimetype=mt,
        as_attachment=False,
        download_name=os.path.basename(abs_path),
        conditional=True,
    )


@hr.route("/assessment/invites/<int:invite_id>", methods=["DELETE"])
@jwt_required()
@hr_required
def delete_assessment_invite(invite_id):
    invite = AssessmentInvite.query.get(invite_id)
    if not invite:
        return jsonify({"success": False, "message": "Invite not found"}), 404

    uploads_root = _assessment_uploads_root()
    selfie_path = (invite.selfie_path or "").strip()
    if selfie_path:
        try:
            abs_selfie = os.path.join(uploads_root, selfie_path.replace("/", os.sep))
            if os.path.isfile(abs_selfie):
                os.remove(abs_selfie)
        except Exception as e:
            current_app.logger.warning("Failed to remove assessment selfie for invite %s: %s", invite_id, e)

    try:
        rel_rec = (getattr(invite, "recording_path", None) or "").strip()
        if rel_rec:
            _assessment_remove_recording_disk(uploads_root, rel_rec)
    except Exception as e:
        current_app.logger.warning("Failed to remove assessment recording for invite %s: %s", invite_id, e)

    db.session.delete(invite)
    db.session.commit()
    return jsonify({"success": True, "message": "Assessment invite deleted successfully."}), 200


@hr.route("/assessment/invites/<int:invite_id>/evaluate", methods=["POST"])
@jwt_required()
@hr_required
def evaluate_assessment_invite(invite_id):
    invite = AssessmentInvite.query.get(invite_id)
    if not invite:
        return jsonify({"success": False, "message": "Invite not found"}), 404
    if invite.status not in ("submitted", "disqualified"):
        return jsonify({"success": False, "message": "Candidate has not submitted yet"}), 400
    data = request.get_json(silent=True) or {}
    marks = data.get("marks") or {}
    if not isinstance(marks, dict):
        return jsonify({"success": False, "message": "marks must be an object"}), 400

    manual_total = 0.0
    normalized = {}
    for qn in ASSESSMENT_MANUAL_QS:
        raw = marks.get(str(qn), marks.get(qn, 0))
        try:
            val = float(raw or 0)
        except Exception:
            val = 0.0
        if val < 0:
            val = 0.0
        normalized[str(qn)] = round(val, 2)
        manual_total += val

    answers = _assessment_load_answers(invite)
    auto_score, _breakdown = _assessment_auto_score(answers)
    total = float(auto_score or 0.0) + float(manual_total)
    max_total = len(ASSESSMENT_OBJECTIVE_ANSWER_KEY) + float(len(ASSESSMENT_ANY_OPTION_CORRECT_QS) + len(ASSESSMENT_MANUAL_QS))
    avg = round((total / max_total) * 100.0, 2) if max_total else 0.0

    invite.manual_marks_json = json.dumps(normalized)
    invite.manual_score = round(manual_total, 2)
    invite.auto_score = round(auto_score, 2)
    invite.total_score = round(total, 2)
    invite.avg_score = avg
    invite.evaluated_at = datetime.utcnow()
    invite.evaluated_by = (get_jwt() or {}).get("email")
    db.session.commit()
    return jsonify(
        {
            "success": True,
            "message": "Assessment evaluated successfully.",
            "scores": {
                "auto_score": invite.auto_score,
                "manual_score": invite.manual_score,
                "total_score": invite.total_score,
                "avg_score": invite.avg_score,
            },
        }
    ), 200


@hr.route("/assessment/public/figures/<filename>", methods=["GET"])
def assessment_public_figure(filename):
    safe = os.path.basename((filename or "").strip())
    if safe not in ASSESSMENT_FIGURE_FILENAMES:
        return jsonify({"success": False, "message": "Not found"}), 404
    directory = _assessment_figures_directory()
    full_path = os.path.join(directory, safe)
    if not os.path.isfile(full_path):
        return jsonify({"success": False, "message": "Figure file missing"}), 404
    mime = "image/png" if safe.lower().endswith(".png") else "image/svg+xml"
    return send_from_directory(directory, safe, mimetype=mime)


@hr.route("/assessment/public/status", methods=["GET"])
def assessment_public_status():
    token = (request.args.get("token") or "").strip()
    if not token:
        return jsonify({"success": False, "message": "token is required"}), 400
    invite = AssessmentInvite.query.filter_by(token_hash=_assessment_hash_token(token)).first()
    if not invite:
        return jsonify({"success": False, "message": "Invalid link"}), 404
    if _assessment_public_access_expired(invite) and invite.status not in ("submitted", "disqualified"):
        invite.status = "expired"
        db.session.commit()
    return jsonify({"success": True, "invite": _assessment_invite_public_payload(invite)}), 200


@hr.route("/assessment/public/questions", methods=["GET"])
def assessment_public_questions():
    token = (request.args.get("token") or "").strip()
    if not token:
        return jsonify({"success": False, "message": "token is required"}), 400
    invite = AssessmentInvite.query.filter_by(token_hash=_assessment_hash_token(token)).first()
    if not invite:
        return jsonify({"success": False, "message": "Invalid link"}), 404
    if invite.status in ("submitted", "disqualified"):
        return jsonify(
            {
                "success": False,
                "message": "Test already submitted" if invite.status == "submitted" else "This attempt was disqualified",
                "status": invite.status,
            }
        ), 409
    if _assessment_link_open_expired(invite):
        invite.status = "expired"
        db.session.commit()
        return jsonify(
            {
                "success": False,
                "message": f"Link expired. Please ask HR for a new invite (valid {ASSESSMENT_LINK_TTL_MINUTES} minutes to start).",
            }
        ), 410
    return jsonify(
        {
            "success": True,
            "invite": _assessment_invite_public_payload(invite),
            "questions": _assessment_questions_payload(),
        }
    ), 200


@hr.route("/assessment/public/start", methods=["POST"])
def assessment_public_start():
    data = request.get_json(silent=True) or {}
    token = (data.get("token") or "").strip()
    if not token:
        return jsonify({"success": False, "message": "token is required"}), 400
    invite = AssessmentInvite.query.filter_by(token_hash=_assessment_hash_token(token)).first()
    if not invite:
        return jsonify({"success": False, "message": "Invalid link"}), 404
    if invite.status in ("submitted", "disqualified"):
        return jsonify(
            {
                "success": False,
                "message": "Test already submitted" if invite.status == "submitted" else "This attempt was disqualified",
            }
        ), 409
    if _assessment_link_open_expired(invite) and not invite.started_at:
        invite.status = "expired"
        db.session.commit()
        return jsonify(
            {
                "success": False,
                "message": f"Link expired. Please ask HR for a new invite (valid {ASSESSMENT_LINK_TTL_MINUTES} minutes to start).",
            }
        ), 410
    if invite.started_at and _assessment_session_expired(invite):
        invite.status = "expired"
        db.session.commit()
        return jsonify({"success": False, "message": "Test time has ended."}), 410

    selfie_data_url = data.get("selfie_data_url")
    if not invite.selfie_path:
        selfie_path, err = _assessment_save_selfie(invite.id, selfie_data_url)
        if err:
            return jsonify({"success": False, "message": err}), 400
        invite.selfie_path = selfie_path
    invite.camera_granted = bool(data.get("camera_granted"))
    invite.mic_granted = bool(data.get("mic_granted"))
    if not invite.started_at:
        invite.started_at = datetime.utcnow()
    _assessment_extend_session_expiry(invite)
    if invite.status not in ("submitted", "disqualified", "expired"):
        invite.status = "started"
    db.session.commit()
    return jsonify({"success": True, "invite": _assessment_invite_public_payload(invite)}), 200


@hr.route("/assessment/public/save-answer", methods=["POST"])
def assessment_public_save_answer():
    data = request.get_json(silent=True) or {}
    token = (data.get("token") or "").strip()
    answers_patch = data.get("answers") or {}
    if not token:
        return jsonify({"success": False, "message": "token is required"}), 400
    if not isinstance(answers_patch, dict):
        return jsonify({"success": False, "message": "answers must be an object"}), 400

    invite = AssessmentInvite.query.filter_by(token_hash=_assessment_hash_token(token)).first()
    if not invite:
        return jsonify({"success": False, "message": "Invalid link"}), 404
    if invite.status in ("submitted", "disqualified"):
        return jsonify({"success": False, "message": "Test already submitted"}), 409
    if not invite.started_at:
        return jsonify({"success": False, "message": "Test has not started"}), 400
    if _assessment_session_expired(invite):
        invite.status = "expired"
        db.session.commit()
        return jsonify({"success": False, "message": "Test time has ended."}), 410

    current_answers = _assessment_load_answers(invite)
    for k, v in answers_patch.items():
        qn = str(k).strip()
        if not qn or qn.startswith("__"):
            continue
        current_answers[qn] = v
    invite.answers_json = json.dumps(current_answers)
    db.session.commit()
    return jsonify({"success": True}), 200


@hr.route("/assessment/public/submit", methods=["POST"])
def assessment_public_submit():
    data = request.get_json(silent=True) or {}
    token = (data.get("token") or "").strip()
    answers = data.get("answers") or {}
    if not token:
        return jsonify({"success": False, "message": "token is required"}), 400
    if not isinstance(answers, dict):
        return jsonify({"success": False, "message": "answers must be an object"}), 400

    invite = AssessmentInvite.query.filter_by(token_hash=_assessment_hash_token(token)).first()
    if not invite:
        return jsonify({"success": False, "message": "Invalid link"}), 404
    if invite.status in ("submitted", "disqualified"):
        return jsonify({"success": False, "message": "Test already submitted"}), 409
    if not invite.started_at:
        return jsonify({"success": False, "message": "Test has not started"}), 400
    if _assessment_session_expired(invite):
        invite.status = "expired"
        db.session.commit()
        return jsonify({"success": False, "message": "Test time has ended."}), 410

    disqualified = bool(data.get("disqualified"))
    merged = _assessment_load_answers(invite)
    if isinstance(answers, dict):
        merged.update(answers)
    invite.answers_json = json.dumps(merged)
    auto_score, _breakdown = _assessment_auto_score(merged)
    invite.auto_score = round(auto_score, 2)
    invite.manual_score = invite.manual_score or 0.0
    invite.total_score = round(float(invite.auto_score or 0.0) + float(invite.manual_score or 0.0), 2)
    max_total = len(ASSESSMENT_OBJECTIVE_ANSWER_KEY) + float(len(ASSESSMENT_ANY_OPTION_CORRECT_QS) + len(ASSESSMENT_MANUAL_QS))
    invite.avg_score = round((invite.total_score / max_total) * 100.0, 2) if max_total else 0.0
    invite.submitted_at = datetime.utcnow()
    invite.status = "disqualified" if disqualified else "submitted"
    db.session.commit()

    if not invite.hr_notified_at:
        ok = send_assessment_submitted_email_to_hr(
            candidate_name=invite.full_name,
            candidate_email=invite.candidate_email,
            department=invite.department,
        )
        if ok:
            invite.hr_notified_at = datetime.utcnow()
            db.session.commit()

    msg = (
        "Attempt closed: disqualified after repeated focus loss (e.g. switching tabs)."
        if disqualified
        else "Test submitted successfully."
    )
    return jsonify(
        {
            "success": True,
            "message": msg,
            "invite": _assessment_invite_public_payload(invite),
        }
    ), 200


@hr.route("/assessment/public/upload-recording", methods=["POST"])
def assessment_public_upload_recording():
    """Candidate uploads session video after submit (multipart: token + file)."""
    token = (request.form.get("token") or "").strip()
    if not token:
        return jsonify({"success": False, "message": "token is required"}), 400
    invite = AssessmentInvite.query.filter_by(token_hash=_assessment_hash_token(token)).first()
    if not invite:
        return jsonify({"success": False, "message": "Invalid link"}), 404
    if invite.status not in ("submitted", "disqualified"):
        return jsonify({"success": False, "message": "Submit the assessment before uploading a recording"}), 400
    if (getattr(invite, "recording_path", None) or "").strip():
        return jsonify({"success": False, "message": "Recording already uploaded"}), 409

    cl = request.content_length
    if cl is not None and cl > ASSESSMENT_RECORDING_MAX_BYTES:
        return jsonify({"success": False, "message": "Recording file is too large"}), 413

    file = request.files.get("file")
    if not file:
        return jsonify({"success": False, "message": "Recording file is required"}), 400
    rel, err = _assessment_save_recording_file(invite.id, file)
    if err:
        return jsonify({"success": False, "message": err}), 400
    invite.recording_path = rel
    invite.recording_first_viewed_at = None
    try:
        db.session.commit()
    except Exception as e:
        db.session.rollback()
        current_app.logger.exception("assessment recording db commit failed invite=%s", invite.id)
        return jsonify({"success": False, "message": f"Could not save recording: {e}"}), 500
    return jsonify({"success": True, "message": "Recording saved"}), 200



@hr.route("/news-feed", methods=["POST"])
@jwt_required()
@hr_required
def add_news_feed_api():
    data = request.form

    title = data.get("title")
    content = data.get("content")
    circle = data.get("circle")
    emp_type = data.get("emp_type")

    if not title or not content:
        return jsonify({
            "success": False,
            "message": "Title and content are required"
        }), 400

    filename = None
    if "file" in request.files:
        file = request.files["file"]
        if file and file.filename:
            filename = secure_filename(file.filename)
            upload_dir = current_app.config.get("UPLOAD_FOLDER") or os.path.join(current_app.static_folder or "static", "uploads")
            os.makedirs(upload_dir, exist_ok=True)
            file.save(os.path.join(upload_dir, filename))

    news_feed = NewsFeed(
        title=title,
        content=content,
        file_path=filename,
        circle=circle,
        emp_type=emp_type
    )

    db.session.add(news_feed)
    db.session.commit()

    return jsonify({
        "success": True,
        "message": "News feed added successfully",
        "news_feed": {
            "id": news_feed.id,
            "title": news_feed.title,
            "file": news_feed.file_path,
            "circle": news_feed.circle,
            "emp_type": news_feed.emp_type
        }
    }), 201


@hr.route("/news-feed", methods=["GET"])
@jwt_required()
@hr_required
def list_news_feed_history():
    """List news feed posts for HR (history view)."""
    try:
        circle = request.args.get("circle")
        emp_type = request.args.get("emp_type")

        q = NewsFeed.query.order_by(NewsFeed.created_at.desc())

        if circle and circle.lower() != "all":
            q = q.filter(NewsFeed.circle == circle)
        if emp_type and emp_type.lower() != "all":
            q = q.filter(NewsFeed.emp_type == emp_type)

        posts = q.limit(200).all()

        return jsonify({
            "success": True,
            "count": len(posts),
            "items": [
                {
                    "id": p.id,
                    "title": p.title,
                    "content": p.content,
                    "file_path": p.file_path,
                    "file_url": p.file_url(),
                    "circle": p.circle,
                    "emp_type": p.emp_type,
                    "created_at": p.created_at.isoformat() if p.created_at else None,
                }
                for p in posts
            ],
        }), 200
    except Exception as e:
        return jsonify({
            "success": False,
            "message": str(e) or "Failed to load news feed history",
        }), 500


@hr.route("/news-feed/<int:post_id>", methods=["DELETE"])
@jwt_required()
@hr_required
def delete_news_feed(post_id):
    """Delete a news feed post (HR only)."""
    post = NewsFeed.query.get(post_id)
    if not post:
        return jsonify({"success": False, "message": "News feed post not found"}), 404

    try:
        db.session.delete(post)
        db.session.commit()
        return jsonify({"success": True, "message": "News feed post deleted"}), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({"success": False, "message": str(e) or "Failed to delete post"}), 500


@hr.route("/employee/lookup", methods=["GET"])
@jwt_required()
@hr_required
def search_employee_api_for_asset():
    """Look up a single employee by emp_id (e.g. for asset assignment). Use /employee/search for filter by emp_type and circle."""
    emp_id = request.args.get("emp_id")

    if not emp_id:
        return jsonify({
            "success": False,
            "message": "emp_id is required"
        }), 400

    # Admin is the source of truth
    admin = Admin.query.filter_by(emp_id=emp_id, is_exited=False).first()

    if not admin:
        return jsonify({
            "success": False,
            "message": "Employee not found"
        }), 404

    return jsonify({
        "success": True,
        "employee": {
            "admin_id": admin.id,
            "name": admin.first_name,
            "emp_id": admin.emp_id,
            "email": admin.email,
            "circle": admin.circle,
            "emp_type": admin.emp_type
        }
    }), 200


@hr.route("/employee/<int:admin_id>/assets", methods=["GET"])
@jwt_required()
@hr_required
def get_employee_assets(admin_id):
    employee = Admin.query.get(admin_id)
    if not employee:
        return jsonify({"success": False, "message": "Employee not found"}), 404

    assets = Asset.query.filter_by(admin_id=admin_id).all()

    return jsonify({
        "success": True,
        "employee": {
            "id": employee.id,
            "name": employee.first_name,
            "email": employee.email
        },
        "assets": [a.to_dict() for a in assets]
    }), 200



@hr.route("/assign-asset", methods=["POST"])
@jwt_required()
@hr_required
def assign_asset():
    admin_id = request.form.get("admin_id")
    name = request.form.get("name")
    description = request.form.get("description")
    remark = request.form.get("remark")

    if not admin_id or not name:
        return jsonify({
            "success": False,
            "message": "admin_id and asset name are required"
        }), 400

    admin = Admin.query.get(admin_id)
    if not admin:
        return jsonify({
            "success": False,
            "message": "Employee not found"
        }), 404

    # -------------------------
    # Handle multiple images
    # -------------------------
    uploaded_files = request.files.getlist("images")
    image_paths = []

    upload_base = f"assets/{admin.emp_id}"
    upload_dir = os.path.join(
        current_app.root_path, "static", "uploads", upload_base
    )
    os.makedirs(upload_dir, exist_ok=True)

    for file in uploaded_files:
        if file and file.filename:
            filename = secure_filename(file.filename)
            save_path = os.path.join(upload_dir, filename)
            file.save(save_path)

            image_paths.append(f"{upload_base}/{filename}")

    try:
        asset = Asset(
            name=name,
            description=description,
            remark=remark,
            admin_id=admin.id,
            image_files=",".join(image_paths),
            issue_date=date.today()
        )

        db.session.add(asset)
        db.session.commit()

    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Asset assign error: {e}")
        return jsonify({
            "success": False,
            "message": "Unable to assign asset"
        }), 500

    # -------------------------
    # Send email (NON-BLOCKING)
    # -------------------------
    send_asset_assigned_email(admin, asset)

    return jsonify({
        "success": True,
        "message": "Asset assigned successfully"
    }), 201



@hr.route("/assets/<int:asset_id>", methods=["PUT"])
@jwt_required()
def update_asset_api(asset_id):
    asset = Asset.query.get(asset_id)
    if not asset:
        return jsonify({
            "success": False,
            "message": "Asset not found"
        }), 404

    data = request.form

    # Existing images
    uploaded_filenames = asset.get_image_files() or []

    # -------------------------
    # Handle new images
    # -------------------------
    if "images" in request.files:
        upload_base = f"assets/{asset.admin.emp_id}"
        upload_dir = os.path.join(
            current_app.root_path,
            "static", "uploads",
            upload_base
        )
        os.makedirs(upload_dir, exist_ok=True)

        for file in request.files.getlist("images"):
            if file and file.filename:
                filename = secure_filename(file.filename)
                file.save(os.path.join(upload_dir, filename))
                uploaded_filenames.append(f"{upload_base}/{filename}")

    # -------------------------
    # Update fields
    # -------------------------
    asset.name = data.get("name", asset.name)
    asset.description = data.get("description", asset.description)
    asset.remark = data.get("remark", asset.remark)

    # Dates (safe parsing)
    if data.get("issue_date"):
        asset.issue_date = datetime.fromisoformat(
            data.get("issue_date")
        ).date()

    if data.get("return_date"):
        asset.return_date = datetime.fromisoformat(
            data.get("return_date")
        ).date()
    else:
        asset.return_date = None

    asset.set_image_files(uploaded_filenames)

    try:
        db.session.commit()
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Asset update failed: {e}")
        return jsonify({
            "success": False,
            "message": "Unable to update asset"
        }), 500

    # -------------------------
    # Email (reuse SAME function)
    # -------------------------
    send_asset_assigned_email(asset.admin, asset)

    return jsonify({
        "success": True,
        "message": "Asset updated successfully",
        "asset": asset.to_dict()
    }), 200


# --------------------------------------------------
# LOCATIONS (Office / Punch-in radius)
# --------------------------------------------------
@hr.route("/locations", methods=["GET"])
@jwt_required()
@hr_required
def list_locations():
    locations = Location.query.all()
    return jsonify({
        "success": True,
        "locations": [
            {
                "id": loc.id,
                "name": loc.name,
                "latitude": loc.latitude,
                "longitude": loc.longitude,
                "radius": loc.radius
            }
            for loc in locations
        ]
    }), 200


@hr.route("/locations", methods=["POST"])
@jwt_required()
@hr_required
def create_location():
    data = request.get_json() or {}
    name = (data.get("name") or "").strip()
    lat = data.get("latitude")
    lng = data.get("longitude")
    radius = data.get("radius", 100)

    if not name:
        return jsonify({"success": False, "message": "Location name is required"}), 400
    try:
        lat_f = float(lat) if lat is not None else 0.0
        lng_f = float(lng) if lng is not None else 0.0
        radius_f = float(radius) if radius is not None else 100.0
    except (TypeError, ValueError):
        return jsonify({"success": False, "message": "Invalid latitude, longitude or radius"}), 400

    loc = Location(name=name, latitude=lat_f, longitude=lng_f, radius=radius_f)
    db.session.add(loc)
    db.session.commit()
    return jsonify({
        "success": True,
        "message": "Location added successfully",
        "location": {"id": loc.id, "name": loc.name, "latitude": loc.latitude, "longitude": loc.longitude, "radius": loc.radius}
    }), 201


@hr.route("/locations/<int:loc_id>", methods=["DELETE"])
@jwt_required()
@hr_required
def delete_location(loc_id):
    loc = Location.query.get(loc_id)
    if not loc:
        return jsonify({"success": False, "message": "Location not found"}), 404
    db.session.delete(loc)
    db.session.commit()
    return jsonify({"success": True, "message": "Location deleted"}), 200


# --------------------------------------------------
# NOC (No Objection Certificate)
# Driven by Resignation/Separation: HR sees employees who submitted separation form
# --------------------------------------------------
@hr.route("/noc", methods=["GET"])
@jwt_required()
@hr_required
def list_noc():
    """Return employees who submitted resignation (separation form). HR sees them and takes NOC action."""
    resignations = (
        Resignation.query.join(Admin, Resignation.admin_id == Admin.id)
        .order_by(Resignation.applied_on.desc())
        .all()
    )
    result = []
    for r in resignations:
        admin = r.admin
        noc_rec = Noc.query.filter_by(admin_id=r.admin_id).order_by(Noc.noc_date.desc()).first()
        has_upload = Noc_Upload.query.filter_by(admin_id=r.admin_id).first() is not None
        if has_upload:
            noc_status = "Uploaded"
        elif noc_rec:
            noc_status = "Pending"
        else:
            noc_status = "No NOC"
        result.append({
            "resignation_id": r.id,
            "admin_id": r.admin_id,
            "emp_id": admin.emp_id if admin else "N/A",
            "name": admin.first_name if admin else "N/A",
            "email": admin.email if admin else None,
            "resignation_date": r.resignation_date.isoformat() if r.resignation_date else None,
            "reason": (r.reason or "")[:200],
            "applied_on": r.applied_on.isoformat() if getattr(r.applied_on, "isoformat", None) else str(r.applied_on),
            "noc_id": noc_rec.id if noc_rec else None,
            "noc_date": noc_rec.noc_date.isoformat() if noc_rec and noc_rec.noc_date else None,
            "noc_status": noc_status,
        })
    return jsonify({"success": True, "noc_list": result}), 200


@hr.route("/noc", methods=["POST"])
@jwt_required()
@hr_required
def create_noc():
    data = request.get_json() or {}
    admin_id = data.get("admin_id")
    noc_date_str = data.get("noc_date")
    if not admin_id:
        return jsonify({"success": False, "message": "admin_id is required"}), 400
    admin = Admin.query.get(admin_id)
    if not admin:
        return jsonify({"success": False, "message": "Employee not found"}), 404
    existing = Noc.query.filter_by(admin_id=admin_id).first()
    if existing:
        return jsonify({"success": True, "message": "NOC record already exists", "noc": {"id": existing.id}}), 200
    try:
        noc_date = datetime.fromisoformat(noc_date_str).date() if noc_date_str else date.today()
    except (TypeError, ValueError):
        noc_date = date.today()
    resignation = Resignation.query.filter_by(admin_id=admin_id).first()
    if resignation and resignation.resignation_date:
        noc_date = resignation.resignation_date
    noc = Noc(admin_id=admin_id, noc_date=noc_date, status="Pending")
    db.session.add(noc)
    db.session.commit()
    return jsonify({
        "success": True,
        "message": "NOC record created",
        "noc": {"id": noc.id, "admin_id": noc.admin_id, "noc_date": noc.noc_date.isoformat(), "status": noc.status},
    }), 201


@hr.route("/leave-accrual/summary", methods=["GET"])
@jwt_required()
@hr_required
def leave_accrual_summary():
    """Quick monitoring endpoint for latest leave accrual runs."""
    latest_run_date = db.session.query(db.func.max(LeaveAccrualLog.run_date)).scalar()
    if not latest_run_date:
        return jsonify(
            {
                "success": True,
                "latest_run_date": None,
                "latest_run": {
                    "events_total": 0,
                    "admins_affected": 0,
                    "pl_credits": 0,
                    "cl_credits": 0,
                    "year_resets": 0,
                },
                "recent_runs": [],
            }
        ), 200

    run_limit = request.args.get("limit", type=int) or 7
    run_limit = max(1, min(run_limit, 31))

    def _run_stats_for_date(run_date):
        events_total = (
            db.session.query(db.func.count(LeaveAccrualLog.id))
            .filter(LeaveAccrualLog.run_date == run_date)
            .scalar()
            or 0
        )
        admins_affected = (
            db.session.query(db.func.count(db.distinct(LeaveAccrualLog.admin_id)))
            .filter(LeaveAccrualLog.run_date == run_date)
            .scalar()
            or 0
        )
        pl_credits = (
            db.session.query(db.func.count(LeaveAccrualLog.id))
            .filter(
                LeaveAccrualLog.run_date == run_date,
                LeaveAccrualLog.event_key.like("PL%"),
            )
            .scalar()
            or 0
        )
        cl_credits = (
            db.session.query(db.func.count(LeaveAccrualLog.id))
            .filter(
                LeaveAccrualLog.run_date == run_date,
                LeaveAccrualLog.event_key.like("CL%"),
            )
            .scalar()
            or 0
        )
        year_resets = (
            db.session.query(db.func.count(LeaveAccrualLog.id))
            .filter(
                LeaveAccrualLog.run_date == run_date,
                LeaveAccrualLog.event_key.like("YEAR_RESET%"),
            )
            .scalar()
            or 0
        )
        return {
            "run_date": run_date.isoformat(),
            "events_total": int(events_total),
            "admins_affected": int(admins_affected),
            "pl_credits": int(pl_credits),
            "cl_credits": int(cl_credits),
            "year_resets": int(year_resets),
        }

    recent_run_dates = (
        db.session.query(LeaveAccrualLog.run_date)
        .distinct()
        .order_by(LeaveAccrualLog.run_date.desc())
        .limit(run_limit)
        .all()
    )
    recent_runs = [_run_stats_for_date(row[0]) for row in recent_run_dates if row and row[0]]

    return jsonify(
        {
            "success": True,
            "latest_run_date": latest_run_date.isoformat(),
            "latest_run": _run_stats_for_date(latest_run_date),
            "recent_runs": recent_runs,
        }
    ), 200


@hr.route("/noc/upload", methods=["POST"])
@jwt_required()
@hr_required
def upload_noc():
    """Upload NOC document. Auto-creates Noc record if employee has Resignation but no Noc yet."""
    admin_id = request.form.get("admin_id")
    if not admin_id:
        return jsonify({"success": False, "message": "admin_id is required"}), 400
    admin = Admin.query.get(admin_id)
    if not admin:
        return jsonify({"success": False, "message": "Employee not found"}), 404
    file = request.files.get("file")
    if not file or not file.filename:
        return jsonify({"success": False, "message": "No file provided"}), 400
    noc = Noc.query.filter_by(admin_id=admin_id).order_by(Noc.noc_date.desc()).first()
    if not noc:
        resignation = Resignation.query.filter_by(admin_id=admin_id).first()
        noc_date = resignation.resignation_date if resignation and resignation.resignation_date else date.today()
        noc = Noc(admin_id=admin_id, noc_date=noc_date, status="Pending")
        db.session.add(noc)
        db.session.flush()
    claims = get_jwt()
    emp_type = claims.get("emp_type") or "Human Resource"
    upload_dir = os.path.join(current_app.root_path, "static", "uploads", "noc")
    os.makedirs(upload_dir, exist_ok=True)
    filename = secure_filename(f"{admin.emp_id}_{datetime.now().strftime('%Y%m%d_%H%M%S')}_{file.filename}")
    file_path = os.path.join(upload_dir, filename)
    file.save(file_path)
    rel_path = f"noc/{filename}"
    noc_upload = Noc_Upload(admin_id=admin_id, file_path=rel_path, emp_type_uploader=emp_type)
    db.session.add(noc_upload)
    noc.status = "Uploaded"
    db.session.commit()
    return jsonify({"success": True, "message": "NOC file uploaded successfully"}), 201


@hr.route("/noc-requests", methods=["GET"])
@jwt_required()
@hr_required
def hr_list_noc_department_requests():
    """HR panel — only Human Resource department_key rows."""
    admin = Admin.query.filter_by(email=get_jwt().get("email")).first()
    if not admin:
        return jsonify({"success": False, "message": "Employee not found"}), 404
    status_raw = (request.args.get("status") or "All").strip()
    items = list_noc_requests("hr", admin, status_raw)
    return jsonify({"success": True, "requests": items}), 200


@hr.route("/noc-requests/<int:req_id>/upload", methods=["POST"])
@jwt_required()
@hr_required
def hr_upload_noc_department_document(req_id):
    admin = Admin.query.filter_by(email=get_jwt().get("email")).first()
    if not admin:
        return jsonify({"success": False, "message": "Employee not found"}), 404
    file = request.files.get("file")
    out = upload_noc_document("hr", admin, req_id, file)
    code = out.pop("http", 200)
    return jsonify({k: v for k, v in out.items()}), code


@hr.route("/noc-requests/<int:req_id>/download", methods=["GET"])
@jwt_required()
@hr_required
def hr_download_noc_department_document(req_id):
    admin = Admin.query.filter_by(email=get_jwt().get("email")).first()
    if not admin:
        return jsonify({"success": False, "message": "Employee not found"}), 404
    out = download_noc_document("hr", admin, req_id)
    if not out.get("success"):
        return jsonify({"success": False, "message": out.get("message", "Error")}), out.get("http", 400)
    return send_file(
        out["path"],
        as_attachment=True,
        download_name=out["download_name"],
        mimetype="application/octet-stream",
    )


@hr.route("/employee/search", methods=["GET"])
@jwt_required()
@hr_required
def search_employee_api():
    emp_type = request.args.get("emp_type")
    circle = request.args.get("circle")

    if not emp_type or not circle:
        return jsonify({
            "success": False,
            "message": "emp_type and circle are required"
        }), 400

    employees = (
        Admin.query.filter(
            Admin.emp_type == emp_type,
            Admin.circle == circle,
            # Treat NULL as legacy-active/non-exited; exclude explicitly inactive or exited employees.
            or_(Admin.is_active == True, Admin.is_active.is_(None)),
            or_(Admin.is_exited == False, Admin.is_exited.is_(None))
        ).all()
    )

    return jsonify({
        "success": True,
        "count": len(employees),
        "employees": [
            {
                "id": e.id,
                "email": e.email,
                "user_name": e.user_name,
                "first_name": e.first_name,
                "emp_id": e.emp_id,
                "mobile": e.mobile,
                "doj": e.doj.isoformat() if e.doj else None,
                "circle": e.circle,
                "emp_type": e.emp_type
            }
            for e in employees
        ]
    }), 200


@hr.route("/employee/by-email/<path:email_path>", methods=["GET"])
@jwt_required()
@hr_required
def get_employee_api(email_path):
    """Get Admin (employee) by email. Uses path so URL-encoded @ and dots are preserved."""
    email = unquote(email_path).strip()
    admin = Admin.query.filter(
        Admin.email == email,
        # Treat NULL as not-exited (older rows may have NULL in is_exited)
        or_(Admin.is_exited == False, Admin.is_exited.is_(None))
    ).first()

    if not admin:
        return jsonify({
            "success": False,
            "message": "Employee not found"
        }), 404

    return jsonify({
        "success": True,
        "employee": {
            "email": admin.email,
            "user_name": admin.user_name,
            "first_name": admin.first_name,
            "emp_id": admin.emp_id,
            "mobile": admin.mobile,
            "doj": admin.doj.isoformat() if admin.doj else None,
            "circle": admin.circle,
            "emp_type": admin.emp_type
        }
    }), 200


@hr.route("/employee/by-email/<path:email_path>", methods=["PUT"], endpoint="hr_update_employee")
@jwt_required()
@hr_required
def update_employee_api(email_path):
    """Update Admin (employee) by email."""
    email = unquote(email_path).strip()
    admin = Admin.query.filter(
        Admin.email == email,
        # Treat NULL as not-exited (older rows may have NULL in is_exited)
        or_(Admin.is_exited == False, Admin.is_exited.is_(None))
    ).first()

    if not admin:
        return jsonify({
            "success": False,
            "message": "Employee not found"
        }), 404

    data = request.get_json() or {}
    if not data:
        return jsonify({
            "success": False,
            "message": "No fields to update"
        }), 400

    if "emp_type" in data:
        proposed_emp_type = str(data.get("emp_type") or "").strip()
        if not proposed_emp_type or not _is_allowed_master_value(MASTER_TYPE_DEPARTMENT, proposed_emp_type):
            return jsonify({
                "success": False,
                "message": "Invalid employee type. Please select a configured department."
            }), 400
        admin.emp_type = proposed_emp_type[:50]

    if "circle" in data:
        proposed_circle = str(data.get("circle") or "").strip()
        if not proposed_circle or not _is_allowed_master_value(MASTER_TYPE_CIRCLE, proposed_circle):
            return jsonify({
                "success": False,
                "message": "Invalid circle. Please select a configured circle."
            }), 400
        old_circle = (admin.circle or "").strip()
        if _norm_circle_name(old_circle) != _norm_circle_name(proposed_circle):
            eff_raw = data.get("circle_effective_from")
            if not eff_raw:
                return jsonify({
                    "success": False,
                    "message": "circle_effective_from is required when changing circle (YYYY-MM-DD).",
                }), 400
            try:
                effective_from = datetime.fromisoformat(str(eff_raw).strip()[:10]).date()
            except (ValueError, TypeError):
                return jsonify({
                    "success": False,
                    "message": "Invalid circle_effective_from (YYYY-MM-DD)",
                }), 400
            hr_email = (get_jwt() or {}).get("email") or "unknown"
            ok, err = _apply_circle_transfer(
                admin,
                proposed_circle,
                effective_from,
                hr_email,
                data.get("circle_transfer_notes"),
            )
            if not ok:
                return jsonify({"success": False, "message": err}), 400
        else:
            admin.circle = proposed_circle[:50]

    if "user_name" in data:
        val = str(data.get("user_name") or "").strip()
        if val:
            admin.user_name = val[:120]

    if "first_name" in data:
        val = str(data.get("first_name") or "").strip()
        if val:
            admin.first_name = val[:150]

    if "emp_id" in data:
        val = str(data.get("emp_id") or "").strip()
        if val:
            admin.emp_id = val[:10]

    if "mobile" in data:
        val = str(data.get("mobile") or "").strip().replace(" ", "")[:15]
        if val:
            if len(val) != 10 or not val.isdigit():
                return jsonify({
                    "success": False,
                    "message": "Mobile number must be exactly 10 digits."
                }), 400
            admin.mobile = val

    if "doj" in data and data.get("doj"):
        try:
            admin.doj = datetime.fromisoformat(str(data["doj"]).strip()[:10]).date()
        except (ValueError, TypeError):
            return jsonify({
                "success": False,
                "message": "Invalid DOJ format (YYYY-MM-DD)"
            }), 400

    if data.get("password"):
        admin.set_password(data["password"])

    db.session.commit()

    return jsonify({
        "success": True,
        "message": "Employee record updated successfully"
    }), 200


@hr.route("/circle-transfers", methods=["GET"])
@jwt_required()
@hr_required
def list_circle_transfers():
    """HR: list circle transfer history (optional filters)."""
    circle = (request.args.get("circle") or "").strip()
    q = (request.args.get("q") or "").strip()
    from_eff = (request.args.get("effective_from") or "").strip()
    to_eff = (request.args.get("effective_to") or "").strip()

    query = EmployeeCircleHistory.query.options(joinedload(EmployeeCircleHistory.admin))
    needs_admin_join = bool(q) or (circle and circle.lower() != "all")
    if needs_admin_join:
        query = query.join(Admin, EmployeeCircleHistory.admin_id == Admin.id)
    if circle and circle.lower() != "all":
        query = query.filter(
            or_(
                db.func.lower(EmployeeCircleHistory.from_circle) == circle.lower(),
                db.func.lower(EmployeeCircleHistory.to_circle) == circle.lower(),
            )
        )
    if q:
        like = f"%{q.lower()}%"
        query = query.filter(
            or_(
                db.func.lower(Admin.first_name).like(like),
                db.func.lower(Admin.email).like(like),
                db.func.lower(db.func.coalesce(Admin.emp_id, "")).like(like),
            )
        )
    if from_eff:
        try:
            query = query.filter(EmployeeCircleHistory.effective_from >= datetime.fromisoformat(from_eff[:10]).date())
        except ValueError:
            return jsonify({"success": False, "message": "Invalid effective_from date"}), 400
    if to_eff:
        try:
            query = query.filter(EmployeeCircleHistory.effective_from <= datetime.fromisoformat(to_eff[:10]).date())
        except ValueError:
            return jsonify({"success": False, "message": "Invalid effective_to date"}), 400

    rows = query.order_by(EmployeeCircleHistory.effective_from.desc(), EmployeeCircleHistory.id.desc()).limit(500).all()
    return jsonify({
        "success": True,
        "count": len(rows),
        "transfers": [_serialize_circle_history_row(r) for r in rows],
    }), 200


@hr.route("/employee/by-email/<path:email_path>/circle-history", methods=["GET"])
@jwt_required()
@hr_required
def get_employee_circle_history(email_path):
    email = unquote(email_path).strip()
    admin = Admin.query.filter(
        Admin.email == email,
        or_(Admin.is_exited == False, Admin.is_exited.is_(None)),
    ).first()
    if not admin:
        return jsonify({"success": False, "message": "Employee not found"}), 404
    rows = (
        EmployeeCircleHistory.query.filter_by(admin_id=admin.id)
        .order_by(EmployeeCircleHistory.effective_from.desc(), EmployeeCircleHistory.id.desc())
        .all()
    )
    return jsonify({
        "success": True,
        "employee": {
            "email": admin.email,
            "emp_id": admin.emp_id,
            "first_name": admin.first_name,
            "current_circle": admin.circle,
        },
        "history": [_serialize_circle_history_row(r, admin) for r in rows],
    }), 200


# --------------------------------------------------
# Ex-employee document sharing (time-limited link, no login)
# --------------------------------------------------
@hr.route("/ex-employee-documents/send", methods=["POST"])
@jwt_required()
@hr_required
def send_ex_employee_documents():
    recipient_email = (request.form.get("recipient_email") or request.form.get("email") or "").strip()
    if not recipient_email or "@" not in recipient_email:
        return jsonify({"success": False, "message": "A valid recipient email is required"}), 400

    display_names_raw = request.form.get("display_names") or "[]"
    try:
        display_names = json.loads(display_names_raw)
    except json.JSONDecodeError:
        return jsonify({"success": False, "message": "Invalid display_names (expect JSON array)"}), 400

    if not isinstance(display_names, list) or len(display_names) == 0:
        return jsonify({"success": False, "message": "At least one file with a display name is required"}), 400

    uploaded = request.files.getlist("files")
    if not uploaded or len(uploaded) == 0:
        return jsonify({"success": False, "message": "At least one file is required"}), 400
    if len(display_names) != len(uploaded):
        return jsonify({"success": False, "message": "Each file must have a matching display name"}), 400

    for i, name in enumerate(display_names):
        dn = str(name or "").strip()
        if not dn:
            dn = secure_filename((uploaded[i].filename or f"file_{i + 1}")) or f"document_{i + 1}"
        if len(dn) > 240:
            dn = dn[:240]
        display_names[i] = dn

    raw_token = secrets.token_urlsafe(32)
    token_hash = _hash_ex_employee_token(raw_token)
    expires_at = datetime.utcnow() + timedelta(hours=EX_EMPLOYEE_LINK_TTL_HOURS)

    created_by = None
    try:
        created_by = int(get_jwt_identity())
    except (TypeError, ValueError):
        created_by = None

    share = ExEmployeeDocShare(
        token_hash=token_hash,
        recipient_email=recipient_email,
        expires_at=expires_at,
        created_by_admin_id=created_by,
    )
    db.session.add(share)
    db.session.flush()

    upload_root = _ex_employee_uploads_base_dir()
    share_dir = os.path.join(upload_root, str(share.id))
    os.makedirs(share_dir, exist_ok=True)

    try:
        for idx, file_storage in enumerate(uploaded):
            if not file_storage or not file_storage.filename:
                raise ValueError("Empty file upload")
            orig_name = secure_filename(file_storage.filename) or f"file_{idx + 1}"
            disk_name = f"{uuid.uuid4().hex}_{orig_name}"
            rel_path = os.path.join("ex_employee_docs", str(share.id), disk_name).replace("\\", "/")
            abs_path = os.path.join(share_dir, disk_name)
            file_storage.save(abs_path)
            db.session.add(
                ExEmployeeDocFile(
                    share_id=share.id,
                    display_name=display_names[idx],
                    stored_rel_path=rel_path,
                )
            )
        db.session.commit()
    except Exception as e:
        db.session.rollback()
        current_app.logger.exception("ex-employee document upload failed: %s", e)
        try:
            if os.path.isdir(share_dir):
                for fn in os.listdir(share_dir):
                    try:
                        os.remove(os.path.join(share_dir, fn))
                    except OSError:
                        pass
                os.rmdir(share_dir)
        except OSError:
            pass
        return jsonify({"success": False, "message": "Failed to store files. Please try again."}), 500

    base_url = current_app.config.get("BASE_URL", "").rstrip("/")
    doc_link = f"{base_url}/ex-employee-documents?t={raw_token}"

    email_ok, email_msg = send_ex_employee_documents_email(
        recipient_email=recipient_email,
        doc_link=doc_link,
        document_names=list(display_names),
        valid_hours=EX_EMPLOYEE_LINK_TTL_HOURS,
    )

    if not email_ok:
        _delete_ex_share_and_files(share)
        return jsonify(
            {
                "success": False,
                "message": email_msg or "Email could not be sent. Nothing was saved.",
            }
        ), 502

    return jsonify(
        {
            "success": True,
            "message": f"Documents sent. The recipient has {EX_EMPLOYEE_LINK_TTL_HOURS} hours to download using the email link.",
            "expires_at": expires_at.isoformat() + "Z",
        }
    ), 201


@hr.route("/ex-employee-documents/public/<path:token>", methods=["GET"])
def ex_employee_documents_public_info(token):
    """Public: list files for a valid, unexpired token (no auth)."""
    token = (token or "").strip()
    if not token:
        return jsonify({"success": False, "message": "Invalid link", "expired": False}), 400
    th = _hash_ex_employee_token(token)
    share = ExEmployeeDocShare.query.filter_by(token_hash=th).first()
    if not share:
        return jsonify({"success": False, "message": "Invalid or expired link", "expired": True}), 404
    if datetime.utcnow() > share.expires_at:
        return jsonify(
            {
                "success": False,
                "message": "This download link has expired. Please contact HR for a new link.",
                "expired": True,
            }
        ), 410

    files = [
        {"id": f.id, "display_name": f.display_name}
        for f in sorted(share.files or [], key=lambda x: x.id)
    ]
    return jsonify(
        {
            "success": True,
            "expired": False,
            "expires_at": share.expires_at.isoformat() + "Z",
            "files": files,
        }
    ), 200


@hr.route("/ex-employee-documents/public/<path:token>/download/<int:file_id>", methods=["GET"])
def ex_employee_documents_public_download(token, file_id):
    """Public: download one file (no auth)."""
    token = (token or "").strip()
    if not token:
        return jsonify({"success": False, "message": "Invalid link"}), 400
    th = _hash_ex_employee_token(token)
    share = ExEmployeeDocShare.query.filter_by(token_hash=th).first()
    if not share:
        return jsonify({"success": False, "message": "Invalid or expired link"}), 404
    if datetime.utcnow() > share.expires_at:
        return jsonify({"success": False, "message": "This link has expired"}), 410

    doc_file = ExEmployeeDocFile.query.filter_by(id=file_id, share_id=share.id).first()
    if not doc_file:
        return jsonify({"success": False, "message": "File not found"}), 404

    abs_path = _abs_path_from_rel(doc_file.stored_rel_path)
    if not os.path.isfile(abs_path):
        return jsonify({"success": False, "message": "File missing on server"}), 404

    mime, _ = mimetypes.guess_type(doc_file.display_name)
    return send_file(
        abs_path,
        mimetype=mime or "application/octet-stream",
        as_attachment=True,
        download_name=doc_file.display_name,
    )


@hr.route("/ex-employee-documents/history", methods=["GET"])
@jwt_required()
@hr_required
def ex_employee_documents_history():
    limit_raw = request.args.get("limit", 100)
    try:
        limit = int(limit_raw)
    except (TypeError, ValueError):
        limit = 100
    if limit < 1:
        limit = 1
    if limit > 500:
        limit = 500

    now = datetime.utcnow()
    shares = (
        ExEmployeeDocShare.query.order_by(ExEmployeeDocShare.created_at.desc(), ExEmployeeDocShare.id.desc())
        .limit(limit)
        .all()
    )

    items = []
    for share in shares:
        files = sorted(share.files or [], key=lambda f: f.id)
        items.append(
            {
                "share_id": share.id,
                "recipient_email": share.recipient_email,
                "created_at": share.created_at.isoformat() + "Z" if share.created_at else None,
                "expires_at": share.expires_at.isoformat() + "Z" if share.expires_at else None,
                "is_expired": bool(share.expires_at and now > share.expires_at),
                "document_count": len(files),
                "documents": [{"id": f.id, "display_name": f.display_name} for f in files],
            }
        )

    return jsonify({"success": True, "history": items}), 200

