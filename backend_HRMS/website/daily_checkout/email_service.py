"""Day-use email sending via Zepto outbox rows."""

from __future__ import annotations

from flask import current_app

from ..datetime_utils import utc_now
from ..email import send_email_via_zeptomail
from ..models.daily_checkout import DailyCheckoutOutbox, DailyCheckoutRequest
from .service import _add_event


def send_outbox_row(item: DailyCheckoutOutbox):
    row = DailyCheckoutRequest.query.get(item.request_id)
    item.attempts = int(item.attempts or 0) + 1
    if not row:
        item.status = "failed"
        item.last_error = "Request missing"
        return

    employee = (row.requester_email_snapshot or "").strip()
    managers = [e for e in (row.manager_emails_snapshot or []) if e]
    it_mailbox = (
        current_app.config.get("ZEPTO_CC_IT") or current_app.config.get("EMAIL_IT") or ""
    ).strip()
    sender = current_app.config.get("ZEPTO_SENDER_EMAIL")
    code = row.request_code
    hw = row.requested_hw_type
    items_summary = (item.payload_json or {}).get("items_summary") or hw
    name = row.requester_name_snapshot or "Employee"
    event = item.event_code

    if event == "REQUEST_CREATED":
        to_email = it_mailbox or employee
        cc = list(managers)
        if employee and employee.lower() != (to_email or "").lower():
            cc.append(employee)
        subject = f"Day-use request {code}"
        body = (
            f"<p>{name} requested day-use assets: <strong>{items_summary}</strong> ({code}).</p>"
            f"<p>Open the IT Day-use Assets inbox to approve.</p>"
        )
    elif event == "REJECTED":
        to_email = employee
        cc = list(managers)
        if it_mailbox:
            cc.append(it_mailbox)
        reason = (row.rejection_reason or (item.payload_json or {}).get("reason") or "").strip()
        subject = f"Day-use request {code} rejected"
        body = f"<p>Dear {name},</p><p>Your day-use request <strong>{code}</strong> was rejected.</p><p>Reason: {reason or '—'}</p>"
    elif event == "ASSIGNED":
        to_email = employee
        cc = list(managers)
        if it_mailbox:
            cc.append(it_mailbox)
        asset = (item.payload_json or {}).get("asset_name") or hw
        subject = f"Day-use asset assigned — {code}"
        body = (
            f"<p>Dear {name},</p><p><strong>{asset}</strong> has been assigned for day-use ({code}).</p>"
            f"<p>Please collect the device(s), open Day-use Assets, and click Acknowledge to download the Acceptance PDF.</p>"
        )
    elif event == "RETURN_REQUESTED":
        to_email = it_mailbox or employee
        cc = list(managers)
        if employee and employee.lower() != (to_email or "").lower():
            cc.append(employee)
        subject = f"Day-use return requested — {code}"
        body = f"<p>{name} requested return of day-use asset {code}. Please verify the device in the IT inbox.</p>"
    elif event == "RETURNED":
        to_email = employee
        cc = list(managers)
        if it_mailbox:
            cc.append(it_mailbox)
        subject = f"Day-use asset returned — {code}"
        body = f"<p>Dear {name},</p><p>Your day-use asset ({code}) has been received by IT.</p>"
    elif event == "OVERDUE":
        to_email = employee
        cc = list(managers)
        if it_mailbox:
            cc.append(it_mailbox)
        subject = f"Day-use asset overdue — {code}"
        body = f"<p>Dear {name},</p><p>Day-use request <strong>{code}</strong> is overdue for return. Please return the asset to IT today.</p>"
    else:
        item.status = "failed"
        item.last_error = f"Unknown event {event}"
        return

    if not to_email:
        item.status = "failed"
        item.last_error = "No recipient"
        return

    ok, msg = send_email_via_zeptomail(
        sender_email=sender,
        subject=subject,
        body=body,
        recipient_email=to_email,
        cc_emails=cc or None,
        from_name="Day-use Assets",
    )
    if ok:
        item.status = "sent"
        item.sent_at = utc_now()
        item.last_error = None
        _add_event(row.id, "EMAIL_SENT", role="system", payload={"event_code": event, "to": to_email})
    else:
        item.status = "failed" if item.attempts >= 5 else "pending"
        item.last_error = str(msg)[:500]
        current_app.logger.warning("Day-use email failed %s %s: %s", code, event, msg)
