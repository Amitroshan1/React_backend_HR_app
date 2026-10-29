"""Generate-official-email workflow: HR requests, IT generates and replies."""
from __future__ import annotations

import re
from typing import Optional

from flask import current_app

from . import db
from .datetime_utils import isoformat_api, utc_now
from .models.Admin_models import Admin
from .models.official_email_request import OfficialEmailRequest
from .tenant_context import tenant_id_for_admin

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def serialize_official_email_request(row: OfficialEmailRequest) -> dict:
    return {
        "id": row.id,
        "candidate_name": row.candidate_name,
        "designation": row.designation or "",
        "department": row.department or "",
        "circle": row.circle or "",
        "preferred_prefix": row.preferred_prefix or "",
        "details": row.details or "",
        "status": row.status,
        "generated_email": row.generated_email or "",
        "it_remarks": row.it_remarks or "",
        "requested_by_name": row.requested_by_name or "",
        "requested_by_email": row.requested_by_email or "",
        "responded_by_name": row.responded_by_name or "",
        "responded_by_email": row.responded_by_email or "",
        "responded_at": isoformat_api(row.responded_at) if row.responded_at else None,
        "created_at": isoformat_api(row.created_at) if row.created_at else None,
        "can_signup": bool(row.generated_email) and (row.status or "").lower() == "generated",
    }


def _notify(recipient_admin_id, title, body, entity_id):
    try:
        from .models.notification import Notification

        db.session.add(Notification(
            recipient_admin_id=recipient_admin_id,
            notif_type="official_email_request",
            title=title,
            body=body,
            entity_type="official_email_request",
            entity_id=entity_id,
        ))
    except Exception:
        current_app.logger.warning("official email notification failed", exc_info=True)


def _it_recipients(hr_admin: Admin):
    """(emails, admin_rows) for IT staff in the requester's tenant."""
    from .leave_attendence import _admin_emails_for_emp_type_tokens

    emails = _admin_emails_for_emp_type_tokens(
        hr_admin, ["it", "it department", "information technology"]
    )
    tenant_id = tenant_id_for_admin(hr_admin)
    rows = (
        Admin.query.filter(
            Admin.tenant_id == tenant_id,
            db.func.lower(db.func.coalesce(Admin.emp_type, "")).in_(
                ["it", "it department", "information technology"]
            ),
        ).all()
    )
    return emails, rows


def create_official_email_request(hr_admin: Admin, data: dict) -> tuple[Optional[dict], Optional[str], int]:
    from .email import send_official_email_request_to_it

    candidate_name = (data.get("candidate_name") or "").strip()
    details = (data.get("details") or "").strip()
    if len(candidate_name) < 2:
        return None, "Enter the candidate's full name.", 400
    if len(details) < 10:
        return None, "Write request details of at least 10 characters for IT.", 400

    row = OfficialEmailRequest(
        tenant_id=tenant_id_for_admin(hr_admin),
        requested_by_admin_id=hr_admin.id,
        requested_by_name=(getattr(hr_admin, "first_name", None) or hr_admin.email or "HR"),
        requested_by_email=hr_admin.email,
        candidate_name=candidate_name[:150],
        designation=(data.get("designation") or "").strip()[:150] or None,
        department=(data.get("department") or "").strip()[:150] or None,
        circle=(data.get("circle") or "").strip()[:120] or None,
        preferred_prefix=(data.get("preferred_prefix") or "").strip()[:120] or None,
        details=details[:5000],
        status="Pending",
    )
    db.session.add(row)
    try:
        db.session.flush()
        emails, it_admins = _it_recipients(hr_admin)
        for it_admin in it_admins:
            if it_admin.id != hr_admin.id:
                _notify(
                    it_admin.id,
                    "New generate email ID request",
                    f"HR requested an email ID for {candidate_name}.",
                    row.id,
                )
        db.session.commit()
    except Exception as exc:
        db.session.rollback()
        current_app.logger.exception("create_official_email_request failed")
        return None, str(exc) or "Could not send the request.", 500

    email_sent = False
    try:
        email_sent = send_official_email_request_to_it(row=row, recipient_emails=emails)
    except Exception as mail_err:
        current_app.logger.warning("Official email request mail failed: %s", mail_err)

    return {
        "success": True,
        "message": (
            "Request sent to IT department."
            if email_sent
            else "Request saved for IT department, but the email notification could not be sent."
        ),
        "email_sent": bool(email_sent),
        "request": serialize_official_email_request(row),
    }, None, 201


def list_official_email_requests(tenant_id: int, *, status_filter: str = "all") -> dict:
    status_filter = (status_filter or "all").strip().lower()
    rows = (
        OfficialEmailRequest.query.filter_by(tenant_id=int(tenant_id))
        .order_by(OfficialEmailRequest.created_at.desc(), OfficialEmailRequest.id.desc())
        .limit(300)
        .all()
    )
    items = [serialize_official_email_request(r) for r in rows]
    counts = {
        "all": len(items),
        "pending": sum(1 for i in items if i["status"].lower() == "pending"),
        "generated": sum(1 for i in items if i["status"].lower() == "generated"),
    }
    if status_filter in ("pending", "generated"):
        items = [i for i in items if i["status"].lower() == status_filter]
    return {"success": True, "requests": items, "summary": counts, "filter": status_filter}


def respond_official_email_request(
    request_id: int, it_admin: Admin, *, generated_email: str, it_remarks: str = ""
) -> tuple[Optional[dict], Optional[str], int]:
    from .email import send_official_email_generated_to_hr

    row = OfficialEmailRequest.query.filter_by(
        id=int(request_id), tenant_id=tenant_id_for_admin(it_admin)
    ).first()
    if not row:
        return None, "Request not found.", 404
    if (row.status or "").lower() == "generated":
        return None, "This request has already been answered.", 409

    email_clean = (generated_email or "").strip().lower()
    if not EMAIL_RE.match(email_clean):
        return None, "Enter a valid generated email ID.", 400

    row.generated_email = email_clean
    row.it_remarks = (it_remarks or "").strip()[:2000] or None
    row.status = "Generated"
    row.responded_by_admin_id = it_admin.id
    row.responded_by_name = (getattr(it_admin, "first_name", None) or it_admin.email or "IT")
    row.responded_by_email = it_admin.email
    row.responded_at = utc_now()
    if row.requested_by_admin_id:
        _notify(
            row.requested_by_admin_id,
            "Email ID generated",
            f"IT generated {email_clean} for {row.candidate_name}.",
            row.id,
        )
    try:
        db.session.commit()
    except Exception as exc:
        db.session.rollback()
        current_app.logger.exception("respond_official_email_request failed")
        return None, str(exc) or "Could not save the response.", 500

    email_sent = False
    try:
        email_sent = send_official_email_generated_to_hr(row=row)
    except Exception as mail_err:
        current_app.logger.warning("Official email generated mail failed: %s", mail_err)

    return {
        "success": True,
        "message": (
            "Email ID sent to HR."
            if email_sent
            else "Response saved, but the email to HR could not be sent."
        ),
        "email_sent": bool(email_sent),
        "request": serialize_official_email_request(row),
    }, None, 200
