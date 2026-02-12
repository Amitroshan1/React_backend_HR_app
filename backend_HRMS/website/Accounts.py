

#https://solviotec.com/api/account



from flask import Blueprint, request, current_app, jsonify,json
from flask_jwt_extended import jwt_required, get_jwt
from .email import send_email_via_zeptomail,send_welcome_email
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
from .models.news_feed import NewsFeed, PaySlip
from werkzeug.security import generate_password_hash
import os
from . import db
from werkzeug.utils import secure_filename
from sqlalchemy import func, or_
from .models.expense import ExpenseLineItem



Accounts = Blueprint('Accounts', __name__)






@Accounts.route("/employee-type-count", methods=["GET"])
@jwt_required()
def employee_type_count():
    email = get_jwt().get("email")
    admin = Admin.query.filter_by(email=email).first()

    if not admin:
        return jsonify({
            "success": False,
            "message": "Unauthorized user"
        }), 401

    # Group by emp_type and count
    results = db.session.query(
        Admin.emp_type,
        func.count(Admin.id)
    ).filter(
        Admin.is_active == True,
        Admin.is_exited == False
    ).group_by(
        Admin.emp_type
    ).all()

    data = []
    for emp_type, count in results:
        data.append({
            "emp_type": emp_type if emp_type else "Not Assigned",
            "count": count
        })

    return jsonify({
        "success": True,
        "data": data
    }), 200




@Accounts.route("/employees-by-type-circle", methods=["GET"])
@jwt_required()
def employees_by_type_and_circle():
    email = get_jwt().get("email")
    admin = Admin.query.filter_by(email=email).first()

    if not admin:
        return jsonify({
            "success": False,
            "message": "Unauthorized user"
        }), 401

    emp_type = request.args.get("emp_type")
    circle = request.args.get("circle")

    if not emp_type or not circle:
        return jsonify({
            "success": False,
            "message": "emp_type and circle are required"
        }), 400

    employees = Admin.query.filter(
        Admin.emp_type == emp_type,
        Admin.circle == circle,
        Admin.is_active == True,
        Admin.is_exited == False
    ).all()

    data = []

    for emp in employees:
        data.append({
            "id": emp.id,
            "emp_id": emp.emp_id,
            "first_name": emp.first_name,
            "email": emp.email,
            "mobile": emp.mobile
        })

    return jsonify({
        "success": True,
        "count": len(data),
        "employees": data
    }), 200


@Accounts.route("/employee-type-circle-summary", methods=["GET"])
@jwt_required()
def employee_type_circle_summary():
    email = get_jwt().get("email")
    admin = Admin.query.filter_by(email=email).first()

    if not admin:
        return jsonify({
            "success": False,
            "message": "Unauthorized user"
        }), 401

    results = db.session.query(
        Admin.emp_type,
        Admin.circle,
        func.count(Admin.id)
    ).filter(
        Admin.is_active == True,
        or_(Admin.is_exited == False, Admin.is_exited.is_(None))
    ).group_by(
        Admin.emp_type,
        Admin.circle
    ).all()

    summary_map = {}
    for emp_type, circle, count in results:
        dept_key = emp_type if emp_type else "Not Assigned"
        if dept_key not in summary_map:
            summary_map[dept_key] = {
                "department": dept_key,
                "employees": 0,
                "circles": set()
            }
        summary_map[dept_key]["employees"] += count
        if circle:
            summary_map[dept_key]["circles"].add(circle)

    data = []
    for item in summary_map.values():
        data.append({
            "department": item["department"],
            "employees": item["employees"],
            "circles": sorted(item["circles"])
        })

    data.sort(key=lambda x: x["department"])

    return jsonify({
        "success": True,
        "data": data
    }), 200


@Accounts.route("/payroll-summary", methods=["GET"])
@jwt_required()
def payroll_summary():
    email = get_jwt().get("email")
    admin = Admin.query.filter_by(email=email).first()

    if not admin:
        return jsonify({
            "success": False,
            "message": "Unauthorized user"
        }), 401

    now = datetime.now()
    current_month = now.strftime("%B")
    current_year = str(now.year)

    total_employees = Admin.query.filter(
        Admin.is_active == True,
        Admin.is_exited == False
    ).count()

    payslips_generated = PaySlip.query.filter_by(
        month=current_month,
        year=current_year
    ).count()

    employees_paid = payslips_generated

    ytd_expenses = db.session.query(
        func.coalesce(func.sum(ExpenseLineItem.amount), 0)
    ).filter(
        func.extract('year', ExpenseLineItem.date) == now.year
    ).scalar()

    return jsonify({
        "success": True,
        "data": {
            "total_employees": total_employees,
            "employees_paid": employees_paid,
            "payslips_generated": payslips_generated,
            "ytd_expenses": float(ytd_expenses or 0)
        }
    }), 200
