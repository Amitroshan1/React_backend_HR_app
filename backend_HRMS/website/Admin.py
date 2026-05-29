"""
Admin panel API: dashboard stats, employee list, and employee detail.
Access restricted to users with emp_type Admin / Administrator / Administration.
"""
import os
from datetime import date
from calendar import monthrange

from flask import Blueprint, current_app, jsonify, request
from flask_jwt_extended import jwt_required, get_jwt
from sqlalchemy import func

from . import db
from .models.Admin_models import Admin
from .models.attendance import LeaveApplication, Punch
from .models.query import Query
from .models.expense import ExpenseClaimHeader, ExpenseLineItem
from .models.seperation import Resignation
from .models.news_feed import PaySlip
from .models.emp_detail_models import Employee, Asset
from .models.deployed_customer import (
    DeployedCustomer,
    PLAN_ORDER,
    PLAN_LABELS,
)


admin_bp = Blueprint("admin", __name__)

# emp_type values that grant Admin panel access (lowercase for comparison)
ADMIN_EMP_TYPES = {"admin", "administrator", "administration"}


def _norm(value):
    return (value or "").strip().lower()


def _admin_required(fn):
    """Decorator: JWT required and emp_type must be Admin/Administrator/Administration."""
    from functools import wraps
    @wraps(fn)
    def wrapper(*args, **kwargs):
        claims = get_jwt()
        if not claims:
            return jsonify({"success": False, "message": "Unauthorized"}), 401
        emp_type = _norm(claims.get("emp_type") or "")
        if emp_type not in ADMIN_EMP_TYPES:
            return jsonify({
                "success": False,
                "message": "Admin access required"
            }), 403
        return fn(*args, **kwargs)
    return wrapper


def _deployment_guide_enabled():
    return bool(current_app.config.get("SHOW_DEPLOYMENT_GUIDE"))


def _can_view_deployment_guide(claims=None):
    """Vendor ops: Admin role on instance with SHOW_DEPLOYMENT_GUIDE=1."""
    if not _deployment_guide_enabled():
        return False
    if claims is None:
        claims = get_jwt() or {}
    emp_type = _norm(claims.get("emp_type") or "")
    if emp_type not in ADMIN_EMP_TYPES and "super" not in emp_type:
        return False
    raw = (os.getenv("DEPLOYMENT_GUIDE_EMAILS") or "").strip()
    if not raw:
        return True
    allowed = {e.strip().lower() for e in raw.split(",") if e.strip()}
    email = (claims.get("email") or "").strip().lower()
    return email in allowed if email else False


def _base_employee_query():
    """Enabled, non-exited employees only (excludes is_active=False)."""
    return Admin.query.filter(
        db.func.coalesce(Admin.is_exited, False) == False,
        db.func.coalesce(Admin.is_active, True) == True,
    )


def _apply_scope(q, circle, emp_type):
    """Apply optional circle and emp_type filters (use 'All' or empty to skip)."""
    if circle and _norm(circle) != "all":
        q = q.filter(func.lower(func.coalesce(Admin.circle, "")) == circle.lower())
    if emp_type and _norm(emp_type) != "all":
        q = q.filter(func.lower(func.coalesce(Admin.emp_type, "")) == emp_type.lower())
    return q


def _date_iso(d):
    return d.isoformat() if d and hasattr(d, "isoformat") else (str(d) if d else None)


# --------------------------------------------------
# GET /api/admin/dashboard – stats for Admin dashboard (optional circle, emp_type)
# --------------------------------------------------
@admin_bp.route("/dashboard", methods=["GET"])
@jwt_required()
@_admin_required
def get_dashboard():
    circle = (request.args.get("circle") or "").strip()
    emp_type = (request.args.get("emp_type") or "").strip()

    # Total employees: filtered by circle / emp_type (current filter)
    q = _base_employee_query()
    q = _apply_scope(q, circle, emp_type)
    total_employees = q.count()

    # Leaves, queries, claims, resignations: all data in DB (Admin has org-wide access)
    total_leaves = LeaveApplication.query.count()
    total_queries = Query.query.count()
    total_claims = ExpenseClaimHeader.query.count()
    total_resignations = Resignation.query.count()

    from .plan_features import can_access_it_panel

    it_inventory_access = can_access_it_panel()
    total_inventory_assets = None
    if it_inventory_access:
        try:
            from .models.it_models import ITAssetUnit

            total_inventory_assets = (
                db.session.query(func.count(ITAssetUnit.id)).scalar() or 0
            )
        except Exception:
            total_inventory_assets = 0

    return jsonify({
        "success": True,
        "total_employees": total_employees,
        "total_leaves": total_leaves,
        "total_queries": total_queries,
        "total_claims": total_claims,
        "total_resignations": total_resignations,
        "it_inventory_access": it_inventory_access,
        "total_inventory_assets": total_inventory_assets,
    }), 200


def _claim_status_from_items(items):
    """Derive overall status from expense line items."""
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


# --------------------------------------------------
# GET /api/admin/leaves – all leave applications (Admin org-wide)
# --------------------------------------------------
@admin_bp.route("/leaves", methods=["GET"])
@jwt_required()
@_admin_required
def list_all_leaves():
    status = (request.args.get("status") or "All").strip()
    q = LeaveApplication.query.join(Admin, LeaveApplication.admin_id == Admin.id)
    if status and _norm(status) != "all":
        q = q.filter(LeaveApplication.status == status)
    rows = q.order_by(LeaveApplication.created_at.desc(), LeaveApplication.id.desc()).all()
    items = []
    for row in rows:
        admin = row.admin
        items.append({
            "id": row.id,
            "employee_name": (admin.first_name or "").strip() if admin else "",
            "employee_email": admin.email if admin else "",
            "emp_id": admin.emp_id if admin else "",
            "circle": admin.circle if admin else None,
            "emp_type": admin.emp_type if admin else None,
            "leave_type": row.leave_type,
            "reason": row.reason or "",
            "start_date": _date_iso(row.start_date),
            "end_date": _date_iso(row.end_date),
            "status": row.status,
            "deducted_days": row.deducted_days,
            "extra_days": row.extra_days,
            "created_at": _date_iso(row.created_at),
        })
    return jsonify({"success": True, "requests": items}), 200


# --------------------------------------------------
# GET /api/admin/queries – all queries (Admin org-wide)
# --------------------------------------------------
@admin_bp.route("/queries", methods=["GET"])
@jwt_required()
@_admin_required
def list_all_queries():
    status = (request.args.get("status") or "All").strip()
    q = Query.query.join(Admin, Query.admin_id == Admin.id)
    if status and _norm(status) != "all":
        q = q.filter(Query.status == status)
    rows = q.order_by(Query.created_at.desc(), Query.id.desc()).all()
    items = []
    for row in rows:
        admin = row.admin
        items.append({
            "id": row.id,
            "employee_name": (admin.first_name or "").strip() if admin else "",
            "employee_email": admin.email if admin else "",
            "emp_id": admin.emp_id if admin else "",
            "title": row.title or "",
            "department": row.department or "",
            "query_text": (row.query_text or "")[:500],
            "status": row.status or "",
            "created_at": _date_iso(row.created_at),
        })
    return jsonify({"success": True, "requests": items}), 200


# --------------------------------------------------
# GET /api/admin/queries/<query_id> – single query with replies (chat) for Admin View
# --------------------------------------------------
@admin_bp.route("/queries/<int:query_id>", methods=["GET"])
@jwt_required()
@_admin_required
def get_query_detail(query_id):
    import json as _json
    query_obj = Query.query.get(query_id)
    if not query_obj:
        return jsonify({"success": False, "message": "Query not found"}), 404

    attachments = []
    if query_obj.photo:
        try:
            attachments = _json.loads(query_obj.photo)
        except (_json.JSONDecodeError, TypeError):
            attachments = []

    admin = query_obj.admin
    chat_messages = [
        {
            "text": query_obj.query_text or "",
            "user_type": "EMPLOYEE",
            "created_at": _date_iso(query_obj.created_at),
            "by": (admin.first_name or admin.email or "") if admin else "",
        }
    ]
    replies = sorted(
        query_obj.replies,
        key=lambda r: (r.created_at or date(2000, 1, 1)),
    )
    for r in replies:
        reply_admin = r.admin
        chat_messages.append({
            "text": r.reply_text or "",
            "user_type": r.user_type or "",
            "created_at": _date_iso(r.created_at),
            "by": (reply_admin.first_name or reply_admin.email or "") if reply_admin else "",
        })

    return jsonify({
        "success": True,
        "query": {
            "id": query_obj.id,
            "title": query_obj.title or "",
            "department": query_obj.department or "",
            "status": query_obj.status or "",
            "created_at": _date_iso(query_obj.created_at),
            "attachments": attachments,
        },
        "chat_messages": chat_messages,
    }), 200


# --------------------------------------------------
# GET /api/admin/claims – all expense claims (Admin org-wide)
# --------------------------------------------------
@admin_bp.route("/claims", methods=["GET"])
@jwt_required()
@_admin_required
def list_all_claims():
    status = (request.args.get("status") or "All").strip()
    rows = ExpenseClaimHeader.query.order_by(ExpenseClaimHeader.id.desc()).all()
    items = []
    for row in rows:
        line_items = ExpenseLineItem.query.filter_by(claim_id=row.id).order_by(ExpenseLineItem.sr_no.asc()).all()
        derived_status = _claim_status_from_items(line_items)
        if status and _norm(status) != "all" and derived_status.lower() != status.lower():
            continue
        admin = row.admin
        items.append({
            "id": row.id,
            "employee_name": row.employee_name or ((admin.first_name or "").strip() if admin else ""),
            "employee_email": row.email or (admin.email if admin else ""),
            "emp_id": row.emp_id or (admin.emp_id if admin else ""),
            "circle": admin.circle if admin else None,
            "emp_type": admin.emp_type if admin else None,
            "project_name": row.project_name or "",
            "country_state": row.country_state or "",
            "travel_from_date": _date_iso(row.travel_from_date),
            "travel_to_date": _date_iso(row.travel_to_date),
            "status": derived_status,
            "line_items": [
                {
                    "id": li.id,
                    "sr_no": li.sr_no,
                    "date": _date_iso(li.date),
                    "purpose": li.purpose,
                    "amount": li.amount,
                    "currency": li.currency,
                    "status": li.status,
                }
                for li in line_items
            ],
        })
    return jsonify({"success": True, "requests": items}), 200


# --------------------------------------------------
# GET /api/admin/resignations – all resignations (Admin org-wide)
# --------------------------------------------------
@admin_bp.route("/resignations", methods=["GET"])
@jwt_required()
@_admin_required
def list_all_resignations():
    status = (request.args.get("status") or "All").strip()
    q = Resignation.query.join(Admin, Resignation.admin_id == Admin.id)
    if status and _norm(status) != "all":
        q = q.filter(Resignation.status == status)
    rows = q.order_by(Resignation.applied_on.desc(), Resignation.id.desc()).all()
    items = []
    for row in rows:
        admin = row.admin
        items.append({
            "id": row.id,
            "employee_name": (admin.first_name or "").strip() if admin else "",
            "employee_email": admin.email if admin else "",
            "emp_id": admin.emp_id if admin else "",
            "circle": admin.circle if admin else None,
            "emp_type": admin.emp_type if admin else None,
            "resignation_date": _date_iso(row.resignation_date),
            "reason": row.reason or "",
            "status": row.status or "",
            "applied_on": _date_iso(row.applied_on),
        })
    return jsonify({"success": True, "requests": items}), 200


# --------------------------------------------------
# GET /api/admin/employees – list employees (optional circle, emp_type)
# --------------------------------------------------
@admin_bp.route("/employees", methods=["GET"])
@jwt_required()
@_admin_required
def list_employees():
    circle = (request.args.get("circle") or "").strip()
    emp_type = (request.args.get("emp_type") or "").strip()

    q = _base_employee_query()
    q = _apply_scope(q, circle, emp_type)
    rows = q.order_by(Admin.first_name.asc(), Admin.id.asc()).all()

    employees = []
    for row in rows:
        employees.append({
            "id": row.id,
            "emp_id": row.emp_id or "",
            "name": (row.first_name or "").strip() or row.email or "",
            "email": row.email or "",
            "designation": (row.emp_type or "").strip(),
            "circle": (row.circle or "").strip(),
            "emp_type": (row.emp_type or "").strip(),
        })
    return jsonify({
        "success": True,
        "count": len(employees),
        "employees": employees,
    }), 200


# --------------------------------------------------
# GET /api/admin/employees/<id> – single employee detail for EmployeeDetails page
# --------------------------------------------------
@admin_bp.route("/employees/<int:admin_id>", methods=["GET"])
@jwt_required()
@_admin_required
def get_employee_detail(admin_id):
    admin = Admin.query.get(admin_id)
    if not admin or admin.is_exited:
        return jsonify({"success": False, "message": "Employee not found"}), 404

    employee_detail = Employee.query.filter_by(admin_id=admin_id).first()

    # Leaves
    leaves = LeaveApplication.query.filter_by(admin_id=admin_id).order_by(
        LeaveApplication.start_date.desc()
    ).all()
    leaves_data = [
        {
            "id": la.id,
            "type": la.leave_type,
            "status": la.status,
            "startDate": _date_iso(la.start_date),
            "endDate": _date_iso(la.end_date),
        }
        for la in leaves
    ]

    # Queries
    queries = Query.query.filter_by(admin_id=admin_id).order_by(Query.created_at.desc()).all()
    queries_data = [
        {
            "id": q.id,
            "type": q.department or q.title,
            "status": q.status,
            "startDate": _date_iso(q.created_at) if q.created_at else None,
            "endDate": _date_iso(q.created_at) if q.created_at else None,
        }
        for q in queries
    ]

    # Claims (headers; status from first line item if any)
    claim_headers = ExpenseClaimHeader.query.filter_by(admin_id=admin_id).order_by(
        ExpenseClaimHeader.travel_from_date.desc()
    ).all()
    claims_data = []
    for ch in claim_headers:
        first_line = ExpenseLineItem.query.filter_by(claim_id=ch.id).first()
        status = (first_line.status if first_line else "Pending") or "Pending"
        claims_data.append({
            "id": ch.id,
            "type": "Travel",
            "status": status,
            "startDate": _date_iso(ch.travel_from_date),
            "endDate": _date_iso(ch.travel_to_date),
        })

    # Resignations
    resignations = Resignation.query.filter_by(admin_id=admin_id).order_by(
        Resignation.resignation_date.desc()
    ).all()
    resignations_data = [
        {
            "id": r.id,
            "type": "Resignation",
            "status": r.status,
            "startDate": _date_iso(r.resignation_date),
            "endDate": _date_iso(r.resignation_date),
        }
        for r in resignations
    ]

    # Punches (group by date; show as check-in/check-out pairs or single row)
    punch_rows = Punch.query.filter_by(admin_id=admin_id).order_by(
        Punch.punch_date.desc()
    ).limit(100).all()
    punches_data = []
    for p in punch_rows:
        d = _date_iso(p.punch_date)
        punches_data.append({
            "id": p.id,
            "type": "Check-in" if p.punch_in and not p.punch_out else "Check-out",
            "status": "Approved",
            "startDate": d,
            "endDate": d,
        })

    # Payslips
    payslips = PaySlip.query.filter_by(admin_id=admin_id).order_by(
        PaySlip.year.desc(), PaySlip.month.desc()
    ).all()
    payslips_data = []
    for ps in payslips:
        try:
            y = int(ps.year)
            m = int(ps.month) if (ps.month and str(ps.month).isdigit()) else 1
            last = date(y, m, monthrange(y, m)[1])
            sd = date(y, m, 1)
            payslips_data.append({
                "id": ps.id,
                "type": "Monthly",
                "status": "Approved",
                "startDate": sd.isoformat(),
                "endDate": last.isoformat(),
            })
        except (ValueError, TypeError):
            payslips_data.append({
                "id": ps.id,
                "type": "Monthly",
                "status": "Approved",
                "startDate": None,
                "endDate": None,
            })

    # Assets
    assets = Asset.query.filter_by(admin_id=admin_id).all()
    assets_data = [
        {
            "id": a.id,
            "type": a.name,
            "status": "Approved",
            "startDate": _date_iso(a.issue_date),
            "endDate": _date_iso(a.return_date),
        }
        for a in assets
    ]

    # Profile fields for UI (match frontend expectations: id, name, email, designation, phone, gender, dob, address, photo)
    name = (admin.first_name or "").strip() or admin.email or ""
    emp = employee_detail
    return jsonify({
        "success": True,
        "employee": {
            "id": admin.id,
            "emp_id": admin.emp_id or "",
            "name": name,
            "email": admin.email or "",
            "designation": (admin.emp_type or "").strip(),
            "circle": (admin.circle or "").strip(),
            "phone": (admin.mobile or (emp.mobile if emp else "") or ""),
            "gender": (emp.gender if emp else "") or "",
            "dob": _date_iso(emp.dob) if emp and emp.dob else "",
            "address": (emp.present_address_line1 if emp else "") or (emp.permanent_address_line1 if emp else "") or "",
            "photo": None,
            "leaves": leaves_data,
            "queries": queries_data,
            "claims": claims_data,
            "resignations": resignations_data,
            "punches": punches_data,
            "payslips": payslips_data,
            "assets": assets_data,
        },
    }), 200


# --------------------------------------------------
# New customer deployment guide (vendor master instance only)
# --------------------------------------------------
@admin_bp.route("/deployment-guide/access", methods=["GET"])
@jwt_required()
@_admin_required
def deployment_guide_access():
    return jsonify({
        "success": True,
        "can_view_deployment_guide": _can_view_deployment_guide(),
    }), 200


@admin_bp.route("/deployment-guide", methods=["GET"])
@jwt_required()
@_admin_required
def deployment_guide_content():
    if not _can_view_deployment_guide():
        return jsonify({
            "success": False,
            "message": "Deployment guide is not available on this instance",
        }), 403
    from .deployment_guide_data import DEPLOYMENT_GUIDE
    return jsonify({
        "success": True,
        "guide": DEPLOYMENT_GUIDE,
        "doc_path": "docs/NEW_CUSTOMER_DEPLOYMENT.md",
    }), 200


def _customers_access_denied():
    return jsonify({
        "success": False,
        "message": "Customer registry is not available on this instance",
    }), 403


def _parse_plan(value):
    plan = _norm(value or "")
    if plan not in PLAN_ORDER:
        return None
    return plan


def _parse_date(value):
    raw = (value or "").strip()
    if not raw:
        return None
    try:
        return date.fromisoformat(raw[:10])
    except ValueError:
        return None


# --------------------------------------------------
# Deployed customers (vendor master instance only)
# --------------------------------------------------
@admin_bp.route("/customers", methods=["GET"])
@jwt_required()
@_admin_required
def list_deployed_customers():
    if not _can_view_deployment_guide():
        return _customers_access_denied()
    rows = (
        DeployedCustomer.query.order_by(
            DeployedCustomer.company_name.asc()
        ).all()
    )
    from .deployment_guide_data import DEPLOYMENT_GUIDE
    plans = DEPLOYMENT_GUIDE.get("plans") or [
        {"id": k, "label": v, "notes": ""} for k, v in PLAN_LABELS.items()
    ]
    return jsonify({
        "success": True,
        "customers": [r.to_dict() for r in rows],
        "plans": plans,
    }), 200


@admin_bp.route("/customers", methods=["POST"])
@jwt_required()
@_admin_required
def create_deployed_customer():
    if not _can_view_deployment_guide():
        return _customers_access_denied()
    data = request.get_json(silent=True) or {}
    company_name = (data.get("company_name") or "").strip()
    if not company_name:
        return jsonify({"success": False, "message": "Company name is required"}), 400
    plan = _parse_plan(data.get("plan"))
    if not plan:
        return jsonify({
            "success": False,
            "message": "Plan must be basic, essential, or enterprise",
        }), 400
    row = DeployedCustomer(
        company_name=company_name,
        plan=plan,
        app_url=(data.get("app_url") or "").strip() or None,
        database_name=(data.get("database_name") or "").strip() or None,
        contact_email=(data.get("contact_email") or "").strip() or None,
        notes=(data.get("notes") or "").strip() or None,
        status=(data.get("status") or "active").strip() or "active",
        go_live_date=_parse_date(data.get("go_live_date")),
    )
    db.session.add(row)
    db.session.commit()
    return jsonify({
        "success": True,
        "message": "Customer added",
        "customer": row.to_dict(),
    }), 201


@admin_bp.route("/customers/<int:customer_id>", methods=["PATCH"])
@jwt_required()
@_admin_required
def update_deployed_customer(customer_id):
    if not _can_view_deployment_guide():
        return _customers_access_denied()
    row = DeployedCustomer.query.get(customer_id)
    if not row:
        return jsonify({"success": False, "message": "Customer not found"}), 404
    data = request.get_json(silent=True) or {}

    if "plan" in data:
        new_plan = _parse_plan(data.get("plan"))
        if not new_plan:
            return jsonify({
                "success": False,
                "message": "Invalid plan",
            }), 400
        current = (row.plan or "basic").lower()
        if current not in PLAN_ORDER:
            current = "basic"
        if new_plan not in row.upgrade_options() and new_plan != current:
            return jsonify({
                "success": False,
                "message": "Can only upgrade to a higher plan or keep the current plan",
            }), 400
        row.plan = new_plan

    if "company_name" in data:
        name = (data.get("company_name") or "").strip()
        if name:
            row.company_name = name
    if "app_url" in data:
        row.app_url = (data.get("app_url") or "").strip() or None
    if "database_name" in data:
        row.database_name = (data.get("database_name") or "").strip() or None
    if "contact_email" in data:
        row.contact_email = (data.get("contact_email") or "").strip() or None
    if "notes" in data:
        row.notes = (data.get("notes") or "").strip() or None
    if "status" in data:
        row.status = (data.get("status") or row.status).strip() or row.status
    if "go_live_date" in data:
        row.go_live_date = _parse_date(data.get("go_live_date"))

    db.session.commit()
    return jsonify({
        "success": True,
        "message": "Customer updated",
        "customer": row.to_dict(),
    }), 200
