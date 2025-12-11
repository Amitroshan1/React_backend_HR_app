from flask import Blueprint, request, redirect, url_for, current_app, session, jsonify
from .models.Admin_models import Admin
from .models.signup import Signup
from . import db
from .models.emp_detail_models import Employee
from .models.attendance import Punch,Location
from .models.attendance import Punch, LeaveBalance
from .models.manager_model import ManagerContact
from .models.news_feed import NewsFeed
from .models.query import Query

from datetime import datetime
import requests
from flask_jwt_extended import create_access_token
import logging

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
# ===================================================
@auth.route('/validate-user', methods=['POST'])
def validate_user():
    data = request.get_json(silent=True) or {}

    identifier = data.get("identifier")
    password = data.get("password")

    if not identifier or not password:
        return jsonify({"success": False, "message": "Missing credentials"}), 400

    user = None

    if identifier.isdigit():
        user = Signup.query.filter_by(mobile=identifier).first()
    elif "@" in identifier:
        user = Signup.query.filter_by(email=identifier).first()

    if not user or not user.check_password(password):
        return jsonify({"success": False, "message": "Invalid credentials"}), 400

    # ✅ CREATE JWT TOKEN
    access_token = create_access_token(
        identity=str(user.id),
        additional_claims={
            "email": user.email,
            "emp_type": user.emp_type
        }
    )
    print("JWT TOKEN:", access_token)
    return jsonify({
        "success": True,
        "token": access_token
    }), 200



# ===================================================
# ✅ 2️⃣ MICROSOFT LOGIN REDIRECT
# FINAL URL → GET /api/auth/microsoft-login
# ===================================================
@auth.route('/microsoft-login')
def microsoft_login():
    params = {
        "client_id": current_app.config["OAUTH2_CLIENT_ID"],
        "response_type": "code",
        "redirect_uri": current_app.config["OAUTH2_REDIRECT_URI"],
        "scope": "openid email profile offline_access https://graph.microsoft.com/mail.send",
        "response_mode": "query"
    }

    auth_url = f"{current_app.config['MICROSOFT_AUTH_URL']}?{requests.compat.urlencode(params)}"
    return redirect(auth_url)


# ===================================================
# ✅ 3️⃣ MICROSOFT CALLBACK + JWT ISSUE
# FINAL URL → GET /api/auth/callback
# ===================================================
@auth.route('/callback')
def callback():
    code = request.args.get("code")
    pending_email = session.get("pending_email")

    if not code or not pending_email:
        return redirect("http://localhost:3000/auth/failure")

    token_response = requests.post(
        current_app.config['MICROSOFT_TOKEN_URL'],
        data={
            "client_id": current_app.config['OAUTH2_CLIENT_ID'],
            "client_secret": current_app.config['OAUTH2_CLIENT_SECRET'],
            "code": code,
            "redirect_uri": current_app.config['OAUTH2_REDIRECT_URI'],
            "grant_type": "authorization_code"
        }
    )

    token_json = token_response.json()

    if "access_token" not in token_json:
        return redirect("http://localhost:3000/auth/failure")

    access_token = token_json["access_token"]

    # Fetch Microsoft user
    user_info = requests.get(
        current_app.config['MICROSOFT_USER_INFO_URL'],
        headers={"Authorization": f"Bearer {access_token}"}
    ).json()

    ms_email = user_info.get("mail") or user_info.get("userPrincipalName")

    # Final email match check
    if not ms_email or ms_email.lower() != pending_email.lower():
        return redirect("http://localhost:3000/auth/failure")

    # ✅ Create JWT
    jwt_token = create_access_token(
        identity=ms_email,
        additional_claims={"email": ms_email, "role": "employee"}
    )

    session.pop("pending_email", None)

    # ✅ Redirect to React with token
    frontend_redirect = f"http://localhost:3000/auth/success?token={jwt_token}"
    return redirect(frontend_redirect)




from flask_jwt_extended import jwt_required, get_jwt_identity, get_jwt
from flask import jsonify
from datetime import date

@auth.route('/employee/homepage', methods=['GET'])
@jwt_required()
def employee_homepage():

    user_id = get_jwt_identity()   # this is Signup.id
    claims = get_jwt()
    email = claims.get("email")

    # ------------------------
    # ✅ 1. SIGNUP DATA
    # ------------------------
    signup = Signup.query.get(user_id)
    if not signup:
        return jsonify({"success": False, "message": "User not found"}), 404

    # ------------------------
    # ✅ 2. EMPLOYEE DATA
    # ------------------------
    employee = Employee.query.filter_by(email=email).first()

    # ------------------------
    # ✅ 3. TODAY PUNCH DATA
    # ------------------------
    today = date.today()
    punch = None
    working_hours = None

    if employee:
        punch = Punch.query.filter_by(
            admin_id=employee.admin_id,
            punch_date=today
        ).first()

        if punch and punch.punch_in:
            if punch.punch_out:
                diff = punch.punch_out - punch.punch_in
            else:
                diff = datetime.now() - punch.punch_in

            working_hours = str(diff).split(".")[0]  # HH:MM:SS

    # ------------------------
    # ✅ 4. LEAVE BALANCE
    # ------------------------
    leave_balance = LeaveBalance.query.filter_by(signup_id=signup.id).first()

    # ------------------------
    # ✅ 6. MANAGER CONTACT
    # ------------------------
    manager = ManagerContact.query.filter_by(
         circle_name=signup.circle,
         user_type=signup.emp_type
     ).first()
    
    

        

    return jsonify({
            "success": True,

            "user": {
                "id": signup.id,
                "name": signup.first_name,
                "emp_id": signup.emp_id,
                "department": signup.emp_type,
                "circle": signup.circle,
                "doj": str(signup.doj)
            },

            "employee": {
                "admin_id": employee.admin_id if employee else None,
                "designation": employee.designation if employee else None,
            },

            "punch": {
                "punch_in": punch.punch_in if punch else None,
                "punch_out": punch.punch_out if punch else None,
                "working_hours": working_hours
            },

            "leave_balance": {
                "pl": leave_balance.privilege_leave_balance if leave_balance else 0,
                "cl": leave_balance.casual_leave_balance if leave_balance else 0
            },
            "manager": {
             "l1": manager.l1_email if manager else None,
             "l2": manager.l2_email if manager else None,
             "l3": manager.l3_email if manager else None
         },

        }), 200



from datetime import datetime, date
from math import radians, sin, cos, sqrt, atan2

def calculate_distance(lat1, lon1, lat2, lon2):
    R = 6371000  # meters
    dLat = radians(lat2 - lat1)
    dLon = radians(lon2 - lon1)
    a = sin(dLat/2)**2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dLon/2)**2
    c = 2 * atan2(sqrt(a), sqrt(1-a))
    return R * c


@auth.route('/employee/punch-in', methods=['POST'])
@jwt_required()
def punch_in():

    data = request.get_json()
    user_lat = data.get("lat")
    user_lon = data.get("lon")
    is_wfh = data.get("is_wfh", False)

    email = get_jwt().get("email")
    employee = Employee.query.filter_by(email=email).first()

    if not employee:
        return jsonify({"success": False, "message": "Employee not found"}), 404

    today = date.today()

    existing = Punch.query.filter_by(admin_id=employee.admin_id, punch_date=today).first()
    if existing:
        return jsonify({"success": False, "message": "Already punched in today"}), 400

    # ---------- LOCATION VALIDATION ----------
    if not is_wfh:

        office_location = Location.query.first()  # or based on employee.circle
        if not office_location:
            return jsonify({"success": False, "message": "Office location not set"}), 400

        distance = calculate_distance(
            user_lat, user_lon,
            office_location.latitude, office_location.longitude
        )

        if distance > office_location.radius:
            return jsonify({
                "success": False,
                "message": f"Too far from office location ({int(distance)}m > {office_location.radius}m)"
            }), 403

    # ---------- CREATE NEW PUNCH ----------
    new_punch = Punch(
        admin_id=employee.admin_id,
        punch_in=datetime.now(),
        punch_date=today,
        lat=user_lat,
        lon=user_lon,
        is_wfh=is_wfh
    )

    db.session.add(new_punch)
    db.session.commit()

    return jsonify({
        "success": True,
        "message": "Punched in successfully",
        "punch_in": str(new_punch.punch_in)
    }), 200



@auth.route('/employee/punch-out', methods=['POST'])
@jwt_required()
def punch_out():

    email = get_jwt().get("email")
    employee = Employee.query.filter_by(email=email).first()

    today = date.today()
    punch = Punch.query.filter_by(admin_id=employee.admin_id, punch_date=today).first()

    if not punch or punch.punch_out:
        return jsonify({"success": False, "message": "Punch-out already done or no punch-in found"}), 400

    punch.punch_out = datetime.now()

    # CALCULATE TOTAL TIME
    diff = punch.punch_out - punch.punch_in
    punch.today_work = str(diff).split(".")[0]   # store as "HH:MM:SS"

    db.session.commit()

    return jsonify({
        "success": True,
        "message": "Punched out",
        "punch_out": str(punch.punch_out),
        "today_work": punch.today_work
    }), 200

