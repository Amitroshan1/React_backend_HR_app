"""HR NOC / bonafide applications: submit HR response to Admin for approval."""
from __future__ import annotations

import json
import os
from typing import Optional

from flask import current_app

from . import db
from .datetime_utils import isoformat_api, utc_now
from .models.Admin_models import Admin
from .models.employee_profile_change import EmployeeProfileChangeRequest
from .models.seperation import NocApplicationRequest
from .tenant_context import tenant_id_for_admin

REQUEST_TYPE_LABELS = {
    "exit_no_dues": "No dues clearance (Exit)",
    "banking_bonafide": "Bonafide letter for banking purpose",
    "travel_bonafide": "Bonafide letter for visa (personal holiday)",
    "other": "Other reason",
}


def _norm(value) -> str:
    return (value or "").strip().lower()


def workflow_status(application: NocApplicationRequest) -> str:
    """pending_hr | pending_admin | approved | rejected (non-exit applications)."""
    status = _norm(application.status)
    if status in ("pending admin", "pending_admin", "pendingadmin"):
        return "pending_admin"
    if status == "approved":
        return "approved"
    if status == "rejected":
        return "rejected"
    return "pending_hr"


def _payload_application_id(row: EmployeeProfileChangeRequest) -> Optional[int]:
    try:
        payload = json.loads(row.signup_payload or "{}")
    except Exception:
        return None
    value = payload.get("noc_application_id") if isinstance(payload, dict) else None
    try:
        return int(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def admin_requests_by_application(tenant_id: int) -> dict[int, EmployeeProfileChangeRequest]:
    """Latest Admin-queue row per NOC application id, for one tenant."""
    rows = (
        EmployeeProfileChangeRequest.query.filter_by(
            tenant_id=int(tenant_id), request_type="noc_application"
        )
        .order_by(EmployeeProfileChangeRequest.id.desc())
        .all()
    )
    out: dict[int, EmployeeProfileChangeRequest] = {}
    for row in rows:
        app_id = _payload_application_id(row)
        if app_id is not None and app_id not in out:
            out[app_id] = row
    return out


def serialize_admin_request_for_hr(row: EmployeeProfileChangeRequest, application=None) -> dict:
    employee = row.employee or (Admin.query.get(row.employee_admin_id) if row.employee_admin_id else None)
    app_id = _payload_application_id(row)
    filename = None
    if application is not None and getattr(application, "hr_document_path", None):
        filename = os.path.basename(application.hr_document_path)
    return {
        "id": row.id,
        "noc_application_id": app_id,
        "request_type": "noc_application",
        "status": row.status,
        "employee_name": (
            ((employee.first_name or employee.user_name or "").strip() if employee else "")
            or (employee.email if employee else "")
        ),
        "employee_id": employee.emp_id if employee else None,
        "email": employee.email if employee else None,
        "noc_request_label": (
            REQUEST_TYPE_LABELS.get(application.request_type, application.request_type)
            if application
            else "NOC / letter"
        ),
        "hr_document_filename": filename,
        "hr_download_url": (
            f"/api/HumanResource/noc-applications/{app_id}/download" if app_id and filename else None
        ),
        "requested_by_name": row.requested_by_name or "",
        "requested_by_email": row.requested_by_email or "",
        "decided_by_name": row.decided_by_name or "",
        "decided_by_email": row.decided_by_email or "",
        "decision_note": row.decision_note or "",
        "created_at": isoformat_api(row.created_at) if row.created_at else None,
        "decided_at": isoformat_api(row.decided_at) if row.decided_at else None,
    }


def list_noc_application_history(tenant_id: int, *, status_filter: str = "all") -> dict:
    """Admin decisions (and pending) for HR-submitted NOC applications."""
    status_filter = _norm(status_filter) or "all"
    rows = (
        EmployeeProfileChangeRequest.query.filter_by(
            tenant_id=int(tenant_id), request_type="noc_application"
        )
        .order_by(EmployeeProfileChangeRequest.id.desc())
        .limit(300)
        .all()
    )
    apps = {
        a.id: a
        for a in NocApplicationRequest.query.filter(
            NocApplicationRequest.admin_id.in_(
                db.session.query(Admin.id).filter(Admin.tenant_id == int(tenant_id))
            )
        ).all()
    }
    items = [
        serialize_admin_request_for_hr(row, apps.get(_payload_application_id(row)))
        for row in rows
    ]
    counts = {"all": len(items), "pending": 0, "approved": 0, "rejected": 0}
    for item in items:
        if item["status"] in counts:
            counts[item["status"]] += 1
    if status_filter in ("pending", "approved", "rejected"):
        items = [i for i in items if i["status"] == status_filter]
    return {"success": True, "history": items, "summary": counts, "filter": status_filter}


def submit_noc_application_to_admin(
    application: NocApplicationRequest,
    hr_admin: Admin,
    *,
    remarks: str = "",
) -> tuple[Optional[dict], Optional[str], int]:
    """Stage Admin approval for an HR-uploaded NOC / letter (non-exit types)."""
    from .approval_settings import approval_required, maybe_notify_bypass
    from .employee_profile_change_service import stage_action_request

    if application.request_type == "exit_no_dues":
        return None, "Exit NOC is submitted to Admin from the separation details in Offboarding.", 409
    if workflow_status(application) == "pending_admin":
        return None, "This NOC is already waiting for Admin approval.", 409
    if workflow_status(application) == "approved":
        return None, "This NOC is already approved by Admin.", 409
    if not getattr(application, "hr_document_path", None):
        return None, "Upload the NOC / letter document before submitting to Admin.", 400

    remarks_clean = (remarks or "").strip()
    if remarks_clean:
        application.hr_remarks = remarks_clean[:2000]

    employee = Admin.query.get(application.admin_id)
    if not employee:
        return None, "Employee not found.", 404

    existing = admin_requests_by_application(tenant_id_for_admin(employee)).get(application.id)
    if existing is not None and existing.status == "pending":
        return None, "This NOC is already waiting for Admin approval.", 409

    payload = {
        "noc_application_id": application.id,
        "noc_request_type": application.request_type,
        "noc_request_label": REQUEST_TYPE_LABELS.get(
            application.request_type, application.request_type
        ),
        "details": application.details or "",
        "other_reason": application.other_reason or "",
        "hr_remarks": application.hr_remarks or "",
        "hr_document_filename": os.path.basename(application.hr_document_path),
        "source": "hr_noc_application",
    }

    try:
        if not approval_required("noc_application"):
            performer = getattr(hr_admin, "email", None) or "HR"
            row = stage_action_request(employee, "noc_application", {}, payload)
            application.status = "Approved"
            row.status = "approved"
            row.decided_at = utc_now()
            row.decision_note = "Applied immediately (Admin approval switch off)."
            db.session.commit()
            maybe_notify_bypass(
                "noc_application", f"HR issued {payload['noc_request_label']} for {employee.email}."
            )
            return {
                "success": True,
                "pending_approval": False,
                "message": "NOC approved and available to the employee.",
                "workflow_status": "approved",
            }, None, 200

        stage_action_request(employee, "noc_application", {}, payload)
        application.status = "Pending Admin"
        db.session.commit()
        return {
            "success": True,
            "pending_approval": True,
            "message": "Sent to Admin for approval. The employee can download it after Admin approves.",
            "workflow_status": "pending_admin",
        }, None, 200
    except Exception as exc:
        db.session.rollback()
        current_app.logger.exception("submit_noc_application_to_admin failed")
        return None, str(exc) or "Could not submit to Admin.", 500


def apply_noc_application_decision(row: EmployeeProfileChangeRequest, status: str) -> None:
    """On Admin decide: reflect approved/rejected onto the NOC application."""
    app_id = _payload_application_id(row)
    if app_id is None:
        return
    application = NocApplicationRequest.query.get(app_id)
    if application is None:
        return
    application.status = "Approved" if status == "approved" else "Rejected"
    if status == "approved":
        try:
            from .models.notification import Notification

            db.session.add(Notification(
                recipient_admin_id=application.admin_id,
                notif_type="noc_application",
                title="Your NOC / letter is ready",
                body=(
                    f"Admin approved your {REQUEST_TYPE_LABELS.get(application.request_type, 'NOC')} request. "
                    "You can download it from Apply NOC."
                ),
                entity_type="noc_application",
                entity_id=application.id,
            ))
        except Exception:
            current_app.logger.warning("NOC approval notification failed", exc_info=True)
