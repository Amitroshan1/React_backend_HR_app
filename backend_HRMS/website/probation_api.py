from datetime import date, datetime

from flask import Blueprint, jsonify, request
from flask_jwt_extended import get_jwt, jwt_required

from . import db
from .datetime_utils import utc_now, isoformat_api
from .models.Admin_models import Admin
from .models.probation import ProbationReview
from .tenant_context import current_admin
from .email import send_probation_hr_decision_email, send_probation_employee_decision_email
from .probation_utils import (
    HR_DECISIONS,
    HR_DECISION_CONFIRMED,
    HR_DECISION_EXTENDED,
    HR_DECISION_FAILED,
    STATUS_HR_CONFIRMED,
    STATUS_HR_EXTENDED,
    STATUS_HR_FAILED,
    STATUS_MANAGER_SUBMITTED,
    STATUS_PENDING_ADMIN,
    STATUS_REMINDER_SENT,
    TERMINAL_STATUSES,
    add_calendar_months,
    build_employee_probation_status,
    compute_probation_end_date,
    infer_status_from_row,
    is_probation_review_row_active,
)

probation_api = Blueprint("probation_api", __name__)

DECISION_LABELS = {
    HR_DECISION_CONFIRMED: "On role",
    HR_DECISION_EXTENDED: "Extend probation",
    HR_DECISION_FAILED: "Reject / not cleared",
}


def _norm(value):
    return (value or "").strip().lower()


def _current_admin():
    return current_admin()


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
    pending_admin = status == STATUS_PENDING_ADMIN and not row.hr_decision

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
        "pending_admin_approval": pending_admin,
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


def _ensure_hr_access():
    from .plan_features import can_access_hr_operations

    admin = _current_admin()
    if not admin:
        return None, (jsonify({"success": False, "message": "Unauthorized user"}), 401)
    if not can_access_hr_operations(get_jwt()):
        return None, (jsonify({"success": False, "message": "HR access required"}), 403)
    return admin, None


def _parse_extended_until(data, row, target):
    """Return (date|None, error_response|None)."""
    extension_months = data.get("extension_months")
    extended_until_raw = (data.get("extended_until") or "").strip()
    if extended_until_raw:
        try:
            extended_until = datetime.strptime(extended_until_raw, "%Y-%m-%d").date()
        except ValueError:
            return None, (jsonify({"success": False, "message": "extended_until must be YYYY-MM-DD"}), 400)
    elif extension_months is not None:
        try:
            months = int(extension_months)
        except (TypeError, ValueError):
            return None, (jsonify({"success": False, "message": "extension_months must be an integer"}), 400)
        if months < 1 or months > 12:
            return None, (jsonify({"success": False, "message": "extension_months must be between 1 and 12"}), 400)
        base = row.probation_end_date or compute_probation_end_date(target.doj)
        extended_until = add_calendar_months(base, months)
    else:
        return None, (
            jsonify({"success": False, "message": "Select an extension end date for Extend"}),
            400,
        )
    if row.probation_end_date and extended_until <= row.probation_end_date:
        return None, (
            jsonify({"success": False, "message": "extended_until must be after current probation end date"}),
            400,
        )
    return extended_until, None


def pending_probation_request_for_review(review_id):
    """Return a pending Admin probation request for this review, if any."""
    from .models.employee_profile_change import EmployeeProfileChangeRequest
    import json

    if not review_id:
        return None
    rows = EmployeeProfileChangeRequest.query.filter_by(
        request_type="probation",
        status="pending",
    ).all()
    for row in rows:
        try:
            payload = json.loads(row.signup_payload or "{}")
        except (TypeError, ValueError):
            continue
        if not isinstance(payload, dict):
            continue
        if int(payload.get("probation_review_id") or 0) == int(review_id):
            return row
    return None


def execute_probation_decision(
    row,
    *,
    decision,
    notes="",
    extended_until=None,
    decided_by_admin,
    send_employee_mail=True,
    send_manager_mail=True,
):
    """
    Apply a finalized probation decision (after Admin approve, or when approval is bypassed).

    Returns dict with keys: extended_until, salary_revision_request, exit_notice.
    Raises ValueError on business errors.
    """
    decision = (decision or "").strip().lower()
    if decision not in HR_DECISIONS:
        raise ValueError("decision must be confirmed, extended, or failed")

    target = row.admin or Admin.query.get(row.admin_id)
    if not target:
        raise ValueError("Employee not found")

    status = infer_status_from_row(row)
    if status in TERMINAL_STATUSES:
        raise ValueError("Review already has a final decision")

    if decision == HR_DECISION_EXTENDED:
        if not extended_until:
            raise ValueError("extended_until is required for extension")
        if row.probation_end_date and extended_until <= row.probation_end_date:
            raise ValueError("extended_until must be after current probation end date")

    now = utc_now()
    notes = (notes or "").strip() or None
    row.hr_decision = decision
    row.hr_decided_at = now
    row.hr_decided_by_admin_id = getattr(decided_by_admin, "id", None)
    row.hr_notes = notes

    exit_notice = None
    if decision == HR_DECISION_CONFIRMED:
        row.status = STATUS_HR_CONFIRMED
        from .employment_status import transition_to_on_role

        transition_to_on_role(
            target,
            effective_from=date.today(),
            changed_by=getattr(decided_by_admin, "email", None),
            notes=notes or "Probation confirmation approved",
            send_email=False,
        )
    elif decision == HR_DECISION_FAILED:
        row.status = STATUS_HR_FAILED
        from .offboarding_service import execute_employee_exit

        today = date.today()
        lwd = row.probation_end_date if row.probation_end_date and row.probation_end_date <= today else today
        reason = notes or "Probation not cleared"
        if len(reason.strip()) < 10:
            reason = "Probation not cleared after manager review and HR decision."
        ok, message, extra = execute_employee_exit(
            target,
            exit_type="Terminated",
            exit_date=today,
            last_working_day=lwd,
            exit_reason=reason[:500],
            notice_shortfall_days=0,
            resignation_date=None,
            hr_email=getattr(decided_by_admin, "email", None) or "HR",
            force_override=True,
            force_override_reason=reason[:500],
        )
        if not ok:
            raise ValueError(message or "Could not exit employee after probation reject")
        exit_notice = extra or {}
        exit_notice["admin"] = target
    elif decision == HR_DECISION_EXTENDED:
        row.status = STATUS_HR_EXTENDED
        row.extended_until = extended_until
        from .employment_status import apply_probation_extension

        apply_probation_extension(
            target,
            extended_until,
            changed_by=getattr(decided_by_admin, "email", None),
            notes=notes or "Probation extended",
        )
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

    salary_revision_request = None
    if decision == HR_DECISION_CONFIRMED:
        from .models.salary_revision_request import SalaryRevisionRequest

        existing_req = SalaryRevisionRequest.query.filter_by(
            admin_id=target.id,
            probation_review_id=row.id,
            status="pending",
        ).first()
        if not existing_req:
            eff_from = row.probation_end_date or date.today()
            salary_revision_request = SalaryRevisionRequest(
                admin_id=target.id,
                probation_review_id=row.id,
                revision_type="probation",
                status="pending",
                effective_from=eff_from,
                notes=notes or "Post-probation confirmation — review CTC in Accounts",
            )
            db.session.add(salary_revision_request)

    hr_name = (
        (getattr(decided_by_admin, "first_name", None) or "").strip()
        or getattr(decided_by_admin, "email", None)
        or "HR"
    )
    # Emails are sent by the caller after commit so they run only on success.
    return {
        "target": target,
        "decision": decision,
        "extended_until": extended_until,
        "notes": notes,
        "hr_name": hr_name,
        "salary_revision_request": salary_revision_request,
        "exit_notice": exit_notice,
        "send_employee_mail": bool(send_employee_mail and decision in (HR_DECISION_CONFIRMED, HR_DECISION_EXTENDED)),
        "send_manager_mail": bool(send_manager_mail),
    }


def send_probation_decision_notifications(result):
    """Send manager + employee (confirm/extend only) + accounts emails after commit."""
    if not result:
        return
    target = result.get("target")
    decision = result.get("decision")
    notes = result.get("notes")
    hr_name = result.get("hr_name") or "HR"
    extended_until = result.get("extended_until")
    row_end = getattr(target, "probation_end_date", None) if target else None

    if result.get("send_manager_mail") and target:
        try:
            send_probation_hr_decision_email(
                target,
                hr_name,
                decision,
                row_end,
                notes=notes,
            )
        except Exception:
            pass

    if result.get("send_employee_mail") and target:
        try:
            send_probation_employee_decision_email(
                target,
                decision,
                probation_end_date=row_end,
                extended_until=extended_until,
                hr_name=hr_name,
                notes=notes,
            )
        except Exception:
            pass

    salary_revision_request = result.get("salary_revision_request")
    if salary_revision_request is not None:
        try:
            from .email import send_salary_revision_pending_accounts_email

            send_salary_revision_pending_accounts_email(salary_revision_request)
        except Exception:
            pass

    exit_notice = result.get("exit_notice")
    if exit_notice:
        try:
            from .offboarding_service import send_exit_employee_notifications

            send_exit_employee_notifications(
                exit_notice["admin"],
                exit_type=exit_notice.get("exit_type"),
                last_working_day=exit_notice.get("last_working_day"),
                exit_reason=exit_notice.get("exit_reason"),
                hr_email=exit_notice.get("hr_email") or hr_name,
                deferred_login=bool(exit_notice.get("deferred_login")),
            )
        except Exception:
            pass


def list_hr_probation_reviews(status_filter=None):
    """Shared HR list logic for /api/probation and /api/HumanResource routes."""
    status_filter = _norm(status_filter or "all")
    run_date = date.today()

    rows = (
        ProbationReview.query.order_by(
            ProbationReview.probation_end_date.asc(),
            ProbationReview.id.asc(),
        ).all()
    )
    all_serialized = []
    for row in rows:
        admin = row.admin or Admin.query.get(row.admin_id)
        status = infer_status_from_row(row)
        if status_filter == "closed":
            if status not in TERMINAL_STATUSES:
                continue
        elif status in TERMINAL_STATUSES:
            continue
        elif not is_probation_review_row_active(row, admin, run_date):
            continue
        all_serialized.append(_serialize_probation_review(row, run_date=run_date))
    items = all_serialized
    if status_filter == "awaiting_hr":
        items = [i for i in all_serialized if i.get("awaiting_hr_decision")]
    elif status_filter == "pending_admin":
        items = [i for i in all_serialized if i.get("pending_admin_approval")]
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
    pending_admin = sum(1 for i in all_serialized if i.get("pending_admin_approval"))
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
                "pending_admin": pending_admin,
                "pending_manager": pending_manager,
                "overdue": overdue,
            },
            "reviews": items,
        }
    ), 200


def apply_hr_probation_decision(hr_admin, data):
    """
    HR proposes On role / Extend / Reject.

    Creates an Admin approval request (default). Applies immediately only when
    the probation approval switch is off or the actor is Org Admin.
    """
    data = data or {}
    review_id = data.get("probation_review_id") or data.get("id")
    decision = (data.get("decision") or data.get("hr_decision") or "").strip().lower()
    notes = (data.get("notes") or data.get("hr_notes") or "").strip()

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
    if status == STATUS_PENDING_ADMIN:
        return jsonify({
            "success": False,
            "message": "A probation decision for this review is already waiting for Admin approval. "
            "Check Request history if Admin rejected it earlier.",
        }), 400
    if status != STATUS_MANAGER_SUBMITTED and not row.reviewed_at:
        return jsonify({"success": False, "message": "Manager review must be submitted before HR decision"}), 400

    if pending_probation_request_for_review(row.id):
        return jsonify({
            "success": False,
            "message": "A probation decision for this review is already waiting for Admin approval.",
        }), 400

    target = Admin.query.get(row.admin_id)
    if not target:
        return jsonify({"success": False, "message": "Employee not found"}), 404

    extended_until = None
    if decision == HR_DECISION_EXTENDED:
        extended_until, err = _parse_extended_until(data, row, target)
        if err:
            return err

    from .approval_settings import approval_required, maybe_notify_bypass
    from .employee_profile_change_service import stage_action_request

    payload = {
        "probation_review_id": row.id,
        "decision": decision,
        "decision_label": DECISION_LABELS.get(decision, decision),
        "notes": notes or None,
        "extended_until": extended_until.isoformat() if extended_until else None,
        "manager_recommendation": row.manager_recommendation,
        "manager_rating": row.rating,
        "manager_feedback": (row.feedback or "")[:1000] or None,
        "probation_end_date": row.probation_end_date.isoformat() if row.probation_end_date else None,
    }
    changes = {
        "probation_decision": {
            "from": "Awaiting HR",
            "to": DECISION_LABELS.get(decision, decision),
        }
    }

    # Apply immediately when approval switch is off / Org Admin bypass.
    if not approval_required("probation"):
        try:
            result = execute_probation_decision(
                row,
                decision=decision,
                notes=notes,
                extended_until=extended_until,
                decided_by_admin=hr_admin,
                send_employee_mail=True,
                send_manager_mail=True,
            )
            staged = stage_action_request(target, "probation", changes, payload)
            staged.status = "approved"
            staged.decided_at = utc_now()
            staged.decision_note = "Applied immediately (Admin approval switch off)."
            staged.decided_by_admin_id = hr_admin.id
            staged.decided_by_name = (getattr(hr_admin, "first_name", None) or "").strip() or hr_admin.email
            staged.decided_by_email = getattr(hr_admin, "email", None)
            db.session.commit()
        except ValueError as exc:
            db.session.rollback()
            return jsonify({"success": False, "message": str(exc)}), 400
        except Exception as e:
            db.session.rollback()
            return jsonify({"success": False, "message": str(e)}), 500

        send_probation_decision_notifications(result)
        maybe_notify_bypass(
            "probation",
            f"HR applied probation {decision} for {target.email} without Admin approval.",
        )
        salary = result.get("salary_revision_request")
        return jsonify(
            {
                "success": True,
                "pending_approval": False,
                "message": f"Probation decision applied: {DECISION_LABELS.get(decision, decision)}",
                "review": _serialize_probation_review(row),
                "salary_revision_request": salary.to_dict() if salary else None,
            }
        ), 200

    try:
        row.status = STATUS_PENDING_ADMIN
        stage_action_request(target, "probation", changes, payload)
        db.session.commit()
    except Exception as e:
        db.session.rollback()
        return jsonify({"success": False, "message": str(e)}), 500

    return jsonify(
        {
            "success": True,
            "pending_approval": True,
            "message": (
                f"Sent to Admin for approval ({DECISION_LABELS.get(decision, decision)}). "
                "Employment status will update only after Admin approves. "
                "If Admin rejects, you will see it in Request history."
            ),
            "review": _serialize_probation_review(row),
        }
    ), 200


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
    _admin, err = _ensure_hr_access()
    if err:
        return err
    return list_hr_probation_reviews(request.args.get("status"))


@probation_api.route("/hr/decision", methods=["POST"])
@jwt_required()
def hr_probation_decision():
    """HR proposes confirm, extend, or fail — queued for Admin approval."""
    admin, err = _ensure_hr_access()
    if err:
        return err
    return apply_hr_probation_decision(admin, request.get_json(silent=True))
