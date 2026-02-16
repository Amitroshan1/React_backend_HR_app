# signup_api,reset_password, hr_dashboard_api, mark_employee_exit,employee_archive_list,
# get_archived_employee_profile,search_employees,
# download_excel_hr_api, display_details_api,get_employee
# assign_asset, update_asset_api, search_employee_api,
# get_employee_api, update_employee_api, delete_employee_api
# Employee_exit,list_employee_archive


#https://solviotec.com/api/HumanResource


from flask import Blueprint, request, current_app, jsonify,json
from flask_jwt_extended import jwt_required, get_jwt
from .email import send_email_via_zeptomail,send_welcome_email
from .models.Admin_models import Admin,EmployeeArchive,AuditLog
from datetime import datetime,date,timedelta
from zoneinfo import ZoneInfo
import calendar
from flask_login import current_user
from .email import update_asset_email,send_asset_assigned_email,send_password_set_email
from .utility import generate_attendance_excel,send_excel_file,calculate_month_summary
from .models.emp_detail_models import Employee,Asset
from .models.family_models import FamilyDetails
from .models.prev_com import PreviousCompany
from .models.education import UploadDoc, Education
from .models.attendance import Punch, LeaveApplication, LeaveBalance, Location
from .models.news_feed import NewsFeed
from .models.seperation import Noc, Noc_Upload, Resignation
from .models.master_data import MasterData
from .models.leave_accrual_log import LeaveAccrualLog
from .models.holiday_calendar import HolidayCalendar
from werkzeug.security import generate_password_hash
import os
from urllib.parse import unquote
from . import db
from werkzeug.utils import secure_filename

hr = Blueprint('HumanResource', __name__)


from functools import wraps
from flask_jwt_extended import get_jwt, jwt_required
from flask import jsonify

def hr_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        claims = get_jwt()
        if claims.get("emp_type") != "Human Resource":
            return jsonify({
                "success": False,
                "message": "HR access required"
            }), 403
        return fn(*args, **kwargs)
    return wrapper


MASTER_TYPE_DEPARTMENT = "department"
MASTER_TYPE_CIRCLE = "circle"
MASTER_TYPES = {MASTER_TYPE_DEPARTMENT, MASTER_TYPE_CIRCLE}

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
        admin = Admin.query.filter_by(email=email).first()

        # ======================================================
        # CASE 1: Existing user (OAuth / partial record)
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
            admin.circle = circle
            admin.is_active = True
            admin.is_exited = False

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

            # Initialize leave balance
            leave_balance = LeaveBalance(
                admin_id=admin.id,
                privilege_leave_balance=0.0,
                casual_leave_balance=0.0,
                compensatory_leave_balance=0.0
            )
            db.session.add(leave_balance)

            action = "CREATE_NEW_EMPLOYEE"

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


@hr.route("/reset-password", methods=["POST"])
@jwt_required()
def reset_password():

    user = current_user
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

    # 1️⃣ Work Anniversaries (Admin DOJ)
    employees_with_anniversaries = Admin.query.filter(
        db.extract("month", Admin.doj) == current_month,
        db.extract("day", Admin.doj) == current_day
    ).all()

    # 2️⃣ Birthdays (Employee DOB)
    employees_with_birthdays = Employee.query.filter(
        db.extract("month", Employee.dob) == current_month,
        db.extract("day", Employee.dob) == current_day
    ).all()

    # 3️⃣ Total Employees
    total_employees = Admin.query.count()

    # 4️⃣ New Joinees (last 30 days)
    thirty_days_ago = today - timedelta(days=30)
    new_joinees_count = Admin.query.filter(
        Admin.doj >= thirty_days_ago
    ).count()

    # 5️⃣ Today's Punch-in Count
    today_punch_count = Punch.query.filter(
        Punch.punch_date == today,
        Punch.punch_in.isnot(None)
    ).count()

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
            "new_joinees_last_30_days": new_joinees_count,
            "today_punch_in_count": today_punch_count
        },
        "anniversaries": anniversaries_list,
        "birthdays": birthdays_list
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

    q = Admin.query.filter(
        db.func.coalesce(Admin.is_exited, False) == False,
    )

    if emp_type:
        q = q.filter(db.func.lower(db.func.coalesce(Admin.emp_type, "")) == emp_type.lower())
    if circle:
        q = q.filter(db.func.lower(db.func.coalesce(Admin.circle, "")) == circle.lower())
    if email:
        q = q.filter(db.func.lower(db.func.coalesce(Admin.email, "")) == email)

    rows = q.order_by(Admin.first_name.asc(), Admin.id.asc()).all()

    return jsonify(
        {
            "success": True,
            "count": len(rows),
            "employees": [
                {
                    "id": row.id,
                    "emp_id": row.emp_id,
                    "name": row.first_name,
                    "email": row.email,
                    "circle": row.circle,
                    "emp_type": row.emp_type,
                }
                for row in rows
            ],
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
        # MARK EXIT
        # --------------------------------------------------
        admin.is_active = False
        admin.is_exited = True
        admin.exit_date = exit_date
        admin.exit_type = exit_type
        admin.exit_reason = exit_reason

        # --------------------------------------------------
        # AUDIT LOG
        # --------------------------------------------------
        hr_email = get_jwt().get("email")

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
    


@hr.route("/employee-archive", methods=["GET"])
@jwt_required()
@hr_required
def employee_archive_list():
    """
    Returns list of exited employees (archive)
    HR only
    """

    try:
        exited_employees = (
            Admin.query
            .filter(Admin.is_exited == True)
            .order_by(
                db.case((Admin.exit_date.is_(None), 1), else_=0),
                Admin.exit_date.desc()
            )
            .all()
        )

        employees = []
        for emp in exited_employees:
            employees.append({
                "admin_id": emp.id,
                "name": emp.first_name,
                "email": emp.email,
                "mobile": emp.mobile,
                "emp_id": emp.emp_id,
                "circle": emp.circle,
                "emp_type": emp.emp_type,
                "exit_date": emp.exit_date.isoformat() if emp.exit_date else None,
                "exit_type": emp.exit_type
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





@hr.route("/archive/employee/<int:employee_id>", methods=["GET"])
@jwt_required()
@hr_required
def get_archived_employee_profile(employee_id):

    admin = Admin.query.get(employee_id)

    if not admin or not admin.is_exited:
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

    # ---------------- DOCUMENTS ----------------
    documents = [{
        "doc_type": d.doc_type,
        "file": d.file_path,
        "uploaded_at": d.created_at.isoformat()
    } for d in admin.document_details]

    # ---------------- EDUCATION ----------------
    education = [{
        "degree": e.degree,
        "institute": e.institute,
        "year": e.year
    } for e in admin.education_details]

    # ---------------- LEAVES ----------------
    leaves = [{
        "type": l.leave_type,
        "start": l.start_date.isoformat(),
        "end": l.end_date.isoformat(),
        "status": l.status
    } for l in admin.leave_applications]

    # ---------------- ASSETS ----------------
    assets = [{
        "asset_name": a.asset_name,
        "assigned_date": a.assigned_date.isoformat() if a.assigned_date else None
    } for a in admin.assets]

    # ---------------- PERFORMANCE ----------------
    performance = [{
        "id": p.id,
        "month": p.month,
        "achievements": p.achievements,
        "challenges": p.challenges,
        "goals_next_month": p.goals_next_month,
        "suggestion_improvement": p.suggestion_improvement,
        "status": p.status,
        "submitted_at": p.submitted_at.isoformat() if p.submitted_at else None,
        "review": {
            "manager_id": p.review.manager_id,
            "rating": p.review.rating,
            "comments": p.review.comments,
            "reviewed_at": p.review.reviewed_at.isoformat() if p.review.reviewed_at else None
        } if getattr(p, "review", None) else None
    } for p in admin.performances]

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

    admins = Admin.query.filter_by(
        circle=circle,
        emp_type=emp_type
    ).all()

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

    # Step 1: Fetch employees directly from Admin
    admins = Admin.query.filter_by(
        circle=circle,
        emp_type=emp_type
    ).all()

    if not admins:
        return jsonify({
            "success": False,
            "message": "No employees found"
        }), 404

    # Step 2: Resolve month
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

        punches = Punch.query.filter(
            Punch.admin_id == user_id,
            Punch.punch_date.between(month_start, month_end)
        ).all()

        leaves = LeaveApplication.query.filter(
            LeaveApplication.admin_id == user_id,
            LeaveApplication.status == "Approved",
            LeaveApplication.start_date <= month_end,
            LeaveApplication.end_date >= month_start
        ).all()

        punch_map = {p.punch_date: p for p in punches}

        attendance = []
        for d in range(1, num_days + 1):
            current_day = date(year, month, d)
            punch = punch_map.get(current_day)

            attendance.append({
                "date": current_day.isoformat(),
                "punch_in": punch.punch_in.strftime("%H:%M:%S") if punch and punch.punch_in else "",
                "punch_out": punch.punch_out.strftime("%H:%M:%S") if punch and punch.punch_out else "",
                "is_wfh": bool(getattr(punch, "is_wfh", False)) if punch else False,
                "today_work": str(punch.today_work) if punch and punch.today_work else "",
                "on_leave": any(
                    lv.start_date <= current_day <= lv.end_date for lv in leaves
                )
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

    if punch.punch_in and punch.punch_out:
        start = punch.punch_in
        end = punch.punch_out
        diff = end - start
        total_seconds = int(diff.total_seconds())
        if total_seconds < 0:
            total_seconds += 24 * 3600
        h, r = divmod(total_seconds, 3600)
        m, s = divmod(r, 60)
        punch.today_work = f"{h:02d}:{m:02d}:{s:02d}"

    try:
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
    admin = Admin.query.filter_by(emp_id=emp_id).first()

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


# --------------------------------------------------
# CONFIRMATION REQUESTS (new joinees needing confirmation)
# --------------------------------------------------
@hr.route("/confirmation-requests", methods=["GET"])
@jwt_required()
@hr_required
def list_confirmation_requests():
    """Return employees who joined in last 6 months (confirmation candidates)."""
    cutoff = date.today() - timedelta(days=180)
    employees = Admin.query.filter(
        Admin.doj >= cutoff,
        Admin.is_exited == False,
        Admin.is_active == True,
    ).order_by(Admin.doj.desc()).all()
    result = [
        {
            "id": a.id,
            "name": a.first_name,
            "emp_id": a.emp_id,
            "email": a.email,
            "doj": a.doj.isoformat() if a.doj else None,
            "circle": a.circle,
            "emp_type": a.emp_type,
        }
        for a in employees
    ]
    return jsonify({"success": True, "requests": result}), 200


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

    employees = Admin.query.filter_by(
        emp_type=emp_type,
        circle=circle
    ).all()

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
    admin = Admin.query.filter_by(email=email).first()

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
    admin = Admin.query.filter_by(email=email).first()

    if not admin:
        return jsonify({
            "success": False,
            "message": "Employee not found"
        }), 404

    data = request.get_json() or {}

    if "emp_type" in data:
        proposed_emp_type = str(data.get("emp_type") or "").strip()
        if not proposed_emp_type or not _is_allowed_master_value(MASTER_TYPE_DEPARTMENT, proposed_emp_type):
            return jsonify({
                "success": False,
                "message": "Invalid employee type. Please select a configured department."
            }), 400

    if "circle" in data:
        proposed_circle = str(data.get("circle") or "").strip()
        if not proposed_circle or not _is_allowed_master_value(MASTER_TYPE_CIRCLE, proposed_circle):
            return jsonify({
                "success": False,
                "message": "Invalid circle. Please select a configured circle."
            }), 400

    admin.user_name = data.get("user_name", admin.user_name)
    admin.first_name = data.get("first_name", admin.first_name)
    admin.emp_id = data.get("emp_id", admin.emp_id)
    admin.mobile = data.get("mobile", admin.mobile)
    admin.circle = data.get("circle", admin.circle)
    admin.emp_type = data.get("emp_type", admin.emp_type)

    if "doj" in data:
        admin.doj = datetime.fromisoformat(data["doj"]).date()

    if data.get("password"):
        admin.set_password(data["password"])

    db.session.commit()

    return jsonify({
        "success": True,
        "message": "Employee record updated successfully"
    }), 200


