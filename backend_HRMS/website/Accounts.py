

#https://solviotec.com/api/account



from flask import Blueprint, request, current_app, jsonify,json, send_from_directory
from flask_jwt_extended import jwt_required, get_jwt
from .email import send_email_via_zeptomail,send_welcome_email,send_payslip_uploaded_email,send_form16_uploaded_email
from .models.Admin_models import Admin
from datetime import datetime,date,timedelta
from zoneinfo import ZoneInfo
import calendar
from .email import asset_email,update_asset_email
from .utility import generate_attendance_excel_Accounts, generate_client_attendance_excel, send_excel_file, calculate_month_summary
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
from .models.employee_accounts import EmployeeAccounts
from .models.ctc_breakup import CTCBreakup


Accounts = Blueprint('Accounts', __name__)


def _accounts_can_access_any_profile(admin):
    t = (getattr(admin, "emp_type", None) or "").strip().lower()
    return t in ("account", "accounts", "accountant", "hr", "human resource", "admin")


def _is_hr(admin):
    """
    HR-only access helper for employee-accounts-profile.
    Notes:
    - Uses Admin.emp_type values (case-insensitive).
    - Treats only HR/Human Resource as HR.
    """
    t = (getattr(admin, "emp_type", None) or "").strip().lower()
    return t in ("hr", "human resource", "human resources")


def _find_admin_by_employee_number(emp_raw):
    if emp_raw is None:
        return None
    s = str(emp_raw).strip()
    if not s:
        return None
    return Admin.query.filter(func.lower(func.trim(Admin.emp_id)) == s.lower()).first()


def _parse_doj(val):
    if val is None or val == "":
        return None
    if isinstance(val, date):
        return val
    s = str(val).strip()
    if not s:
        return None
    return datetime.strptime(s.split("T")[0], "%Y-%m-%d").date()


def _parse_amount(val):
    if val is None:
        return None
    s = str(val).strip()
    if not s:
        return None
    return float(s)


def _round2(x):
    try:
        return round(float(x or 0), 2)
    except Exception:
        return 0.0


_CTC_RULES = {
    "hra": {"min_pct": 5.0, "max_pct": 50.0},
    "epf": {"mandatory_pct": 12.0, "basic_threshold": 15000.0, "min_amount_if_above_threshold": 1800.0},
    "ptax": {
        "male": {"slab_7500_10000": 175.0, "slab_above_10000": 200.0, "feb_surcharge": 300.0},
        "female": {"slab_25000_or_more": 200.0},
    },
    "esic": {
        "gross_threshold": 21001.0,
        "employee_pct": 3.25,
        "employer_pct": 0.75,
    },
}


def _ctc_calculate(*, basic_salary, other_allowance, hra_pct, epf_mode, epf_pct, month, gender):
    """
    Implements rules exactly as discussed:
    - HRA: between 5% and 50% of (basic + DA)
    - EPF: if basic < 15000 => 12% mandatory; else choose min 1800 OR percentage
    - PTAX: depends on gender, basic slabs and Feb special
    - ESIC: if gross < 21001 => employee 3.25% and employer 0.75%; else 0
    - Gross = basic + hra_amount + other_allowance
    - Net = Gross - (EPF + PTAX + ESIC_employee)
    """
    basic = float(basic_salary or 0)
    other = float(other_allowance or 0)

    # Month parsing: expects "YYYY-MM" (preferred) but tolerates "February"/etc.
    month_num = None
    if month:
        s = str(month).strip()
        if len(s) >= 7 and s[4] == "-" and s[:4].isdigit() and s[5:7].isdigit():
            try:
                month_num = int(s[5:7])
            except Exception:
                month_num = None
        if month_num is None:
            name = s.lower()
            month_map = {
                "january": 1, "february": 2, "march": 3, "april": 4,
                "may": 5, "june": 6, "july": 7, "august": 8,
                "september": 9, "october": 10, "november": 11, "december": 12,
            }
            month_num = month_map.get(name)

    # HRA
    hra_pct_val = None if hra_pct is None or str(hra_pct).strip() == "" else float(hra_pct)
    if hra_pct_val is None:
        hra_pct_val = _CTC_RULES["hra"]["min_pct"]
    if hra_pct_val < _CTC_RULES["hra"]["min_pct"] or hra_pct_val > _CTC_RULES["hra"]["max_pct"]:
        raise ValueError(f"HRA percentage must be between {_CTC_RULES['hra']['min_pct']} and {_CTC_RULES['hra']['max_pct']}")
    hra_amount = basic * (hra_pct_val / 100.0)

    gross = basic + hra_amount + other

    # EPF
    epf_amount = 0.0
    if basic < _CTC_RULES["epf"]["basic_threshold"]:
        epf_amount = basic * (_CTC_RULES["epf"]["mandatory_pct"] / 100.0)
        epf_mode_effective = "mandatory_12pct"
        epf_pct_effective = _CTC_RULES["epf"]["mandatory_pct"]
    else:
        mode = (epf_mode or "min").strip().lower()
        if mode not in ("min", "percent", "percentage"):
            mode = "min"
        if mode in ("percent", "percentage"):
            pct = None if epf_pct is None or str(epf_pct).strip() == "" else float(epf_pct)
            if pct is None or pct <= 0:
                raise ValueError("EPF percentage is required when EPF mode is percentage")
            epf_amount = basic * (pct / 100.0)
            epf_mode_effective = "percent"
            epf_pct_effective = pct
        else:
            epf_amount = float(_CTC_RULES["epf"]["min_amount_if_above_threshold"])
            epf_mode_effective = "min"
            epf_pct_effective = None

    # PTAX
    g = (gender or "").strip().lower()
    is_male = g.startswith("m")
    is_female = g.startswith("f")
    ptax_amount = 0.0
    if is_male:
        if basic >= 7500 and basic <= 10000:
            ptax_amount = _CTC_RULES["ptax"]["male"]["slab_7500_10000"]
        elif basic > 10000:
            ptax_amount = _CTC_RULES["ptax"]["male"]["slab_above_10000"]
            if month_num == 2:
                ptax_amount = _CTC_RULES["ptax"]["male"]["feb_surcharge"]
    elif is_female:
        if basic >= 25000:
            ptax_amount = _CTC_RULES["ptax"]["female"]["slab_25000_or_more"]
        else:
            ptax_amount = 0.0

    # ESIC
    esic_employee_amount = 0.0
    esic_employer_amount = 0.0
    if gross < _CTC_RULES["esic"]["gross_threshold"]:
        esic_employee_amount = gross * (_CTC_RULES["esic"]["employee_pct"] / 100.0)
        esic_employer_amount = gross * (_CTC_RULES["esic"]["employer_pct"] / 100.0)

    deductions = epf_amount + ptax_amount + esic_employee_amount
    net = gross - deductions

    return {
        "inputs": {
            "basic_salary": _round2(basic),
            "hra_pct": _round2(hra_pct_val),
            "other_allowance": _round2(other),
            "epf_mode": epf_mode_effective,
            "epf_pct": _round2(epf_pct_effective) if epf_pct_effective is not None else None,
            "month": month,
            "gender": gender,
        },
        "computed": {
            "hra_amount": _round2(hra_amount),
            "epf_amount": _round2(epf_amount),
            "ptax_amount": _round2(ptax_amount),
            "esic_employee_amount": _round2(esic_employee_amount),
            "esic_employer_amount": _round2(esic_employer_amount),
            "gross_salary": _round2(gross),
            "net_salary": _round2(net),
            "deductions_total": _round2(deductions),
        },
        "rules": _CTC_RULES,
    }


_EMP_ACC_STRING_FIELDS = (
    "function",
    "designation",
    "location",
    "bank_details",
    "tax_regime",
    "pan",
    "uan",
    "pf_account_number",
    "esi_number",
    "pran",
)


def _get_uploads_root():
    """Single source for uploads directory. Use UPLOADS_ROOT in production if files live elsewhere."""
    root = current_app.config.get("UPLOADS_ROOT")
    if root and str(root).strip():
        return os.path.abspath(str(root).strip())
    return os.path.abspath(os.path.join(current_app.root_path, "..", "uploads"))






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

    upload_folder = os.path.join(_get_uploads_root(), "form16")
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

    upload_folder = os.path.join(_get_uploads_root(), "form16")
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

    upload_folder = os.path.join(_get_uploads_root(), "payslips")
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

    upload_folder = os.path.join(_get_uploads_root(), "payslips")
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

    # Option A: employee can only fetch their own; Accounts/HR/Admin can fetch any
    emp_type_lower = (getattr(admin, "emp_type", None) or "").strip().lower()
    can_view_any = emp_type_lower in ("account", "accounts", "accountant", "hr", "human resource", "admin")
    if not can_view_any and admin_id != admin.id:
        return jsonify({
            "success": False,
            "message": "You can only view your own payslip history"
        }), 403

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


@Accounts.route("/ctc-breakup/<int:admin_id>", methods=["GET"])
@jwt_required()
def get_ctc_breakup(admin_id):
    email = get_jwt().get("email")
    admin = Admin.query.filter_by(email=email).first()
    if not admin:
        return jsonify({
            "success": False,
            "message": "Unauthorized user"
        }), 401

    emp_type_lower = (getattr(admin, "emp_type", None) or "").strip().lower()
    can_view_any = emp_type_lower in ("account", "accounts", "accountant", "hr", "human resource", "admin")
    if not can_view_any and admin_id != admin.id:
        return jsonify({
            "success": False,
            "message": "You can only view your own CTC breakup"
        }), 403

    target_admin = Admin.query.get(admin_id)
    if not target_admin:
        return jsonify({
            "success": False,
            "message": "Employee not found"
        }), 404

    row = CTCBreakup.query.filter_by(admin_id=admin_id).first()
    return jsonify({
        "success": True,
        "ctc_breakup": row.to_dict() if row else None
    }), 200


@Accounts.route("/ctc-breakup/calculate", methods=["POST"])
@jwt_required()
def calculate_ctc_breakup():
    """
    Calculates CTC breakup using current govt rules and employee gender.
    Expects JSON:
    {
      "admin_id": 123,
      "basic_salary": 50000,
      "hra_pct": 5,
      "other_allowance": 0,
      "epf_mode": "min" | "percent",
      "epf_pct": 8,
      "month": "2026-02"
    }
    """
    email = get_jwt().get("email")
    admin = Admin.query.filter_by(email=email).first()
    if not admin:
        return jsonify({"success": False, "message": "Unauthorized user"}), 401

    data = request.get_json(silent=True) or {}
    admin_id = data.get("admin_id")
    if not admin_id:
        return jsonify({"success": False, "message": "admin_id is required"}), 400
    try:
        admin_id = int(admin_id)
    except (TypeError, ValueError):
        return jsonify({"success": False, "message": "Invalid admin_id"}), 400

    emp_type_lower = (getattr(admin, "emp_type", None) or "").strip().lower()
    can_view_any = emp_type_lower in ("account", "accounts", "accountant", "hr", "human resource", "admin")
    if not can_view_any and admin_id != admin.id:
        return jsonify({"success": False, "message": "You can only calculate your own CTC breakup"}), 403

    target_admin = Admin.query.get(admin_id)
    if not target_admin:
        return jsonify({"success": False, "message": "Employee not found"}), 404

    emp = Employee.query.filter_by(admin_id=admin_id).first()
    gender = getattr(emp, "gender", None) if emp else None

    try:
        result = _ctc_calculate(
            basic_salary=_parse_amount(data.get("basic_salary")) or 0,
            other_allowance=_parse_amount(data.get("other_allowance")) or 0,
            hra_pct=data.get("hra_pct"),
            epf_mode=data.get("epf_mode"),
            epf_pct=data.get("epf_pct"),
            month=data.get("month"),
            gender=gender,
        )
        return jsonify({"success": True, "data": result}), 200
    except Exception as e:
        return jsonify({"success": False, "message": str(e)}), 400


@Accounts.route("/ctc-breakup", methods=["PUT"])
@jwt_required()
def upsert_ctc_breakup():
    email = get_jwt().get("email")
    admin = Admin.query.filter_by(email=email).first()
    if not admin:
        return jsonify({
            "success": False,
            "message": "Unauthorized user"
        }), 401

    data = request.get_json(silent=True) or {}
    admin_id = data.get("admin_id")
    if not admin_id:
        return jsonify({
            "success": False,
            "message": "admin_id is required"
        }), 400
    try:
        admin_id = int(admin_id)
    except (TypeError, ValueError):
        return jsonify({
            "success": False,
            "message": "Invalid admin_id"
        }), 400

    emp_type_lower = (getattr(admin, "emp_type", None) or "").strip().lower()
    can_edit_any = emp_type_lower in ("account", "accounts", "accountant", "hr", "human resource", "admin")
    if not can_edit_any and admin_id != admin.id:
        return jsonify({
            "success": False,
            "message": "You can only update your own CTC breakup"
        }), 403

    target_admin = Admin.query.get(admin_id)
    if not target_admin:
        return jsonify({
            "success": False,
            "message": "Employee not found"
        }), 404

    row = CTCBreakup.query.filter_by(admin_id=admin_id).first()
    if not row:
        row = CTCBreakup(admin_id=admin_id)
        db.session.add(row)

    try:
        # Partial update: only fields present in payload are updated.
        if "basic_salary" in data:
            row.basic_salary = _parse_amount(data.get("basic_salary"))
        if "hra" in data:
            row.hra = _parse_amount(data.get("hra"))
        if "other_allowance" in data:
            row.other_allowance = _parse_amount(data.get("other_allowance"))
        if "gross_salary" in data:
            row.gross_salary = _parse_amount(data.get("gross_salary"))
        if "net_salary" in data:
            row.net_salary = _parse_amount(data.get("net_salary"))
        if "epf" in data:
            row.epf = _parse_amount(data.get("epf"))
        if "esic" in data:
            row.esic = _parse_amount(data.get("esic"))
        if "ptax" in data:
            row.ptax = _parse_amount(data.get("ptax"))
        row.updated_at = datetime.now()
        db.session.commit()
    except Exception as e:
        db.session.rollback()
        return jsonify({
            "success": False,
            "message": str(e)
        }), 500

    return jsonify({
        "success": True,
        "message": "CTC breakup saved",
        "ctc_breakup": row.to_dict()
    }), 200


@Accounts.route("/ctc-breakup/history/<int:admin_id>", methods=["GET"])
@jwt_required()
def ctc_breakup_history(admin_id):
    email = get_jwt().get("email")
    admin = Admin.query.filter_by(email=email).first()
    if not admin:
        return jsonify({
            "success": False,
            "message": "Unauthorized user"
        }), 401

    emp_type_lower = (getattr(admin, "emp_type", None) or "").strip().lower()
    can_view_any = emp_type_lower in ("account", "accounts", "accountant", "hr", "human resource", "admin")
    if not can_view_any and admin_id != admin.id:
        return jsonify({
            "success": False,
            "message": "You can only view your own CTC breakup history"
        }), 403

    target_admin = Admin.query.get(admin_id)
    if not target_admin:
        return jsonify({
            "success": False,
            "message": "Employee not found"
        }), 404

    rows = CTCBreakup.query.filter_by(admin_id=admin_id).order_by(CTCBreakup.updated_at.desc(), CTCBreakup.id.desc()).all()
    return jsonify({
        "success": True,
        "history": [r.to_dict() for r in rows]
    }), 200


@Accounts.route("/payslip/<int:payslip_id>", methods=["DELETE"])
@jwt_required()
def delete_payslip(payslip_id):
    email = get_jwt().get("email")
    admin = Admin.query.filter_by(email=email).first()
    if not admin:
        return jsonify({
            "success": False,
            "message": "Unauthorized user"
        }), 401

    emp_type_lower = (getattr(admin, "emp_type", None) or "").strip().lower()
    can_delete_any = emp_type_lower in ("account", "accounts", "accountant", "hr", "human resource", "admin")

    payslip = PaySlip.query.get(payslip_id)
    if not payslip:
        return jsonify({
            "success": False,
            "message": "Payslip not found"
        }), 404

    if not can_delete_any and payslip.admin_id != admin.id:
        return jsonify({
            "success": False,
            "message": "You are not allowed to delete this payslip"
        }), 403

    # Best-effort delete of underlying file
    try:
        uploads_root = _get_uploads_root()
        abs_path = os.path.join(uploads_root, payslip.file_path)
        if os.path.isfile(abs_path):
            os.remove(abs_path)
    except Exception:
        current_app.logger.warning("Error deleting payslip file for id=%s", payslip_id)

    db.session.delete(payslip)
    db.session.commit()

    return jsonify({
        "success": True,
        "message": "Payslip deleted successfully"
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

    # Restrict payslip files: allow if payslip belongs to current user, or user is Accounts/HR/Admin
    if normalized.startswith("payslips/"):
        payslip = PaySlip.query.filter_by(file_path=normalized).first()
        if not payslip:
            return jsonify({
                "success": False,
                "message": "Payslip not found"
            }), 404
        emp_type_lower = (getattr(admin, "emp_type", None) or "").strip().lower()
        can_view_any = emp_type_lower in ("account", "accounts", "accountant", "hr", "human resource", "admin")
        if not can_view_any and payslip.admin_id != admin.id:
            return jsonify({
                "success": False,
                "message": "Access denied"
            }), 403

    uploads_root = _get_uploads_root()

    # Try primary path first (e.g. payslips/foo.pdf or flat foo.pdf).
    full_path = os.path.join(uploads_root, normalized)
    if os.path.isfile(full_path):
        try:
            return send_from_directory(uploads_root, normalized, as_attachment=False)
        except Exception:
            pass

    # Fallback for legacy DB: flat filename (no folder) stored in payslips/form16 subfolders.
    if "/" not in normalized:
        for subdir in ("payslips", "form16"):
            candidate_dir = os.path.join(uploads_root, subdir)
            candidate_path = os.path.join(candidate_dir, normalized)
            if os.path.isfile(candidate_path):
                try:
                    return send_from_directory(candidate_dir, normalized, as_attachment=False)
                except Exception:
                    continue

    # Profile docs and other static uploads live under Flask static/uploads/
    # Example: upload_profile_file stores "profile/<filename>" under static/uploads/profile/.
    static_uploads_root = os.path.join(current_app.static_folder, "uploads")
    static_full_path = os.path.join(static_uploads_root, normalized)
    if os.path.isfile(static_full_path):
        try:
            return send_from_directory(static_uploads_root, normalized, as_attachment=False)
        except Exception:
            pass

    return jsonify({
        "success": False,
        "message": "File not found on server."
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


@Accounts.route("/download-excel-client", methods=["GET"])
@jwt_required()
def download_excel_client_api():
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

    output = generate_client_attendance_excel(
        admins=admins,
        year=year,
        month=month
    )

    filename = f"Client_Attendance_{circle}_{emp_type}_{calendar.month_name[month]}_{year}.xlsx"
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


@Accounts.route("/employee-accounts-profile", methods=["GET"])
@jwt_required()
def get_employee_accounts_profile():
    """
    Load Accounts payroll/statutory profile for one employee.
    Query: admin_id (int) OR employee_number (matches admins.emp_id).
    If omitted, returns the logged-in user's profile.
    """
    email = get_jwt().get("email")
    viewer = Admin.query.filter_by(email=email).first()
    if not viewer:
        return jsonify({"success": False, "message": "Unauthorized user"}), 401

    admin_id_param = request.args.get("admin_id", type=int)
    employee_number = (request.args.get("employee_number") or "").strip()

    target_admin = None
    if _is_hr(viewer):
        if admin_id_param:
            target_admin = Admin.query.get(admin_id_param)
        elif employee_number:
            target_admin = _find_admin_by_employee_number(employee_number)
        else:
            target_admin = viewer
    else:
        target_admin = viewer
        if admin_id_param and admin_id_param != viewer.id:
            return jsonify({"success": False, "message": "You can only view your own profile"}), 403
        if employee_number:
            resolved = _find_admin_by_employee_number(employee_number)
            if not resolved or resolved.id != viewer.id:
                return jsonify({"success": False, "message": "Invalid employee number for your account"}), 403

    if not target_admin:
        return jsonify({"success": False, "message": "Employee not found"}), 404

    row = EmployeeAccounts.query.filter_by(admin_id=target_admin.id).first()
    employee_details = Employee.query.filter_by(admin_id=target_admin.id).first()

    # Auto-fill defaults from authoritative tables.
    # Rule: use EmployeeAccounts value if it's set, otherwise fallback to:
    # - function -> Admin.emp_type
    # - date_of_joining -> Admin.doj
    # - designation -> Employee.designation
    base = row.to_dict() if row else {}

    def _str_or_none(x):
        if x is None:
            return None
        s = str(x).strip()
        return s or None

    def _date_iso(d):
        if d is None:
            return None
        return d.isoformat() if hasattr(d, "isoformat") else None

    auto_function = _str_or_none(getattr(target_admin, "emp_type", None))
    auto_designation = _str_or_none(getattr(employee_details, "designation", None)) if employee_details else None
    auto_doj = _date_iso(getattr(target_admin, "doj", None))

    profile = {
        "id": base.get("id"),
        "admin_id": base.get("admin_id"),
        "employee_number": base.get("employee_number") or getattr(target_admin, "emp_id", None),
        "function": _str_or_none(base.get("function")) or auto_function,
        "designation": _str_or_none(base.get("designation")) or auto_designation,
        "location": base.get("location"),
        "bank_details": base.get("bank_details"),
        "date_of_joining": base.get("date_of_joining") or auto_doj,
        "tax_regime": base.get("tax_regime"),
        "pan": base.get("pan"),
        "uan": base.get("uan"),
        "pf_account_number": base.get("pf_account_number"),
        "esi_number": base.get("esi_number"),
        "pran": base.get("pran"),
        "created_at": base.get("created_at"),
        "updated_at": base.get("updated_at"),
    }

    return jsonify({
        "success": True,
        "admin": {
            "id": target_admin.id,
            "emp_id": target_admin.emp_id,
            "first_name": target_admin.first_name,
            "email": target_admin.email,
            "doj": target_admin.doj.isoformat() if target_admin.doj else None,
        },
        "profile": profile,
    }), 200


@Accounts.route("/employee-accounts-profile", methods=["PUT"])
@jwt_required()
def put_employee_accounts_profile():
    """
    Partial save. If body contains employee_number, it must match an existing Admin.emp_id;
    then admin_id is set and all other provided fields are merged.
    Staff (Accounts/HR/Admin) may pass admin_id to edit a specific employee without sending employee_number again.
    """
    email = get_jwt().get("email")
    viewer = Admin.query.filter_by(email=email).first()
    if not viewer:
        return jsonify({"success": False, "message": "Unauthorized user"}), 401

    # Only HR can update accounts profiles.
    if not _is_hr(viewer):
        return jsonify({"success": False, "message": "HR access required"}), 403

    data = request.get_json(silent=True) or {}
    admin_id_body = data.get("admin_id")
    try:
        admin_id_body = int(admin_id_body) if admin_id_body is not None and str(admin_id_body).strip() else None
    except (TypeError, ValueError):
        admin_id_body = None

    employee_number_in = data.get("employee_number")
    if employee_number_in is not None:
        employee_number_in = str(employee_number_in).strip() or None

    target_admin = None
    if _accounts_can_access_any_profile(viewer):
        if admin_id_body:
            target_admin = Admin.query.get(admin_id_body)
        elif employee_number_in:
            target_admin = _find_admin_by_employee_number(employee_number_in)
        else:
            target_admin = viewer
    else:
        target_admin = viewer
        if admin_id_body and admin_id_body != viewer.id:
            return jsonify({"success": False, "message": "You can only update your own profile"}), 403
        if employee_number_in:
            resolved = _find_admin_by_employee_number(employee_number_in)
            if not resolved or resolved.id != viewer.id:
                return jsonify({
                    "success": False,
                    "message": "Employee number does not match your account",
                }), 400

    if not target_admin:
        if employee_number_in:
            return jsonify({
                "success": False,
                "message": "Employee number does not match any employee (check Admin emp_id)",
            }), 400
        return jsonify({"success": False, "message": "Employee not found"}), 404

    if employee_number_in:
        resolved = _find_admin_by_employee_number(employee_number_in)
        if not resolved or resolved.id != target_admin.id:
            return jsonify({
                "success": False,
                "message": "Employee number does not match this employee's emp_id",
            }), 400

    row = EmployeeAccounts.query.filter_by(admin_id=target_admin.id).first()
    if not row:
        row = EmployeeAccounts(
            admin_id=target_admin.id,
            employee_number=(employee_number_in or (target_admin.emp_id or "")).strip() or None,
        )
        db.session.add(row)
    else:
        if employee_number_in:
            row.employee_number = employee_number_in
        elif not row.employee_number and target_admin.emp_id:
            row.employee_number = (target_admin.emp_id or "").strip() or None

    for key in _EMP_ACC_STRING_FIELDS:
        if key not in data:
            continue
        val = data.get(key)
        setattr(row, key, (str(val).strip() if val is not None and str(val).strip() else None))

    if "date_of_joining" in data:
        row.date_of_joining = _parse_doj(data.get("date_of_joining"))

    row.updated_at = datetime.utcnow()
    try:
        db.session.commit()
    except Exception as e:
        db.session.rollback()
        current_app.logger.exception("employee_accounts save")
        return jsonify({"success": False, "message": str(e)}), 500

    return jsonify({
        "success": True,
        "message": "Profile saved",
        "profile": row.to_dict(),
    }), 200
