"""
Admin panel API: dashboard stats, employee list, and employee detail.
Access restricted to users with emp_type Admin / Administrator / Administration.
"""
import os
from datetime import date, datetime, timedelta
from calendar import monthrange

from flask import Blueprint, current_app, jsonify, request
from flask_jwt_extended import jwt_required, get_jwt
from sqlalchemy import func

from . import db
from .models.Admin_models import Admin
from .models.attendance import LeaveApplication, Punch, WorkFromHomeApplication
from .models.query import Query
from .models.expense import ExpenseClaimHeader, ExpenseLineItem
from .models.seperation import Resignation
from .models.news_feed import PaySlip
from .models.emp_detail_models import Employee, Asset
from .employee_photo import photo_url_for_admin_id
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


def _as_date(value):
    """Normalize DB date/datetime/string to date."""
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    try:
        return date.fromisoformat(str(value)[:10])
    except (TypeError, ValueError):
        return None


def _fmt_punch_time(dt):
    if not dt:
        return ""
    try:
        return dt.strftime("%H:%M")
    except Exception:
        return ""


def _punch_in_out_times(punch):
    """Resolve punch in/out from Punch aggregate or sessions."""
    if not punch:
        return "", ""
    pin = _fmt_punch_time(getattr(punch, "punch_in", None))
    pout = _fmt_punch_time(getattr(punch, "punch_out", None))
    if pin or pout:
        return pin, pout
    sessions = getattr(punch, "sessions", None) or []
    if not sessions:
        return "", ""
    clocks_in = [s.clock_in for s in sessions if getattr(s, "clock_in", None)]
    clocks_out = [s.clock_out for s in sessions if getattr(s, "clock_out", None)]
    pin = _fmt_punch_time(min(clocks_in)) if clocks_in else ""
    pout = _fmt_punch_time(max(clocks_out)) if clocks_out else ""
    return pin, pout


def _build_admin_punch_days(admin_id, range_start, range_end):
    """
    Build day rows (newest first) for punch in/out + approved leave/WFH.
    Includes every calendar day in [range_start, range_end].
    """
    from sqlalchemy.orm import joinedload

    if range_start > range_end:
        range_start, range_end = range_end, range_start

    punch_rows = (
        Punch.query.options(joinedload(Punch.sessions))
        .filter(
            Punch.admin_id == admin_id,
            Punch.punch_date >= range_start,
            Punch.punch_date <= range_end,
        )
        .all()
    )
    punch_map = {}
    for p in punch_rows:
        d = _as_date(p.punch_date)
        if d:
            punch_map[d] = p

    leave_rows = LeaveApplication.query.filter(
        LeaveApplication.admin_id == admin_id,
        LeaveApplication.status == "Approved",
        LeaveApplication.start_date <= range_end,
        LeaveApplication.end_date >= range_start,
    ).all()
    wfh_rows = WorkFromHomeApplication.query.filter(
        WorkFromHomeApplication.admin_id == admin_id,
        WorkFromHomeApplication.status == "Approved",
        WorkFromHomeApplication.start_date <= range_end,
        WorkFromHomeApplication.end_date >= range_start,
    ).all()

    rows = []
    day = range_end
    while day >= range_start:
        punch = punch_map.get(day)
        leave_match = next(
            (
                lv
                for lv in leave_rows
                if (ls := _as_date(lv.start_date))
                and (le := _as_date(lv.end_date))
                and ls <= day <= le
            ),
            None,
        )
        wfh_match = next(
            (
                w
                for w in wfh_rows
                if (ws := _as_date(w.start_date))
                and (we := _as_date(w.end_date))
                and ws <= day <= we
            ),
            None,
        )
        on_leave = leave_match is not None
        is_wfh = wfh_match is not None
        punch_in_s, punch_out_s = _punch_in_out_times(punch)
        rows.append({
            "id": punch.id if punch else f"day-{day.isoformat()}",
            "date": day.isoformat(),
            "punch_in": punch_in_s or "—",
            "punch_out": punch_out_s or "—",
            "on_leave": on_leave,
            "is_wfh": is_wfh,
            "leave_type": (leave_match.leave_type if leave_match else "") or "",
            "today_work": str(punch.today_work) if punch and punch.today_work else "",
        })
        day -= timedelta(days=1)
    return rows


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
    company_total_employees = _base_employee_query().count()

    today = date.today()
    active_today = (
        Punch.query.join(Admin, Punch.admin_id == Admin.id)
        .filter(
            Punch.punch_date == today,
            Punch.punch_in.isnot(None),
            db.func.coalesce(Admin.is_exited, False) == False,
            db.func.coalesce(Admin.is_active, True) == True,
        )
        .count()
    )

    # Leaves, queries, claims, resignations: all data in DB (Admin has org-wide access)
    total_leaves = LeaveApplication.query.count()
    total_queries = Query.query.count()
    total_claims = ExpenseClaimHeader.query.count()
    total_resignations = Resignation.query.count()

    pending_leaves = LeaveApplication.query.filter(
        func.lower(func.coalesce(LeaveApplication.status, "")) == "pending"
    ).count()

    pending_queries = Query.query.filter(
        func.lower(func.coalesce(Query.status, "")).in_(("new", "open", "pending"))
    ).count()

    pending_claims = (
        db.session.query(func.count(ExpenseLineItem.id))
        .filter(func.lower(func.coalesce(ExpenseLineItem.status, "")) == "pending")
        .scalar()
        or 0
    )

    total_inventory_assets = 0
    open_tickets = 0
    pending_return_requests = 0
    try:
        from .models.it_models import ITAssetUnit, ITSupportTicket, ITAssetReturnRequest

        total_inventory_assets = (
            db.session.query(func.count(ITAssetUnit.id)).scalar() or 0
        )
        open_tickets = (
            db.session.query(func.count(ITSupportTicket.id))
            .filter(func.lower(ITSupportTicket.status) == "pending")
            .scalar()
            or 0
        )
        pending_return_requests = (
            db.session.query(func.count(ITAssetReturnRequest.id))
            .filter(func.lower(ITAssetReturnRequest.status) == "pending")
            .scalar()
            or 0
        )
    except Exception:
        pass

    claims = get_jwt() or {}

    return jsonify({
        "success": True,
        "total_employees": total_employees,
        "company_total_employees": company_total_employees,
        "active_today": active_today,
        "total_leaves": total_leaves,
        "total_queries": total_queries,
        "total_claims": total_claims,
        "total_resignations": total_resignations,
        "pending_leaves": pending_leaves,
        "pending_queries": pending_queries,
        "pending_claims": pending_claims,
        "it_inventory_access": True,
        "total_inventory_assets": total_inventory_assets,
        "open_tickets": open_tickets,
        "pending_return_requests": pending_return_requests,
        "can_view_deployment_guide": _can_view_deployment_guide(claims),
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
        photo = photo_url_for_admin_id(row.id)
        employees.append({
            "id": row.id,
            "emp_id": row.emp_id or "",
            "name": (row.first_name or "").strip() or row.email or "",
            "email": row.email or "",
            "designation": (row.emp_type or "").strip(),
            "circle": (row.circle or "").strip(),
            "emp_type": (row.emp_type or "").strip(),
            "photo": photo,
            "photo_url": photo,
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

    # Queries — latest 5 raised by this employee
    queries = (
        Query.query.filter_by(admin_id=admin_id)
        .order_by(Query.created_at.desc(), Query.id.desc())
        .limit(5)
        .all()
    )
    queries_data = [
        {
            "id": q.id,
            "title": q.title or "",
            "department": q.department or "",
            "status": q.status or "",
            "created_at": _date_iso(q.created_at) if q.created_at else None,
            "query_text": ((q.query_text or "")[:200]),
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

    # Punches: last 5 calendar days with punch in/out + leave/WFH flags
    today = date.today()
    punches_data = _build_admin_punch_days(admin_id, today - timedelta(days=4), today)

    # Payslips (newest uploaded/generated first)
    payslips = PaySlip.query.filter_by(admin_id=admin_id).order_by(
        PaySlip.id.desc()
    ).all()
    month_names = (
        "", "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December",
    )
    month_name_to_num = {name.lower(): i for i, name in enumerate(month_names) if name}

    def _payslip_month_parts(raw_month):
        raw = str(raw_month or "").strip()
        if raw.isdigit():
            m = int(raw)
            if 1 <= m <= 12:
                return m, month_names[m]
            return None, raw or "—"
        key = raw.lower()
        if key in month_name_to_num:
            m = month_name_to_num[key]
            return m, month_names[m]
        # Truncated / alternate labels e.g. "Jan"
        for name, num in month_name_to_num.items():
            if name.startswith(key) or key.startswith(name[:3]):
                return num, month_names[num]
        return None, raw or "—"

    payslips_data = []
    for ps in payslips:
        try:
            y = int(ps.year) if ps.year and str(ps.year).strip().isdigit() else None
        except (TypeError, ValueError):
            y = None
        m_num, m_label = _payslip_month_parts(ps.month)
        period_date = None
        if y and m_num:
            try:
                period_date = date(y, m_num, 1).isoformat()
            except ValueError:
                period_date = None
        payslips_data.append({
            "id": ps.id,
            "month": m_label,
            "month_num": m_num,
            "year": str(ps.year or "").strip() or "—",
            "date": period_date,
            "file_path": ps.file_path or "",
        })

    # Assets — all currently assigned IT inventory + legacy HR assets
    assets_data = []
    try:
        from .it import _serialize_emp_assets
        for row in _serialize_emp_assets(admin):
            assets_data.append({
                "id": row.get("id"),
                "name": row.get("name") or "—",
                "category": row.get("category") or "—",
                "status": row.get("status") or "Assigned",
                "assignedDate": row.get("assignedDate"),
                "serialNumber": row.get("serialNumber") or "",
                "assetTag": row.get("assetTag") or row.get("assetId") or "",
                "quantity": row.get("quantity"),
            })
    except Exception:
        assets_data = []

    legacy_assets = Asset.query.filter_by(admin_id=admin_id).all()
    for a in legacy_assets:
        assets_data.append({
            "id": f"hr-{a.id}",
            "name": a.name or "—",
            "category": "HR Asset",
            "status": "Returned" if a.return_date else "Assigned",
            "assignedDate": _date_iso(a.issue_date),
            "serialNumber": "",
            "assetTag": "",
            "quantity": None,
            "returnDate": _date_iso(a.return_date),
            "remark": a.remark or "",
        })

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
            "photo": photo_url_for_admin_id(admin_id),
            "photo_url": photo_url_for_admin_id(admin_id),
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
# GET /api/admin/employees/<id>/punches – month (or last N days) punch ledger
# --------------------------------------------------
@admin_bp.route("/employees/<int:admin_id>/punches", methods=["GET"])
@jwt_required()
@_admin_required
def get_employee_punches(admin_id):
    admin = Admin.query.get(admin_id)
    if not admin or admin.is_exited:
        return jsonify({"success": False, "message": "Employee not found"}), 404

    today = date.today()
    days_arg = (request.args.get("days") or "").strip()
    month_arg = (request.args.get("month") or "").strip()
    year_arg = (request.args.get("year") or "").strip()

    if days_arg:
        try:
            n = max(1, min(31, int(days_arg)))
        except ValueError:
            n = 5
        range_end = today
        range_start = today - timedelta(days=n - 1)
        month = range_end.month
        year = range_end.year
    else:
        try:
            month = int(month_arg) if month_arg else today.month
            year = int(year_arg) if year_arg else today.year
        except ValueError:
            return jsonify({"success": False, "message": "Invalid month or year"}), 400
        if month < 1 or month > 12 or year < 2000 or year > 2100:
            return jsonify({"success": False, "message": "Invalid month or year"}), 400
        range_start = date(year, month, 1)
        range_end = date(year, month, monthrange(year, month)[1])

    rows = _build_admin_punch_days(admin_id, range_start, range_end)
    name = (admin.first_name or "").strip() or admin.email or ""
    return jsonify({
        "success": True,
        "employee": {
            "id": admin.id,
            "emp_id": admin.emp_id or "",
            "name": name,
        },
        "month": month,
        "year": year,
        "from_date": range_start.isoformat(),
        "to_date": range_end.isoformat(),
        "punches": rows,
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
