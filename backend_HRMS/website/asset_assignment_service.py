"""Asset assignment requests: auto-raised to IT when Admin approves a signup."""
from __future__ import annotations

from typing import Optional

from flask import current_app

from . import db
from .datetime_utils import isoformat_api, utc_now
from .models.Admin_models import Admin
from .models.asset_assignment_request import AssetAssignmentRequest
from .official_email_service import _it_recipients
from .tenant_context import tenant_id_for_admin


def _notify(recipient_admin_id, title, body, entity_id):
    try:
        from .models.notification import Notification

        db.session.add(Notification(
            recipient_admin_id=recipient_admin_id,
            notif_type="asset_assignment_request",
            title=title,
            body=body,
            entity_type="asset_assignment_request",
            entity_id=entity_id,
        ))
    except Exception:
        current_app.logger.warning("asset assignment notification failed", exc_info=True)


def serialize_asset_assignment_request(row: AssetAssignmentRequest) -> dict:
    return {
        "id": row.id,
        "employee_admin_id": row.employee_admin_id,
        "employee_name": row.employee_name,
        "employee_email": row.employee_email or "",
        "emp_id": row.emp_id or "",
        "designation": row.designation or "",
        "department": row.department or "",
        "circle": row.circle or "",
        "doj": row.doj or "",
        "details": row.details or "",
        "status": row.status,
        "assigned_assets": row.assigned_assets or "",
        "it_remarks": row.it_remarks or "",
        "requested_by_name": row.requested_by_name or "",
        "requested_by_email": row.requested_by_email or "",
        "responded_by_name": row.responded_by_name or "",
        "responded_by_email": row.responded_by_email or "",
        "responded_at": isoformat_api(row.responded_at) if row.responded_at else None,
        "created_at": isoformat_api(row.created_at) if row.created_at else None,
    }


def create_asset_assignment_request(signup_row, employee: Admin) -> Optional[AssetAssignmentRequest]:
    """Create the IT asset request for an approved signup (idempotent per signup).

    Commits its own row; emails IT. Never raises to the caller.
    """
    from .email import send_asset_assignment_request_to_it

    try:
        existing = None
        if getattr(signup_row, "id", None):
            existing = AssetAssignmentRequest.query.filter_by(
                signup_request_id=signup_row.id
            ).first()
        if existing:
            return existing

        payload: dict = {}
        try:
            from .employee_profile_change_service import _signup_payload

            payload = _signup_payload(signup_row) or {}
        except Exception:
            payload = {}

        name = (
            getattr(employee, "first_name", None)
            or payload.get("first_name")
            or getattr(employee, "email", "")
            or "Employee"
        )
        row = AssetAssignmentRequest(
            tenant_id=tenant_id_for_admin(employee),
            signup_request_id=getattr(signup_row, "id", None),
            employee_admin_id=employee.id,
            employee_name=str(name)[:150],
            employee_email=(getattr(employee, "email", None) or payload.get("email") or "")[:160] or None,
            emp_id=(getattr(employee, "emp_id", None) or payload.get("emp_id") or "")[:20] or None,
            designation=(getattr(employee, "designation", None) or payload.get("designation") or "")[:150] or None,
            department=(getattr(employee, "emp_type", None) or payload.get("emp_type") or "")[:150] or None,
            circle=(getattr(employee, "circle", None) or payload.get("circle") or "")[:120] or None,
            doj=(str(getattr(employee, "doj", "") or payload.get("doj") or ""))[:20] or None,
            requested_by_admin_id=getattr(signup_row, "requested_by_admin_id", None),
            requested_by_name=(getattr(signup_row, "requested_by_name", None) or "HR"),
            requested_by_email=getattr(signup_row, "requested_by_email", None),
            details=(
                "Please assign the required assets (laptop/desktop and accessories as per role) "
                "to this newly joined employee and update this request once done."
            ),
            status="Pending",
        )
        db.session.add(row)
        db.session.flush()

        emails, it_admins = _it_recipients(employee)
        for it_admin in it_admins:
            _notify(
                it_admin.id,
                "New asset assignment request",
                f"Assign assets to {row.employee_name} ({row.emp_id or row.employee_email}).",
                row.id,
            )
        db.session.commit()

        try:
            send_asset_assignment_request_to_it(row=row, recipient_emails=emails)
        except Exception as mail_err:
            current_app.logger.warning("Asset assignment mail to IT failed: %s", mail_err)
        return row
    except Exception:
        db.session.rollback()
        current_app.logger.exception("create_asset_assignment_request failed")
        return None


def list_asset_assignment_requests(tenant_id: int, *, status_filter: str = "all") -> dict:
    status_filter = (status_filter or "all").strip().lower()
    rows = (
        AssetAssignmentRequest.query.filter_by(tenant_id=int(tenant_id))
        .order_by(AssetAssignmentRequest.created_at.desc(), AssetAssignmentRequest.id.desc())
        .limit(300)
        .all()
    )
    items = [serialize_asset_assignment_request(r) for r in rows]
    counts = {
        "all": len(items),
        "pending": sum(1 for i in items if i["status"].lower() == "pending"),
        "completed": sum(1 for i in items if i["status"].lower() == "completed"),
    }
    if status_filter in ("pending", "completed"):
        items = [i for i in items if i["status"].lower() == status_filter]
    return {"success": True, "requests": items, "summary": counts, "filter": status_filter}


def complete_asset_assignment_request(
    request_id: int, it_admin: Admin, *, assigned_assets: str, it_remarks: str = ""
) -> tuple[Optional[dict], Optional[str], int]:
    from .email import send_asset_assignment_completed_to_hr

    row = AssetAssignmentRequest.query.filter_by(
        id=int(request_id), tenant_id=tenant_id_for_admin(it_admin)
    ).first()
    if not row:
        return None, "Request not found.", 404
    if (row.status or "").lower() == "completed":
        return None, "This request has already been completed.", 409
    assets = (assigned_assets or "").strip()
    if len(assets) < 3:
        return None, "Enter the assets assigned to the employee.", 400

    row.assigned_assets = assets[:3000]
    row.it_remarks = (it_remarks or "").strip()[:2000] or None
    row.status = "Completed"
    row.responded_by_admin_id = it_admin.id
    row.responded_by_name = (getattr(it_admin, "first_name", None) or it_admin.email or "IT")
    row.responded_by_email = it_admin.email
    row.responded_at = utc_now()
    if row.requested_by_admin_id:
        _notify(
            row.requested_by_admin_id,
            "Assets assigned",
            f"IT assigned assets to {row.employee_name}: {assets[:120]}",
            row.id,
        )
    try:
        db.session.commit()
    except Exception as exc:
        db.session.rollback()
        current_app.logger.exception("complete_asset_assignment_request failed")
        return None, str(exc) or "Could not save the response.", 500

    email_sent = False
    try:
        email_sent = send_asset_assignment_completed_to_hr(row=row)
    except Exception as mail_err:
        current_app.logger.warning("Asset assignment completion mail failed: %s", mail_err)

    return {
        "success": True,
        "message": (
            "Marked completed and HR has been informed."
            if email_sent
            else "Marked completed, but the email to HR could not be sent."
        ),
        "email_sent": bool(email_sent),
        "request": serialize_asset_assignment_request(row),
    }, None, 200
