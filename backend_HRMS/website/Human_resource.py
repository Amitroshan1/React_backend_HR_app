from flask import Blueprint, request, current_app, jsonify,json
from flask_jwt_extended import jwt_required, get_jwt
from .models.signup import Signup
from .models.Admin_models import Admin
from datetime import datetime,date,timedelta
from zoneinfo import ZoneInfo
import calendar
from .email import asset_email,update_asset_email
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


@hr.route("/dashboard", methods=["GET"])
@jwt_required()
def hr_dashboard_api():
    today = date.today()
    current_day = today.day
    current_month = today.month

    # 1️⃣ Work Anniversaries (Signup DOJ)
    employees_with_anniversaries = Signup.query.filter(
        db.extract("month", Signup.doj) == current_month,
        db.extract("day", Signup.doj) == current_day
    ).all()

    # 2️⃣ Birthdays (Employee DOB)
    employees_with_birthdays = Employee.query.filter(
        db.extract("month", Employee.dob) == current_month,
        db.extract("day", Employee.dob) == current_day
    ).all()

    # 3️⃣ Total Employees
    total_employees = Signup.query.count()

    # 4️⃣ New Joinees (last 30 days)
    thirty_days_ago = today - timedelta(days=30)
    new_joinees_count = Signup.query.filter(
        Signup.doj >= thirty_days_ago
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

    # Step 1: Filter Signup by circle & emp_type
    signups = Signup.query.filter_by(
        circle=circle,
        emp_type=emp_type
    ).all()

    if not signups:
        return jsonify({
            "success": False,
            "message": "No matching employees found"
        }), 404

    emails = [s.email for s in signups]

    # Step 2: Get Admin records using emails
    admins = Admin.query.filter(
        Admin.email.in_(emails)
    ).all()

    if not admins:
        return jsonify({
            "success": False,
            "message": "No matching admin records found"
        }), 404

    # Step 3: Return React-ready response
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

    # Step 1: Fetch employees from Signup
    signups = Signup.query.filter_by(
        circle=circle,
        emp_type=emp_type
    ).all()

    if not signups:
        return jsonify({
            "success": False,
            "message": "No employees found"
        }), 404

    emails = [s.email for s in signups]

    # Step 2: Fetch Admin records
    admins = Admin.query.filter(
        Admin.email.in_(emails)
    ).all()

    if not admins:
        return jsonify({
            "success": False,
            "message": "No admin records found"
        }), 404

    # Step 3: Resolve month
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

    # Step 4: Generate Excel
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

    # Step 5: Return file
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
    employee = Signup.query.get(employee_id)
    leave_balance = LeaveBalance.query.filter_by(signup_id=employee_id).first()

    if not employee or not leave_balance:
        return jsonify({
            "success": False,
            "message": "Employee or leave balance not found"
        }), 404

    return jsonify({
        "success": True,
        "employee": {
            "id": employee.id,
            "emp_id": employee.emp_id,
            "name": employee.first_name,
            "email": employee.email
        },
        "leave_balance": {
            "privilege_leave_balance": leave_balance.privilege_leave_balance,
            "casual_leave_balance": leave_balance.casual_leave_balance
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

    employee = Signup.query.filter_by(emp_id=emp_id).first()
    if not employee:
        return jsonify({
            "success": False,
            "message": "Employee not found"
        }), 404

    admin = Admin.query.filter_by(email=employee.email).first()

    return jsonify({
        "success": True,
        "employee": {
            "signup_id": employee.id,
            "admin_id": admin.id if admin else None,
            "name": employee.first_name,
            "emp_id": employee.emp_id,
            "email": employee.email,
            "circle": employee.circle,
            "emp_type": employee.emp_type
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



@hr.route("/employee/<int:admin_id>/assets", methods=["POST"])
@jwt_required()
def add_asset_api(admin_id):
    employee = Admin.query.get(admin_id)
    if not employee:
        return jsonify({"success": False, "message": "Employee not found"}), 404

    data = request.form
    uploaded_filenames = []

    if "images" in request.files:
        for file in request.files.getlist("images"):
            if file and file.filename:
                filename = secure_filename(file.filename)
                upload_dir = current_app.config["UPLOAD_FOLDER"]
                os.makedirs(upload_dir, exist_ok=True)
                file.save(os.path.join(upload_dir, filename))
                uploaded_filenames.append(filename)

    asset = Asset(
        name=data.get("name"),
        description=data.get("description"),
        admin_id=admin_id,
        issue_date=data.get("issue_date"),
        return_date=data.get("return_date") or None,
        remark=data.get("remark")
    )

    asset.set_image_files(uploaded_filenames)

    db.session.add(asset)
    db.session.commit()

    # Email
    asset_email(employee.email, employee.first_name)

    return jsonify({
        "success": True,
        "message": "Asset added successfully",
        "asset": asset.to_dict()
    }), 201


@hr.route("/assets/<int:asset_id>", methods=["PUT"])
@jwt_required()
def update_asset_api(asset_id):
    asset = Asset.query.get(asset_id)
    if not asset:
        return jsonify({"success": False, "message": "Asset not found"}), 404

    data = request.form
    uploaded_filenames = asset.get_image_files() or []

    if "images" in request.files:
        for file in request.files.getlist("images"):
            if file and file.filename:
                filename = secure_filename(file.filename)
                upload_dir = current_app.config["UPLOAD_FOLDER"]
                os.makedirs(upload_dir, exist_ok=True)
                file.save(os.path.join(upload_dir, filename))
                uploaded_filenames.append(filename)

    asset.name = data.get("name", asset.name)
    asset.description = data.get("description", asset.description)
    asset.issue_date = data.get("issue_date", asset.issue_date)
    asset.return_date = data.get("return_date") or None
    asset.remark = data.get("remark", asset.remark)
    asset.set_image_files(uploaded_filenames)

    db.session.commit()

    update_asset_email(asset.admin.email, asset.admin.first_name)

    return jsonify({
        "success": True,
        "message": "Asset updated successfully",
        "asset": asset.to_dict()
    }), 200


@hr.route("/signup/search", methods=["GET"])
@jwt_required()
def search_signup_api():
    emp_type = request.args.get("emp_type")
    circle = request.args.get("circle")

    if not emp_type or not circle:
        return jsonify({
            "success": False,
            "message": "emp_type and circle are required"
        }), 400

    employees = Signup.query.filter_by(
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


@hr.route("/signup/<string:email>", methods=["GET"])
@jwt_required()
def get_signup_api(email):
    employee = Signup.query.filter_by(email=email).first()

    if not employee:
        return jsonify({
            "success": False,
            "message": "Employee not found"
        }), 404

    return jsonify({
        "success": True,
        "employee": {
            "email": employee.email,
            "user_name": employee.user_name,
            "first_name": employee.first_name,
            "emp_id": employee.emp_id,
            "mobile": employee.mobile,
            "doj": employee.doj.isoformat() if employee.doj else None,
            "circle": employee.circle,
            "emp_type": employee.emp_type
        }
    }), 200



@hr.route("/signup/<string:email>", methods=["PUT"])
@jwt_required()
def update_signup_api(email):
    employee = Signup.query.filter_by(email=email).first()

    if not employee:
        return jsonify({
            "success": False,
            "message": "Employee not found"
        }), 404

    data = request.get_json()

    # Update fields safely
    employee.user_name = data.get("user_name", employee.user_name)
    employee.first_name = data.get("first_name", employee.first_name)
    employee.emp_id = data.get("emp_id", employee.emp_id)
    employee.mobile = data.get("mobile", employee.mobile)
    employee.circle = data.get("circle", employee.circle)
    employee.emp_type = data.get("emp_type", employee.emp_type)

    if "doj" in data:
        employee.doj = datetime.fromisoformat(data["doj"]).date()

    if data.get("password"):
        employee.password = generate_password_hash(data["password"])

    db.session.commit()

    return jsonify({
        "success": True,
        "message": "Employee record updated successfully"
    }), 200



@hr.route("/signup/<string:email>", methods=["DELETE"])
@jwt_required()
def delete_signup_api(email):
    employee = Signup.query.filter_by(email=email).first()

    if not employee:
        return jsonify({
            "success": False,
            "message": "Employee not found"
        }), 404

    db.session.delete(employee)
    db.session.commit()

    return jsonify({
        "success": True,
        "message": f"Employee {email} deleted successfully"
    }), 200


# @hr.route("/confirmation-requests", methods=["GET"])
# @jwt_required()
# def list_hr_confirmation_requests():
#     jwt_email = get_jwt().get("email")

#     hr_user = Signup.query.filter_by(email=jwt_email).first()
#     if not hr_user or hr_user.emp_type != "Human Resource":
#         return jsonify({
#             "success": False,
#             "message": "Access denied. HR only."
#         }), 403

#     requests = (
#         HRConfirmationRequest.query
#         .order_by(HRConfirmationRequest.created_at.desc())
#         .all()
#     )

#     return jsonify({
#         "success": True,
#         "count": len(requests),
#         "requests": [
#             {
#                 "id": r.id,
#                 "employee_id": r.employee_id,
#                 "status": r.status,
#                 "manager_review": r.manager_review,
#                 "created_at": r.created_at.isoformat()
#             }
#             for r in requests
#         ]
#     }), 200


# @hr.route("/confirmation-requests/<int:request_id>", methods=["PUT"])
# @jwt_required()
# def update_hr_confirmation_request_api(request_id):
#     jwt_email = get_jwt().get("email")

#     hr_user = Signup.query.filter_by(email=jwt_email).first()
#     if not hr_user or hr_user.emp_type != "Human Resource":
#         return jsonify({
#             "success": False,
#             "message": "Access denied. HR only."
#         }), 403

#     req = HRConfirmationRequest.query.get(request_id)
#     if not req:
#         return jsonify({
#             "success": False,
#             "message": "Confirmation request not found"
#         }), 404

#     data = request.get_json()
#     action = data.get("action")
#     review = data.get("review")

#     if action == "approve":
#         req.status = "Approved"
#     elif action == "reject":
#         req.status = "Rejected"
#     else:
#         return jsonify({
#             "success": False,
#             "message": "Invalid action. Use approve or reject."
#         }), 400

#     req.manager_review = review
#     db.session.commit()

#     # Notify employee
#     employee = Signup.query.get(req.employee_id)
#     if employee:
#         subject = f"Confirmation Status: {req.status}"
#         body = f"""
#         <p>Dear {employee.first_name},</p>
#         <p>Your employment confirmation has been reviewed.</p>
#         <p><strong>Status:</strong> {req.status}</p>
#         <p><strong>HR Comments:</strong> {review or 'No comments provided'}</p>
#         <p>Regards,<br><strong>HR Team</strong></p>
#         """

#         verify_oauth2_and_send_email(
#             user_email=jwt_email,
#             subject=subject,
#             body=body,
#             recipient_email=employee.email
#         )

#     return jsonify({
#         "success": True,
#         "message": f"Request {req.status.lower()} successfully"
#     }), 200

