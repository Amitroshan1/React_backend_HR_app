"""Two-step L1 then L2 approval for leave and work-from-home.

A request stays open after L1. Balance and paid attendance apply only when it
is finally approved. A request whose end month has closed is greyed out until
Admin releases it.
"""
from __future__ import annotations

import calendar
import json
from datetime import date, datetime

from flask import current_app

from . import db
from .datetime_utils import utc_now
from .manager_utils import resolve_manager_contact_for_employee

STATUS_PENDING = "Pending"
STATUS_L1 = "L1 Approved"
STATUS_GREY = "Greyed Out"
STATUS_APPROVED = "Approved"
STATUS_REJECTED = "Rejected"
OPEN_STATUSES = (STATUS_PENDING, STATUS_L1)


class ApprovalError(ValueError):
    """The manager is not allowed to take this action."""


def _contact(employee):
    return resolve_manager_contact_for_employee(employee)


def approver_levels(approver, employee) -> set[str]:
    """Which approval steps this person holds for the employee."""
    if not approver or not employee:
        return set()
    if approver.id == employee.id:
        return set()
    contact = _contact(employee)
    if not contact:
        return set()
    levels = set()
    if contact.l1_admin_id == approver.id:
        levels.add("l1")
    if contact.l2_admin_id == approver.id:
        levels.add("l2")
    return levels


def has_distinct_l2(employee) -> bool:
    contact = _contact(employee)
    if not contact or not contact.l2_admin_id:
        return False
    return contact.l2_admin_id != contact.l1_admin_id


def l1_admin_id(employee):
    contact = _contact(employee)
    return getattr(contact, "l1_admin_id", None) if contact else None


def l2_admin_id(employee):
    contact = _contact(employee)
    return getattr(contact, "l2_admin_id", None) if contact else None


def can_act(approver, row) -> bool:
    if (row.status or "") == STATUS_GREY:
        return False
    levels = approver_levels(approver, row.admin)
    if row.status == STATUS_PENDING:
        return "l1" in levels
    if row.status == STATUS_L1:
        return "l2" in levels
    return False


def can_release(approver, row) -> bool:
    if (row.status or "") != STATUS_GREY:
        return False
    return bool(approver_levels(approver, row.admin))


def decide_request(row, approver, action: str) -> str:
    """Move one leave or WFH request. Returns approved, rejected, or l1_approved.

    Does not commit and does not change leave balance.
    """
    action = (action or "").strip().lower()
    if action not in ("approve", "reject"):
        raise ApprovalError("action must be approve or reject")
    status = row.status or ""
    if status == STATUS_GREY:
        raise ApprovalError("This request is locked until Admin releases it.")
    if status not in OPEN_STATUSES:
        raise ApprovalError("Only open requests can be updated.")

    levels = approver_levels(approver, row.admin)
    if status == STATUS_PENDING:
        if "l1" not in levels:
            raise ApprovalError("Waiting for the L1 manager.")
        if action == "reject":
            row.status = STATUS_REJECTED
            return "rejected"
        if has_distinct_l2(row.admin):
            row.status = STATUS_L1
            return "l1_approved"
        row.status = STATUS_APPROVED
        row.final_approved_at = utc_now()
        return "approved"

    if "l2" not in levels:
        raise ApprovalError("Waiting for the L2 manager.")
    if action == "reject":
        row.status = STATUS_REJECTED
        return "rejected"
    row.status = STATUS_APPROVED
    row.final_approved_at = utc_now()
    return "approved"


def actionable_for(approver, rows):
    return [row for row in rows if can_act(approver, row)]


def grey_out_closed_months(today: date, tenant_id: int) -> int:
    """On the first day of a month, lock requests whose end date is already past."""
    if today.day != 1:
        return 0
    from .models.attendance import LeaveApplication, WorkFromHomeApplication
    from .tenant_context import tenant_admin_ids

    cutoff = date(today.year, today.month, 1)
    admin_ids = tenant_admin_ids(tenant_id)
    changed = 0
    for model in (LeaveApplication, WorkFromHomeApplication):
        rows = model.query.filter(
            model.admin_id.in_(admin_ids),
            model.status.in_(OPEN_STATUSES),
            model.end_date < cutoff,
        ).all()
        for row in rows:
            row.greyed_from_status = row.status
            row.status = STATUS_GREY
            changed += 1
    return changed


def reminder_day(today: date) -> int:
    """29th, or the 28th in a February that has no 29th."""
    last_day = calendar.monthrange(today.year, today.month)[1]
    return 29 if last_day >= 29 else last_day


def pending_reminder_buckets(tenant_id: int) -> dict[int, list]:
    """Map manager admin id -> open requests waiting on that person."""
    from .models.attendance import LeaveApplication, WorkFromHomeApplication
    from .tenant_context import tenant_admin_ids

    admin_ids = tenant_admin_ids(tenant_id)
    buckets: dict[int, list] = {}
    for model, kind in ((LeaveApplication, "Leave"), (WorkFromHomeApplication, "Work from home")):
        rows = model.query.filter(
            model.admin_id.in_(admin_ids),
            model.status.in_(OPEN_STATUSES),
        ).all()
        for row in rows:
            owner_id = l1_admin_id(row.admin) if row.status == STATUS_PENDING else l2_admin_id(row.admin)
            if not owner_id:
                continue
            buckets.setdefault(owner_id, []).append((kind, row))
    return buckets


def send_month_end_reminders(today: date, tenant_id: int) -> int:
    if today.day != reminder_day(today):
        return 0
    from .models.Admin_models import Admin

    sent = 0
    for manager_id, items in pending_reminder_buckets(tenant_id).items():
        manager = db.session.get(Admin, manager_id)
        email = (getattr(manager, "email", None) or "").strip()
        if not email or not items:
            continue
        if _send_reminder_email(email, getattr(manager, "first_name", None) or email, items):
            sent += 1
    return sent


def _send_reminder_email(recipient, name, items) -> bool:
    from .email import send_email_via_zeptomail

    lines = []
    for kind, row in items:
        who = getattr(getattr(row, "admin", None), "first_name", None) or "Employee"
        lines.append(
            f"- {kind}: {who}, {row.start_date.isoformat()} to {row.end_date.isoformat()} "
            f"({row.status})"
        )
    body = (
        f"Hello {name},\n\n"
        "These leave and work-from-home requests are still waiting for you. "
        "If they are not fully approved before the month ends, they will be locked.\n\n"
        + "\n".join(lines)
        + "\n"
    )
    try:
        ok, message = send_email_via_zeptomail(
            sender_email=_sender(),
            subject="Reminder: leave and work-from-home approvals are still open",
            body=_html_body(body),
            recipient_email=recipient,
            from_name="HRMS",
        )
    except Exception as exc:
        current_app.logger.warning("Month-end approval reminder failed: %s", exc)
        return False
    if not ok:
        current_app.logger.warning("Month-end approval reminder skipped: %s", message)
    return bool(ok)


def send_consent_email(approver, approved_rows) -> None:
    """Tell HR and each L1 which requests L2 accepted together."""
    from .company_mailbox import company_mailbox
    from .email import send_email_via_zeptomail
    from .models.Admin_models import Admin

    if not approved_rows:
        return
    lines = []
    l1_ids = set()
    for kind, row in approved_rows:
        who = getattr(getattr(row, "admin", None), "first_name", None) or "Employee"
        lines.append(
            f"- {kind}: {who}, {row.start_date.isoformat()} to {row.end_date.isoformat()}"
        )
        owner = l1_admin_id(row.admin)
        if owner:
            l1_ids.add(owner)
    decider = getattr(approver, "first_name", None) or getattr(approver, "email", None) or "L2"
    body = (
        f"{decider} gave consent and approved these requests:\n\n"
        + "\n".join(lines)
        + "\n"
    )
    recipients = []
    hr = (company_mailbox("ZEPTO_CC_HR") or "").strip()
    if hr:
        recipients.append(hr)
    for admin_id in l1_ids:
        manager = db.session.get(Admin, admin_id)
        email = (getattr(manager, "email", None) or "").strip()
        if email:
            recipients.append(email)
    seen = set()
    unique = []
    for email in recipients:
        key = email.lower()
        if key in seen:
            continue
        seen.add(key)
        unique.append(email)
    if not unique:
        current_app.logger.warning("Consent saved but no HR or L1 mailbox was configured.")
        return
    sender = _sender()
    if not sender:
        current_app.logger.warning("Consent saved but no sender email is configured.")
        return
    try:
        ok, message = send_email_via_zeptomail(
            sender_email=sender,
            subject=f"Consent recorded by {decider}",
            body=_html_body(body),
            recipient_email=unique[0],
            cc_emails=unique[1:] or None,
            from_name="HRMS",
        )
        if not ok:
            current_app.logger.warning("Consent email failed: %s", message)
    except Exception as exc:
        current_app.logger.warning("Consent email failed: %s", exc)


def _sender():
    return (current_app.config.get("ZEPTO_SENDER_EMAIL") or "").strip()


def _html_body(text: str) -> str:
    return "<p>" + "<br>".join(
        (text or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").splitlines()
    ) + "</p>"


def counts_as_paid_on_sheet(leave, year: int, month: int) -> bool:
    """Paid on a month sheet only when approval was not after that month."""
    if (getattr(leave, "status", None) or "").strip().lower() != "approved":
        return False
    stamp = getattr(leave, "final_approved_at", None)
    if stamp is None:
        return True
    stamp_date = stamp.date() if isinstance(stamp, datetime) else stamp
    if (stamp_date.year, stamp_date.month) <= (year, month):
        return True
    return False


def extra_payment_lines(admin_id: int, year: int, month: int) -> list[str]:
    """Late approvals whose leave ended before this month, approved during this month."""
    from .models.attendance import LeaveApplication

    month_start = date(year, month, 1)
    last = calendar.monthrange(year, month)[1]
    month_end = date(year, month, last)
    rows = LeaveApplication.query.filter(
        LeaveApplication.admin_id == admin_id,
        LeaveApplication.status == STATUS_APPROVED,
        LeaveApplication.final_approved_at.isnot(None),
        LeaveApplication.end_date < month_start,
    ).all()
    lines = []
    for row in rows:
        stamp = row.final_approved_at
        stamp_date = stamp.date() if isinstance(stamp, datetime) else stamp
        if not (month_start <= stamp_date <= month_end):
            continue
        days = float(row.deducted_days or 0) or float(row.requested_deducted_days or 0)
        if days <= 0 and row.start_date and row.end_date:
            days = (row.end_date - row.start_date).days + 1
        day_label = "day" if days == 1 else "days"
        lines.append(
            f"{days:g} {day_label} · {row.start_date.isoformat()} to {row.end_date.isoformat()}"
        )
    return lines


def release_greyed_items(payload: dict) -> None:
    """Restore greyed leave and WFH rows after Admin approves the unlock."""
    from .models.attendance import LeaveApplication, WorkFromHomeApplication

    for item in payload.get("items") or []:
        kind = (item.get("kind") or "").strip().lower()
        model = LeaveApplication if kind == "leave" else WorkFromHomeApplication if kind == "wfh" else None
        if model is None:
            continue
        row = db.session.get(model, int(item.get("id") or 0))
        if row is None or row.status != STATUS_GREY:
            continue
        restore = row.greyed_from_status if row.greyed_from_status in OPEN_STATUSES else STATUS_PENDING
        row.status = restore
        row.greyed_from_status = None


def describe_unlock_item(kind: str, row) -> dict:
    who = getattr(getattr(row, "admin", None), "first_name", None) or "Employee"
    detail = getattr(row, "leave_type", None) or getattr(row, "reason", None) or ""
    return {
        "kind": kind,
        "id": row.id,
        "employee": who,
        "dates": f"{row.start_date.isoformat()} to {row.end_date.isoformat()}",
        "detail": detail,
    }


def stage_unlock_request(approver, items: list[dict]):
    """Queue one Admin request to release the selected greyed rows."""
    from .employee_profile_change_service import (
        EmployeeProfileChangeRequest,
        _requester,
        request_tenant_id,
    )

    if not items:
        raise ApprovalError("Select at least one greyed-out request.")
    _reject_overlapping_unlock(items)
    requester_id, requester_name, requester_email = _requester()
    row = EmployeeProfileChangeRequest(
        tenant_id=request_tenant_id(),
        employee_admin_id=None,
        request_type="leave_unlock",
        status="pending",
        changes="{}",
        signup_payload=json.dumps({"subject": "Release greyed requests", "items": items}),
        requested_by_admin_id=requester_id or getattr(approver, "id", None),
        requested_by_name=requester_name or getattr(approver, "first_name", None),
        requested_by_email=requester_email or getattr(approver, "email", None),
        created_at=utc_now(),
    )
    db.session.add(row)
    return row


def _reject_overlapping_unlock(items: list[dict]) -> None:
    from .employee_profile_change_service import EmployeeProfileChangeRequest, request_tenant_id

    wanted = {(item["kind"], int(item["id"])) for item in items}
    pending = EmployeeProfileChangeRequest.query.filter_by(
        tenant_id=request_tenant_id(),
        request_type="leave_unlock",
        status="pending",
    ).all()
    for row in pending:
        try:
            payload = json.loads(row.signup_payload or "{}")
        except json.JSONDecodeError:
            continue
        for item in payload.get("items") or []:
            key = ((item.get("kind") or "").lower(), int(item.get("id") or 0))
            if key in wanted:
                raise ApprovalError("One of these requests is already waiting for Admin.")
