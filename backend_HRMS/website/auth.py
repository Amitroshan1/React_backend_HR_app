from flask import Blueprint, request, redirect, url_for, current_app, session, jsonify
from .models.Admin_models import Admin
from .models.signup import Signup
from . import db
from .models.emp_detail_models import Employee
from .models.attendance import Punch
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
        identity=user.id,
        additional_claims={
            "email": user.email,
            "emp_type": user.emp_type
        }
    )

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
    if employee:
        punch = Punch.query.filter_by(
            admin_id=employee.admin_id,
            punch_date=today
        ).first()

    # ------------------------
    # ✅ 4. LEAVE BALANCE
    # ------------------------
    leave_balance = LeaveBalance.query.filter_by(signup_id=signup.id).first()

    # ------------------------
    # ✅ 5. QUERY NOTIFICATIONS
    # ------------------------
    new_queries_count = Query.query.filter_by(
        emp_type=signup.emp_type,
        status='New'
    ).count()

    # ------------------------
    # ✅ 6. MANAGER CONTACT
    # ------------------------
    manager = ManagerContact.query.filter_by(
        circle_name=signup.circle,
        user_type=signup.emp_type
    ).first()

    # ------------------------
    # ✅ 7. NEWS FEED
    # ------------------------
    news_feeds = NewsFeed.query.filter(
        (NewsFeed.circle == signup.circle) | (NewsFeed.circle == 'All'),
        (NewsFeed.emp_type == signup.emp_type) | (NewsFeed.emp_type == 'All')
    ).order_by(NewsFeed.created_at.desc()).limit(5).all()

    # ------------------------
    # ✅ FINAL JSON RESPONSE
    # ------------------------
    return jsonify({
        "success": True,

        "user": {
            "id": signup.id,
            "name": signup.first_name,
            "email": signup.email,
            "emp_type": signup.emp_type,
            "circle": signup.circle,
            "doj": str(signup.doj)
        },

        "employee": {
            "admin_id": employee.admin_id if employee else None
        },

        "punch": {
            "punch_in": punch.punch_in if punch else None,
            "punch_out": punch.punch_out if punch else None
        },

        "leave_balance": {
            "pl": leave_balance.privilege_leave_balance if leave_balance else 0,
            "cl": leave_balance.casual_leave_balance if leave_balance else 0
        },

        "notifications": {
            "new_queries": new_queries_count
        },

        "manager": {
            "l1": manager.l1_email if manager else None,
            "l2": manager.l2_email if manager else None,
            "l3": manager.l3_email if manager else None
        },

        "news": [
            {
                "title": n.title,
                "desc": n.description,
                "date": str(n.created_at)
            } for n in news_feeds
        ]
    }), 200
