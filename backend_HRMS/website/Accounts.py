

#https://solviotec.com/api/account



from flask import Blueprint, request, current_app, jsonify,json, send_from_directory
from flask_jwt_extended import jwt_required, get_jwt
from .email import send_email_via_zeptomail,send_welcome_email,send_payslip_uploaded_email,send_form16_uploaded_email
from .models.Admin_models import Admin
from datetime import datetime,date,timedelta
from zoneinfo import ZoneInfo
import calendar
from .email import asset_email,update_asset_email
from .utility import generate_attendance_excel_Accounts, send_excel_file, calculate_month_summary
from .models.emp_detail_models import Employee,Asset
from .models.family_models import FamilyDetails
from .models.prev_com import PreviousCompany
from .models.education import UploadDoc, Education
from .models.attendance import Punch, LeaveApplication,LeaveBalance
from .models.news_feed import NewsFeed, PaySlip, Form16
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

    selected_year = request.args.get("year", type=int) or datetime.now().year
    selected_month = request.args.get("month", type=int) or datetime.now().month

    employees = Admin.query.filter(
        Admin.emp_type == emp_type,
        Admin.circle == circle,
        Admin.is_active == True,
        or_(Admin.is_exited == False, Admin.is_exited.is_(None))
    ).all()

    data = []

    for emp in employees:
        employee_details = Employee.query.filter_by(admin_id=emp.id).first()
        upload_doc = UploadDoc.query.filter_by(admin_id=emp.id).first()
        latest_form16 = Form16.query.filter_by(admin_id=emp.id).order_by(Form16.id.desc()).first()
        month_stats = calculate_month_summary(emp.id, selected_year, selected_month)

        data.append({
            "id": emp.id,
            "emp_id": emp.emp_id,
            "first_name": employee_details.name if employee_details and employee_details.name else emp.first_name,
            "email": employee_details.email if employee_details and employee_details.email else emp.email,
            "mobile": emp.mobile,
            "working_days": month_stats.get("working_days_final", 0),
            "bank_details_available": bool(upload_doc and upload_doc.passbook_front),
            "bank_details_path": upload_doc.passbook_front if upload_doc else None,
            "documents": upload_doc.to_dict() if upload_doc else {},
            "form16_available": bool(latest_form16 and latest_form16.file_path),
            "form16_path": latest_form16.file_path if latest_form16 else None
        })

    return jsonify({
        "success": True,
        "count": len(data),
        "employees": data
    }), 200


@Accounts.route("/employee-documents/<int:admin_id>", methods=["GET"])
@jwt_required()
def employee_documents(admin_id):
    email = get_jwt().get("email")
    admin = Admin.query.filter_by(email=email).first()
    if not admin:
        return jsonify({
            "success": False,
            "message": "Unauthorized user"
        }), 401

    target_admin = Admin.query.get(admin_id)
    if not target_admin:
        return jsonify({
            "success": False,
            "message": "Employee not found"
        }), 404

    upload_doc = UploadDoc.query.filter_by(admin_id=admin_id).first()
    latest_form16 = Form16.query.filter_by(admin_id=admin_id).order_by(Form16.id.desc()).first()

    return jsonify({
        "success": True,
        "documents": upload_doc.to_dict() if upload_doc else {},
        "form16_path": latest_form16.file_path if latest_form16 else None
    }), 200


@Accounts.route("/form16/upload", methods=["POST"])
@jwt_required()
def upload_form16():
    email = get_jwt().get("email")
    admin = Admin.query.filter_by(email=email).first()
    if not admin:
        return jsonify({
            "success": False,
            "message": "Unauthorized user"
        }), 401

    admin_id = request.form.get("admin_id", type=int)
    financial_year = (request.form.get("financial_year") or "").strip()
    file = request.files.get("form16_file")

    if not admin_id or not financial_year or not file:
        return jsonify({
            "success": False,
            "message": "admin_id, financial_year and form16_file are required"
        }), 400

    target_admin = Admin.query.get(admin_id)
    if not target_admin:
        return jsonify({
            "success": False,
            "message": "Employee not found"
        }), 404

    upload_folder = os.path.join(current_app.root_path, "..", "uploads", "form16")
    os.makedirs(upload_folder, exist_ok=True)

    safe_name = secure_filename(file.filename)
    timestamp = datetime.now().strftime("%Y%m%d%H%M%S")
    final_name = f"{admin_id}_{financial_year}_{timestamp}_{safe_name}"
    file.save(os.path.join(upload_folder, final_name))

    form16 = Form16(
        admin_id=admin_id,
        financial_year=financial_year,
        file_path=f"form16/{final_name}"
    )
    db.session.add(form16)
    db.session.commit()

    # Notify employee (and CC Accounts) about Form 16 upload
    try:
        send_form16_uploaded_email(target_admin, financial_year)
    except Exception:
        current_app.logger.warning(
            f"Form16 upload email failed for admin_id={admin_id}"
        )

    return jsonify({
        "success": True,
        "message": "Form 16 uploaded successfully",
        "file_path": form16.file_path
    }), 201


@Accounts.route("/form16/history/<int:admin_id>", methods=["GET"])
@jwt_required()
def form16_history(admin_id):
    email = get_jwt().get("email")
    admin = Admin.query.filter_by(email=email).first()
    if not admin:
        return jsonify({
            "success": False,
            "message": "Unauthorized user"
        }), 401

    target_admin = Admin.query.get(admin_id)
    if not target_admin:
        return jsonify({
            "success": False,
            "message": "Employee not found"
        }), 404

    rows = Form16.query.filter_by(admin_id=admin_id).order_by(Form16.created_at.desc(), Form16.id.desc()).all()
    history = []
    for row in rows:
        history.append({
            "id": row.id,
            "financial_year": row.financial_year,
            "file_path": row.file_path,
            "created_at": row.created_at.isoformat() if row.created_at else None
        })

    return jsonify({
        "success": True,
        "history": history
    }), 200


@Accounts.route("/form16/bulk-upload", methods=["POST"])
@jwt_required()
def bulk_upload_form16():
    email = get_jwt().get("email")
    admin_user = Admin.query.filter_by(email=email).first()
    if not admin_user:
        return jsonify({
            "success": False,
            "message": "Unauthorized user"
        }), 401

    financial_year = (request.form.get("financial_year") or "").strip()
    files = request.files.getlist("form16_files")

    if not financial_year or not files:
        return jsonify({
            "success": False,
            "message": "financial_year and form16_files are required"
        }), 400

    upload_folder = os.path.join(current_app.root_path, "..", "uploads", "form16")
    os.makedirs(upload_folder, exist_ok=True)

    saved_docs = []
    unmatched_files = []

    for file in files:
        if not file or not file.filename or not file.filename.strip():
            continue

        original_name = secure_filename(file.filename)
        base_name = os.path.splitext(original_name)[0]
        emp_id_part = base_name[:5].upper()

        target_admin = Admin.query.filter(
            func.upper(func.coalesce(Admin.emp_id, "")).like(f"%{emp_id_part}%")
        ).first()

        if not target_admin:
            unmatched_files.append({
                "filename": original_name,
                "reason": f"No employee match (emp_id like '{emp_id_part}')"
            })
            continue

        timestamp = datetime.now().strftime("%Y%m%d%H%M%S")
        final_name = f"{target_admin.id}_{financial_year}_{timestamp}_{original_name}"
        abs_path = os.path.join(upload_folder, final_name)
        file.save(abs_path)

        rel_path = f"form16/{final_name}"
        doc = Form16(
            admin_id=target_admin.id,
            financial_year=financial_year,
            file_path=rel_path
        )
        db.session.add(doc)
        saved_docs.append(target_admin)

    db.session.commit()

    email_failures = []
    for target_admin in saved_docs:
        success, message = send_form16_uploaded_email(target_admin, financial_year)
        if not success:
            email_failures.append({
                "email": target_admin.email,
                "reason": message
            })

    errors = [f"{item['filename']}: {item['reason']}" for item in unmatched_files]
    email_failure_messages = [f"{item['email']}: {item['reason']}" for item in email_failures]

    return jsonify({
        "success": True,
        "message": "Bulk Form16 upload processed",
        "uploaded_count": len(saved_docs),
        "unmatched_files": unmatched_files,
        "email_failure_details": email_failures,
        "errors": errors,
        "email_failures": email_failure_messages
    }), 201


@Accounts.route("/payslip/upload", methods=["POST"])
@jwt_required()
def upload_payslip():
    email = get_jwt().get("email")
    admin = Admin.query.filter_by(email=email).first()
    if not admin:
        return jsonify({
            "success": False,
            "message": "Unauthorized user"
        }), 401

    admin_id = request.form.get("admin_id", type=int)
    month = (request.form.get("month") or "").strip()
    year = (request.form.get("year") or "").strip()
    file = request.files.get("payslip_file")

    if not admin_id or not month or not year or not file:
        return jsonify({
            "success": False,
            "message": "admin_id, month, year and payslip_file are required"
        }), 400

    target_admin = Admin.query.get(admin_id)
    if not target_admin:
        return jsonify({
            "success": False,
            "message": "Employee not found"
        }), 404

    upload_folder = os.path.join(current_app.root_path, "..", "uploads", "payslips")
    os.makedirs(upload_folder, exist_ok=True)

    safe_name = secure_filename(file.filename)
    timestamp = datetime.now().strftime("%Y%m%d%H%M%S")
    final_name = f"{admin_id}_{month}_{year}_{timestamp}_{safe_name}"
    file.save(os.path.join(upload_folder, final_name))

    payslip = PaySlip(
        admin_id=admin_id,
        month=month,
        year=year,
        file_path=f"payslips/{final_name}"
    )
    db.session.add(payslip)
    db.session.commit()

    # Notify employee (and CC Accounts) about payslip upload
    try:
        send_payslip_uploaded_email(target_admin, month, year)
    except Exception:
        current_app.logger.warning(
            f"Payslip upload email failed for admin_id={admin_id}"
        )

    return jsonify({
        "success": True,
        "message": "Payslip uploaded successfully",
        "file_path": payslip.file_path
    }), 201


@Accounts.route("/payslip/bulk-upload", methods=["POST"])
@jwt_required()
def bulk_upload_payslips():
    email = get_jwt().get("email")
    admin_user = Admin.query.filter_by(email=email).first()
    if not admin_user:
        return jsonify({
            "success": False,
            "message": "Unauthorized user"
        }), 401

    month = (request.form.get("month") or "").strip()
    year = (request.form.get("year") or "").strip()
    files = request.files.getlist("payslip_files")

    if not month or not year or not files:
        return jsonify({
            "success": False,
            "message": "month, year and payslip_files are required"
        }), 400

    upload_folder = os.path.join(current_app.root_path, "..", "uploads", "payslips")
    os.makedirs(upload_folder, exist_ok=True)

    saved_slips = []
    unmatched_files = []

    for file in files:
        if not file or not file.filename or not file.filename.strip():
            continue

        original_name = secure_filename(file.filename)
        base_name = os.path.splitext(original_name)[0]
        emp_id_part = base_name[:5].upper()

        target_admin = Admin.query.filter(
            func.upper(func.coalesce(Admin.emp_id, "")).like(f"%{emp_id_part}%")
        ).first()

        if not target_admin:
            unmatched_files.append({
                "filename": original_name,
                "reason": f"No employee match (emp_id like '{emp_id_part}')"
            })
            continue

        timestamp = datetime.now().strftime("%Y%m%d%H%M%S")
        final_name = f"{target_admin.id}_{month}_{year}_{timestamp}_{original_name}"
        abs_path = os.path.join(upload_folder, final_name)
        file.save(abs_path)

        rel_path = f"payslips/{final_name}"
        slip = PaySlip(
            admin_id=target_admin.id,
            month=month,
            year=year,
            file_path=rel_path
        )
        db.session.add(slip)
        saved_slips.append((target_admin, original_name))

    db.session.commit()

    email_failures = []
    for target_admin, _ in saved_slips:
        success, message = send_payslip_uploaded_email(target_admin, month, year)
        if not success:
            email_failures.append({
                "email": target_admin.email,
                "reason": message
            })

    errors = [f"{item['filename']}: {item['reason']}" for item in unmatched_files]
    email_failure_messages = [f"{item['email']}: {item['reason']}" for item in email_failures]

    return jsonify({
        "success": True,
        "message": "Bulk payslip upload processed",
        "uploaded_count": len(saved_slips),
        "unmatched_files": unmatched_files,
        "email_failure_details": email_failures,
        "errors": errors,
        "email_failures": email_failure_messages
    }), 201


@Accounts.route("/payslip/history/<int:admin_id>", methods=["GET"])
@jwt_required()
def payslip_history(admin_id):
    email = get_jwt().get("email")
    admin = Admin.query.filter_by(email=email).first()
    if not admin:
        return jsonify({
            "success": False,
            "message": "Unauthorized user"
        }), 401

    target_admin = Admin.query.get(admin_id)
    if not target_admin:
        return jsonify({
            "success": False,
            "message": "Employee not found"
        }), 404

    rows = PaySlip.query.filter_by(admin_id=admin_id).order_by(PaySlip.id.desc()).all()
    history = []
    for row in rows:
        history.append({
            "id": row.id,
            "month": row.month,
            "year": row.year,
            "file_path": row.file_path
        })

    return jsonify({
        "success": True,
        "history": history
    }), 200


@Accounts.route("/file/<path:relative_path>", methods=["GET"])
@jwt_required()
def serve_uploaded_file(relative_path):
    email = get_jwt().get("email")
    admin = Admin.query.filter_by(email=email).first()
    if not admin:
        return jsonify({
            "success": False,
            "message": "Unauthorized user"
        }), 401

    normalized = (relative_path or "").replace("\\", "/").lstrip("/")
    if not normalized or ".." in normalized.split("/"):
        return jsonify({
            "success": False,
            "message": "Invalid file path"
        }), 400

    uploads_root = os.path.abspath(os.path.join(current_app.root_path, "..", "uploads"))
    try:
        return send_from_directory(uploads_root, normalized, as_attachment=False)
    except Exception:
        return jsonify({
            "success": False,
            "message": "File not found"
        }), 404


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


@Accounts.route("/download-excel", methods=["GET"])
@jwt_required()
def download_excel_acc_api():
    circle = request.args.get("circle")
    emp_type = request.args.get("emp_type")
    month_str = request.args.get("month")

    if not circle or not emp_type:
        return jsonify({
            "success": False,
            "message": "circle and emp_type are required"
        }), 400

    admins = Admin.query.filter(
        Admin.circle == circle,
        Admin.emp_type == emp_type,
        Admin.is_active == True,
        or_(Admin.is_exited == False, Admin.is_exited.is_(None))
    ).all()

    if not admins:
        return jsonify({
            "success": False,
            "message": "No employees found"
        }), 404

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

    output = generate_attendance_excel_Accounts(
        admins=admins,
        emp_type=emp_type,
        circle=circle,
        year=year,
        month=month
    )

    filename = f"ACC_Attendance_{circle}_{emp_type}_{calendar.month_name[month]}_{year}.xlsx"
    return send_excel_file(
        output,
        download_name=filename,
        mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )


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
        or_(Admin.is_exited == False, Admin.is_exited.is_(None))
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
