from datetime import date, datetime

from flask import Blueprint, jsonify, request
from flask_jwt_extended import get_jwt, jwt_required

from . import db
from .datetime_utils import utc_now, isoformat_api
from .models.Admin_models import Admin
from .models.probation import ProbationReview
from .email import send_probation_hr_decision_email, send_probation_employee_decision_email
from .probation_utils import (
    HR_DECISIONS,
    HR_DECISION_CONFIRMED,
    HR_DECISION_EXTENDED,
    HR_DECISION_FAILED,
    STATUS_HR_CONFIRMED,
    STATUS_HR_EXTENDED,
    STATUS_MANAGER_SUBMITTED,
    STATUS_REMINDER_SENT,
    TERMINAL_STATUSES,
    add_calendar_months,
    build_employee_probation_status,
    compute_probation_end_date,
    infer_status_from_row,
)

probation_api = Blueprint("probation_api", __name__)


def _norm(value):
    return (value or "").strip().lower()


def _current_admin():
    email = get_jwt().get("email")
    if not email:
        return None
    return Admin.query.filter_by(email=email).first()


def _is_hr(admin):
    return _norm(getattr(admin, "emp_type", "")) in {"human resource", "hr"}


def _serialize_date(value):
    if not value:
        return None
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return str(value)


def _serialize_probation_review(row, run_date=None):
    admin = row.admin or Admin.query.get(row.admin_id)
    status = infer_status_from_row(row)
    end_date = row.probation_end_date
    overdue = bool(
        run_date
        and end_date
        and not row.reviewed_at
        and status == STATUS_REMINDER_SENT
        and end_date < run_date
    )
    awaiting_hr = status == STATUS_MANAGER_SUBMITTED and not row.hr_decision

    reviewer = row.reviewed_by
    hr_decider = row.hr_decided_by
    return {
        "id": row.id,
        "admin_id": row.admin_id,
        "employee_name": (getattr(admin, "first_name", None) or "").strip() or (admin.email if admin else "N/A"),
        "employee_email": admin.email if admin else None,
        "emp_id": getattr(admin, "emp_id", None) if admin else None,
        "circle": getattr(admin, "circle", None) if admin else None,
        "emp_type": getattr(admin, "emp_type", None) if admin else None,
        "doj": _serialize_date(getattr(admin, "doj", None) if admin else None),
        "probation_end_date": _serialize_date(end_date),
        "status": status,
        "awaiting_hr_decision": awaiting_hr,
        "overdue": overdue,
        "reminder_sent_at": isoformat_api(row.reminder_sent_at),
        "followup_reminder_sent_at": isoformat_api(row.followup_reminder_sent_at),
        "overdue_escalation_sent_at": isoformat_api(row.overdue_escalation_sent_at),
        "reviewed_at": isoformat_api(row.reviewed_at),
        "reviewed_by_name": (getattr(reviewer, "first_name", None) or reviewer.email if reviewer else None),
        "rating": row.rating,
        "manager_recommendation": row.manager_recommendation,
        "feedback": row.feedback,
        "hr_decision": row.hr_decision,
        "hr_decided_at": isoformat_api(row.hr_decided_at),
        "hr_decided_by_name": (getattr(hr_decider, "first_name", None) or hr_decider.email if hr_decider else None),
        "extended_until": _serialize_date(row.extended_until),
        "hr_notes": row.hr_notes,
    }


@probation_api.route("/self", methods=["GET"])
@jwt_required()
def employee_probation_status():
    """Return probation status for the logged-in employee."""
    admin = _current_admin()
    if not admin:
        return jsonify({"success": False, "message": "Unauthorized user"}), 401

    status = build_employee_probation_status(admin, run_date=date.today())
    return jsonify({"success": True, "probation": status}), 200


@probation_api.route("/hr/reviews", methods=["GET"])
@jwt_required()
def hr_probation_reviews():
    """List probation reviews for HR with optional filters."""
    admin = _current_admin()
    if not admin:
        return jsonify({"success": False, "message": "Unauthorized user"}), 401
    if not _is_hr(admin):
        return jsonify({"success": False, "message": "HR access required"}), 403

    status_filter = _norm(request.args.get("status") or "all")
    run_date = date.today()

    q = ProbationReview.query.order_by(
        ProbationReview.probation_end_date.asc(),
        ProbationReview.id.asc(),
    )
    rows = q.all()
    all_serialized = [_serialize_probation_review(row, run_date=run_date) for row in rows]
    items = all_serialized
    if status_filter == "awaiting_hr":
        items = [i for i in all_serialized if i.get("awaiting_hr_decision")]
    elif status_filter == "pending_manager":
        items = [
            i
            for i in all_serialized
            if i.get("status") == STATUS_REMINDER_SENT and not i.get("reviewed_at")
        ]
    elif status_filter == "overdue":
        items = [i for i in all_serialized if i.get("overdue")]
    elif status_filter == "closed":
        items = [i for i in all_serialized if i.get("status") in TERMINAL_STATUSES]

    awaiting_hr = sum(1 for i in all_serialized if i.get("awaiting_hr_decision"))
    pending_manager = sum(
        1 for i in all_serialized if i.get("status") == STATUS_REMINDER_SENT and not i.get("reviewed_at")
    )
    overdue = sum(1 for i in all_serialized if i.get("overdue"))
    return jsonify(
        {
            "success": True,
            "summary": {
                "total": len(items),
                "awaiting_hr": awaiting_hr,
                "pending_manager": pending_manager,
                "overdue": overdue,
            },
            "reviews": items,
        }
    ), 200


@probation_api.route("/hr/decision", methods=["POST"])
@jwt_required()
def hr_probation_decision():
    """HR confirms, extends, or fails a probation review."""
    admin = _current_admin()
    if not admin:
        return jsonify({"success": False, "message": "Unauthorized user"}), 401
    if not _is_hr(admin):
        return jsonify({"success": False, "message": "HR access required"}), 403

    data = request.get_json(silent=True) or {}
    review_id = data.get("probation_review_id") or data.get("id")
    decision = (data.get("decision") or data.get("hr_decision") or "").strip().lower()
    notes = (data.get("notes") or data.get("hr_notes") or "").strip()
    extension_months = data.get("extension_months")
    extended_until_raw = (data.get("extended_until") or "").strip()

    if not review_id:
        return jsonify({"success": False, "message": "probation_review_id required"}), 400
    if decision not in HR_DECISIONS:
        return jsonify({"success": False, "message": "decision must be confirmed, extended, or failed"}), 400

    row = ProbationReview.query.get(review_id)
    if not row:
        return jsonify({"success": False, "message": "Probation review not found"}), 404

    status = infer_status_from_row(row)
    if status in TERMINAL_STATUSES:
        return jsonify({"success": False, "message": "Review already has an HR decision"}), 400
    if status != STATUS_MANAGER_SUBMITTED and not row.reviewed_at:
        return jsonify({"success": False, "message": "Manager review must be submitted before HR decision"}), 400

    target = Admin.query.get(row.admin_id)
    if not target:
        return jsonify({"success": False, "message": "Employee not found"}), 404

    extended_until = None
    if decision == HR_DECISION_EXTENDED:
        if extended_until_raw:
            try:
                extended_until = datetime.strptime(extended_until_raw, "%Y-%m-%d").date()
            except ValueError:
                return jsonify({"success": False, "message": "extended_until must be YYYY-MM-DD"}), 400
        elif extension_months is not None:
            try:
                months = int(extension_months)
            except (TypeError, ValueError):
                return jsonify({"success": False, "message": "extension_months must be an integer"}), 400
            if months < 1 or months > 12:
                return jsonify({"success": False, "message": "extension_months must be between 1 and 12"}), 400
            base = row.probation_end_date or compute_probation_end_date(target.doj)
            extended_until = add_calendar_months(base, months)
        else:
            return jsonify(
                {"success": False, "message": "extended_until or extension_months required for extension"}
            ), 400
        if extended_until <= row.probation_end_date:
            return jsonify(
                {"success": False, "message": "extended_until must be after current probation end date"}
            ), 400

    now = utc_now()
    row.hr_decision = decision
    row.hr_decided_at = now
    row.hr_decided_by_admin_id = admin.id
    row.hr_notes = notes or None

    if decision == HR_DECISION_CONFIRMED:
        row.status = STATUS_HR_CONFIRMED
    elif decision == HR_DECISION_FAILED:
        row.status = STATUS_HR_FAILED
    elif decision == HR_DECISION_EXTENDED:
        row.status = STATUS_HR_EXTENDED
        row.extended_until = extended_until
        existing_next = ProbationReview.query.filter_by(
            admin_id=row.admin_id,
            probation_end_date=extended_until,
        ).first()
        if not existing_next:
            db.session.add(
                ProbationReview(
                    admin_id=row.admin_id,
                    probation_end_date=extended_until,
                )
            )

    try:
        db.session.commit()
    except Exception as e:
        db.session.rollback()
        return jsonify({"success": False, "message": str(e)}), 500

    hr_name = (getattr(admin, "first_name", None) or "").strip() or admin.email or "HR"
    send_probation_hr_decision_email(
        target,
        hr_name,
        decision,
        row.probation_end_date,
        notes=notes,
    )
    send_probation_employee_decision_email(
        target,
        decision,
        probation_end_date=row.probation_end_date,
        extended_until=extended_until,
        hr_name=hr_name,
        notes=notes,
    )

    return jsonify(
        {
            "success": True,
            "message": f"Probation decision recorded: {decision}",
            "review": _serialize_probation_review(row),
        }
    ), 200
