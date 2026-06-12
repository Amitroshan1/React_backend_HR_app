

#https://solviotec.com/api/account



from flask import Blueprint, request, current_app, jsonify,json, send_from_directory, send_file
from flask_jwt_extended import jwt_required, get_jwt
from .email import send_email_via_zeptomail,send_welcome_email,send_payslip_uploaded_email,send_form16_uploaded_email,send_claim_line_item_decision_email
from .models.Admin_models import Admin
from datetime import datetime,date,timedelta
from .datetime_utils import utc_now, isoformat_api
from zoneinfo import ZoneInfo
import calendar
from .email import asset_email,update_asset_email
from .expense_utils import generate_expense_claim_excel
from .utility import (
    generate_attendance_excel_Accounts,
    generate_client_attendance_excel,
    send_excel_file,
    calculate_month_summary,
    calculate_monthly_payroll_from_ctc_and_attendance,
    calculate_actual_working_days_Accounts,
)
from .circle_transfer_utils import fetch_admins_for_attendance_export
from .models.emp_detail_models import Employee,Asset
from .models.family_models import FamilyDetails
from .models.prev_com import PreviousCompany
from .models.education import UploadDoc, Education
from .models.attendance import Punch, LeaveApplication,LeaveBalance
from .models.news_feed import NewsFeed, PaySlip, Form16
from werkzeug.security import generate_password_hash
import os
from functools import wraps
from io import BytesIO
from . import db
from .noc_department_service import download_noc_document, list_noc_requests, upload_noc_document
from werkzeug.utils import secure_filename
from sqlalchemy import func, or_
from .models.expense import ExpenseLineItem, ExpenseClaimHeader
from .expense_utils import claim_attach_storage_name
from .models.employee_accounts import EmployeeAccounts
from .models.ctc_breakup import CTCBreakup
from .models.monthly_payroll import MonthlyPayroll
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen import canvas


Accounts = Blueprint('Accounts', __name__)


_ACCOUNTS_ROUTE_FEATURES = (
    ("account_payroll", ("/payroll", "/payroll-summary")),
    ("account_ctc_breakup", ("/ctc-breakup", "/tds", "/tax-rules")),
    ("account_for_client", ("/download-excel-client",)),
)


@Accounts.before_request
def _accounts_plan_guard():
    from flask import request
    from .plan_features import has_feature, plan_forbidden_response

    if request.method == "OPTIONS":
        return None
    if not has_feature("account_panel"):
        return plan_forbidden_response("account_panel")

    path = (request.path or "").lower()
    for feature, prefixes in _ACCOUNTS_ROUTE_FEATURES:
        if any(p in path for p in prefixes) and not has_feature(feature):
            return plan_forbidden_response(feature)
    return None


def accounts_department_required(fn):
    """Accounts-only (not HR-only) for Accounts department NOC queue."""

    @wraps(fn)
    def wrapper(*args, **kwargs):
        claims = get_jwt()
        emp_type = (claims.get("emp_type") or "").strip().lower().replace("-", " ")
        emp_type = " ".join(emp_type.split())
        if emp_type not in {"account", "accounts", "accountant"}:
            return jsonify({"success": False, "message": "Accounts access required"}), 403
        return fn(*args, **kwargs)

    return wrapper


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


def _fmt_money(v):
    try:
        return f"{float(v or 0.0):,.2f}"
    except Exception:
        return "0.00"


def _fit_text_pdf(text, font_name, font_size, max_w):
    """Truncate text so it fits within max_w points (ReportLab stringWidth)."""
    s = str(text if text is not None else "-").strip() or "-"
    if stringWidth(s, font_name, font_size) <= max_w:
        return s
    ell = "..."
    while s and stringWidth(s + ell, font_name, font_size) > max_w:
        s = s[:-1]
    return (s + ell) if s else ell


def _wrap_lines_pdf(text, font_name, font_size, max_w):
    """Word-wrap into lines that each fit within max_w (no truncation)."""
    words = str(text or "").split()
    if not words:
        return [""]
    lines = []
    cur = words[0]
    if stringWidth(cur, font_name, font_size) > max_w:
        return [_fit_text_pdf(cur, font_name, font_size, max_w)]
    for w in words[1:]:
        if stringWidth(w, font_name, font_size) > max_w:
            lines.append(cur)
            cur = _fit_text_pdf(w, font_name, font_size, max_w)
            continue
        test = f"{cur} {w}"
        if stringWidth(test, font_name, font_size) <= max_w:
            cur = test
        else:
            lines.append(cur)
            cur = w
    lines.append(cur)
    return lines


_ONES = (
    "Zero",
    "One",
    "Two",
    "Three",
    "Four",
    "Five",
    "Six",
    "Seven",
    "Eight",
    "Nine",
    "Ten",
    "Eleven",
    "Twelve",
    "Thirteen",
    "Fourteen",
    "Fifteen",
    "Sixteen",
    "Seventeen",
    "Eighteen",
    "Nineteen",
)
_TENS = (
    "",
    "",
    "Twenty",
    "Thirty",
    "Forty",
    "Fifty",
    "Sixty",
    "Seventy",
    "Eighty",
    "Ninety",
)


def _words_under_100(n):
    n = int(n)
    if n < 20:
        return _ONES[n]
    if n < 100:
        t = _TENS[n // 10]
        u = n % 10
        return f"{t} {_ONES[u]}".strip() if u else t
    return ""


def _words_under_1000(n):
    n = int(n)
    if n <= 0:
        return ""
    if n < 100:
        return _words_under_100(n)
    if n < 1000:
        h = n // 100
        r = n % 100
        base = f"{_ONES[h]} Hundred"
        if r:
            return f"{base} {_words_under_100(r)}"
        return base
    # 1000–99999 (e.g. large crore counts): split as N Thousand + remainder
    if n < 100000:
        th = n // 1000
        rem = n % 1000
        s = f"{_words_under_1000(th)} Thousand"
        if rem:
            s = f"{s} {_words_under_1000(rem)}"
        return s
    return str(n)


def _rupees_in_words(amount):
    """Indian numbering (lakhs/crores) for payslip footer."""
    n = int(round(float(amount or 0)))
    if n == 0:
        return "Zero"
    if n < 0:
        return f"Minus {_rupees_in_words(-n)}"
    parts = []
    crores = n // 10000000
    n %= 10000000
    lakhs = n // 100000
    n %= 100000
    thousands = n // 1000
    remainder = n % 1000
    if crores:
        parts.append(f"{_words_under_1000(crores)} Crore")
    if lakhs:
        parts.append(f"{_words_under_1000(lakhs)} Lakh")
    if thousands:
        parts.append(f"{_words_under_1000(thousands)} Thousand")
    if remainder:
        parts.append(_words_under_1000(remainder))
    return " ".join(parts)


def _prorate_earnings_to_gross(basic, hra, other, target_gross):
    """Scale CTC components so they sum to monthly gross (payroll)."""
    b = float(basic or 0.0)
    h = float(hra or 0.0)
    o = float(other or 0.0)
    s = b + h + o
    tg = float(target_gross or 0.0)
    if tg <= 0:
        return 0.0, 0.0, 0.0
    if s <= 0:
        return round(tg / 3.0, 2), round(tg / 3.0, 2), round(tg / 3.0, 2)
    r = tg / s
    b2 = round(b * r, 2)
    h2 = round(h * r, 2)
    o2 = round(o * r, 2)
    diff = round(tg - (b2 + h2 + o2), 2)
    o2 = round(o2 + diff, 2)
    return b2, h2, o2


from .commands.ctc_breakup_logic import (
    DEFAULT_HRA_PCT,
    annual_ctc_from_monthly,
    basic_pct_of_monthly_ctc,
    employer_costs_summary,
    maharashtra_professional_tax,
    monthly_components,
    reverse_ctc_breakup,
)
from .commands.payroll_logic import payroll_earnings_factor
from .commands.tds_logic import (
    financial_year_for_date,
    list_available_tax_rules,
    load_tax_rules,
    normalize_regime,
    run_tds_projection,
)

_CTC_RULES = {
    "hra": {"min_pct": 5.0, "max_pct": 50.0},
    "epf": {"mandatory_pct": 12.0, "basic_threshold": 15000.0, "min_amount_if_above_threshold": 1800.0},
    "ptax": {
        "basis": "monthly_gross",
        "state": "Maharashtra",
        "male": {
            "upto_7500": 0.0,
            "7501_to_10000": 175.0,
            "above_10000": 200.0,
            "february": 300.0,
        },
        "female": {
            "upto_25000": 0.0,
            "above_25000": 200.0,
            "february": 300.0,
        },
    },
    "esic": {
        "gross_threshold": 21001.0,
        "employee_pct": 0.75,
        "employer_pct": 3.25,
    },
}


def _ctc_calculate(
    *,
    basic_salary,
    other_allowance,
    hra_pct,
    epf_mode,
    epf_pct,
    month,
    gender,
    mediclaim_yearly=0,
):
    """
    Implements rules exactly as discussed:
    - HRA: between 5% and 50% of (basic + DA)
    - EPF: if basic < 15000 => 12% mandatory; else choose min 1800 OR percentage
    - PTAX: Maharashtra slabs on monthly gross, gender, and February
    - ESIC: if gross < 21001 => employee 0.75% and employer 3.25%; else 0
    - Gross = basic + hra_amount + other_allowance
    - Net = Gross - (EPF + PTAX + ESIC_employee)
    """
    other = float(other_allowance or 0)

    # HRA
    hra_pct_val = None if hra_pct is None or str(hra_pct).strip() == "" else float(hra_pct)
    if hra_pct_val is None:
        hra_pct_val = _CTC_RULES["hra"]["min_pct"]
    if hra_pct_val < _CTC_RULES["hra"]["min_pct"] or hra_pct_val > _CTC_RULES["hra"]["max_pct"]:
        raise ValueError(f"HRA percentage must be between {_CTC_RULES['hra']['min_pct']} and {_CTC_RULES['hra']['max_pct']}")

    mediclaim = max(0.0, float(mediclaim_yearly or 0))
    basic, hra_amount, other, gross = monthly_components(
        float(basic_salary or 0),
        hra_pct_val,
        other,
        apply_floor=True,
        mediclaim_yearly=mediclaim,
    )

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

    # PTAX (Maharashtra — monthly gross salary)
    ptax_amount = maharashtra_professional_tax(gross, gender, month)

    # ESIC
    esic_employee_amount = 0.0
    esic_employer_amount = 0.0
    if gross < _CTC_RULES["esic"]["gross_threshold"]:
        esic_employee_amount = gross * (_CTC_RULES["esic"]["employee_pct"] / 100.0)
        esic_employer_amount = gross * (_CTC_RULES["esic"]["employer_pct"] / 100.0)

    deductions = epf_amount + ptax_amount + esic_employee_amount
    net = gross - deductions
    employer_costs = employer_costs_summary(basic, gross, mediclaim)
    annual_ctc_total = annual_ctc_from_monthly(
        basic, hra_pct_val, other, mediclaim
    )

    return {
        "inputs": {
            "basic_salary": _round2(basic),
            "hra_pct": _round2(hra_pct_val),
            "other_allowance": _round2(other),
            "epf_mode": epf_mode_effective,
            "epf_pct": _round2(epf_pct_effective) if epf_pct_effective is not None else None,
            "month": month,
            "gender": gender,
            "mediclaim_yearly": _round2(mediclaim),
        },
        "computed": {
            "basic_pct_of_monthly_ctc": _round2(
                basic_pct_of_monthly_ctc(basic, hra_pct_val, other, mediclaim)
            ),
            "hra_amount": _round2(hra_amount),
            "epf_amount": _round2(epf_amount),
            "ptax_amount": _round2(ptax_amount),
            "esic_employee_amount": _round2(esic_employee_amount),
            "esic_employer_amount": _round2(esic_employer_amount),
            "gross_salary": _round2(gross),
            "net_salary": _round2(net),
            "deductions_total": _round2(deductions),
            "gratuity_yearly": employer_costs["gratuity_yearly"],
            "gratuity_monthly": employer_costs["gratuity_monthly"],
            "employer_pf_yearly": employer_costs["employer_pf_yearly"],
            "employer_pf_monthly": employer_costs["employer_pf_monthly"],
            "employer_esic_yearly": employer_costs["employer_esic_yearly"],
            "employer_esic_monthly": employer_costs["employer_esic_monthly"],
            "mediclaim_yearly": employer_costs["mediclaim_yearly"],
            "annual_ctc_total": _round2(annual_ctc_total),
        },
        "rules": _CTC_RULES,
    }


def _ctc_reverse_from_annual(
    *,
    annual_ctc,
    other_allowance,
    hra_pct,
    epf_mode,
    epf_pct,
    month,
    gender,
    mediclaim_yearly=0,
):
    """
    Derive Basic + DA, HRA, and Other from full annual CTC including
    employer PF, employer ESIC, mediclaim, and gratuity.
    """
    other_for_solve = max(0.0, float(other_allowance or 0))
    solved = reverse_ctc_breakup(
        annual_ctc,
        hra_pct,
        other_allowance=other_for_solve,
        mediclaim_yearly=mediclaim_yearly,
    )
    result = _ctc_calculate(
        basic_salary=solved["basic_salary"],
        other_allowance=solved["other_allowance"],
        hra_pct=solved["hra_pct"],
        epf_mode=epf_mode,
        epf_pct=epf_pct,
        month=month,
        gender=gender,
        mediclaim_yearly=mediclaim_yearly,
    )
    result["computed"]["annual_ctc_total"] = _round2(solved.get("annual_ctc_computed") or 0)
    result["computed"]["mediclaim_yearly"] = _round2(mediclaim_yearly or 0)
    result["derived"] = {
        "annual_ctc": solved["annual_ctc"],
        "annual_ctc_computed": solved.get("annual_ctc_computed"),
        "basic_salary": solved["basic_salary"],
        "hra_amount": solved["hra_amount"],
        "hra_pct": solved["hra_pct"],
        "other_allowance": solved["other_allowance"],
        "monthly_gross": solved["gross_salary"],
        "mediclaim_yearly": solved.get("mediclaim_yearly", 0),
        "employer_costs": solved.get("employer_costs", {}),
    }
    return result


def _sync_annual_ctc_computed(row):
    """Recompute and persist final annual CTC from saved salary components."""
    basic = float(row.basic_salary or 0)
    if basic <= 0:
        return
    row.annual_ctc_computed = _round2(
        annual_ctc_from_monthly(
            basic,
            row.hra_pct if row.hra_pct is not None else 40,
            row.other_allowance or 0,
            row.mediclaim_yearly or 0,
        )
    )


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
        working_days = calculate_actual_working_days_Accounts(
            admin_id=emp.id,
            emp_type=emp_type,
            year=selected_year,
            month_num=selected_month,
        )

        data.append({
            "id": emp.id,
            "emp_id": emp.emp_id,
            "first_name": employee_details.name if employee_details and employee_details.name else emp.first_name,
            "email": employee_details.email if employee_details and employee_details.email else emp.email,
            "mobile": emp.mobile,
            "working_days": round(float(working_days or 0.0), 1),
            "bank_details_available": bool(upload_doc and upload_doc.passbook_front),
            "bank_details_path": upload_doc.passbook_front if upload_doc else None,
            "documents": _serialize_upload_doc(upload_doc),
            "form16_available": bool(latest_form16 and latest_form16.file_path),
            "form16_path": latest_form16.file_path if latest_form16 else None
        })

    return jsonify({
        "success": True,
        "count": len(data),
        "employees": data
    }), 200


def _serialize_upload_doc(upload_doc):
    """Identity fields + file paths for Accounts / HR document views."""
    if not upload_doc:
        return {}
    from .auth import _upload_doc_profile_dict
    return _upload_doc_profile_dict(upload_doc)


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
        "documents": _serialize_upload_doc(upload_doc),
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
            "created_at": isoformat_api(row.created_at)
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
    if row:
        _sync_annual_ctc_computed(row)
        db.session.commit()
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
            mediclaim_yearly=_parse_amount(data.get("mediclaim_yearly")) or 0,
        )
        return jsonify({"success": True, "data": result}), 200
    except Exception as e:
        return jsonify({"success": False, "message": str(e)}), 400


@Accounts.route("/ctc-breakup/reverse-calculate", methods=["POST"])
@jwt_required()
def reverse_calculate_ctc_breakup():
    """
    Derive Basic + DA and HRA from annual CTC; returns full computed breakup.
    Expects JSON:
    {
      "admin_id": 123,
      "annual_ctc": 500000,
      "other_allowance": 0,
      "hra_pct": 40,
      "epf_mode": "min" | "percent",
      "epf_pct": 8,
      "month": "2026-06"
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
    can_view_any = emp_type_lower in (
        "account", "accounts", "accountant", "hr", "human resource", "admin"
    )
    if not can_view_any and admin_id != admin.id:
        return jsonify({
            "success": False,
            "message": "You can only calculate your own CTC breakup",
        }), 403

    target_admin = Admin.query.get(admin_id)
    if not target_admin:
        return jsonify({"success": False, "message": "Employee not found"}), 404

    emp = Employee.query.filter_by(admin_id=admin_id).first()
    gender = getattr(emp, "gender", None) if emp else None

    annual_ctc = _parse_amount(data.get("annual_ctc"))
    if not annual_ctc or annual_ctc <= 0:
        return jsonify({
            "success": False,
            "message": "annual_ctc is required and must be greater than 0",
        }), 400

    try:
        result = _ctc_reverse_from_annual(
            annual_ctc=annual_ctc,
            other_allowance=data.get("other_allowance"),
            hra_pct=data.get("hra_pct"),
            epf_mode=data.get("epf_mode"),
            epf_pct=data.get("epf_pct"),
            month=data.get("month"),
            gender=gender,
            mediclaim_yearly=_parse_amount(data.get("mediclaim_yearly")) or 0,
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
        amount_fields = (
            "basic_salary",
            "hra",
            "hra_pct",
            "other_allowance",
            "gross_salary",
            "net_salary",
            "epf",
            "epf_pct",
            "esic",
            "esic_employer",
            "ptax",
            "deductions_total",
            "annual_ctc",
            "annual_ctc_computed",
            "mediclaim_yearly",
            "gratuity_yearly",
            "gratuity_monthly",
            "employer_pf_yearly",
            "employer_pf_monthly",
            "employer_esic_yearly",
            "employer_esic_monthly",
        )
        for field in amount_fields:
            if field in data:
                row.__setattr__(field, _parse_amount(data.get(field)))

        if "epf_mode" in data:
            row.epf_mode = (data.get("epf_mode") or "").strip() or None
        if "ptax_month" in data:
            row.ptax_month = (data.get("ptax_month") or "").strip() or None

        _sync_annual_ctc_computed(row)

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


def _parse_iso_date(val):
    if not val:
        return None
    if hasattr(val, "isoformat"):
        return val
    s = str(val).strip()
    if not s:
        return None
    try:
        return date.fromisoformat(s[:10])
    except ValueError:
        return None


def _tds_ytd_gross_and_tds(admin_id, financial_year):
    """Sum gross from monthly payroll rows in the financial year (if saved)."""
    from .commands.tds_logic import fy_start_end
    fy_start, fy_end = fy_start_end(financial_year)
    rows = MonthlyPayroll.query.filter_by(admin_id=admin_id).all()
    ytd_gross = 0.0
    for row in rows:
        try:
            y = int(row.year)
            m = int(row.month_num)
        except (TypeError, ValueError):
            continue
        d = date(y, m, 1)
        if fy_start <= d <= fy_end:
            ytd_gross += float(row.gross_salary_for_month or 0)
    return ytd_gross, 0.0


@Accounts.route("/tax-rules", methods=["GET"])
@jwt_required()
def get_tax_rules():
    email = get_jwt().get("email")
    admin = Admin.query.filter_by(email=email).first()
    if not admin:
        return jsonify({"success": False, "message": "Unauthorized user"}), 401

    fy = (request.args.get("financial_year") or "").strip()
    regime = (request.args.get("regime") or "new").strip()

    if fy:
        try:
            rules = load_tax_rules(fy, regime)
            return jsonify({"success": True, "rules": rules}), 200
        except ValueError as e:
            return jsonify({"success": False, "message": str(e)}), 404

    return jsonify({
        "success": True,
        "available": list_available_tax_rules(),
    }), 200


@Accounts.route("/tds/projection", methods=["POST"])
@jwt_required()
def tds_projection():
    """
    Project annual tax and monthly TDS for an employee using CTC breakup
    and Employee Accounts profile (tax regime, PAN, DOJ).
    """
    email = get_jwt().get("email")
    viewer = Admin.query.filter_by(email=email).first()
    if not viewer:
        return jsonify({"success": False, "message": "Unauthorized user"}), 401

    data = request.get_json(silent=True) or {}
    admin_id = data.get("admin_id")
    if not admin_id:
        return jsonify({"success": False, "message": "admin_id is required"}), 400
    try:
        admin_id = int(admin_id)
    except (TypeError, ValueError):
        return jsonify({"success": False, "message": "Invalid admin_id"}), 400

    emp_type_lower = (getattr(viewer, "emp_type", None) or "").strip().lower()
    can_view_any = emp_type_lower in ("account", "accounts", "accountant", "hr", "human resource", "admin")
    if not can_view_any and admin_id != viewer.id:
        return jsonify({"success": False, "message": "Access denied"}), 403

    target_admin = Admin.query.get(admin_id)
    if not target_admin:
        return jsonify({"success": False, "message": "Employee not found"}), 404

    ctc = CTCBreakup.query.filter_by(admin_id=admin_id).first()
    if not ctc or not float(ctc.gross_salary or 0):
        return jsonify({
            "success": False,
            "message": "CTC breakup not found or gross salary is zero. Save CTC first.",
        }), 400

    profile_row = EmployeeAccounts.query.filter_by(admin_id=admin_id).first()
    profile = profile_row.to_dict() if profile_row else {}

    financial_year = (data.get("financial_year") or "").strip() or financial_year_for_date()
    as_of_str = (data.get("as_of") or "").strip()
    as_of = _parse_iso_date(as_of_str) if as_of_str else date.today()

    doj = _parse_iso_date(profile.get("date_of_joining")) or _parse_iso_date(
        getattr(target_admin, "doj", None)
    )

    ytd_gross, ytd_tds = _tds_ytd_gross_and_tds(admin_id, financial_year)

    monthly_ptax = float(ctc.ptax or 0)
    ptax_annual = monthly_ptax * 12

    try:
        projection = run_tds_projection(
            monthly_gross=float(ctc.gross_salary or 0),
            monthly_basic=float(ctc.basic_salary or 0),
            monthly_hra=float(ctc.hra or 0),
            monthly_epf=float(ctc.epf or 0),
            tax_regime=profile.get("tax_regime"),
            financial_year=financial_year,
            pan=profile.get("pan"),
            date_of_joining=doj,
            ytd_gross=ytd_gross if data.get("use_ytd_gross", True) else 0,
            ytd_tds=_parse_amount(data.get("ytd_tds")) or ytd_tds,
            previous_employer_taxable=_parse_amount(data.get("previous_employer_taxable")) or 0,
            previous_employer_tds=_parse_amount(data.get("previous_employer_tds")) or 0,
            rent_paid_annual=_parse_amount(data.get("rent_paid_annual")) or 0,
            is_metro=bool(data.get("is_metro")),
            section_80c_extra=_parse_amount(data.get("section_80c_extra")) or 0,
            section_80d=_parse_amount(data.get("section_80d")) or 0,
            ptax_annual=ptax_annual,
            as_of=as_of,
        )
    except ValueError as e:
        return jsonify({"success": False, "message": str(e)}), 400

    projection["employee"] = {
        "admin_id": admin_id,
        "name": (target_admin.first_name or "").strip() or target_admin.email,
        "tax_regime": profile.get("tax_regime"),
        "pan": profile.get("pan"),
        "date_of_joining": doj.isoformat() if doj else None,
    }

    return jsonify({"success": True, "projection": projection}), 200


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

    # Claim receipts: stored under uploads/expenses/; DB may hold basename or expenses/name
    if "/" not in normalized:
        expense_rel = os.path.join("expenses", normalized)
        expense_full = os.path.join(static_uploads_root, expense_rel)
        if os.path.isfile(expense_full):
            try:
                return send_from_directory(static_uploads_root, expense_rel, as_attachment=False)
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

    admins = fetch_admins_for_attendance_export(circle, emp_type, year, month)

    if not admins:
        return jsonify({
            "success": False,
            "message": "No employees found"
        }), 404

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

    admins = fetch_admins_for_attendance_export(circle, emp_type, year, month)

    if not admins:
        return jsonify({
            "success": False,
            "message": "No employees found"
        }), 404

    output = generate_client_attendance_excel(
        admins=admins,
        year=year,
        month=month,
        circle=circle,
        emp_type=emp_type,
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
        db.func.coalesce(Admin.is_exited, False) == False,
        db.func.coalesce(Admin.is_active, True) == True,
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


def _claim_status_from_line_items(items):
    if not items:
        return "Pending"
    statuses = {str(i.status or "Pending") for i in items}
    if statuses == {"Approved"}:
        return "Approved"
    if statuses == {"Rejected"}:
        return "Rejected"
    if "Pending" in statuses:
        return "Pending"
    return "Partially Approved"


@Accounts.route("/expense-claims", methods=["GET"])
@jwt_required()
def list_expense_claims():
    """Accounts: list all expense claims with optional filters."""
    email = get_jwt().get("email")
    admin = Admin.query.filter_by(email=email).first()
    if not admin:
        return jsonify({"success": False, "message": "Unauthorized user"}), 401

    status = (request.args.get("status") or "All").strip()
    circle = (request.args.get("circle") or "").strip()
    emp_type = (request.args.get("emp_type") or "").strip()
    q = (request.args.get("q") or "").strip()
    month_year_raw = (request.args.get("month_year") or "").strip()
    month_raw = (request.args.get("month") or "All").strip()
    year_raw = (request.args.get("year") or "All").strip()
    from_date_raw = (request.args.get("from_date") or "").strip()
    to_date_raw = (request.args.get("to_date") or "").strip()

    filter_month = None
    filter_year = None
    if month_year_raw:
        try:
            parts = month_year_raw.split("-")
            if len(parts) < 2:
                raise ValueError("month_year must be YYYY-MM")
            filter_year = int(parts[0])
            filter_month = int(parts[1])
            if filter_month < 1 or filter_month > 12:
                raise ValueError("invalid month")
        except ValueError:
            return jsonify({"success": False, "message": "Invalid month_year (YYYY-MM)"}), 400
    else:
        if month_raw.lower() != "all":
            try:
                filter_month = _parse_month_to_num(month_raw)
            except ValueError:
                return jsonify({"success": False, "message": "Invalid month"}), 400
        if year_raw.lower() != "all":
            try:
                filter_year = int(str(year_raw).strip())
            except ValueError:
                return jsonify({"success": False, "message": "Invalid year"}), 400

    from_date = None
    to_date = None
    try:
        if from_date_raw:
            from_date = datetime.fromisoformat(from_date_raw[:10]).date()
        if to_date_raw:
            to_date = datetime.fromisoformat(to_date_raw[:10]).date()
    except ValueError:
        return jsonify({"success": False, "message": "Invalid from_date or to_date (YYYY-MM-DD)"}), 400

    rows = (
        ExpenseClaimHeader.query
        .join(Admin, ExpenseClaimHeader.admin_id == Admin.id)
        .order_by(ExpenseClaimHeader.id.desc())
        .all()
    )

    claims_out = []
    for row in rows:
        emp = row.admin
        if circle and circle.lower() != "all":
            if (getattr(emp, "circle", None) or "").strip().lower() != circle.lower():
                continue
        if emp_type and emp_type.lower() != "all":
            if (getattr(emp, "emp_type", None) or "").strip().lower() != emp_type.lower():
                continue
        if q:
            like = q.lower()
            haystack = " ".join(
                filter(
                    None,
                    [
                        row.employee_name,
                        row.emp_id,
                        row.email,
                        row.project_name,
                        getattr(emp, "first_name", None),
                        getattr(emp, "email", None),
                    ],
                )
            ).lower()
            if like not in haystack:
                continue

        line_items = (
            ExpenseLineItem.query.filter_by(claim_id=row.id)
            .order_by(ExpenseLineItem.sr_no.asc())
            .all()
        )
        derived_status = _claim_status_from_line_items(line_items)
        if status and status.lower() != "all" and derived_status.lower() != status.lower():
            continue

        items_out = []
        for li in line_items:
            if from_date and li.date and li.date < from_date:
                continue
            if to_date and li.date and li.date > to_date:
                continue
            if filter_month and (not li.date or li.date.month != filter_month):
                continue
            if filter_year and (not li.date or li.date.year != filter_year):
                continue
            file_path = claim_attach_storage_name(li.Attach_file) if li.Attach_file else None
            items_out.append(
                {
                    "id": li.id,
                    "sr_no": li.sr_no,
                    "date": li.date.isoformat() if li.date else None,
                    "purpose": li.purpose,
                    "amount": float(li.amount or 0),
                    "currency": li.currency,
                    "status": li.status,
                    "attach_file": li.Attach_file,
                    "file_path": file_path,
                    "rejection_reason": getattr(li, "rejection_reason", None),
                }
            )

        if (from_date or to_date or filter_month or filter_year) and not items_out:
            continue

        claims_out.append(
            {
                "id": row.id,
                "employee_name": row.employee_name or (emp.first_name if emp else ""),
                "employee_email": row.email or (emp.email if emp else ""),
                "emp_id": row.emp_id or (emp.emp_id if emp else ""),
                "circle": emp.circle if emp else None,
                "emp_type": emp.emp_type if emp else None,
                "designation": row.designation,
                "project_name": row.project_name,
                "country_state": row.country_state,
                "travel_from_date": row.travel_from_date.isoformat() if row.travel_from_date else None,
                "travel_to_date": row.travel_to_date.isoformat() if row.travel_to_date else None,
                "status": derived_status,
                "line_items": items_out,
                "total_amount": sum(i["amount"] for i in items_out),
            }
        )

    filter_options = {
        "circles": sorted(
            {
                (a.circle or "").strip()
                for a in Admin.query.filter(
                    db.func.coalesce(Admin.is_exited, False) == False,
                    db.func.coalesce(Admin.is_active, True) == True,
                ).all()
                if (a.circle or "").strip()
            }
        ),
        "emp_types": sorted(
            {
                (a.emp_type or "").strip()
                for a in Admin.query.filter(
                    db.func.coalesce(Admin.is_exited, False) == False,
                    db.func.coalesce(Admin.is_active, True) == True,
                ).all()
                if (a.emp_type or "").strip()
            }
        ),
    }

    return jsonify(
        {
            "success": True,
            "count": len(claims_out),
            "filter_options": filter_options,
            "claims": claims_out,
        }
    ), 200


@Accounts.route("/expense-claims/<int:claim_id>/excel", methods=["GET"])
@jwt_required()
def download_expense_claim_excel(claim_id):
    """Accounts: download one expense claim as Excel."""
    email = get_jwt().get("email")
    admin = Admin.query.filter_by(email=email).first()
    if not admin:
        return jsonify({"success": False, "message": "Unauthorized user"}), 401

    row = ExpenseClaimHeader.query.get(claim_id)
    if not row:
        return jsonify({"success": False, "message": "Claim not found"}), 404

    emp = row.admin
    line_items = (
        ExpenseLineItem.query.filter_by(claim_id=row.id)
        .order_by(ExpenseLineItem.sr_no.asc())
        .all()
    )
    if not line_items:
        return jsonify({"success": False, "message": "No line items for this claim"}), 404

    status = _claim_status_from_line_items(line_items)
    output = generate_expense_claim_excel(
        row,
        line_items,
        circle=getattr(emp, "circle", None) if emp else None,
        emp_type=getattr(emp, "emp_type", None) if emp else None,
        claim_status=status,
    )
    safe_emp = (row.emp_id or "claim").replace("/", "-")
    filename = f"Expense_Claim_{safe_emp}_{claim_id}.xlsx"
    return send_excel_file(output, filename)


@Accounts.route("/expense-claims/line-items/<int:line_item_id>/action", methods=["POST"])
@jwt_required()
def act_on_expense_claim_line_item(line_item_id):
    """Accounts: approve or reject a single expense claim line item."""
    email = get_jwt().get("email")
    approver = Admin.query.filter_by(email=email).first()
    if not approver:
        return jsonify({"success": False, "message": "Unauthorized user"}), 401

    data = request.get_json(silent=True) or {}
    action = (data.get("action") or "").strip().lower()
    rejection_reason = (data.get("rejection_reason") or "").strip()

    if action not in ("approve", "reject"):
        return jsonify({"success": False, "message": "action must be approve or reject"}), 400
    if action == "reject" and not rejection_reason:
        return jsonify({"success": False, "message": "Rejection reason is required"}), 400

    line_item = ExpenseLineItem.query.get(line_item_id)
    if not line_item:
        return jsonify({"success": False, "message": "Expense line item not found"}), 404
    if (line_item.status or "Pending") != "Pending":
        return jsonify({"success": False, "message": "Only pending items can be updated"}), 409

    claim = ExpenseClaimHeader.query.get(line_item.claim_id)
    if not claim:
        return jsonify({"success": False, "message": "Claim not found"}), 404

    employee = claim.admin or Admin.query.get(claim.admin_id)
    if not employee:
        return jsonify({"success": False, "message": "Employee not found for this claim"}), 404

    new_status = "Approved" if action == "approve" else "Rejected"
    line_item.status = new_status
    line_item.rejection_reason = rejection_reason if action == "reject" else None

    db.session.commit()

    try:
        send_claim_line_item_decision_email(
            line_item=line_item,
            claim_header=claim,
            employee=employee,
            approver=approver,
            action=action,
            rejection_reason=rejection_reason if action == "reject" else None,
        )
    except Exception as e:
        current_app.logger.warning(
            "Claim line item email failed (line_item_id=%s): %s", line_item_id, e
        )

    all_items = ExpenseLineItem.query.filter_by(claim_id=claim.id).all()
    claim_status = _claim_status_from_line_items(all_items)

    return jsonify(
        {
            "success": True,
            "message": f"Expense item {new_status.lower()}",
            "line_item": {
                "id": line_item.id,
                "status": line_item.status,
                "rejection_reason": line_item.rejection_reason,
            },
            "claim_status": claim_status,
            "claim_id": claim.id,
        }
    ), 200


def _parse_month_to_num(month_val):
    """
    Accepts:
      - "January" / "jan"
      - numeric month string/int like "1" / 1
    Returns 1..12 or raises ValueError.
    """
    if month_val is None:
        raise ValueError("month is required")

    if isinstance(month_val, int):
        m = month_val
    else:
        s = str(month_val).strip()
        if not s:
            raise ValueError("month is required")
        if s.isdigit():
            m = int(s)
        else:
            # Match calendar.month_name (1..12)
            lower = s.lower()
            month_lookup = {calendar.month_name[i].lower(): i for i in range(1, 13)}
            if lower not in month_lookup:
                # Also allow common abbreviations (jan, feb, ...)
                abbr_lookup = {calendar.month_name[i][:3].lower(): i for i in range(1, 13)}
                m = abbr_lookup.get(lower)
            else:
                m = month_lookup[lower]

    if m < 1 or m > 12:
        raise ValueError("Invalid month")
    return m


@Accounts.route("/payroll/generate", methods=["POST"])
@jwt_required()
def payroll_generate():
    """
    Create or recalculate payroll-by-month row using:
      - CTC breakup gross_salary prorated by calendar days (gross 1-day salary)
      - actual working days (Excel-style attendance logic)
      - deductions initially fetched from CTC breakup

    Expected JSON:
      {
        "admin_id": 123,
        "month": "January",     # or 1..12
        "year": "2026"
      }
    """
    email = get_jwt().get("email")
    viewer = Admin.query.filter_by(email=email).first()
    if not viewer:
        return jsonify({"success": False, "message": "Unauthorized user"}), 401

    data = request.get_json(silent=True) or {}
    admin_id = data.get("admin_id")
    month_val = data.get("month")
    year_val = data.get("year")

    try:
        admin_id = int(admin_id)
        year_int = int(year_val)
        month_num = _parse_month_to_num(month_val)
    except Exception as e:
        return jsonify({"success": False, "message": str(e) or "Invalid input"}), 400

    if not _accounts_can_access_any_profile(viewer) and admin_id != viewer.id:
        return jsonify({"success": False, "message": "Access denied"}), 403

    # Calculate computed payroll amounts
    result = calculate_monthly_payroll_from_ctc_and_attendance(
        admin_id=admin_id,
        year=year_int,
        month_num=month_num,
    )

    month_name = calendar.month_name[month_num]
    year_str = str(year_int)

    row = MonthlyPayroll.query.filter_by(
        admin_id=admin_id,
        month_num=month_num,
        year=year_str,
    ).first()

    # Upsert
    if not row:
        row = MonthlyPayroll(
            admin_id=admin_id,
            month=month_name,
            month_num=month_num,
            year=year_str,
        )
        db.session.add(row)

    # Earnings
    row.ctc_gross_salary = result["ctc_gross_salary"]
    row.calendar_days = result["calendar_days"]
    row.one_day_salary = result["one_day_salary"]
    row.actual_working_days = result["actual_working_days"]
    row.gross_salary_for_month = result["gross_salary_for_month"]

    # Deductions - computed fetched from CTC
    row.epf_computed = result["epf_computed"]
    row.esic_computed = result["esic_computed"]
    row.ptax_computed = result["ptax_computed"]

    # Defaults: finals start same as computed (Accounts can override later)
    row.epf_final = result["epf_computed"]
    row.esic_final = result["esic_computed"]
    row.ptax_final = result["ptax_computed"]

    deductions_total_final = float(row.epf_final or 0.0) + float(row.esic_final or 0.0) + float(row.ptax_final or 0.0)
    row.deductions_total_final = deductions_total_final
    row.net_salary_final = max(
        0.0,
        float(row.gross_salary_for_month or 0.0) - deductions_total_final,
    )

    db.session.commit()
    return jsonify({"success": True, "payroll": row.to_dict()}), 200


@Accounts.route("/payroll/deductions-update", methods=["PUT"])
@jwt_required()
def payroll_deductions_update():
    """
    Accounts can override the final deductions before saving.

    Expected JSON:
      {
        "admin_id": 123,
        "month": "January",
        "year": "2026",
        "epf_final": 0,
        "esic_final": 0,
        "ptax_final": 0,
        "actual_working_days": 22.5
      }
    """
    email = get_jwt().get("email")
    viewer = Admin.query.filter_by(email=email).first()
    if not viewer:
        return jsonify({"success": False, "message": "Unauthorized user"}), 401

    data = request.get_json(silent=True) or {}
    admin_id = data.get("admin_id")
    month_val = data.get("month")
    year_val = data.get("year")

    if admin_id is None or month_val is None or year_val is None:
        return jsonify({"success": False, "message": "admin_id, month, year are required"}), 400

    try:
        admin_id = int(admin_id)
        year_int = int(year_val)
        month_num = _parse_month_to_num(month_val)
    except Exception as e:
        return jsonify({"success": False, "message": str(e) or "Invalid input"}), 400

    if not _accounts_can_access_any_profile(viewer) and admin_id != viewer.id:
        return jsonify({"success": False, "message": "Access denied"}), 403

    row = MonthlyPayroll.query.filter_by(
        admin_id=admin_id,
        month_num=month_num,
        year=str(year_int),
    ).first()
    if not row:
        return jsonify({"success": False, "message": "Payroll row not found. Generate it first."}), 404

    # Optional overrides; if omitted, keep existing values
    if "epf_final" in data:
        row.epf_final = float(data.get("epf_final") or 0.0)
    if "esic_final" in data:
        row.esic_final = float(data.get("esic_final") or 0.0)
    if "ptax_final" in data:
        row.ptax_final = float(data.get("ptax_final") or 0.0)
    if "actual_working_days" in data:
        calendar_days = int(
            row.calendar_days or calendar.monthrange(year_int, month_num)[1]
        )
        awd = float(data.get("actual_working_days") or 0.0)
        row.actual_working_days = max(0.0, min(float(calendar_days), awd))
        one_day = float(row.one_day_salary or 0.0)
        row.gross_salary_for_month = max(
            0.0, one_day * float(row.actual_working_days or 0.0)
        )

        factor = payroll_earnings_factor(row.actual_working_days, calendar_days)
        ctc = CTCBreakup.query.filter_by(admin_id=admin_id).first()
        emp = Employee.query.filter_by(admin_id=admin_id).first()
        gender = getattr(emp, "gender", None) if emp else None
        if ctc:
            row.epf_final = round(float(ctc.epf or 0.0) * factor, 2)
            row.esic_final = round(float(ctc.esic or 0.0) * factor, 2)
        row.ptax_final = maharashtra_professional_tax(
            float(row.gross_salary_for_month or 0.0), gender, month_num
        )

    deductions_total_final = (
        float(row.epf_final or 0.0)
        + float(row.esic_final or 0.0)
        + float(row.ptax_final or 0.0)
    )
    row.deductions_total_final = deductions_total_final
    row.net_salary_final = max(
        0.0,
        float(row.gross_salary_for_month or 0.0) - deductions_total_final,
    )

    db.session.commit()
    return jsonify({"success": True, "payroll": row.to_dict()}), 200


@Accounts.route("/payroll/list", methods=["POST"])
@jwt_required()
def payroll_list():
    """
    Fetch payroll rows for given admin_ids + month + year.
    If a row doesn't exist yet, create it with computed deductions (initial finals),
    but if it exists, do NOT overwrite existing final deductions.

    Expected JSON:
      {
        "admin_ids": [1,2,3],
        "month": "January",
        "year": "2026"
      }
    """
    email = get_jwt().get("email")
    viewer = Admin.query.filter_by(email=email).first()
    if not viewer:
        return jsonify({"success": False, "message": "Unauthorized user"}), 401

    data = request.get_json(silent=True) or {}
    admin_ids = data.get("admin_ids") or []
    month_val = data.get("month")
    year_val = data.get("year")

    if not isinstance(admin_ids, list) or not admin_ids:
        return jsonify({"success": False, "message": "admin_ids list is required"}), 400
    if month_val is None or year_val is None:
        return jsonify({"success": False, "message": "month and year are required"}), 400

    try:
        admin_ids = [int(x) for x in admin_ids]
        year_int = int(year_val)
        month_num = _parse_month_to_num(month_val)
    except Exception:
        return jsonify({"success": False, "message": "Invalid admin_ids/month/year"}), 400

    if not _accounts_can_access_any_profile(viewer):
        # Non-Accounts users can only fetch their own payroll row.
        if not (len(admin_ids) == 1 and admin_ids[0] == viewer.id):
            return jsonify({"success": False, "message": "Access denied"}), 403

    month_name = calendar.month_name[month_num]
    year_str = str(year_int)

    payrolls = []
    rows_to_create = []

    # Fetch existing rows
    existing_rows = MonthlyPayroll.query.filter(
        MonthlyPayroll.admin_id.in_(admin_ids),
        MonthlyPayroll.month_num == month_num,
        MonthlyPayroll.year == year_str,
    ).all()
    existing_by_admin = {r.admin_id: r for r in existing_rows}

    # Create missing rows using computed values
    for admin_id in admin_ids:
        row = existing_by_admin.get(admin_id)
        if row:
            if float(row.actual_working_days or 0) < 0 or float(row.gross_salary_for_month or 0) < 0:
                computed = calculate_monthly_payroll_from_ctc_and_attendance(
                    admin_id=admin_id,
                    year=year_int,
                    month_num=month_num,
                )
                row.actual_working_days = computed["actual_working_days"]
                row.gross_salary_for_month = computed["gross_salary_for_month"]
                row.epf_computed = computed["epf_computed"]
                row.esic_computed = computed["esic_computed"]
                row.ptax_computed = computed["ptax_computed"]
                row.epf_final = computed["epf_computed"]
                row.esic_final = computed["esic_computed"]
                row.ptax_final = computed["ptax_computed"]
                row.deductions_total_final = computed["deductions_total_computed"]
                row.net_salary_final = computed["net_salary_computed"]
            payrolls.append(row)
            continue

        computed = calculate_monthly_payroll_from_ctc_and_attendance(
            admin_id=admin_id,
            year=year_int,
            month_num=month_num,
        )
        new_row = MonthlyPayroll(
            admin_id=admin_id,
            month=month_name,
            month_num=month_num,
            year=year_str,
        )
        new_row.ctc_gross_salary = computed["ctc_gross_salary"]
        new_row.calendar_days = computed["calendar_days"]
        new_row.one_day_salary = computed["one_day_salary"]
        new_row.actual_working_days = computed["actual_working_days"]
        new_row.gross_salary_for_month = computed["gross_salary_for_month"]

        new_row.epf_computed = computed["epf_computed"]
        new_row.esic_computed = computed["esic_computed"]
        new_row.ptax_computed = computed["ptax_computed"]

        # Initial finals = computed; Accounts can later override via deductions-update
        new_row.epf_final = computed["epf_computed"]
        new_row.esic_final = computed["esic_computed"]
        new_row.ptax_final = computed["ptax_computed"]
        new_row.deductions_total_final = computed["deductions_total_computed"]
        new_row.net_salary_final = computed["net_salary_computed"]

        db.session.add(new_row)
        rows_to_create.append(new_row)
        payrolls.append(new_row)

    db.session.commit()

    # Return only the columns your UI needs
    return jsonify({
        "success": True,
        "payrolls": [
            {
                "admin_id": p.admin_id,
                "month": p.month,
                "month_num": p.month_num,
                "year": p.year,
                "one_day_salary": float(p.one_day_salary or 0.0),
                "gross_salary_for_month": p.gross_salary_for_month,
                "actual_working_days": p.actual_working_days,
                "epf_final": p.epf_final,
                "ptax_final": p.ptax_final,
                "esic_final": p.esic_final,
                "net_salary_final": p.net_salary_final,
            }
            for p in payrolls
        ],
    }), 200


@Accounts.route("/payroll/history", methods=["POST"])
@jwt_required()
def payroll_history():
    """
    Read-only history from monthly_payrolls for a given month/year.
    Optionally filter by circle + emp_type (department) to match the filtered users list.

    Expected JSON:
      {
        "month": "January",
        "year": "2026",
        "circle": "NHQ",
        "emp_type": "Accounts"
      }
    """
    email = get_jwt().get("email")
    viewer = Admin.query.filter_by(email=email).first()
    if not viewer:
        return jsonify({"success": False, "message": "Unauthorized user"}), 401

    if not _accounts_can_access_any_profile(viewer):
        return jsonify({"success": False, "message": "Access denied"}), 403

    data = request.get_json(silent=True) or {}
    month_val = data.get("month")
    year_val = data.get("year")
    circle = (data.get("circle") or "").strip()
    emp_type = (data.get("emp_type") or "").strip()

    if month_val is None or year_val is None:
        return jsonify({"success": False, "message": "month and year are required"}), 400

    try:
        year_int = int(year_val)
        month_num = _parse_month_to_num(month_val)
    except Exception:
        return jsonify({"success": False, "message": "Invalid month/year"}), 400

    q = (
        db.session.query(MonthlyPayroll, Admin)
        .join(Admin, Admin.id == MonthlyPayroll.admin_id)
        .filter(
            MonthlyPayroll.month_num == month_num,
            MonthlyPayroll.year == str(year_int),
        )
    )

    if circle:
        q = q.filter(Admin.circle == circle)
    if emp_type:
        q = q.filter(Admin.emp_type == emp_type)

    q = q.order_by(Admin.first_name.asc(), Admin.emp_id.asc())
    rows = q.all()

    history = []
    for payroll, admin in rows:
        history.append({
            "admin_id": admin.id,
            "name": admin.first_name or "N/A",
            "emp_id": admin.emp_id,
            "circle": admin.circle,
            "emp_type": admin.emp_type,
            "month": payroll.month,
            "year": payroll.year,
            "gross_salary_for_month": float(payroll.gross_salary_for_month or 0.0),
            "epf_final": float(payroll.epf_final or 0.0),
            "ptax_final": float(payroll.ptax_final or 0.0),
            "esic_final": float(payroll.esic_final or 0.0),
            "actual_working_days": float(payroll.actual_working_days or 0.0),
            "net_salary_final": float(payroll.net_salary_final or 0.0),
            "created_at": isoformat_api(payroll.created_at),
            "updated_at": isoformat_api(payroll.updated_at),
        })

    return jsonify({"success": True, "history": history}), 200


@Accounts.route("/payroll/<int:payroll_id>/download", methods=["GET"])
@jwt_required()
def download_payroll_slip(payroll_id):
    email = get_jwt().get("email")
    viewer = Admin.query.filter_by(email=email).first()
    if not viewer:
        return jsonify({"success": False, "message": "Unauthorized user"}), 401

    payroll = MonthlyPayroll.query.get(payroll_id)
    if not payroll:
        return jsonify({"success": False, "message": "Payroll record not found"}), 404

    if not _accounts_can_access_any_profile(viewer) and payroll.admin_id != viewer.id:
        return jsonify({"success": False, "message": "Access denied"}), 403

    admin = Admin.query.get(payroll.admin_id)
    if not admin:
        return jsonify({"success": False, "message": "Employee not found"}), 404

    profile = EmployeeAccounts.query.filter_by(admin_id=admin.id).first()
    ctc = CTCBreakup.query.filter_by(admin_id=admin.id).first()
    employee_details = Employee.query.filter_by(admin_id=admin.id).first()

    emp_name = (getattr(admin, "first_name", None) or getattr(admin, "user_name", None) or "Employee").strip()
    emp_no = (getattr(admin, "emp_id", None) or "").strip() or "-"
    month_year = f"{payroll.month}-{payroll.year}"

    basic = float(getattr(ctc, "basic_salary", 0.0) or 0.0)
    hra = float(getattr(ctc, "hra", 0.0) or 0.0)
    other = float(getattr(ctc, "other_allowance", 0.0) or 0.0)
    gross = float(getattr(payroll, "gross_salary_for_month", 0.0) or 0.0)
    epf = float(getattr(payroll, "epf_final", 0.0) or 0.0)
    ptax = float(getattr(payroll, "ptax_final", 0.0) or 0.0)
    esic = float(getattr(payroll, "esic_final", 0.0) or 0.0)
    total_ded = float(getattr(payroll, "deductions_total_final", 0.0) or 0.0)
    net = float(getattr(payroll, "net_salary_final", 0.0) or 0.0)
    work_days = float(getattr(payroll, "actual_working_days", 0.0) or 0.0)
    cal_days = int(getattr(payroll, "calendar_days", 0) or 0)

    basic, hra, other = _prorate_earnings_to_gross(basic, hra, other, gross)
    cum_earn1 = basic
    cum_earn2 = basic + hra
    cum_earn3 = gross
    cum_ded1 = epf
    cum_ded2 = epf + ptax
    cum_ded3 = total_ded

    leave_balance = LeaveBalance.query.filter_by(admin_id=admin.id).first()
    pl_balance = float((leave_balance.privilege_leave_balance if leave_balance else 0.0) or 0.0)
    cl_balance = float((leave_balance.casual_leave_balance if leave_balance else 0.0) or 0.0)

    # Weekly Off in the PDF should be *weekend-only*, not derived from attendance.
    # Policy requested:
    # - For Accounts and HR employees: weekly off = Sundays only
    # - For all others: weekly off = Saturdays + Sundays
    emp_type_str = (getattr(admin, "emp_type", None) or "").strip().lower()
    is_accounts_or_hr = (
        emp_type_str.startswith("account")
        or emp_type_str == "hr"
        or emp_type_str.startswith("human resource")
        or emp_type_str.startswith("human resources")
    )

    month_num = int(getattr(payroll, "month_num", 0) or 0)
    year_int = int(getattr(payroll, "year", 0) or 0)
    sunday_count = 0
    saturday_count = 0
    if month_num >= 1 and month_num <= 12 and year_int > 0:
        _, month_days = calendar.monthrange(year_int, month_num)
        for d in range(1, month_days + 1):
            wd = date(year_int, month_num, d).weekday()  # Mon=0 ... Sun=6
            if wd == 6:
                sunday_count += 1
            elif wd == 5:
                saturday_count += 1
    weekly_off_days = sunday_count if is_accounts_or_hr else (sunday_count + saturday_count)

    def _fmt_balance(v):
        vv = float(v or 0.0)
        if abs(vv - round(vv)) < 1e-6:
            return str(int(round(vv)))
        s = f"{vv:.2f}"
        return s.rstrip("0").rstrip(".")

    buffer = BytesIO()
    c = canvas.Canvas(buffer, pagesize=A4)
    width, height = A4
    left_margin = 36
    right_margin = width - 36
    usable_w = right_margin - left_margin
    c.setLineWidth(0.5)
    # Six columns only: [Earnings, Amount, Gross] + [Deductions, Amount, Gross]
    x0 = left_margin
    x1 = x0 + usable_w * 0.27
    x2 = x1 + usable_w * 0.115
    x3 = x2 + usable_w * 0.115
    # Right side (Deductions): shift boundary to reduce the visual gap after the
    # "Deductions" label and give more width to the "Amount" column so Net Amount
    # fits cleanly in the last column.
    #
    # Total for right half must remain 0.5 * usable_w to keep table width unchanged.
    x4 = x3 + usable_w * 0.22   # narrower "Deductions" label column
    x5 = x4 + usable_w * 0.16   # wider "Amount" column
    x6 = x5 + usable_w * 0.12   # remaining width for "Gross Salary" column

    def _clip_text(text, max_chars=42):
        t = str(text or "-").strip()
        if len(t) <= max_chars:
            return t
        return f"{t[:max_chars - 3]}..."

    def _amt_right(right_edge, yy, text):
        """Right-align amount inside column ending at right_edge (pt)."""
        c.drawRightString(right_edge - 6, yy, text)

    y = height - 32
    c.setFont("Helvetica-Bold", 16)
    c.drawCentredString(width / 2, y, "Saffo Solution Technology LLP")
    y -= 15
    c.setFont("Helvetica", 10)
    c.drawCentredString(width / 2, y, "203, A Wing, 2nd Floor")
    y -= 13
    c.drawCentredString(width / 2, y, "Technocity TTC Indl Area, Mhape")
    y -= 13
    c.drawCentredString(width / 2, y, "Navi Mumbai")
    y -= 13
    c.drawCentredString(width / 2, y, "CIN: AAP-6504")
    y -= 18
    c.drawCentredString(width / 2, y, "E-Mail : finance@saffotech.com")
    c.setLineWidth(0.7)
    c.line(left_margin + 40, y - 4, right_margin - 40, y - 4)

    y -= 28
    c.setFont("Helvetica-Bold", 18)
    c.drawCentredString(width / 2, y, "Pay Slip")
    y -= 16
    c.setFont("Helvetica-Bold", 11)
    c.drawCentredString(width / 2, y, f"for {month_year}")
    y -= 18
    c.setFont("Helvetica-Bold", 15)
    c.drawCentredString(width / 2, y, emp_name)

    y -= 14
    c.line(left_margin, y, right_margin, y)
    y -= 16
    meta_font = "Helvetica"
    meta_size = 10
    c.setFont(meta_font, meta_size)

    mid_split = left_margin + usable_w * 0.5
    left_block_end = mid_split - 10
    right_block_start = mid_split + 10
    label_line_step = 10

    meta_left = [
        ("Employee Number", emp_no),
        ("Function", getattr(profile, "function", None) or getattr(admin, "emp_type", None) or "-"),
        (
            "Designation",
            (getattr(profile, "designation", None) or (getattr(employee_details, "designation", None) if employee_details else None) or "-"),
        ),
        ("Location", getattr(profile, "location", None) or getattr(admin, "circle", None) or "-"),
        ("Bank Details", _clip_text(getattr(profile, "bank_details", None), 38)),
        ("Date of joining", getattr(admin, "doj", None).strftime("%d-%b-%y") if getattr(admin, "doj", None) else "-"),
    ]
    meta_right = [
        ("Tax Regime", getattr(profile, "tax_regime", None) or "Regular Tax Regime"),
        ("Income Tax Number (PAN)", getattr(profile, "pan", None) or "-"),
        ("Universal Account Number (UAN)", getattr(profile, "uan", None) or "-"),
        ("PF account number", getattr(profile, "pf_account_number", None) or "-"),
        ("ESI Number", getattr(profile, "esi_number", None) or "-"),
        ("PR Account Number (PRAN)", getattr(profile, "pran", None) or "-"),
    ]

    # Tight label columns: colon sits just after longest label (capped), not a fixed 84% band — frees space for values
    left_inner_w = left_block_end - left_margin - 14
    right_inner_w = right_margin - right_block_start - 14
    max_left_pt = max(stringWidth(l[0], meta_font, meta_size) for l in meta_left)
    # Left: keep compact so value has enough room.
    meta_left_max_w = min(max_left_pt, left_inner_w * 0.38)
    left_colon_x = left_margin + 2 + meta_left_max_w + 4
    left_val_x = left_colon_x + 6
    left_val_max_w = max(24.0, left_block_end - left_val_x)

    # Right: reserve space for values, widen label band, shrink label font if needed
    # so long labels (Income Tax Number (PAN), UAN, PRAN) stay on one line.
    min_value_reserve = 110
    right_label_band = max(120.0, min(right_inner_w * 0.78, right_inner_w - min_value_reserve))
    meta_right_font_size = meta_size
    for sz in (10, 9, 8):
        wmax = max(stringWidth(r[0], meta_font, sz) for r in meta_right)
        if wmax <= right_label_band:
            meta_right_font_size = float(sz)
            break
    meta_right_max_w = right_label_band
    # Slightly larger gap between label and value on the right so
    # the data sits visually apart from "Tax Regime" text.
    right_colon_x = right_block_start + meta_right_max_w + 4
    right_val_x = right_colon_x + 10
    right_val_max_w = max(28.0, right_margin - right_val_x - 4)

    y_cursor = y
    for i in range(6):
        left_lines = _wrap_lines_pdf(meta_left[i][0], meta_font, meta_size, meta_left_max_w)
        right_lines = _wrap_lines_pdf(
            meta_right[i][0], meta_font, meta_right_font_size, meta_right_max_w
        )
        n_lines = max(len(left_lines), len(right_lines), 1)
        for j, line in enumerate(left_lines):
            c.setFont(meta_font, meta_size)
            c.drawString(left_margin + 2, y_cursor - j * label_line_step, line)
        for j, line in enumerate(right_lines):
            c.setFont(meta_font, meta_right_font_size)
            c.drawString(right_block_start, y_cursor - j * label_line_step, line)
        c.setFont(meta_font, meta_size)
        c.drawString(left_colon_x, y_cursor, ":")
        c.drawString(right_colon_x, y_cursor, ":")
        val_l = _fit_text_pdf(str(meta_left[i][1]), meta_font, meta_size, left_val_max_w)
        c.drawString(left_val_x, y_cursor, val_l)
        val_r = _fit_text_pdf(str(meta_right[i][1]), meta_font, meta_size, right_val_max_w)
        c.drawString(right_val_x, y_cursor, val_r)
        y_cursor -= 6 + n_lines * label_line_step

    y = y_cursor - 4
    c.line(left_margin, y, right_margin, y)
    y -= 18

    # Attendance section (full content width)
    att_left = left_margin
    att_right = right_margin
    att_h = 78
    att_top = y
    att_bottom = y - att_h
    c.setLineWidth(0.45)
    c.rect(att_left, att_bottom, att_right - att_left, att_top - att_bottom)
    c.line(att_left, att_top - 22, att_right, att_top - 22)
    split_x = att_left + (att_right - att_left) * 0.72
    c.line(split_x, att_top, split_x, att_bottom)
    c.setFont("Helvetica-Bold", 10)
    c.drawString(att_left + 5, att_top - 15, "Attendance Details")
    c.drawRightString(att_right - 6, att_top - 15, "Value")
    c.setFont("Helvetica", 10)
    r1, r2, r3 = att_top - 36, att_top - 54, att_top - 72
    c.drawString(att_left + 5, r1, "CL/PL")
    _amt_right(att_right, r1, f"{_fmt_balance(pl_balance)}/{_fmt_balance(cl_balance)} Days")
    c.drawString(att_left + 5, r2, "Present Days")
    _amt_right(att_right, r2, f"{work_days:.0f} Days")
    c.drawString(att_left + 5, r3, "Weekly Off")
    _amt_right(att_right, r3, f"{weekly_off_days} Days")

    y = att_bottom - 18
    row_h = 22
    hdr_h = 22
    body_rows = 6

    # Earnings / deductions table (aligned to six-column grid)
    table_top = y
    table_bottom = table_top - hdr_h - body_rows * row_h
    for xx in (x0, x1, x2, x3, x4, x5, x6):
        c.line(xx, table_top, xx, table_bottom)
    horiz = [table_top, table_top - hdr_h]
    for i in range(1, body_rows + 1):
        horiz.append(table_top - hdr_h - i * row_h)
    for yy in horiz:
        c.line(x0, yy, x6, yy)

    hdr_y = table_top - 12
    c.setFont("Helvetica-Bold", 9.5)
    c.drawString(x0 + 4, hdr_y, "Earnings")
    c.drawCentredString((x1 + x2) / 2, hdr_y, "Amount")
    c.drawCentredString((x2 + x3) / 2, hdr_y, "Gross Salary")
    c.drawString(x3 + 4, hdr_y, "Deductions")
    c.drawCentredString((x4 + x5) / 2, hdr_y, "Amount")
    c.drawCentredString((x5 + x6) / 2, hdr_y, "Gross Salary")

    r = table_top - hdr_h - 14
    c.setFont("Helvetica", 10)
    c.drawString(x0 + 4, r, "Basic Salary + DA")
    _amt_right(x2, r, _fmt_money(basic))
    _amt_right(x3, r, _fmt_money(cum_earn1))
    c.drawString(x3 + 4, r, "EPF")
    _amt_right(x5, r, _fmt_money(epf))
    _amt_right(x6, r, _fmt_money(cum_ded1))

    r -= row_h
    c.drawString(x0 + 4, r, "HRA")
    _amt_right(x2, r, _fmt_money(hra))
    _amt_right(x3, r, _fmt_money(cum_earn2))
    c.drawString(x3 + 4, r, "P.Tax")
    _amt_right(x5, r, _fmt_money(ptax))
    _amt_right(x6, r, _fmt_money(cum_ded2))

    r -= row_h
    c.drawString(x0 + 4, r, "Other Allowance")
    _amt_right(x2, r, _fmt_money(other))
    _amt_right(x3, r, _fmt_money(cum_earn3))
    c.drawString(x3 + 4, r, "ESIC")
    _amt_right(x5, r, _fmt_money(esic))
    _amt_right(x6, r, _fmt_money(cum_ded3))

    r -= row_h
    # Blank spacer row (matches typical payslip layout)
    r -= row_h
    c.setFont("Helvetica-Bold", 10)
    c.drawString(x0 + 4, r, "Total Earnings")
    _amt_right(x2, r, _fmt_money(gross))
    _amt_right(x3, r, _fmt_money(gross))
    c.drawString(x3 + 4, r, "Total Deductions")
    _amt_right(x5, r, _fmt_money(total_ded))
    _amt_right(x6, r, _fmt_money(total_ded))

    r -= row_h
    c.setFont("Helvetica-Bold", 10.5)
    c.drawString(x3 + 4, r, "Net Amount")
    # Single net figure in last column only (avoids Rs. on border / duplicate)
    _amt_right(x6, r, f"Rs. {_fmt_money(net)}")

    y = table_bottom - 20
    words = _rupees_in_words(net)
    c.setFont("Helvetica", 10)
    c.drawString(left_margin, y, "Amount (in words):")
    y -= 16
    c.drawString(left_margin, y, f"Indian Rupees {words} Only")

    sig_y = y - 52
    c.setLineWidth(0.45)
    c.line(right_margin - 200, sig_y + 28, right_margin, sig_y + 28)
    c.setFont("Helvetica-Bold", 10.5)
    c.drawRightString(right_margin, sig_y + 12, "for Saffo Solution Technology LLP")
    c.setFont("Helvetica", 10)
    c.drawRightString(right_margin, sig_y - 4, "Authorised Signatory")

    c.showPage()
    c.save()
    buffer.seek(0)

    filename = f"payroll-slip-{emp_no}-{payroll.month}-{payroll.year}.pdf".replace(" ", "-")
    return send_file(buffer, mimetype="application/pdf", as_attachment=True, download_name=filename)


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

    row.updated_at = utc_now()
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


@Accounts.route("/noc-requests", methods=["GET"])
@jwt_required()
@accounts_department_required
def accounts_list_noc_department_requests():
    admin = Admin.query.filter_by(email=get_jwt().get("email")).first()
    if not admin:
        return jsonify({"success": False, "message": "Employee not found"}), 404
    status_raw = (request.args.get("status") or "All").strip()
    items = list_noc_requests("accounts", admin, status_raw)
    return jsonify({"success": True, "requests": items}), 200


@Accounts.route("/noc-requests/<int:req_id>/upload", methods=["POST"])
@jwt_required()
@accounts_department_required
def accounts_upload_noc_department_document(req_id):
    admin = Admin.query.filter_by(email=get_jwt().get("email")).first()
    if not admin:
        return jsonify({"success": False, "message": "Employee not found"}), 404
    file = request.files.get("file")
    out = upload_noc_document("accounts", admin, req_id, file)
    code = out.pop("http", 200)
    return jsonify({k: v for k, v in out.items()}), code


@Accounts.route("/noc-requests/<int:req_id>/download", methods=["GET"])
@jwt_required()
@accounts_department_required
def accounts_download_noc_department_document(req_id):
    admin = Admin.query.filter_by(email=get_jwt().get("email")).first()
    if not admin:
        return jsonify({"success": False, "message": "Employee not found"}), 404
    out = download_noc_document("accounts", admin, req_id)
    if not out.get("success"):
        return jsonify({"success": False, "message": out.get("message", "Error")}), out.get("http", 400)
    return send_file(
        out["path"],
        as_attachment=True,
        download_name=out["download_name"],
        mimetype="application/octet-stream",
    )
