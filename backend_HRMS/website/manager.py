from flask import Blueprint, jsonify, request, current_app
from flask_jwt_extended import jwt_required, get_jwt
from sqlalchemy import func, or_
from datetime import date

from . import db
from .models.Admin_models import Admin
from .models.attendance import LeaveApplication, WorkFromHomeApplication
from .models.expense import ExpenseClaimHeader, ExpenseLineItem
from .models.seperation import Resignation
from .models.manager_model import ManagerContact
from .email import send_leave_decision_email, send_wfh_decision_email


manager = Blueprint("manager", __name__)


def _norm(value):
    return (value or "").strip().lower()


def _serialize_date(value):
    return value.isoformat() if value and hasattr(value, "isoformat") else None


def _get_current_admin():
    email = get_jwt().get("email")
    if not email:
        return None
    return Admin.query.filter_by(email=email).first()


def _get_contact_for_target(target_admin):
    circle = _norm(target_admin.circle)
    emp_type = _norm(target_admin.emp_type)
    target_email = _norm(target_admin.email)

    if not circle or not emp_type:
        return None

    specific = ManagerContact.query.filter(
        func.lower(func.coalesce(ManagerContact.circle_name, "")) == circle,
        func.lower(func.coalesce(ManagerContact.user_type, "")) == emp_type,
        func.lower(func.coalesce(ManagerContact.user_email, "")) == target_email,
    ).first()
    if specific:
        return specific

    return ManagerContact.query.filter(
        func.lower(func.coalesce(ManagerContact.circle_name, "")) == circle,
        func.lower(func.coalesce(ManagerContact.user_type, "")) == emp_type,
        or_(ManagerContact.user_email.is_(None), ManagerContact.user_email == ""),
    ).first()


def _is_manager_for_target(approver_admin, target_admin):
    if not approver_admin or not target_admin:
        return False
    if approver_admin.id == target_admin.id:
        return False
    # Strict scope: manager can only act within own emp_type + circle.
    if _norm(approver_admin.circle) != _norm(target_admin.circle):
        return False
    if _norm(approver_admin.emp_type) != _norm(target_admin.emp_type):
        return False

    contact = _get_contact_for_target(target_admin)
    if not contact:
        return False

    approver_email = _norm(approver_admin.email)
    allowed = {
        _norm(contact.l1_email),
        _norm(contact.l2_email),
        _norm(contact.l3_email),
    }
    return approver_email in allowed


def _ensure_manager_user():
    admin = _get_current_admin()
    if not admin:
        return None, (jsonify({"success": False, "message": "Unauthorized user"}), 401)

    admin_circle = _norm(admin.circle)
    admin_type = _norm(admin.emp_type)
    if not admin_circle or not admin_type:
        return None, (jsonify({"success": False, "message": "Manager profile missing circle or emp_type"}), 403)

    normalized_email = _norm(admin.email)
    has_mapping = ManagerContact.query.filter(
        func.lower(func.coalesce(ManagerContact.circle_name, "")) == admin_circle,
        func.lower(func.coalesce(ManagerContact.user_type, "")) == admin_type,
        or_(
            func.lower(func.coalesce(ManagerContact.l1_email, "")) == normalized_email,
            func.lower(func.coalesce(ManagerContact.l2_email, "")) == normalized_email,
            func.lower(func.coalesce(ManagerContact.l3_email, "")) == normalized_email,
        )
    ).first()

    if not has_mapping:
        return None, (jsonify({"success": False, "message": "Manager access required"}), 403)

    return admin, None


@manager.route("/scope", methods=["GET"])
@jwt_required()
def manager_scope():
    admin, err = _ensure_manager_user()
    if err:
        return err

    return jsonify(
        {
            "success": True,
            "scope": {
                "email": admin.email,
                "circle": admin.circle,
                "emp_type": admin.emp_type,
            },
        }
    ), 200


def _reverse_leave_usage(leave_balance, leave_type, deducted_days):
    if not leave_balance or deducted_days <= 0:
        return

    if leave_type == "Privilege Leave":
        leave_balance.used_privilege_leave = max(
            0.0, float(leave_balance.used_privilege_leave or 0.0) - deducted_days
        )
    elif leave_type == "Casual Leave":
        leave_balance.used_casual_leave = max(
            0.0, float(leave_balance.used_casual_leave or 0.0) - deducted_days
        )
    elif leave_type == "Compensatory Leave":
        leave_balance.used_comp_leave = max(
            0.0, float(leave_balance.used_comp_leave or 0.0) - deducted_days
        )
    elif leave_type == "Half Day Leave":
        leave_balance.used_casual_leave = max(
            0.0, float(leave_balance.used_casual_leave or 0.0) - 0.5
        )


def _validate_action_payload():
    data = request.get_json(silent=True) or {}
    action = (data.get("action") or "").strip().lower()
    if action not in ("approve", "reject"):
        return None, data, (jsonify({"success": False, "message": "action must be approve or reject"}), 400)
    return action, data, None


@manager.route("/leave-requests", methods=["GET"])
@jwt_required()
def list_leave_requests():
    admin, err = _ensure_manager_user()
    if err:
        return err

    status = (request.args.get("status") or "Pending").strip()
    query = LeaveApplication.query
    if status.lower() != "all":
        query = query.filter(LeaveApplication.status == status)

    rows = query.order_by(LeaveApplication.created_at.desc()).all()
    items = []
    for row in rows:
        if not _is_manager_for_target(admin, row.admin):
            continue
        items.append({
            "id": row.id,
            "employee_name": row.admin.first_name,
            "employee_email": row.admin.email,
            "emp_id": row.admin.emp_id,
            "circle": row.admin.circle,
            "emp_type": row.admin.emp_type,
            "leave_type": row.leave_type,
            "reason": row.reason,
            "start_date": _serialize_date(row.start_date),
            "end_date": _serialize_date(row.end_date),
            "status": row.status,
            "deducted_days": row.deducted_days,
            "extra_days": row.extra_days,
            "created_at": _serialize_date(row.created_at),
        })

    return jsonify({"success": True, "requests": items}), 200


@manager.route("/leave-requests/<int:leave_id>/action", methods=["POST"])
@jwt_required()
def act_on_leave_request(leave_id):
    approver, err = _ensure_manager_user()
    if err:
        return err

    action, _, payload_err = _validate_action_payload()
    if payload_err:
        return payload_err

    leave_obj = LeaveApplication.query.get(leave_id)
    if not leave_obj:
        return jsonify({"success": False, "message": "Leave request not found"}), 404
    if not _is_manager_for_target(approver, leave_obj.admin):
        return jsonify({"success": False, "message": "Not allowed for this employee"}), 403
    if leave_obj.status != "Pending":
        return jsonify({"success": False, "message": "Only pending requests can be updated"}), 409

    new_status = "Approved" if action == "approve" else "Rejected"
    leave_obj.status = new_status

    leave_balance = leave_obj.admin.leave_balance if leave_obj.admin else None
    deducted = float(leave_obj.deducted_days or 0.0)

    # Apply balance changes ONLY on approval.
    # Rejected requests do not touch LeaveBalance.
    if new_status == "Approved" and leave_balance and deducted > 0:
        lt = leave_obj.leave_type

        # Privilege Leave
        if lt == "Privilege Leave":
            current = float(leave_balance.privilege_leave_balance or 0.0)
            leave_balance.privilege_leave_balance = max(0.0, current - deducted)
            leave_balance.used_privilege_leave = float(leave_balance.used_privilege_leave or 0.0) + deducted

        # Casual Leave
        elif lt == "Casual Leave":
            current = float(leave_balance.casual_leave_balance or 0.0)
            leave_balance.casual_leave_balance = max(0.0, current - deducted)
            leave_balance.used_casual_leave = float(leave_balance.used_casual_leave or 0.0) + deducted

        # Compensatory Leave
        elif lt == "Compensatory Leave":
            current = float(leave_balance.compensatory_leave_balance or 0.0)
            leave_balance.compensatory_leave_balance = max(0.0, current - deducted)
            leave_balance.used_comp_leave = float(leave_balance.used_comp_leave or 0.0) + deducted

        # Half Day Leave: treat as 0.5 day CL (or PL) unless it was pure LOP (extra_days >= 0.5)
        elif lt == "Half Day Leave":
            extra = float(leave_obj.extra_days or 0.0)
            if extra < 0.5:
                # There was sufficient balance when applied; now consume from CL if possible, else PL.
                if float(leave_balance.casual_leave_balance or 0.0) >= 0.5:
                    leave_balance.casual_leave_balance -= 0.5
                    leave_balance.used_casual_leave = float(leave_balance.used_casual_leave or 0.0) + 0.5
                elif float(leave_balance.privilege_leave_balance or 0.0) >= 0.5:
                    leave_balance.privilege_leave_balance -= 0.5
                    leave_balance.used_privilege_leave = float(leave_balance.used_privilege_leave or 0.0) + 0.5
                # else: treat as LOP at this point as well (no balance change)

        # Optional Leave: never touches leave balances
        elif lt == "Optional Leave":
            pass

    db.session.commit()

    # Fire-and-forget email notification; never break API on failure
    try:
        send_leave_decision_email(leave_obj, approver, action)
    except Exception:
        current_app.logger.warning(
            "send_leave_decision_email failed for leave_id=%s", getattr(leave_obj, "id", None)
        )

    return jsonify({"success": True, "message": f"Leave request {new_status.lower()}"}), 200


@manager.route("/wfh-requests", methods=["GET"])
@jwt_required()
def list_wfh_requests():
    admin, err = _ensure_manager_user()
    if err:
        return err

    status = (request.args.get("status") or "Pending").strip()
    query = WorkFromHomeApplication.query
    if status.lower() != "all":
        query = query.filter(WorkFromHomeApplication.status == status)

    rows = query.order_by(WorkFromHomeApplication.created_at.desc()).all()
    items = []
    for row in rows:
        if not _is_manager_for_target(admin, row.admin):
            continue
        items.append({
            "id": row.id,
            "employee_name": row.admin.first_name,
            "employee_email": row.admin.email,
            "emp_id": row.admin.emp_id,
            "circle": row.admin.circle,
            "emp_type": row.admin.emp_type,
            "start_date": _serialize_date(row.start_date),
            "end_date": _serialize_date(row.end_date),
            "reason": row.reason,
            "status": row.status,
            "created_at": _serialize_date(row.created_at),
        })

    return jsonify({"success": True, "requests": items}), 200


@manager.route("/wfh-requests/<int:wfh_id>/action", methods=["POST"])
@jwt_required()
def act_on_wfh_request(wfh_id):
    approver, err = _ensure_manager_user()
    if err:
        return err

    action, _, payload_err = _validate_action_payload()
    if payload_err:
        return payload_err

    wfh_obj = WorkFromHomeApplication.query.get(wfh_id)
    if not wfh_obj:
        return jsonify({"success": False, "message": "WFH request not found"}), 404
    if not _is_manager_for_target(approver, wfh_obj.admin):
        return jsonify({"success": False, "message": "Not allowed for this employee"}), 403
    if wfh_obj.status != "Pending":
        return jsonify({"success": False, "message": "Only pending requests can be updated"}), 409

    wfh_obj.status = "Approved" if action == "approve" else "Rejected"
    db.session.commit()

    try:
        send_wfh_decision_email(wfh_obj, approver, action)
    except Exception:
        current_app.logger.warning(
            "send_wfh_decision_email failed for wfh_id=%s", getattr(wfh_obj, "id", None)
        )

    return jsonify({"success": True, "message": f"WFH request {wfh_obj.status.lower()}"}), 200


def _claim_status(items):
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


@manager.route("/claim-requests", methods=["GET"])
@jwt_required()
def list_claim_requests():
    admin, err = _ensure_manager_user()
    if err:
        return err

    requested_status = (request.args.get("status") or "Pending").strip()
    rows = ExpenseClaimHeader.query.order_by(ExpenseClaimHeader.id.desc()).all()

    items = []
    for row in rows:
        if not _is_manager_for_target(admin, row.admin):
            continue
        line_items = ExpenseLineItem.query.filter_by(claim_id=row.id).order_by(ExpenseLineItem.sr_no.asc()).all()
        derived_status = _claim_status(line_items)
        if requested_status.lower() != "all" and derived_status.lower() != requested_status.lower():
            continue

        items.append({
            "id": row.id,
            "employee_name": row.employee_name,
            "employee_email": row.email,
            "emp_id": row.emp_id,
            "circle": row.admin.circle if row.admin else None,
            "emp_type": row.admin.emp_type if row.admin else None,
            "project_name": row.project_name,
            "country_state": row.country_state,
            "travel_from_date": _serialize_date(row.travel_from_date),
            "travel_to_date": _serialize_date(row.travel_to_date),
            "status": derived_status,
            "line_items": [
                {
                    "id": li.id,
                    "sr_no": li.sr_no,
                    "date": _serialize_date(li.date),
                    "purpose": li.purpose,
                    "amount": li.amount,
                    "currency": li.currency,
                    "file": li.Attach_file,
                    "status": li.status,
                }
                for li in line_items
            ],
        })

    return jsonify({"success": True, "requests": items}), 200


@manager.route("/claim-requests/<int:claim_id>/action", methods=["POST"])
@jwt_required()
def act_on_claim_request(claim_id):
    approver, err = _ensure_manager_user()
    if err:
        return err

    action, _, payload_err = _validate_action_payload()
    if payload_err:
        return payload_err

    claim = ExpenseClaimHeader.query.get(claim_id)
    if not claim:
        return jsonify({"success": False, "message": "Claim request not found"}), 404
    if not _is_manager_for_target(approver, claim.admin):
        return jsonify({"success": False, "message": "Not allowed for this employee"}), 403

    new_status = "Approved" if action == "approve" else "Rejected"
    line_items = ExpenseLineItem.query.filter_by(claim_id=claim_id).all()
    changed = 0
    for item in line_items:
        if item.status == "Pending":
            item.status = new_status
            changed += 1

    if changed == 0:
        return jsonify({"success": False, "message": "No pending line items to update"}), 409

    db.session.commit()
    return jsonify({"success": True, "message": f"Claim request {new_status.lower()}"}), 200


@manager.route("/resignation-requests", methods=["GET"])
@jwt_required()
def list_resignation_requests():
    admin, err = _ensure_manager_user()
    if err:
        return err

    status = (request.args.get("status") or "Pending").strip()
    query = Resignation.query
    if status.lower() != "all":
        query = query.filter(Resignation.status == status)

    rows = query.order_by(Resignation.applied_on.desc()).all()
    items = []
    for row in rows:
        if not _is_manager_for_target(admin, row.admin):
            continue
        items.append({
            "id": row.id,
            "employee_name": row.admin.first_name,
            "employee_email": row.admin.email,
            "emp_id": row.admin.emp_id,
            "circle": row.admin.circle,
            "emp_type": row.admin.emp_type,
            "resignation_date": _serialize_date(row.resignation_date),
            "reason": row.reason,
            "status": row.status,
            "applied_on": _serialize_date(row.applied_on),
        })

    return jsonify({"success": True, "requests": items}), 200


@manager.route("/resignation-requests/<int:resignation_id>/action", methods=["POST"])
@jwt_required()
def act_on_resignation_request(resignation_id):
    approver, err = _ensure_manager_user()
    if err:
        return err

    action, _, payload_err = _validate_action_payload()
    if payload_err:
        return payload_err

    resignation = Resignation.query.get(resignation_id)
    if not resignation:
        return jsonify({"success": False, "message": "Resignation request not found"}), 404
    if not _is_manager_for_target(approver, resignation.admin):
        return jsonify({"success": False, "message": "Not allowed for this employee"}), 403
    if resignation.status != "Pending":
        return jsonify({"success": False, "message": "Only pending requests can be updated"}), 409

    resignation.status = "Approved" if action == "approve" else "Rejected"
    db.session.commit()
    return jsonify({"success": True, "message": f"Resignation request {resignation.status.lower()}"}), 200


@manager.route("/team-members", methods=["GET"])
@jwt_required()
def list_team_members():
    manager_admin, err = _ensure_manager_user()
    if err:
        return err

    manager_circle = _norm(manager_admin.circle)
    manager_type = _norm(manager_admin.emp_type)
    req_circle = _norm(request.args.get("circle"))
    req_type = _norm(request.args.get("emp_type"))

    # If frontend sends filters, enforce they cannot escape manager's own scope.
    if req_circle and req_circle != "all" and req_circle != manager_circle:
        return jsonify({"success": True, "members": []}), 200
    if req_type and req_type != "all" and req_type != manager_type:
        return jsonify({"success": True, "members": []}), 200

    rows = (
        Admin.query.filter(
            func.coalesce(Admin.is_exited, False) == False,
            func.lower(func.coalesce(Admin.circle, "")) == manager_circle,
            func.lower(func.coalesce(Admin.emp_type, "")) == manager_type,
        )
        .order_by(Admin.first_name.asc(), Admin.id.asc())
        .all()
    )

    today = date.today()
    members = []
    for row in rows:
        if row.id == manager_admin.id:
            continue
        has_wfh_today = (
            WorkFromHomeApplication.query.filter(
                WorkFromHomeApplication.admin_id == row.id,
                WorkFromHomeApplication.status == "Approved",
                WorkFromHomeApplication.start_date <= today,
                WorkFromHomeApplication.end_date >= today,
            )
            .first()
            is not None
        )
        members.append(
            {
                "id": row.id,
                "name": row.first_name or "Unknown",
                "role": row.emp_type or "",
                "circle": row.circle or "",
                "status": "WFH" if has_wfh_today else "Present",
                "perf": 75 if has_wfh_today else 90,
            }
        )

    return jsonify({"success": True, "members": members}), 200


@manager.route("/sprint-performance", methods=["GET"])
@jwt_required()
def sprint_performance():
    manager_admin, err = _ensure_manager_user()
    if err:
        return err

    completed = 0
    pending = 0
    overdue = 0

    def _tally(status_value):
        nonlocal completed, pending, overdue
        s = _norm(status_value)
        if s == "approved":
            completed += 1
        elif s == "pending":
            pending += 1
        elif s == "rejected":
            overdue += 1

    for row in LeaveApplication.query.all():
        if _is_manager_for_target(manager_admin, row.admin):
            _tally(row.status)
    for row in WorkFromHomeApplication.query.all():
        if _is_manager_for_target(manager_admin, row.admin):
            _tally(row.status)
    for row in Resignation.query.all():
        if _is_manager_for_target(manager_admin, row.admin):
            _tally(row.status)
    for row in ExpenseClaimHeader.query.all():
        if _is_manager_for_target(manager_admin, row.admin):
            line_items = ExpenseLineItem.query.filter_by(claim_id=row.id).all()
            _tally(_claim_status(line_items))

    total = max(completed + pending + overdue, 1)
    items = [
        {"name": "Completed Tasks", "value": int(round((completed * 100) / total))},
        {"name": "Pending Tasks", "value": int(round((pending * 100) / total))},
        {"name": "Overdue Tasks", "value": int(round((overdue * 100) / total))},
    ]
    return jsonify({"success": True, "items": items}), 200
