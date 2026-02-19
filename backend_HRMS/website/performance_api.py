from datetime import datetime, timedelta

from flask import Blueprint, jsonify, request
from flask_jwt_extended import get_jwt, jwt_required
from sqlalchemy import func, or_

from . import db
from .models.Admin_models import Admin
from .models.manager_model import ManagerContact
from .models.Performance import EmployeePerformance, ManagerReview
from .email import send_performance_submitted_email, send_performance_reviewed_email


performance_api = Blueprint("performance_api", __name__)


def _norm(value):
    return (value or "").strip().lower()


def _current_admin():
    email = get_jwt().get("email")
    if not email:
        return None
    return Admin.query.filter_by(email=email).first()


def _is_hr(admin):
    return _norm(getattr(admin, "emp_type", "")) in {"human resource", "hr"}


def _manager_contact_for_target(target_admin):
    circle = _norm(getattr(target_admin, "circle", ""))
    emp_type = _norm(getattr(target_admin, "emp_type", ""))
    email = _norm(getattr(target_admin, "email", ""))
    if not circle or not emp_type:
        return None

    row = ManagerContact.query.filter(
        func.lower(func.coalesce(ManagerContact.circle_name, "")) == circle,
        func.lower(func.coalesce(ManagerContact.user_type, "")) == emp_type,
        func.lower(func.coalesce(ManagerContact.user_email, "")) == email,
    ).first()
    if row:
        return row

    return ManagerContact.query.filter(
        func.lower(func.coalesce(ManagerContact.circle_name, "")) == circle,
        func.lower(func.coalesce(ManagerContact.user_type, "")) == emp_type,
        or_(ManagerContact.user_email.is_(None), ManagerContact.user_email == ""),
    ).first()


def _is_manager_for_target(manager_admin, target_admin):
    """True if manager is L1/L2/L3 in target's ManagerContact (no circle/emp_type restriction)."""
    if not manager_admin or not target_admin:
        return False
    if manager_admin.id == target_admin.id:
        return False
    contact = _manager_contact_for_target(target_admin)
    if not contact:
        return False
    from .manager_utils import is_manager_in_contact
    return is_manager_in_contact(contact, manager_admin)


def _ensure_manager_user():
    """Grant manager access if admin appears in any ManagerContact as L1/L2/L3 (no circle/emp_type required)."""
    admin = _current_admin()
    if not admin:
        return None, (jsonify({"success": False, "message": "Unauthorized user"}), 401)
    from .manager_utils import user_has_manager_access
    if not user_has_manager_access(admin):
        return None, (jsonify({"success": False, "message": "Manager access required"}), 403)
    return admin, None


def _serialize_performance(row):
    review = row.review
    return {
        "id": row.id,
        "admin_id": row.admin_id,
        "employee_name": row.employee_name,
        "employee_email": row.admin.email if row.admin else None,
        "emp_id": row.admin.emp_id if row.admin else None,
        "circle": row.admin.circle if row.admin else None,
        "emp_type": row.admin.emp_type if row.admin else None,
        "month": row.month,
        "achievements": row.achievements,
        "challenges": row.challenges,
        "goals_next_month": row.goals_next_month,
        "suggestion_improvement": row.suggestion_improvement,
        "submitted_at": row.submitted_at.isoformat() if row.submitted_at else None,
        "status": row.status,
        "review": {
            "manager_id": review.manager_id if review else None,
            "rating": review.rating if review else None,
            "comments": review.comments if review else None,
            "reviewed_at": review.reviewed_at.isoformat() if review and review.reviewed_at else None,
        }
        if review
        else None,
    }


@performance_api.route("/self", methods=["POST"])
@jwt_required()
def upsert_self_performance():
    admin = _current_admin()
    if not admin:
        return jsonify({"success": False, "message": "Unauthorized user"}), 401

    data = request.get_json(silent=True) or {}
    month = (data.get("month") or "").strip()
    achievements = (data.get("achievements") or "").strip()
    challenges = (data.get("challenges") or "").strip() or None
    goals_next_month = (data.get("goals_next_month") or "").strip() or None
    suggestion_improvement = (data.get("suggestion_improvement") or "").strip() or None

    if not month:
        return jsonify({"success": False, "message": "month is required"}), 400
    if not achievements:
        return jsonify({"success": False, "message": "achievements is required"}), 400

    row = EmployeePerformance.query.filter_by(admin_id=admin.id, month=month).first()
    if row and row.review:
        return jsonify({"success": False, "message": "Performance already reviewed and locked"}), 409

    if not row:
        row = EmployeePerformance(
            admin_id=admin.id,
            employee_name=admin.first_name or admin.email or "Employee",
            month=month,
            achievements=achievements,
            challenges=challenges,
            goals_next_month=goals_next_month,
            suggestion_improvement=suggestion_improvement,
            status="Submitted",
            submitted_at=datetime.utcnow(),
        )
        db.session.add(row)
    else:
        row.achievements = achievements
        row.challenges = challenges
        row.goals_next_month = goals_next_month
        row.suggestion_improvement = suggestion_improvement
        row.status = "Submitted"
        row.submitted_at = datetime.utcnow()

    db.session.commit()

    # Fire-and-forget email (do not break API on failure)
    try:
        send_performance_submitted_email(row)
    except Exception:
        pass

    return jsonify({"success": True, "performance": _serialize_performance(row)}), 200


@performance_api.route("/my", methods=["GET"])
@jwt_required()
def my_performance_list():
    admin = _current_admin()
    if not admin:
        return jsonify({"success": False, "message": "Unauthorized user"}), 401

    month = (request.args.get("month") or "").strip()
    q = EmployeePerformance.query.filter_by(admin_id=admin.id)
    if month:
        q = q.filter(EmployeePerformance.month == month)
    rows = q.order_by(EmployeePerformance.submitted_at.desc(), EmployeePerformance.id.desc()).all()
    return jsonify({"success": True, "items": [_serialize_performance(r) for r in rows]}), 200


@performance_api.route("/manager/queue", methods=["GET"])
@jwt_required()
def manager_queue():
    manager_admin, err = _ensure_manager_user()
    if err:
        return err

    month = (request.args.get("month") or "").strip()
    status = (request.args.get("status") or "").strip()
    q = EmployeePerformance.query.order_by(
        EmployeePerformance.submitted_at.desc(), EmployeePerformance.id.desc()
    )
    if month:
        q = q.filter(EmployeePerformance.month == month)
    if status:
        q = q.filter(func.lower(EmployeePerformance.status) == _norm(status))

    rows = []
    for row in q.all():
        if row.admin and _is_manager_for_target(manager_admin, row.admin):
            rows.append(_serialize_performance(row))

    return jsonify({"success": True, "items": rows}), 200


@performance_api.route("/manager/review/<int:performance_id>", methods=["POST"])
@jwt_required()
def manager_review(performance_id):
    manager_admin, err = _ensure_manager_user()
    if err:
        return err

    row = EmployeePerformance.query.get(performance_id)
    if not row:
        return jsonify({"success": False, "message": "Performance entry not found"}), 404
    if not row.admin or not _is_manager_for_target(manager_admin, row.admin):
        return jsonify({"success": False, "message": "Not allowed for this employee"}), 403

    data = request.get_json(silent=True) or {}
    rating = (data.get("rating") or "").strip()
    comments = (data.get("comments") or "").strip()
    if not rating:
        return jsonify({"success": False, "message": "rating is required"}), 400

    if row.review:
        row.review.rating = rating
        row.review.comments = comments or None
        row.review.reviewed_at = datetime.utcnow()
    else:
        db.session.add(
            ManagerReview(
                performance_id=row.id,
                manager_id=manager_admin.id,
                rating=rating,
                comments=comments or None,
                reviewed_at=datetime.utcnow(),
            )
        )
    row.status = "Reviewed"
    db.session.commit()
    row = EmployeePerformance.query.get(row.id)

    try:
        send_performance_reviewed_email(row, manager_admin, rating, comments)
    except Exception:
        pass

    return jsonify({"success": True, "performance": _serialize_performance(row)}), 200


@performance_api.route("/hr/report", methods=["GET"])
@jwt_required()
def hr_report():
    admin = _current_admin()
    if not admin:
        return jsonify({"success": False, "message": "Unauthorized user"}), 401
    if not _is_hr(admin):
        return jsonify({"success": False, "message": "HR access required"}), 403

    month = (request.args.get("month") or "").strip()
    circle = _norm(request.args.get("circle"))
    emp_type = _norm(request.args.get("emp_type"))

    q = EmployeePerformance.query.order_by(
        EmployeePerformance.submitted_at.desc(), EmployeePerformance.id.desc()
    )
    if month:
        q = q.filter(EmployeePerformance.month == month)

    rows = []
    for row in q.all():
        if not row.admin:
            continue
        if circle and circle != "all" and _norm(row.admin.circle) != circle:
            continue
        if emp_type and emp_type != "all" and _norm(row.admin.emp_type) != emp_type:
            continue
        rows.append(_serialize_performance(row))

    reviewed = sum(1 for r in rows if _norm(r.get("status")) == "reviewed")
    pending = len(rows) - reviewed
    return jsonify(
        {
            "success": True,
            "summary": {
                "total": len(rows),
                "reviewed": reviewed,
                "pending": pending,
            },
            "items": rows,
        }
    ), 200


@performance_api.route("/manager/summary", methods=["GET"])
@jwt_required()
def manager_summary():
    manager_admin, err = _ensure_manager_user()
    if err:
        return err

    month = (request.args.get("month") or "").strip()
    q = EmployeePerformance.query
    if month:
        q = q.filter(EmployeePerformance.month == month)

    now = datetime.utcnow()
    total = reviewed = overdue = 0
    for row in q.all():
        if not row.admin or not _is_manager_for_target(manager_admin, row.admin):
            continue
        total += 1
        if _norm(row.status) == "reviewed":
            reviewed += 1
        elif row.submitted_at and (now - row.submitted_at) > timedelta(days=7):
            overdue += 1

    pending = max(total - reviewed, 0)
    denominator = max(total, 1)
    items = [
        {"name": "Completed Tasks", "value": int(round((reviewed * 100) / denominator))},
        {"name": "Pending Tasks", "value": int(round((pending * 100) / denominator))},
        {"name": "Overdue Tasks", "value": int(round((overdue * 100) / denominator))},
    ]
    return jsonify({"success": True, "items": items}), 200
