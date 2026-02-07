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
from .models.attendance import Punch, LeaveApplication,LeaveBalance
from .models.news_feed import NewsFeed
from werkzeug.security import generate_password_hash
import os
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


@hr.route("/signup", methods=["POST"])
# @jwt_required()
# @hr_required
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
        doj = datetime.fromisoformat(data["doj"]).date()
    except ValueError:
        return jsonify({
            "success": False,
            "message": "Invalid DOJ format (YYYY-MM-DD)"
        }), 400

    # hr_email = get_jwt().get("email")

    try:
        admin = Admin.query.filter_by(email=data["email"]).first()

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
            admin.first_name = data["first_name"]
            admin.user_name = data["user_name"]
            admin.mobile = data["mobile"]
            admin.emp_id = data["emp_id"]
            admin.doj = doj
            admin.emp_type = data["emp_type"]
            admin.circle = data["circle"]
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
                email=data["email"],
                first_name=data["first_name"],
                user_name=data["user_name"],
                mobile=data["mobile"],
                emp_id=data["emp_id"],
                doj=doj,
                emp_type=data["emp_type"],
                circle=data["circle"],
                is_active=True,
                is_exited=False
            )

            # Password logic
            if data.get("password"):
                admin.set_password(data["password"])
            # else:
                # send_password_set_email(admin)

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
        # audit = AuditLog(
        #     action=action,
        #     performed_by=hr_email,
        #     target_email=admin.email,
        #     meta={
        #         "emp_id": admin.emp_id,
        #         "emp_type": admin.emp_type,
        #         "circle": admin.circle
        #     }
        # )
        # db.session.add(audit)

        db.session.commit()

        # send_welcome_email(admin, data)

        return jsonify({
            "success": True,
            "message": "Employee onboarded successfully",
            "employee_id": admin.id,
            "action": action
        }), 201

    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Signup error: {e}")
        return jsonify({
            "success": False,
            "message": "Unable to onboard employee"
        }), 500

    # -------------------------
    # Send Welcome Email (NON-BLOCKING)


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

    return jsonify({
        "success": True,
        "date": today.isoformat(),
        "counts": {
            "total_employees": total_employees,
            "new_joinees_last_30_days": new_joinees_count,
            "today_punch_in_count": today_punch_count
        },
        "anniversaries": [
            {
                "emp_id": e.emp_id,
                "name": e.first_name,
                "email": e.email,
                "doj": e.doj.isoformat()
            }
            for e in employees_with_anniversaries
        ],
        "birthdays": [
            {
                "name": e.name,
                "email": e.email,
                "dob": e.dob.isoformat()
            }
            for e in employees_with_birthdays
        ]
    }), 200



# --------------------------------------------------
# MARK EMPLOYEE AS EXITED
# --------------------------------------------------
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
            target_email=admin.email,
            meta={
                "emp_id": admin.emp_id,
                "exit_type": exit_type,
                "exit_date": exit_date.isoformat()
            }
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
            .order_by(Admin.exit_date.desc().nullslast())
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
        "cycle": p.cycle,
        "rating": p.rating,
        "remarks": p.remarks
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
        mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        download_name=filename,
        as_attachment=True
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
                "is_wfh": bool(punch.is_wfh) if punch else False,
                "today_work": punch.today_work.strftime("%H:%M:%S") if punch and punch.today_work else "",
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
def get_leave_balance(employee_id):
    # employee_id = Admin.id
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
def update_leave_balance(employee_id):
    leave_balance = LeaveBalance.query.filter_by(signup_id=employee_id).first()

    if not leave_balance:
        return jsonify({
            "success": False,
            "message": "Leave balance not found"
        }), 404

    data = request.get_json()

    if "privilege_leave_balance" in data:
        leave_balance.privilege_leave_balance = data["privilege_leave_balance"]

    if "casual_leave_balance" in data:
        leave_balance.casual_leave_balance = data["casual_leave_balance"]

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
            "message": f"Database error: {str(e)}"
        }), 500
    


@hr.route("/news-feed", methods=["POST"])
@jwt_required()
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
            upload_dir = current_app.config.get("UPLOAD_FOLDER")
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


@hr.route("/employee/search", methods=["GET"])
@jwt_required()
def search_employee_api_for_asset():
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


@hr.route("/employee/search", methods=["GET"])
@jwt_required()
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


@hr.route("/employee/<string:email>", methods=["GET"])
@jwt_required()
def get_employee_api(email):
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


@hr.route("/employee/<string:email>", methods=["PUT"], endpoint="hr_update_employee")
@jwt_required()
def update_employee_api(email):
    admin = Admin.query.filter_by(email=email).first()

    if not admin:
        return jsonify({
            "success": False,
            "message": "Employee not found"
        }), 404

    data = request.get_json() or {}

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


