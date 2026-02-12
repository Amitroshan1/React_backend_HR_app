# save_upload_docs,create_or_update_education,create_or_update_employee,
# punch_out,punch_in,employee_homepage,validate_user



#https://solviotec.com/api/auth


import re
from math import radians, cos, sin, atan2, sqrt
from flask import Blueprint, request, redirect, url_for, current_app,jsonify
from .email import send_login_alert_email
from .models.Admin_models import Admin
from . import db
from .models.emp_detail_models import Employee
from .models.attendance import Punch,Location,LeaveBalance
from .models.manager_model import ManagerContact
from .models.news_feed import NewsFeed
from .models.query import Query
from .models.education import Education, UploadDoc
from .models.prev_com import PreviousCompany
from datetime import datetime, time, date
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
        admin = Admin.query.filter_by(mobile=identifier).first()
    elif "@" in identifier:
        admin = Admin.query.filter_by(email=identifier).first()

    if not admin or not admin.check_password(password):
        return jsonify({
            "success": False,
            "message": "Invalid credentials"
        }), 400

    access_token = create_access_token(
        identity=str(admin.id),
        additional_claims={
            "email": admin.email,
            "emp_type": admin.emp_type
        }
    )

    try:
        send_login_alert_email(admin)
    except Exception as e:
        current_app.logger.warning(
            f"Login email failed for {admin.email}: {e}"
        )

    return jsonify({
        "success": True,
        "token": access_token
    }), 200


@auth.route('/employee/homepage', methods=['GET'])
@jwt_required()
def employee_homepage():

    admin_id = get_jwt_identity()
    claims = get_jwt()
    email = claims.get("email")

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

    # ------------------------
    # 4. LEAVE BALANCE + USAGE (from LeaveBalance table)
    # ------------------------
    leave_balance = LeaveBalance.query.filter_by(admin_id=admin.id).first()

    # ------------------------
    # 5. MANAGER DETAILS (ManagerContact)
    # ------------------------
    manager_contact = ManagerContact.query.filter_by(
        user_email=admin.email
    ).first()

    if not manager_contact:
        manager_contact = ManagerContact.query.filter_by(
            circle_name=admin.circle,
            user_type=admin.emp_type
        ).first()

    managers = {}

    if manager_contact:
        if manager_contact.l1_name and manager_contact.l1_email:
            managers["l1"] = {
                "name": manager_contact.l1_name,
                "email": manager_contact.l1_email,
                "mobile": manager_contact.l1_mobile
            }

        if manager_contact.l2_name and manager_contact.l2_email:
            managers["l2"] = {
                "name": manager_contact.l2_name,
                "email": manager_contact.l2_email,
                "mobile": manager_contact.l2_mobile
            }

        if manager_contact.l3_name and manager_contact.l3_email:
            managers["l3"] = {
                "name": manager_contact.l3_name,
                "email": manager_contact.l3_email,
                "mobile": manager_contact.l3_mobile
            }

    # ------------------------
    # RESPONSE
    # ------------------------
    return jsonify({
        "success": True,

        "user": {
            "id": admin.id,
            "name": admin.first_name,
            "emp_id": admin.emp_id,
            "emp_type": admin.emp_type,  # Use emp_type from admins table
            "department": admin.emp_type,  # Keep for backward compatibility
            "circle": admin.circle,
            "doj": str(admin.doj)
        },

        "employee": {
            "designation": employee.designation if employee else None
        },

        "punch": {
            "punch_in": punch.punch_in.isoformat() if punch and punch.punch_in and hasattr(punch.punch_in, 'isoformat') else (str(punch.punch_in) if punch and punch.punch_in else None),
            "punch_out": punch.punch_out.isoformat() if punch and punch.punch_out and hasattr(punch.punch_out, 'isoformat') else (str(punch.punch_out) if punch and punch.punch_out else None),
            "working_hours": working_hours
        },

        "leave_balance": {
            # Remaining balances (what's left to use)
            "pl": leave_balance.privilege_leave_balance if leave_balance else 0,
            "cl": leave_balance.casual_leave_balance if leave_balance else 0,
            "comp": leave_balance.compensatory_leave_balance if leave_balance else 0,

            # Total entitlements (fixed total granted - e.g., CL=8, PL=13)
            "total_pl": leave_balance.total_privilege_leave if leave_balance else 0,
            "total_cl": leave_balance.total_casual_leave if leave_balance else 0,
            "total_comp": leave_balance.total_compensatory_leave if leave_balance else 0,

            # Used amounts (how much has been used from total)
            "used_pl": leave_balance.used_privilege_leave if leave_balance else 0,
            "used_cl": leave_balance.used_casual_leave if leave_balance else 0,
            "used_comp": leave_balance.used_comp_leave if leave_balance else 0,
        },

        "managers": managers
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


@auth.route('/employee/location-check', methods=['GET'])
@jwt_required()
def location_check():
    """Check if user's lat/lon is within office range. Used by dashboard for punch-in/out buttons."""
    lat = request.args.get('lat', type=float)
    lon = request.args.get('lon', type=float)
    if lat is None or lon is None:
        return jsonify({
            "success": False,
            "in_range": False,
            "message": "Latitude and longitude are required"
        }), 400
    office = Location.query.first()
    if not office:
        return jsonify({
            "success": True,
            "in_range": False,
            "message": "Office location not configured"
        }), 200
    distance = calculate_distance(lat, lon, office.latitude, office.longitude)
    in_range = distance <= office.radius
    return jsonify({
        "success": True,
        "in_range": in_range,
        "distance_meters": int(distance),
        "radius_meters": office.radius
    }), 200


@auth.route('/employee/punch-in', methods=['POST'])
@jwt_required()
def punch_in():

    data = request.get_json() or {}

    user_lat = data.get("lat")
    user_lon = data.get("lon")
    is_wfh = bool(data.get("is_wfh", False))

    # Get logged-in user email from JWT
    email = get_jwt().get("email")
    print(email)
    employee = Admin.query.filter_by(email=email).first()

    if not employee:
        return jsonify({"success": False, "message": "Employee not found"}), 404

    today = date.today()

    # ❌ Already punched in
    existing = Punch.query.filter_by(
        admin_id=employee.id,
        punch_date=today
    ).first()

    if existing and existing.punch_in:
        return jsonify({
            "success": False,
            "message": "Already punched in today"
        }), 400

    # ❌ On approved leave
    if is_on_leave(employee.id, today):
        return jsonify({
            "success": False,
            "message": "You are on approved leave today"
        }), 403

    # ❌ WFH selected but not approved
    if is_wfh and not is_wfh_allowed(employee.id):
        return jsonify({
            "success": False,
            "message": "WFH mode is not approved for today"
        }), 403

    # ❌ Location validation (only if NOT WFH)
    if not is_wfh:
        if user_lat is None or user_lon is None:
            return jsonify({
                "success": False,
                "message": "Location (lat, lon) is required"
            }), 400

        office_location = Location.query.first()  # or based on employee.circle
        if not office_location:
            return jsonify({
                "success": False,
                "message": "Office location not configured"
            }), 500

        distance = calculate_distance(
            user_lat, user_lon,
            office_location.latitude,
            office_location.longitude
        )

        if distance > office_location.radius:
            return jsonify({
                "success": False,
                "message": f"Too far from office location ({int(distance)}m > {office_location.radius}m)"
            }), 403

    # ✅ CREATE / UPDATE PUNCH
    if not existing:
        existing = Punch(
            admin_id=employee.id,
            punch_date=today
        )

    existing.punch_in = datetime.now()
    existing.lat = user_lat
    existing.lon = user_lon
    existing.is_wfh = is_wfh

    db.session.add(existing)
    db.session.commit()

    punch_in_str = existing.punch_in.isoformat() if hasattr(existing.punch_in, 'isoformat') else str(existing.punch_in)
    return jsonify({
        "success": True,
        "message": "Punched in successfully",
        "punch_in": punch_in_str,
        "is_wfh": is_wfh
    }), 200



@auth.route('/employee/punch-out', methods=['POST'])
@jwt_required()
def punch_out():
    try:
        data = request.get_json() or {}
        
        user_lat = data.get("lat")
        user_lon = data.get("lon")

        # Get logged-in user email from JWT
        email = get_jwt().get("email")
        employee = Admin.query.filter_by(email=email).first()

        if not employee:
            return jsonify({"success": False, "message": "Employee not found"}), 404

        today = date.today()
        punch = Punch.query.filter_by(admin_id=employee.id, punch_date=today).first()

        if not punch or not punch.punch_in:
            return jsonify({"success": False, "message": "No punch-in found for today"}), 400
        
        if punch.punch_out:
            return jsonify({"success": False, "message": "Punch-out already done"}), 400

        if user_lat is None or user_lon is None:
            return jsonify({
                "success": False,
                "message": "Location (lat, lon) is required for punch-out"
            }), 400

        # ✅ UPDATE PUNCH-OUT (allow from any location)
        punch.punch_out = datetime.now()
        punch.lat = user_lat  # Update location on punch-out
        punch.lon = user_lon

        # CALCULATE TOTAL TIME
        if isinstance(punch.punch_in, datetime):
            diff = punch.punch_out - punch.punch_in
        else:
            # If punch_in is time only, combine with date
            punch_in_dt = datetime.combine(today, punch.punch_in) if isinstance(punch.punch_in, datetime.time) else punch.punch_in
            diff = punch.punch_out - punch_in_dt
        
        today_work_str = str(diff).split(".")[0]  # "HH:MM:SS"
        punch.today_work = today_work_str

        db.session.commit()

        punch_out_str = punch.punch_out.isoformat() if hasattr(punch.punch_out, 'isoformat') else str(punch.punch_out)
        return jsonify({
            "success": True,
            "message": "Punched out successfully",
            "punch_out": punch_out_str,
            "today_work": today_work_str
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

    employee = Employee.query.filter_by(admin_id=admin_id).first()

    try:
        if employee:
            required_string_fields = {
                "name", "email", "father_name", "mother_name", "marital_status",
                "emp_id", "mobile", "gender", "emergency_mobile", "nationality",
                "blood_group", "designation",
                "permanent_address_line1", "permanent_pincode",
                "present_address_line1", "present_pincode",
            }
            optional_address_fields = {"permanent_district", "permanent_state", "present_district", "present_state"}

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
                    val = s
                elif field in optional_address_fields:
                    val = (val or "").strip() if val is not None else None
                    if val == "":
                        val = None
                setattr(employee, field, val)

            db.session.commit()
            return jsonify({"success": True, "message": "Employee updated successfully"}), 200

        # Create new employee
        dob = _parse_date(data.get("dob"))
        if not dob:
            return jsonify({"success": False, "message": "Valid date of birth (YYYY-MM-DD) is required"}), 400

        def _str(v, default=""):
            return (v or default).strip() if v is not None else default

        # User-friendly validation messages
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
            ("permanent_address_line1", "Permanent address"),
            ("permanent_pincode", "Permanent address pincode"),
            ("present_address_line1", "Current address"),
            ("present_pincode", "Current address pincode"),
        ]
        for key, label in required:
            if not _str(data.get(key)):
                return jsonify({"success": False, "message": f"Please fill in: {label}"}), 400

        # Designation can be empty on first save; default to "Not Specified"
        designation_val = _str(data.get("designation")) or "Not Specified"

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
        db.session.commit()
        return jsonify({"success": True, "message": "Employee created successfully"}), 201

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



@auth.route("/upload-docs", methods=["POST"])
def save_upload_docs():
    data = request.get_json()

    if not data:
        return {"success": False, "message": "Missing JSON body"}, 400

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



