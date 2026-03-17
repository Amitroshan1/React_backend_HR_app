# save_upload_docs,create_or_update_education,create_or_update_employee,
# punch_out,punch_in,employee_homepage,validate_user



#https://solviotec.com/api/auth


import os
import re
from math import radians, cos, sin, atan2, sqrt
from werkzeug.utils import secure_filename
from flask import Blueprint, request, redirect, url_for, current_app, jsonify
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from .email import send_login_alert_email
from .models.Admin_models import Admin
from . import db
from .models.emp_detail_models import Employee
from .models.attendance import Punch, Location, LeaveBalance, LeaveApplication
from .compoff_utils import get_effective_comp_balance
from .models.manager_model import ManagerContact
from .models.news_feed import NewsFeed, PaySlip
from .models.query import Query
from .models.education import Education, UploadDoc
from .models.prev_com import PreviousCompany
from .models.master_data import MasterData
from datetime import datetime, time, date, timedelta
from flask_jwt_extended import create_access_token, get_jwt_identity, get_jwt, jwt_required
import logging
from flask_jwt_extended import jwt_required, get_jwt_identity, get_jwt
from flask import jsonify
from .utility import is_wfh_allowed, is_on_leave

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
    return jsonify({
        "success": True,
        "departments": [r.name for r in dept_rows],
        "circles": [r.name for r in circle_rows],
    }), 200


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
    if not admin.password_reset_expiry or admin.password_reset_expiry < datetime.utcnow():
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


    return jsonify({
        "success": True,
        "token": access_token
    }), 200


def _safe_doj(admin):
    """Return admin.doj as string for JSON; None-safe."""
    d = getattr(admin, "doj", None)
    if d is None:
        return None
    return d.isoformat() if hasattr(d, "isoformat") else str(d)


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
    # 3. TODAY PUNCH
    # ------------------------
    today = date.today()
    punch = Punch.query.filter_by(
        admin_id=admin.id,
        punch_date=today
    ).first()

    working_hours = None
    if punch and punch.punch_in:
        try:
            end_time = punch.punch_out or datetime.now()
            punch_in_dt = punch.punch_in
            if isinstance(punch.punch_in, time):
                punch_in_dt = datetime.combine(today, punch.punch_in)
            elif not isinstance(punch.punch_in, datetime):
                punch_in_dt = datetime.combine(today, punch.punch_in) if hasattr(punch.punch_in, 'hour') else punch.punch_in
            diff = end_time - punch_in_dt
            calculated = str(diff).split(".")[0]
            normalized = _normalize_working_hours(punch.today_work) if punch.today_work else None
            working_hours = normalized if normalized else calculated
        except Exception:
            working_hours = None

    # ------------------------
    # 4. LEAVE BALANCE + USAGE (from LeaveBalance table)
    # ------------------------
    leave_balance = LeaveBalance.query.filter_by(admin_id=admin.id).first()

    # ------------------------
    # 5. MANAGER DETAILS (ManagerContact)
    # Look up by (circle, user_type, user_email). Use stripped + case-insensitive match
    # so DB "NHQ"/"Software Developer" matches admin "nhq"/"software developer".
    # Fall back to group-level (user_email is None or '') if no employee-specific row.
    # ------------------------
    manager_contact = None
    user_circle = (getattr(admin, "circle", None) or "").strip()
    user_emp_type = (getattr(admin, "emp_type", None) or "").strip()
    user_email = (admin.email or "").strip() or None
    if user_circle and user_emp_type:
        circle_lower = user_circle.lower()
        emp_type_lower = user_emp_type.lower()
        if user_email:
            # Try employee-specific row first (exact email; circle/type case-insensitive)
            manager_contact = ManagerContact.query.filter(
                func.lower(ManagerContact.circle_name) == circle_lower,
                func.lower(ManagerContact.user_type) == emp_type_lower,
                ManagerContact.user_email == user_email
            ).first()
        if not manager_contact:
            # Fall back to group-level row (user_email null or empty)
            manager_contact = ManagerContact.query.filter(
                func.lower(ManagerContact.circle_name) == circle_lower,
                func.lower(ManagerContact.user_type) == emp_type_lower,
                (ManagerContact.user_email.is_(None)) | (ManagerContact.user_email == "")
            ).first()

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
    def _punch_iso(p, attr):
        val = getattr(p, attr, None) if p else None
        if val is None:
            return None
        return val.isoformat() if hasattr(val, "isoformat") else str(val)

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
            "punch_in": _punch_iso(punch, "punch_in"),
            "punch_out": _punch_iso(punch, "punch_out"),
            "working_hours": working_hours
        },
        "joining_info": {
            "doj": _safe_doj(admin),
            "years_of_service": years_of_service,
            "is_joining_today": bool(admin.doj and admin.doj == today),
        },
        "leave_balance": {
            "pl": leave_balance.privilege_leave_balance if leave_balance else 0,
            "cl": leave_balance.casual_leave_balance if leave_balance else 0,
            "comp": (get_effective_comp_balance(admin.id) if admin else 0),
            "total_pl": leave_balance.total_privilege_leave if leave_balance else 0,
            "total_cl": leave_balance.total_casual_leave if leave_balance else 0,
            "total_comp": leave_balance.total_compensatory_leave if leave_balance else 0,
            "used_pl": leave_balance.used_privilege_leave if leave_balance else 0,
            "used_cl": leave_balance.used_casual_leave if leave_balance else 0,
            "used_comp": leave_balance.used_comp_leave if leave_balance else 0,
        },
        "managers": managers,
        "last_leave": last_leave_data,
        "last_payslip": last_payslip_data,
    }), 200


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

    # 2. Work anniversaries (Admin.doj) – same circle
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
            items.append({
                "id": f"anniversary-{a.id}",
                "type": "anniversary",
                "title": "Work Anniversary!",
                "content": f"{name} completes {years} year(s) with us today.",
                "file_path": None,
                "created_at": today.isoformat(),
            })

    # 3. Regular news feed posts
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
            "created_at": p.created_at.isoformat() if p.created_at else None,
        }
        for p in posts
    ])
    return jsonify({"success": True, "news_feed": items}), 200


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
        from .manager_utils import get_manager_detail
        circle_lower = (admin.circle or "").strip().lower()
        emp_type_lower = (admin.emp_type or "").strip().lower()
        user_email = (admin.email or "").strip() or None
        if circle_lower and emp_type_lower:
            manager_contact = None
            if user_email:
                manager_contact = ManagerContact.query.filter(
                    func.lower(ManagerContact.circle_name) == circle_lower,
                    func.lower(ManagerContact.user_type) == emp_type_lower,
                    ManagerContact.user_email == user_email
                ).first()
            if not manager_contact:
                manager_contact = ManagerContact.query.filter(
                    func.lower(ManagerContact.circle_name) == circle_lower,
                    func.lower(ManagerContact.user_type) == emp_type_lower,
                    (ManagerContact.user_email.is_(None)) | (ManagerContact.user_email == "")
                ).first()
            if manager_contact:
                l1 = get_manager_detail(manager_contact, "l1")
                reporting_manager_name = (l1.get("name") or "").strip()
    except Exception:
        pass
    education_list = Education.query.filter_by(admin_id=admin.id).all()
    prev_companies = PreviousCompany.query.filter_by(admin_id=admin.id).all()
    upload_doc = UploadDoc.query.filter_by(admin_id=admin.id).first()

    def _date_iso(d):
        return d.isoformat() if d and hasattr(d, 'isoformat') else (str(d) if d else None)

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
            "permanent_district": employee.permanent_district or "",
            "permanent_state": employee.permanent_state or "",
            "present_address_line1": employee.present_address_line1,
            "present_pincode": employee.present_pincode,
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
        profile["documents"] = {
            "aadhaar_front": upload_doc.aadhaar_front,
            "aadhaar_back": upload_doc.aadhaar_back,
            "pan_front": upload_doc.pan_front,
            "pan_back": upload_doc.pan_back,
            "appointment_letter": upload_doc.appointment_letter,
            "passbook_front": upload_doc.passbook_front,
        }

    return jsonify({"success": True, "profile": profile}), 200


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

    employee = Employee.query.filter_by(admin_id=admin.id).first()
    if not employee:
        return jsonify({"success": False, "message": "Employee record not found"}), 404

    if 'photo' not in request.files:
        return jsonify({"success": False, "message": "No photo file provided"}), 400

    photo = request.files['photo']
    if not photo or not photo.filename:
        return jsonify({"success": False, "message": "Invalid photo file"}), 400

    allowed_extensions = {'png', 'jpg', 'jpeg', 'gif', 'webp'}
    ext = photo.filename.rsplit('.', 1)[-1].lower() if '.' in photo.filename else ''
    if ext not in allowed_extensions:
        return jsonify({"success": False, "message": "Invalid file type. Allowed: png, jpg, jpeg, gif, webp"}), 400

    filename = secure_filename(f"profile_{admin.id}_{admin.emp_id or 'emp'}.{ext}")
    upload_dir = os.path.join(current_app.static_folder, "uploads")
    os.makedirs(upload_dir, exist_ok=True)
    photo_path = os.path.join(upload_dir, filename)
    photo.save(photo_path)

    employee.photo_filename = filename
    db.session.commit()

    try:
        photo_url = url_for("static", filename=f"uploads/{filename}", _external=True)
    except Exception:
        photo_url = f"/static/uploads/{filename}"
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

def compute_zone(distance, radius, grace=GEOFENCE_GRACE_METERS):
    if distance is None or radius is None:
        return "NO_GPS"
    if distance <= radius:
        return "INSIDE"
    if distance <= (radius + grace):
        return "NEAR"
    return "OUTSIDE"

def needs_reason_for_zone(zone):
    return zone in ["OUTSIDE", "NO_GPS"]


@auth.route('/employee/location-check', methods=['GET'])
@jwt_required()
def location_check():
    """Check if user's lat/lon is within office range. Used by dashboard for punch-in/out buttons."""
    lat = request.args.get('lat', type=float)
    lon = request.args.get('lon', type=float)
    if lat is None or lon is None:
        return jsonify({
            "success": True,
            "zone": "NO_GPS",
            "in_range": False,
            "distance_meters": None,
            "radius_meters": None,
            "grace_meters": GEOFENCE_GRACE_METERS,
            "requires_reason": True,
            "message": "Location not captured"
        }), 200
    offices = Location.query.all()
    if not offices:
        return jsonify({
            "success": True,
            "zone": "NO_OFFICE_CONFIG",
            "in_range": False,
            "distance_meters": None,
            "radius_meters": None,
            "grace_meters": GEOFENCE_GRACE_METERS,
            "requires_reason": False,
            "message": "Office location not configured"
        }), 200

    # Evaluate all configured locations and pick the best match:
    # - Prefer any office where zone is INSIDE/NEAR (in_range)
    # - Among those, choose the one with smallest distance
    # - If none are INSIDE/NEAR, pick the closest office overall
    best_zone = None
    best_distance = None
    best_radius = None

    for office in offices:
        distance = calculate_distance(lat, lon, office.latitude, office.longitude)
        zone = compute_zone(distance, office.radius)

        if best_zone is None:
            best_zone = zone
            best_distance = distance
            best_radius = office.radius
            continue

        # Prefer INSIDE/NEAR over OUTSIDE/NO_GPS; within same class choose closest
        current_in_range = zone in ["INSIDE", "NEAR"]
        best_in_range = best_zone in ["INSIDE", "NEAR"]

        if current_in_range and not best_in_range:
            best_zone = zone
            best_distance = distance
            best_radius = office.radius
        elif current_in_range == best_in_range and distance < best_distance:
            best_zone = zone
            best_distance = distance
            best_radius = office.radius

    zone = best_zone
    distance = best_distance
    radius = best_radius

    return jsonify({
        "success": True,
        "zone": zone,
        "in_range": zone in ["INSIDE", "NEAR"],
        "distance_meters": int(distance) if distance is not None else None,
        "radius_meters": radius,
        "grace_meters": GEOFENCE_GRACE_METERS,
        "requires_reason": needs_reason_for_zone(zone),
        "message": f"{zone} zone"
    }), 200


@auth.route('/employee/punch-in', methods=['POST'])
@jwt_required()
def punch_in():

    data = request.get_json() or {}

    user_lat = data.get("lat")
    user_lon = data.get("lon")
    is_wfh = bool(data.get("is_wfh", False))
    geo_reason = (data.get("geo_reason") or "").strip()

    # Logged-in user
    email = get_jwt().get("email")
    employee = Admin.query.filter_by(email=email).first()

    if not employee:
        return jsonify({"success": False, "message": "Employee not found"}), 404

    today = date.today()

    # Existing punch
    punch = Punch.query.filter_by(
        admin_id=employee.id,
        punch_date=today
    ).first()

    if punch and punch.punch_in:
        return jsonify({
            "success": False,
            "message": "Already punched in today"
        }), 400

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

    office_location = Location.query.first()
    zone = "NO_GPS"
    distance = None
    if user_lat is not None and user_lon is not None and office_location:
        distance = calculate_distance(
            user_lat, user_lon,
            office_location.latitude,
            office_location.longitude
        )
        zone = compute_zone(distance, office_location.radius)
    elif office_location is None:
        zone = "NO_OFFICE_CONFIG"

    # Allow punch-in even when outside radius (no reason required)
    status_map = {
        "INSIDE": "inside_geofence",
        "NEAR": "inside_geofence",
        "OUTSIDE": "outside_geofence",
        "NO_GPS": "outside_geofence",
        "NO_OFFICE_CONFIG": "office_not_configured"
    }
    location_status = status_map.get(zone, "LOCATION_NOT_CAPTURED")

    # -------- CREATE / UPDATE PUNCH --------
    if not punch:
        punch = Punch(
            admin_id=employee.id,
            punch_date=today
        )

    punch.punch_in = datetime.now()
    punch.lat = user_lat
    punch.lon = user_lon
    punch.is_wfh = is_wfh
    punch.location_status = location_status


    db.session.add(punch)
    db.session.commit()

    punch_in_str = punch.punch_in.isoformat() if hasattr(punch.punch_in, 'isoformat') else str(punch.punch_in)
    return jsonify({
        "success": True,
        "message": "Punched in; pending geo review" if zone in ["OUTSIDE", "NO_GPS"] else "Punched in successfully",
        "punch_in": punch_in_str,
        "is_wfh": is_wfh,
        "zone": zone,
        "location_status": location_status,
        "needs_review": zone in ["OUTSIDE", "NO_GPS"]
    }), 200



@auth.route('/employee/punch-out', methods=['POST'])
@jwt_required()
def punch_out():
    try:
        data = request.get_json() or {}
        
        user_lat = data.get("lat")
        user_lon = data.get("lon")
        geo_reason = (data.get("geo_reason") or "").strip()

        # Get logged-in user email from JWT
        email = get_jwt().get("email")
        employee = Admin.query.filter_by(email=email).first()

        if not employee:
            return jsonify({"success": False, "message": "Employee not found"}), 404

        today = date.today()
        punch = Punch.query.filter_by(admin_id=employee.id, punch_date=today).first()

        if not punch or not punch.punch_in:
            return jsonify({"success": False, "message": "No punch-in found for today"}), 400

        # Allow punch-out again: last punch-out is saved (overwrites previous)
        office_location = Location.query.first()
        zone = "NO_GPS"
        if user_lat is not None and user_lon is not None and office_location:
            distance = calculate_distance(
                user_lat, user_lon,
                office_location.latitude,
                office_location.longitude
            )
            zone = compute_zone(distance, office_location.radius)
        elif office_location is None:
            zone = "NO_OFFICE_CONFIG"

        # Allow punch-out even when outside radius (no reason required)
        status_map = {
            "INSIDE": "inside_geofence",
            "NEAR": "inside_geofence",
            "OUTSIDE": "outside_geofence",
            "NO_GPS": "outside_geofence",
            "NO_OFFICE_CONFIG": "office_not_configured"
        }
        location_status = status_map.get(zone, "LOCATION_NOT_CAPTURED")

        # ✅ UPDATE PUNCH-OUT (allow from any location)
        punch.punch_out = datetime.now()
        punch.lat = user_lat  # Update location on punch-out
        punch.lon = user_lon
        punch.location_status = location_status

        # CALCULATE TOTAL TIME
        if isinstance(punch.punch_in, datetime):
            diff = punch.punch_out - punch.punch_in
        else:
            # If punch_in is time only, combine with date
            punch_in_dt = datetime.combine(today, punch.punch_in) if isinstance(punch.punch_in, time) else punch.punch_in
            diff = punch.punch_out - punch_in_dt
        
        today_work_str = str(diff).split(".")[0]  # "HH:MM:SS"
        punch.today_work = today_work_str

        db.session.commit()

        punch_out_str = punch.punch_out.isoformat() if hasattr(punch.punch_out, 'isoformat') else str(punch.punch_out)
        return jsonify({
            "success": True,
            "message": "Punched out; pending geo review" if zone in ["OUTSIDE", "NO_GPS"] else "Punched out successfully",
            "punch_out": punch_out_str,
            "today_work": today_work_str,
            "zone": zone,
            "location_status": location_status,
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
def create_or_update_employee():
    data = request.get_json()

    if not data:
        return jsonify({"success": False, "message": "Missing JSON body"}), 400

    admin_id = data.get("admin_id")
    if not admin_id:
        return jsonify({"success": False, "message": "admin_id is required"}), 400

    try:
        admin_id = int(admin_id)
    except (TypeError, ValueError):
        return jsonify({"success": False, "message": "admin_id must be an integer"}), 400

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
                "blood_group", "designation",
                "permanent_address_line1", "permanent_pincode",
                "present_address_line1", "present_pincode",
            }
            optional_string_fields = {"mother_name", "emergency_mobile"}
            optional_address_fields = {
                "permanent_district", "permanent_state",
                "present_district", "present_state"
            }

            for field in [
                "name", "email", "father_name", "mother_name", "marital_status",
                "dob", "emp_id", "mobile", "gender", "emergency_mobile",
                "nationality", "blood_group", "designation",
                "permanent_address_line1", "permanent_pincode",
                "permanent_district", "permanent_state",
                "present_address_line1", "present_pincode",
                "present_district", "present_state"
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
        for key in ("permanent_district", "permanent_state", "present_district", "present_state"):
            s = _str(data.get(key))
            if s and len(s) > 100:
                label = "District" if "district" in key else ("State" if "state" in key else "City")
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
            permanent_district=data.get("permanent_district") or None,
            permanent_state=data.get("permanent_state") or None,

            present_address_line1=_str(data.get("present_address_line1")),
            present_pincode=_str(data.get("present_pincode")),
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
def create_or_update_education():
    data = request.get_json()

    if not data:
        return {"success": False, "message": "Missing JSON body"}, 400

    admin_id = data.get("admin_id")
    if not admin_id:
        return {"success": False, "message": "admin_id is required"}, 400

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
            return {"success": True, "message": "Education updated successfully"}, 200

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
        return {"success": True, "message": "Education created successfully"}, 201

    except Exception as e:
        db.session.rollback()
        return {"success": False, "message": str(e)}, 500


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
            com_name = (item.get("companyName") or "").strip() or "-"
            designation = (item.get("designation") or "").strip() or "-"
            dol_str = item.get("dateOfLeaving") or ""
            exp_years = item.get("experienceYears") or ""

            dol = None
            if dol_str:
                try:
                    dol = datetime.strptime(dol_str.split("T")[0], "%Y-%m-%d").date()
                except (ValueError, AttributeError):
                    dol = date.today()

            doj = dol
            if dol and exp_years:
                try:
                    yrs = float(str(exp_years).replace(",", "."))
                    from datetime import timedelta
                    doj = dol - timedelta(days=int(365.25 * yrs))
                except (ValueError, TypeError):
                    pass

            if not doj:
                doj = date.today()
            if not dol:
                dol = date.today()

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

    admin_id = data.get("admin_id")
    if not admin_id:
        return {"success": False, "message": "admin_id is required"}, 400

    # Check if record exists
    upload_doc = UploadDoc.query.filter_by(admin_id=admin_id).first()

    try:
        # ---------------- UPDATE ----------------
        if upload_doc:
            update_fields = [
                "aadhaar_front", "aadhaar_back",
                "pan_front", "pan_back",
                "appointment_letter",
                "passbook_front"
            ]

            for field in update_fields:
                if field in data:
                    setattr(upload_doc, field, data[field])

            db.session.commit()
            return {"success": True, "message": "Documents updated successfully"}, 200

        # ---------------- CREATE ----------------
        upload_doc = UploadDoc(
            admin_id=admin_id,
            aadhaar_front=data.get("aadhaar_front"),
            aadhaar_back=data.get("aadhaar_back"),
            pan_front=data.get("pan_front"),
            pan_back=data.get("pan_back"),
            appointment_letter=data.get("appointment_letter"),
            passbook_front=data.get("passbook_front")
        )

        db.session.add(upload_doc)
        db.session.commit()
        return {"success": True, "message": "Documents saved successfully"}, 201

    except Exception as e:
        db.session.rollback()
        print("ERROR:", e)
        return {"success": False, "message": str(e)}, 500



