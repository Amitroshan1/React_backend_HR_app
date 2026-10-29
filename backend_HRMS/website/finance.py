"""Finance panel: payroll cost, tax queue counts, reimbursement payout, and F&F sign-off.

Accounts still edits CTC, uploads payslips, and uploads Form 16.
"""
from __future__ import annotations

import calendar
from datetime import datetime

from flask import Blueprint, jsonify, request
from flask_jwt_extended import get_jwt, jwt_required
from sqlalchemy import func, or_

from . import db
from .datetime_utils import utc_now
from .models.Admin_models import Admin
from .models.attendance import LeaveApplication
from .models.expense import ExpenseClaimHeader, ExpenseLineItem
from .models.fnf_settlement import FnfSettlement
from .models.monthly_payroll import MonthlyPayroll
from .models.news_feed import PaySlip
from .payroll_lifecycle_service import update_fnf_settlement_status
from .plan_features import can_access_finance_panel, plan_forbidden_response
from .tenant_context import admin_id_in_tenant, admin_tenant_clause, current_admin, tenant_admin_ids, tenant_admin_query

finance_bp = Blueprint("finance", __name__)

FNF_CLOSED = frozenset({"paid", "settled", "completed"})
PAYOUT_ACTIONS = frozenset({"paid", "hold"})


@finance_bp.before_request
def _finance_guard():
    if request.method == "OPTIONS":
        return None
    try:
        from flask_jwt_extended import verify_jwt_in_request

        verify_jwt_in_request()
    except Exception:
        return jsonify({"success": False, "message": "Unauthorized"}), 401
    claims = get_jwt() or {}
    if can_access_finance_panel(claims):
        return None
    from .plan_features import has_feature, is_finance_role, is_org_admin

    if not is_org_admin(claims) and not has_feature("finance_panel"):
        return plan_forbidden_response("finance_panel")
    if not is_finance_role(claims):
        return jsonify({"success": False, "message": "Finance access required"}), 403
    return plan_forbidden_response("finance_panel")


def _viewer():
    admin = current_admin()
    if not admin:
        return None, (jsonify({"success": False, "message": "Unauthorized user"}), 401)
    return admin, None


def claim_is_fully_approved(items) -> bool:
    if not items:
        return False
    return {str(item.status or "Pending") for item in items} == {"Approved"}


def apply_claim_payout(header, action: str, actor_id: int) -> None:
    """Mark a fully approved claim paid or on hold. Paid claims stay paid."""
    action = (action or "").strip().lower()
    if action not in PAYOUT_ACTIONS:
        raise ValueError("action must be paid or hold")
    current = (header.payout_status or "").strip().lower()
    if current == "paid":
        raise ValueError("This claim is already marked paid.")
    items = list(header.expenses or [])
    if not claim_is_fully_approved(items):
        raise ValueError("Only claims a manager has fully approved can be paid or held.")
    header.payout_status = action
    header.payout_at = utc_now()
    header.payout_by_admin_id = actor_id


def _month_bounds(year: int, month: int):
    start = datetime(year, month, 1)
    last = calendar.monthrange(year, month)[1]
    return start.date(), datetime(year, month, last).date()


def _extra_payment_count(year: int, month: int) -> int:
    month_start, month_end = _month_bounds(year, month)
    rows = LeaveApplication.query.filter(
        LeaveApplication.admin_id.in_(tenant_admin_ids()),
        LeaveApplication.status == "Approved",
        LeaveApplication.final_approved_at.isnot(None),
        LeaveApplication.end_date < month_start,
    ).all()
    count = 0
    for row in rows:
        stamp = row.final_approved_at
        stamp_date = stamp.date() if isinstance(stamp, datetime) else stamp
        if month_start <= stamp_date <= month_end:
            count += 1
    return count


def _ytd_claim_amount(year: int) -> float:
    total = db.session.query(func.coalesce(func.sum(ExpenseLineItem.amount), 0)).join(
        ExpenseClaimHeader, ExpenseLineItem.claim_id == ExpenseClaimHeader.id
    ).filter(
        func.extract("year", ExpenseLineItem.date) == year,
        ExpenseClaimHeader.admin_id.in_(tenant_admin_ids()),
    ).scalar()
    return _rupee(total)


def _rupee(value) -> float:
    return round(float(value or 0), 2)


def _ctc_pending_count() -> int:
    try:
        from .ctc_approval_service import pending_count
        return pending_count()
    except Exception:
        return 0


def _payroll_batch_pending_count() -> int:
    try:
        from .payroll_batch_service import pending_finance_count
        return pending_finance_count()
    except Exception:
        return 0


@finance_bp.route("/summary", methods=["GET"])
@jwt_required()
def finance_summary():
    viewer, err = _viewer()
    if err:
        return err
    now = datetime.now()
    month_name = now.strftime("%B")
    year = str(now.year)
    month_num = now.month

    active_employees = tenant_admin_query().filter(
        db.func.coalesce(Admin.is_exited, False) == False,
        db.func.coalesce(Admin.is_active, True) == True,
    ).count()
    payslips = PaySlip.query.filter(
        PaySlip.month == month_name,
        PaySlip.year == year,
        PaySlip.admin_id.in_(tenant_admin_ids()),
    ).count()

    gross, net, payroll_rows = db.session.query(
        func.coalesce(func.sum(MonthlyPayroll.gross_salary_for_month), 0),
        func.coalesce(func.sum(MonthlyPayroll.net_salary_final), 0),
        func.count(MonthlyPayroll.id),
    ).filter(
        MonthlyPayroll.admin_id.in_(tenant_admin_ids()),
        MonthlyPayroll.month_num == month_num,
        MonthlyPayroll.year == year,
    ).one()

    approved_claims = (
        ExpenseClaimHeader.query.filter(ExpenseClaimHeader.admin_id.in_(tenant_admin_ids())).all()
    )
    to_pay = 0
    on_hold = 0
    for claim in approved_claims:
        if not claim_is_fully_approved(claim.expenses or []):
            continue
        status = (claim.payout_status or "").strip().lower()
        if status == "paid":
            continue
        if status == "hold":
            on_hold += 1
        else:
            to_pay += 1

    tax_pending = 0
    try:
        from .models.employee_tax_declaration import EmployeeTaxDeclaration

        tax_pending = EmployeeTaxDeclaration.query.filter(
            EmployeeTaxDeclaration.admin_id.in_(tenant_admin_ids()),
            or_(
                EmployeeTaxDeclaration.status == "verified",
                func.lower(func.coalesce(EmployeeTaxDeclaration.final_proof_status, "")) == "verified",
            ),
        ).count()
    except Exception:
        tax_pending = 0

    claims_pending_review = 0
    for claim in approved_claims:
        lines = claim.expenses or []
        if any(str(getattr(item, "status", "") or "").strip().lower() == "pending" for item in lines):
            claims_pending_review += 1

    fnf_open = FnfSettlement.query.filter(
        FnfSettlement.admin_id.in_(tenant_admin_ids()),
        FnfSettlement.status.notin_(tuple(FNF_CLOSED)),
    ).count()

    purchase_pending = 0
    purchase_waiting_manager = 0
    try:
        from .models.inventory_purchase_request import InventoryPurchaseRequest
        from .tenant_context import get_current_tenant_id

        purchase_pending = InventoryPurchaseRequest.query.filter(
            InventoryPurchaseRequest.tenant_id == get_current_tenant_id(),
            InventoryPurchaseRequest.status == "pending_finance",
        ).count()
        purchase_waiting_manager = InventoryPurchaseRequest.query.filter(
            InventoryPurchaseRequest.tenant_id == get_current_tenant_id(),
            InventoryPurchaseRequest.status == "pending_manager",
        ).count()
    except Exception:
        purchase_pending = 0
        purchase_waiting_manager = 0

    return jsonify({
        "success": True,
        "data": {
            "month": month_name,
            "year": int(year),
            "active_employees": active_employees,
            "payslips_generated": payslips,
            "payslips_pending": max(0, active_employees - payslips),
            "payroll_rows": int(payroll_rows or 0),
            "gross": _rupee(gross),
            "net": _rupee(net),
            "claims_to_pay": to_pay,
            "claims_on_hold": on_hold,
            "claims_pending_review": claims_pending_review,
            "claims_open": claims_pending_review + to_pay,
            "ytd_expenses": _ytd_claim_amount(now.year),
            "tax_pending": tax_pending,
            "fnf_open": fnf_open,
            "purchase_pending": purchase_pending,
            "purchase_waiting_manager": purchase_waiting_manager,
            "ctc_pending": _ctc_pending_count(),
            "payroll_batch_pending": _payroll_batch_pending_count(),
            "extra_payments": _extra_payment_count(now.year, month_num),
        },
    }), 200


@finance_bp.route("/payroll", methods=["GET"])
@jwt_required()
def finance_payroll():
    viewer, err = _viewer()
    if err:
        return err
    now = datetime.now()
    year = str(now.year)
    month_num = now.month
    rows = (
        MonthlyPayroll.query.join(Admin, MonthlyPayroll.admin_id == Admin.id)
        .filter(
            admin_tenant_clause(),
            MonthlyPayroll.month_num == month_num,
            MonthlyPayroll.year == year,
        )
        .all()
    )
    grouped = {}
    for row in rows:
        dept = (row.admin.emp_type if row.admin else None) or "Not assigned"
        bucket = grouped.setdefault(dept, {"department": dept, "employees": 0, "gross": 0.0, "net": 0.0})
        bucket["employees"] += 1
        bucket["gross"] += float(row.gross_salary_for_month or 0)
        bucket["net"] += float(row.net_salary_final or 0)
    data = []
    for item in grouped.values():
        item["gross"] = _rupee(item["gross"])
        item["net"] = _rupee(item["net"])
        data.append(item)
    data.sort(key=lambda item: item["department"])
    return jsonify({
        "success": True,
        "month": now.strftime("%B"),
        "year": int(year),
        "departments": data,
    }), 200


def _claim_payload(row: ExpenseClaimHeader) -> dict:
    emp = row.admin
    items = list(row.expenses or [])
    total = sum(float(item.amount or 0) for item in items)
    return {
        "id": row.id,
        "employee_name": row.employee_name or (emp.first_name if emp else ""),
        "emp_id": row.emp_id or (emp.emp_id if emp else ""),
        "project_name": row.project_name,
        "travel_from_date": row.travel_from_date.isoformat() if row.travel_from_date else None,
        "travel_to_date": row.travel_to_date.isoformat() if row.travel_to_date else None,
        "total_amount": _rupee(total),
        "payout_status": (row.payout_status or "to_pay"),
        "line_count": len(items),
    }


@finance_bp.route("/expense-claims", methods=["GET"])
@jwt_required()
def finance_expense_claims():
    viewer, err = _viewer()
    if err:
        return err
    wanted = (request.args.get("payout") or "to_pay").strip().lower()
    rows = (
        ExpenseClaimHeader.query.filter(ExpenseClaimHeader.admin_id.in_(tenant_admin_ids()))
        .order_by(ExpenseClaimHeader.id.desc())
        .all()
    )
    claims = []
    for row in rows:
        if not claim_is_fully_approved(row.expenses or []):
            continue
        status = (row.payout_status or "to_pay").strip().lower() or "to_pay"
        if wanted != "all" and status != wanted:
            continue
        claims.append(_claim_payload(row))
    return jsonify({"success": True, "claims": claims}), 200


@finance_bp.route("/expense-claims/<int:claim_id>/payout", methods=["POST"])
@jwt_required()
def finance_claim_payout(claim_id):
    viewer, err = _viewer()
    if err:
        return err
    data = request.get_json(silent=True) or {}
    row = db.session.get(ExpenseClaimHeader, claim_id)
    if not row or not admin_id_in_tenant(row.admin_id):
        return jsonify({"success": False, "message": "Claim not found"}), 404
    try:
        apply_claim_payout(row, data.get("action"), viewer.id)
        db.session.commit()
    except ValueError as exc:
        db.session.rollback()
        return jsonify({"success": False, "message": str(exc)}), 409
    return jsonify({"success": True, "claim": _claim_payload(row)}), 200


@finance_bp.route("/fnf", methods=["GET"])
@jwt_required()
def finance_fnf_list():
    viewer, err = _viewer()
    if err:
        return err
    rows = (
        FnfSettlement.query.join(Admin, FnfSettlement.admin_id == Admin.id)
        .filter(admin_tenant_clause())
        .order_by(FnfSettlement.id.desc())
        .all()
    )
    settlements = []
    for row in rows:
        emp = row.admin
        payload = row.to_dict()
        payload["employee_name"] = (emp.first_name if emp else "") or ""
        payload["emp_id"] = (emp.emp_id if emp else "") or ""
        payload["open"] = (row.status or "").strip().lower() not in FNF_CLOSED
        settlements.append(payload)
    return jsonify({"success": True, "settlements": settlements}), 200


@finance_bp.route("/fnf/<int:settlement_id>/paid", methods=["POST"])
@jwt_required()
def finance_fnf_paid(settlement_id):
    viewer, err = _viewer()
    if err:
        return err
    row = db.session.get(FnfSettlement, settlement_id)
    if not row or not admin_id_in_tenant(row.admin_id):
        return jsonify({"success": False, "message": "Settlement not found"}), 404
    prev = (row.status or "").strip().lower()
    if prev in FNF_CLOSED:
        return jsonify({"success": False, "message": "This settlement is already closed."}), 409
    try:
        row = update_fnf_settlement_status(settlement_id, "paid")
        db.session.commit()
    except ValueError as exc:
        db.session.rollback()
        return jsonify({"success": False, "message": str(exc)}), 400
    try:
        from .exit_interview_service import send_fnf_paid_documents_to_employee

        send_fnf_paid_documents_to_employee(settlement_id, created_by_admin_id=viewer.id)
        db.session.commit()
    except Exception:
        db.session.rollback()
    fresh = db.session.get(FnfSettlement, settlement_id)
    return jsonify({"success": True, "settlement": fresh.to_dict() if fresh else row.to_dict()}), 200


@finance_bp.route("/client-options", methods=["GET"])
@jwt_required()
def finance_client_options():
    viewer, err = _viewer()
    if err:
        return err
    results = db.session.query(Admin.emp_type, Admin.circle).filter(
        admin_tenant_clause(),
        Admin.is_active == True,
        or_(Admin.is_exited == False, Admin.is_exited.is_(None)),
    ).distinct().all()
    departments = set()
    circles = set()
    for emp_type, circle in results:
        if emp_type:
            departments.add(emp_type)
        if circle:
            circles.add(circle)
    return jsonify({
        "success": True,
        "departments": sorted(departments),
        "circles": sorted(circles),
    }), 200


@finance_bp.route("/extra-payments", methods=["GET"])
@jwt_required()
def finance_extra_payments():
    viewer, err = _viewer()
    if err:
        return err
    now = datetime.now()
    month_start, month_end = _month_bounds(now.year, now.month)
    rows = (
        LeaveApplication.query.join(Admin, LeaveApplication.admin_id == Admin.id)
        .filter(
            admin_tenant_clause(),
            LeaveApplication.status == "Approved",
            LeaveApplication.final_approved_at.isnot(None),
            LeaveApplication.end_date < month_start,
        )
        .all()
    )
    items = []
    for row in rows:
        stamp = row.final_approved_at
        stamp_date = stamp.date() if isinstance(stamp, datetime) else stamp
        if not (month_start <= stamp_date <= month_end):
            continue
        emp = row.admin
        days = float(row.deducted_days or 0) or float(row.requested_deducted_days or 0)
        if days <= 0 and row.start_date and row.end_date:
            days = (row.end_date - row.start_date).days + 1
        items.append({
            "id": row.id,
            "employee_name": emp.first_name if emp else "",
            "emp_id": emp.emp_id if emp else "",
            "leave_type": row.leave_type,
            "start_date": row.start_date.isoformat() if row.start_date else None,
            "end_date": row.end_date.isoformat() if row.end_date else None,
            "days": days,
            "approved_on": stamp_date.isoformat(),
        })
    return jsonify({"success": True, "items": items}), 200


@finance_bp.route("/ctc-approvals", methods=["GET"])
@jwt_required()
def finance_ctc_approvals():
    viewer, err = _viewer()
    if err:
        return err
    from .ctc_approval_service import list_queue

    status = (request.args.get("status") or "").strip() or None
    rows = list_queue(status)
    return jsonify({
        "success": True,
        "items": [row.to_dict() for row in rows],
    }), 200


@finance_bp.route("/ctc-approvals/<int:req_id>/decide", methods=["POST"])
@jwt_required()
def finance_ctc_decide(req_id):
    viewer, err = _viewer()
    if err:
        return err
    from .ctc_approval_service import decide
    from .models.ctc_change_request import CTCChangeRequest
    from .Accounts import _apply_approved_change_request

    req = CTCChangeRequest.query.get(req_id)
    if not req:
        return jsonify({"success": False, "message": "Request not found"}), 404
    data = request.get_json(silent=True) or {}
    try:
        req, apply_now = decide(
            req,
            actor=viewer,
            action=data.get("action") or "approve",
            reason=data.get("reason"),
            step="finance",
        )
        if apply_now:
            _apply_approved_change_request(req, viewer.id)
        db.session.commit()
    except Exception as e:
        db.session.rollback()
        return jsonify({"success": False, "message": str(e)}), 400
    return jsonify({"success": True, "request": req.to_dict()}), 200


@finance_bp.route("/payroll-batches", methods=["GET"])
@jwt_required()
def finance_payroll_batches():
    viewer, err = _viewer()
    if err:
        return err
    from .payroll_batch_service import batch_public_payload, list_pending_finance_batches

    rows = list_pending_finance_batches()
    return jsonify({
        "success": True,
        "items": [batch_public_payload(b) for b in rows],
    }), 200


@finance_bp.route("/payroll-batches/<int:batch_id>", methods=["GET"])
@jwt_required()
def finance_payroll_batch_detail(batch_id):
    viewer, err = _viewer()
    if err:
        return err
    from .models.monthly_payroll import MonthlyPayroll
    from .payroll_batch_service import PayrollBatch, batch_public_payload
    from .tenant_context import get_current_tenant_id

    batch = db.session.get(PayrollBatch, batch_id)
    if not batch or int(batch.tenant_id) != int(get_current_tenant_id()):
        return jsonify({"success": False, "message": "Batch not found"}), 404
    members = []
    for member in batch.members or []:
        if not member.included:
            continue
        payroll = member.payroll or db.session.get(MonthlyPayroll, member.payroll_id)
        admin = db.session.get(Admin, member.admin_id)
        if not payroll:
            continue
        members.append({
            **payroll.to_dict(),
            "name": getattr(admin, "first_name", None) if admin else None,
            "empId": getattr(admin, "emp_id", None) if admin else None,
        })
    return jsonify({
        "success": True,
        "batch": batch_public_payload(batch),
        "members": members,
    }), 200


@finance_bp.route("/payroll-batches/<int:batch_id>/decide", methods=["POST"])
@jwt_required()
def finance_payroll_batch_decide(batch_id):
    viewer, err = _viewer()
    if err:
        return err
    from .email import send_payroll_batch_decision_email
    from .payroll_batch_service import PayrollBatch, batch_public_payload, decide_batch
    from .tenant_context import get_current_tenant_id

    batch = db.session.get(PayrollBatch, batch_id)
    if not batch or int(batch.tenant_id) != int(get_current_tenant_id()):
        return jsonify({"success": False, "message": "Batch not found"}), 404
    data = request.get_json(silent=True) or {}
    try:
        status = decide_batch(
            batch,
            action=data.get("action") or "approve",
            actor_admin_id=viewer.id,
            comment=data.get("reason") or data.get("comment"),
        )
        db.session.commit()
    except ValueError as e:
        db.session.rollback()
        return jsonify({"success": False, "message": str(e)}), 409
    try:
        decided_on = batch.decided_at.date().isoformat() if batch.decided_at else ""
        send_payroll_batch_decision_email(
            circle=batch.circle,
            emp_type=batch.emp_type,
            month=batch.month,
            year=batch.year,
            decision=status,
            decided_on=decided_on,
        )
    except Exception:
        pass
    return jsonify({"success": True, "batch": batch_public_payload(batch)}), 200
