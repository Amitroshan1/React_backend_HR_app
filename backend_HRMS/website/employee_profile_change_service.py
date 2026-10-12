"""Hold HR employee changes for Admin approval."""
from __future__ import annotations

import json
from html import escape

from flask import current_app
from flask_jwt_extended import get_jwt

from . import db
from .datetime_utils import utc_now
from .models.employee_profile_change import EmployeeProfileChangeRequest
from .tenant_context import current_admin, get_current_tenant_id, tenant_id_for_admin

REQUEST_LABELS = {
    "signup": "New employee",
    "profile_change": "Profile change",
    "exit": "Employee exit",
    "rehire": "Employee rehire",
    "general": "General request",
}
DECISION_KINDS = {
    "signup": "new employee signup",
    "exit": "employee exit",
    "rehire": "employee rehire",
    "general": "request from HR",
}
GATED_FIELDS = ("emp_type", "circle", "designation", "employment_status")
FIELD_LABELS = {
    "emp_type": "Department",
    "circle": "Circle",
    "designation": "Designation",
    "employment_status": "Employment status",
}
EMPLOYMENT_PAYLOAD_KEYS = (
    "employment_status",
    "probation_start_date",
    "probation_end_date",
    "probation_duration_months",
)


def _clean(value) -> str:
    return ("" if value is None else str(value)).strip()


def _current_designation(admin) -> str:
    from .models.emp_detail_models import Employee

    row = Employee.query.filter_by(admin_id=admin.id).first()
    return _clean(getattr(row, "designation", None)) if row else ""


def _employment_label(value) -> str:
    from .employment_status import STATUS_LABELS

    key = _clean(value).lower()
    return STATUS_LABELS.get(key, value or "—")


def _display_value(field: str, value) -> str:
    if field == "employment_status":
        return _employment_label(value)
    text = _clean(value)
    return text or "—"


def _requester():
    admin = current_admin()
    claims = {}
    try:
        claims = get_jwt() or {}
    except Exception:
        claims = {}
    name = _clean(getattr(admin, "first_name", None) or claims.get("name") or claims.get("email"))
    email = _clean(getattr(admin, "email", None) or claims.get("email")).lower()
    admin_id = getattr(admin, "id", None)
    return admin_id, name or email or "HR", email


def pending_for_employee(admin):
    return (
        EmployeeProfileChangeRequest.query.filter_by(
            tenant_id=tenant_id_for_admin(admin),
            employee_admin_id=admin.id,
            status="pending",
        )
        .order_by(EmployeeProfileChangeRequest.id.desc())
        .first()
    )


def pending_request_message(admin):
    existing = pending_for_employee(admin)
    if not existing:
        return None
    label = REQUEST_LABELS.get((existing.request_type or "profile_change").strip(), "request")
    return f"This employee already has a {label.lower()} waiting for Admin approval."


def prepare_profile_change(admin, data: dict):
    """
    Split an employee update into fields saved now and fields held for approval.

    Returns (direct_payload, changes_or_none, error_message).
    """
    from .Human_resource import (
        MASTER_TYPE_CIRCLE,
        MASTER_TYPE_DEPARTMENT,
        _is_allowed_master_value,
        _is_valid_profile_designation,
        _norm_circle_name,
    )

    source = dict(data or {})
    direct = dict(source)
    changes = {}

    if "emp_type" in source:
        proposed = _clean(source.get("emp_type"))
        current = _clean(admin.emp_type)
        if proposed and proposed.casefold() != current.casefold():
            if not _is_allowed_master_value(MASTER_TYPE_DEPARTMENT, proposed):
                return direct, None, "Invalid employee type. Please select a configured department."
            changes["emp_type"] = {"from": current, "to": proposed[:50]}
            direct.pop("emp_type", None)

    if "circle" in source:
        proposed = _clean(source.get("circle"))
        current = _clean(admin.circle)
        if proposed and _norm_circle_name(current) != _norm_circle_name(proposed):
            if not _is_allowed_master_value(MASTER_TYPE_CIRCLE, proposed):
                return direct, None, "Invalid circle. Please select a configured circle."
            effective = _clean(source.get("circle_effective_from"))[:10]
            if not effective:
                return direct, None, "circle_effective_from is required when changing circle (YYYY-MM-DD)."
            from datetime import datetime

            try:
                datetime.fromisoformat(effective).date()
            except ValueError:
                return direct, None, "Invalid circle_effective_from (YYYY-MM-DD)."
            changes["circle"] = {
                "from": current,
                "to": proposed[:50],
                "effective_from": effective,
                "notes": _clean(source.get("circle_transfer_notes"))[:500],
            }
            direct.pop("circle", None)
            direct.pop("circle_effective_from", None)
            direct.pop("circle_transfer_notes", None)

    if "designation" in source:
        proposed = _clean(source.get("designation"))
        current = _current_designation(admin)
        if proposed and proposed.casefold() != current.casefold():
            if not _is_valid_profile_designation(proposed):
                return direct, None, (
                    "Invalid designation. Use 2–100 characters "
                    "(letters, numbers, spaces, and common punctuation)."
                )
            changes["designation"] = {"from": current, "to": proposed[:100]}
            direct.pop("designation", None)

    if "employment_status" in source:
        proposed = _clean(source.get("employment_status")).lower()
        current = _clean(getattr(admin, "employment_status", None)).lower() or "probation"
        if proposed and proposed != current:
            payload = {key: source.get(key) for key in EMPLOYMENT_PAYLOAD_KEYS if key in source}
            payload["employment_status"] = proposed
            from .employment_status import EmploymentStatusError, resolve_employment_payload

            try:
                resolve_employment_payload(payload, doj=admin.doj, existing=admin, for_create=False)
            except EmploymentStatusError as exc:
                return direct, None, str(exc)
            changes["employment_status"] = {"from": current, "to": proposed, "payload": payload}
            for key in EMPLOYMENT_PAYLOAD_KEYS:
                direct.pop(key, None)

    if not changes:
        return direct, None, None

    blocked = pending_request_message(admin)
    if blocked:
        return direct, None, blocked
    return direct, changes, None


def stage_action_request(admin, request_type: str, changes: dict, payload: dict | None = None):
    requester_id, requester_name, requester_email = _requester()
    row = EmployeeProfileChangeRequest(
        tenant_id=tenant_id_for_admin(admin),
        employee_admin_id=admin.id,
        request_type=request_type,
        status="pending",
        changes=json.dumps(changes or {}),
        signup_payload=json.dumps(payload) if payload is not None else None,
        requested_by_admin_id=requester_id,
        requested_by_name=requester_name,
        requested_by_email=requester_email,
        created_at=utc_now(),
    )
    db.session.add(row)
    return row


def stage_profile_change(admin, changes: dict) -> EmployeeProfileChangeRequest:
    requester_id, requester_name, requester_email = _requester()
    row = EmployeeProfileChangeRequest(
        tenant_id=tenant_id_for_admin(admin),
        employee_admin_id=admin.id,
        status="pending",
        changes=json.dumps(changes),
        requested_by_admin_id=requester_id,
        requested_by_name=requester_name,
        requested_by_email=requester_email,
        created_at=utc_now(),
    )
    db.session.add(row)
    return row


def update_result_message(changes) -> tuple[str, list[str]]:
    if not changes:
        return "Employee record updated successfully", []
    labels = [FIELD_LABELS[key] for key in GATED_FIELDS if key in changes]
    listed = ", ".join(labels)
    return (
        f"Sent for Admin approval. {listed} will stay unchanged until an Admin approves the request.",
        list(changes.keys()),
    )


def _load_changes(row) -> dict:
    try:
        parsed = json.loads(row.changes or "{}")
    except (TypeError, ValueError):
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _employee_bits(admin):
    if admin is None:
        return {"employee_name": "", "employee_email": "", "emp_id": ""}
    return {
        "employee_name": _clean(admin.first_name or admin.user_name or admin.email),
        "employee_email": _clean(admin.email),
        "emp_id": _clean(admin.emp_id),
    }


def _signup_payload(row) -> dict:
    try:
        parsed = json.loads(row.signup_payload or "{}")
    except (TypeError, ValueError):
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _same_identifier(left, right) -> bool:
    a = _clean(left).casefold()
    b = _clean(right).casefold()
    return bool(a) and a == b


def signup_identifier_conflict(tenant_id, *, email, user_name, mobile, emp_id):
    """Block a new signup when an active employee or a pending signup already uses an identifier."""
    from .models.Admin_models import Admin
    from .tenant_context import tenant_admin_query

    existing = tenant_admin_query(tenant_id).filter(
        (Admin.email == email)
        | (Admin.user_name == user_name)
        | (Admin.mobile == mobile)
        | (Admin.emp_id == emp_id)
    ).first()
    if existing and existing.is_onboarded():
        return "Email, User name, Mobile or Employee ID already exists. Use different values."

    pending = EmployeeProfileChangeRequest.query.filter_by(
        tenant_id=int(tenant_id),
        status="pending",
        request_type="signup",
    ).all()
    for row in pending:
        payload = _signup_payload(row)
        if any(
            _same_identifier(payload.get(key), value)
            for key, value in (
                ("email", email),
                ("user_name", user_name),
                ("mobile", mobile),
                ("emp_id", emp_id),
            )
        ):
            return (
                "A signup with this email, user name, mobile, or employee ID "
                "is already waiting for Admin approval."
            )
    return None


def stage_general_request(subject: str, details: str) -> EmployeeProfileChangeRequest:
    requester_id, requester_name, requester_email = _requester()
    clean_subject = _clean(subject)[:150]
    clean_details = _clean(details)[:4000]
    if len(clean_subject) < 3:
        raise ValueError("Write a subject of at least 3 characters.")
    if len(clean_details) < 10:
        raise ValueError("Write the request details in at least 10 characters.")
    row = EmployeeProfileChangeRequest(
        tenant_id=request_tenant_id(),
        employee_admin_id=None,
        request_type="general",
        status="pending",
        changes="{}",
        signup_payload=json.dumps({"subject": clean_subject, "details": clean_details}),
        requested_by_admin_id=requester_id,
        requested_by_name=requester_name,
        requested_by_email=requester_email,
        created_at=utc_now(),
    )
    db.session.add(row)
    return row


def stage_signup_request(payload: dict) -> EmployeeProfileChangeRequest:
    requester_id, requester_name, requester_email = _requester()
    summary = {
        "emp_type": {"from": "", "to": payload.get("emp_type") or ""},
        "circle": {"from": "", "to": payload.get("circle") or ""},
        "designation": {"from": "", "to": payload.get("designation") or ""},
        "employment_status": {"from": "", "to": payload.get("employment_status") or "probation"},
    }
    row = EmployeeProfileChangeRequest(
        tenant_id=request_tenant_id(),
        employee_admin_id=None,
        request_type="signup",
        status="pending",
        changes=json.dumps(summary),
        signup_payload=json.dumps(payload),
        requested_by_admin_id=requester_id,
        requested_by_name=requester_name,
        requested_by_email=requester_email,
        created_at=utc_now(),
    )
    db.session.add(row)
    return row


def serialize_change_request(row) -> dict:
    changes = _load_changes(row)
    fields = []
    request_type = (getattr(row, "request_type", None) or "profile_change").strip() or "profile_change"
    signup = _signup_payload(row) if request_type in ("signup", "exit", "rehire", "general") else {}
    if request_type == "exit":
        for key, label in (
            ("exit_type", "Exit type"),
            ("exit_date", "Exit date"),
            ("last_working_day", "Last working day"),
            ("resignation_date", "Resignation date"),
            ("exit_reason", "Reason"),
            ("notice_shortfall_days", "Notice shortfall (days)"),
        ):
            value = signup.get(key)
            if value in (None, ""):
                continue
            fields.append({
                "field": key,
                "label": label,
                "from": "Active",
                "to": _display_value(key, value),
            })
        if signup.get("force_override"):
            fields.append({
                "field": "force_override",
                "label": "Force override",
                "from": "—",
                "to": _clean(signup.get("force_override_reason")) or "Yes",
            })
    elif request_type == "rehire":
        fields.append({
            "field": "status",
            "label": "Status",
            "from": "Exited",
            "to": "Active",
        })
    elif request_type == "general":
        fields.append({
            "field": "subject",
            "label": "Subject",
            "from": "—",
            "to": _clean(signup.get("subject")) or "—",
        })
        fields.append({
            "field": "details",
            "label": "Details",
            "from": "—",
            "to": _clean(signup.get("details")) or "—",
        })
    elif request_type == "signup":
        for key, label in (
            ("first_name", "Full name"),
            ("email", "Email"),
            ("user_name", "Username"),
            ("emp_id", "Employee ID"),
            ("mobile", "Mobile"),
            ("doj", "Date of joining"),
        ):
            fields.append({
                "field": key,
                "label": label,
                "from": "—",
                "to": _display_value(key, signup.get(key)),
            })
    for key in GATED_FIELDS:
        item = changes.get(key)
        if not isinstance(item, dict):
            continue
        entry = {
            "field": key,
            "label": FIELD_LABELS[key],
            "from": _display_value(key, item.get("from")) if item.get("from") else "—",
            "to": _display_value(key, item.get("to")),
        }
        if key == "circle" and item.get("effective_from"):
            entry["effective_from"] = item.get("effective_from")
            if item.get("notes"):
                entry["notes"] = item.get("notes")
        fields.append(entry)
    employee = getattr(row, "employee", None)
    bits = _employee_bits(employee)
    if request_type == "general":
        bits = {
            "employee_name": _clean(signup.get("subject")),
            "employee_email": "",
            "emp_id": "",
        }
    elif request_type == "signup" and not bits["employee_name"]:
        bits = {
            "employee_name": _clean(signup.get("first_name")),
            "employee_email": _clean(signup.get("email")),
            "emp_id": _clean(signup.get("emp_id")),
        }
    payload = {
        "id": row.id,
        "request_type": request_type,
        "request_label": REQUEST_LABELS.get(request_type, "Profile change"),
        "status": row.status,
        "fields": fields,
        "requested_by_name": row.requested_by_name or "",
        "requested_by_email": row.requested_by_email or "",
        "decided_by_name": row.decided_by_name or "",
        "decided_by_email": row.decided_by_email or "",
        "decision_note": row.decision_note or "",
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "decided_at": row.decided_at.isoformat() if row.decided_at else None,
        **bits,
    }
    return payload


def list_change_requests(tenant_id, status=None):
    query = EmployeeProfileChangeRequest.query.filter_by(tenant_id=int(tenant_id))
    if status and status.lower() not in ("all", ""):
        query = query.filter(EmployeeProfileChangeRequest.status == status.lower())
    rows = query.order_by(EmployeeProfileChangeRequest.created_at.desc(), EmployeeProfileChangeRequest.id.desc()).limit(300).all()
    return [serialize_change_request(row) for row in rows]


def get_change_request(tenant_id, request_id):
    return EmployeeProfileChangeRequest.query.filter_by(
        tenant_id=int(tenant_id),
        id=int(request_id),
    ).first()


def _apply_changes(admin, changes: dict, decider_email: str, decider_name: str):
    from .Human_resource import (
        MASTER_TYPE_CIRCLE,
        MASTER_TYPE_DEPARTMENT,
        _apply_circle_transfer,
        _is_allowed_master_value,
        _is_valid_profile_designation,
        _upsert_employee_designation_for_admin,
    )

    if "emp_type" in changes:
        proposed = _clean(changes["emp_type"].get("to"))
        if not _is_allowed_master_value(MASTER_TYPE_DEPARTMENT, proposed):
            raise ValueError("Department is no longer available. Reject this request or add the department again.")
        admin.emp_type = proposed[:50]

    if "circle" in changes:
        item = changes["circle"]
        proposed = _clean(item.get("to"))
        if not _is_allowed_master_value(MASTER_TYPE_CIRCLE, proposed):
            raise ValueError("Circle is no longer available. Reject this request or add the circle again.")
        from datetime import datetime

        effective = datetime.fromisoformat(_clean(item.get("effective_from"))[:10]).date()
        ok, err = _apply_circle_transfer(
            admin,
            proposed,
            effective,
            decider_email or decider_name or "admin",
            item.get("notes"),
        )
        if not ok:
            raise ValueError(err or "Could not apply the circle change.")

    if "designation" in changes:
        proposed = _clean(changes["designation"].get("to"))
        if not _is_valid_profile_designation(proposed):
            raise ValueError("Designation is no longer valid.")
        _upsert_employee_designation_for_admin(admin, proposed)

    if "employment_status" in changes:
        from .employment_status import EmploymentStatusError, apply_employment_fields, resolve_employment_payload

        payload = changes["employment_status"].get("payload") or {
            "employment_status": changes["employment_status"].get("to"),
        }
        try:
            fields = resolve_employment_payload(payload, doj=admin.doj, existing=admin, for_create=False)
        except EmploymentStatusError as exc:
            raise ValueError(str(exc)) from exc
        apply_employment_fields(
            admin,
            fields,
            changed_by=decider_email or decider_name,
            notes=f"Approved profile change. Requested earlier; decided by {decider_name or decider_email}.",
            send_email=True,
        )


def _date_from_payload(payload: dict, key: str):
    from datetime import date

    raw = _clean(payload.get(key))[:10]
    if not raw:
        return None
    return date.fromisoformat(raw)


def _apply_exit(admin, row, performed_by: str):
    from .offboarding_service import execute_employee_exit

    payload = _signup_payload(row)
    exit_date = _date_from_payload(payload, "exit_date")
    last_working_day = _date_from_payload(payload, "last_working_day") or exit_date
    if exit_date is None or last_working_day is None:
        raise ValueError("Exit date is missing from this request.")
    ok, message, _extra = execute_employee_exit(
        admin,
        exit_type=payload.get("exit_type") or "Resigned",
        exit_date=exit_date,
        last_working_day=last_working_day,
        exit_reason=_clean(payload.get("exit_reason")),
        notice_shortfall_days=int(payload.get("notice_shortfall_days") or 0),
        resignation_date=_date_from_payload(payload, "resignation_date"),
        hr_email=_clean(row.requested_by_email) or performed_by,
        force_override=bool(payload.get("force_override")),
        force_override_reason=_clean(payload.get("force_override_reason")),
    )
    if not ok:
        raise ValueError(message or "Could not apply the exit.")
    return _extra or {}


def _apply_rehire(admin, performed_by: str):
    from .exit_interview_service import serialize_rehire_policy
    from .models.Admin_models import AuditLog

    if not getattr(admin, "is_exited", False):
        raise ValueError("This employee is not in the exit archive.")
    policy = serialize_rehire_policy(admin.id)
    if not policy.get("can_rejoin_now"):
        raise ValueError(policy.get("rehire_block_reason") or "Employee is not eligible for rehire yet.")
    admin.is_exited = False
    admin.is_active = True
    admin.exit_date = None
    admin.exit_type = None
    admin.exit_reason = None
    admin.exit_login_until = None
    db.session.add(
        AuditLog(
            action="EMPLOYEE_REJOINED",
            performed_by=performed_by,
            target_email=admin.email,
        )
    )


def _send_decision_email(row, decision: str, decider_name: str):
    from .company_mailbox import company_mailbox
    from .email import send_email_via_zeptomail

    tenant_id = row.tenant_id
    recipient = (
        company_mailbox("ZEPTO_CC_HR", tenant_id) or company_mailbox("EMAIL_HR", tenant_id) or ""
    ).strip()
    sender = (current_app.config.get("ZEPTO_SENDER_EMAIL") or "").strip()
    if not recipient or not sender:
        current_app.logger.warning(
            "Profile change %s %s: HR email skipped (mailbox or sender missing)",
            row.id,
            decision,
        )
        return False, "HR mailbox is not configured, so the decision email was not sent."

    bits = {
        "employee_name": serialize_change_request(row).get("employee_name"),
        "employee_email": serialize_change_request(row).get("employee_email"),
        "emp_id": serialize_change_request(row).get("emp_id"),
    }
    kind = DECISION_KINDS.get((row.request_type or "").strip(), "employee profile change")
    lines = []
    for field in serialize_change_request(row)["fields"]:
        extra = ""
        if field.get("effective_from"):
            extra = f" (effective {escape(field['effective_from'])})"
        lines.append(
            f"<li><strong>{escape(field['label'])}:</strong> "
            f"{escape(field['from'])} → {escape(field['to'])}{extra}</li>"
        )
    verb = "approved" if decision == "approved" else "rejected"
    note = _clean(row.decision_note)
    note_html = f"<p><strong>Note:</strong> {escape(note)}</p>" if note else ""
    body = (
        f"<p>An Admin has <strong>{verb}</strong> a {kind}.</p>"
        f"<p><strong>Employee:</strong> {escape(bits['employee_name'])} "
        f"({escape(bits['emp_id'] or 'no id')}, {escape(bits['employee_email'] or 'no email')})</p>"
        f"<p><strong>Decision by:</strong> {escape(decider_name or 'Admin')}</p>"
        f"<ul>{''.join(lines)}</ul>"
        f"{note_html}"
    )
    requester = _clean(row.requested_by_email).lower()
    cc = [requester] if requester and requester != recipient.lower() else None
    ok, message = send_email_via_zeptomail(
        sender_email=sender,
        subject=f"{kind[:1].upper()}{kind[1:]} {verb}: {bits['employee_name'] or bits['emp_id'] or 'employee'}",
        body=body,
        recipient_email=recipient,
        cc_emails=cc,
        from_name="HRMS",
    )
    if not ok:
        current_app.logger.warning("Profile change %s email failed: %s", row.id, message)
        return False, "The decision was saved, but the email to HR could not be sent."
    return True, ""


def decide_profile_change(row, decision: str, note: str = ""):
    decision = (decision or "").strip().lower()
    if decision not in ("approve", "reject"):
        return None, "Choose approve or reject.", 400
    if row.status != "pending":
        return None, "This request has already been decided.", 409

    decider = current_admin()
    decider_name = _clean(getattr(decider, "first_name", None) or getattr(decider, "email", None)) or "Admin"
    decider_email = _clean(getattr(decider, "email", None)).lower()
    decider_id = getattr(decider, "id", None)
    status = "approved" if decision == "approve" else "rejected"

    welcome_admin = None
    welcome_payload = None
    exit_notice = None
    try:
        request_type = (row.request_type or "profile_change").strip() or "profile_change"
        if status == "approved" and request_type == "signup":
            from .email import send_welcome_email
            from .Human_resource import materialize_employee_signup

            welcome_payload = _signup_payload(row)
            welcome_admin = materialize_employee_signup(
                welcome_payload, decider_email or decider_name
            )
            row.employee_admin_id = welcome_admin.id
            row.employee = welcome_admin
        elif status == "approved" and request_type == "exit":
            employee = row.employee
            if employee is None:
                return None, "Employee record was not found.", 404
            exit_notice = _apply_exit(employee, row, decider_email or decider_name)
            exit_notice["admin"] = employee
        elif status == "approved" and request_type == "rehire":
            employee = row.employee
            if employee is None:
                return None, "Employee record was not found.", 404
            _apply_rehire(employee, decider_email or decider_name)
        elif status == "approved" and request_type == "general":
            pass
        elif status == "approved":
            employee = row.employee
            if employee is None:
                return None, "Employee record was not found.", 404
            _apply_changes(employee, _load_changes(row), decider_email, decider_name)
        row.status = status
        row.decided_by_admin_id = decider_id
        row.decided_by_name = decider_name
        row.decided_by_email = decider_email
        row.decision_note = _clean(note)[:500] or None
        row.decided_at = utc_now()
        db.session.commit()
    except ValueError as exc:
        db.session.rollback()
        return None, str(exc), 400
    except Exception:
        db.session.rollback()
        current_app.logger.exception("Profile change %s decision failed", row.id)
        return None, "Could not save this decision.", 500

    if welcome_admin is not None:
        try:
            send_welcome_email(welcome_admin, welcome_payload or {})
        except Exception as mail_err:
            current_app.logger.warning("Welcome email failed after signup approval: %s", mail_err)

    if exit_notice:
        try:
            from .offboarding_service import send_exit_employee_notifications

            send_exit_employee_notifications(
                exit_notice["admin"],
                exit_type=exit_notice.get("exit_type"),
                last_working_day=exit_notice.get("last_working_day"),
                exit_reason=exit_notice.get("exit_reason"),
                hr_email=exit_notice.get("hr_email"),
                deferred_login=bool(exit_notice.get("deferred_login")),
            )
        except Exception as mail_err:
            current_app.logger.warning("Exit email failed after approval: %s", mail_err)

    email_ok, email_message = _send_decision_email(row, status, decider_name)
    payload = serialize_change_request(row)
    payload["email_sent"] = email_ok
    if email_message:
        payload["email_message"] = email_message
    return payload, "", 200


def request_tenant_id():
    tid = get_current_tenant_id()
    return int(tid) if tid is not None else tenant_id_for_admin(current_admin())
