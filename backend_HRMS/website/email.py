# send_email_via_zeptomail,send_login_alert_email,Company_verify_oauth2_and_send_email,
# send_wfh_approval_email_to_managers,send_claim_submission_email
# asset_email,update_asset_email,send_welcome_email,send_asset_assigned_email,
# send_resignation_email,notify_query_event,send_leave_applied_email,

from .models.Admin_models import Admin
from .models.manager_model import ManagerContact
from .manager_utils import get_manager_emails, resolve_manager_contact_for_employee
from flask import current_app, url_for
from .models.expense import ExpenseLineItem
from .expense_utils import claim_attach_static_filename
import html
import base64
import mimetypes
import os
import requests
from sqlalchemy import func
from . import db



ZEPTO_MAX_CC_PER_MESSAGE = 48


def _zeptomail_auth_header():
    """ZeptoMail expects: Zoho-enczapikey <token> (prefix optional in env)."""
    raw = (current_app.config.get("ZEPTO_API_KEY") or "").strip()
    if not raw:
        return None
    if raw.lower().startswith("zoho-enczapikey"):
        return raw
    return f"Zoho-enczapikey {raw}"


def zeptomail_config_error():
    """Return an error string if ZeptoMail is not configured, else None."""
    if not _zeptomail_auth_header():
        return "ZEPTO_API_KEY is not configured on the server."
    if not (current_app.config.get("ZEPTO_SENDER_EMAIL") or "").strip():
        return "ZEPTO_SENDER_EMAIL is not configured on the server."
    base = (current_app.config.get("BASE_URL") or "").strip()
    if not base or not base.startswith(("http://", "https://")):
        return "BASE_URL must be set to your site URL (e.g. https://hr.company.com)."
    return None


def _zeptomail_post_payload(payload):
    auth = _zeptomail_auth_header()
    if not auth:
        return False, "ZEPTO_API_KEY is not configured on the server."
    url = current_app.config.get(
        "ZEPTO_BASE_URL",
        "https://api.zeptomail.in/v1.1/email",
    )
    headers = {
        "accept": "application/json",
        "content-type": "application/json",
        "authorization": auth,
    }
    response = requests.post(url, json=payload, headers=headers, timeout=30)
    if response.status_code in (200, 201):
        return True, "Email sent successfully"
    return False, f"ZeptoMail error: {response.text}"


def _zeptomail_attachment_from_path(abs_path):
    if not abs_path or not os.path.isfile(abs_path):
        return None
    mime, _enc = mimetypes.guess_type(abs_path)
    if not mime:
        mime = "application/octet-stream"
    name = os.path.basename(abs_path)
    with open(abs_path, "rb") as f:
        content_b64 = base64.b64encode(f.read()).decode("ascii")
    return {"name": name, "content": content_b64, "mime_type": mime}


def send_email_via_zeptomail(
    sender_email,
    subject,
    body,
    recipient_email,
    cc_emails=None,
    attachments=None,
    from_name=None,
):
    """
    Sends email using Zoho ZeptoMail API
    Returns: (success: bool, message: str)
    """
    try:
        display_name = (from_name or subject or "Notification").strip()
        payload = {
            "from": {
                "address": sender_email,
                "name": display_name,
            },
            "to": [
                {
                    "email_address": {
                        "address": recipient_email,
                    }
                }
            ],
            "subject": subject,
            "htmlbody": body,
        }

        if cc_emails:
            payload["cc"] = [
                {"email_address": {"address": email}}
                for email in cc_emails
                if email
            ]

        if attachments:
            payload["attachments"] = attachments

        return _zeptomail_post_payload(payload)

    except Exception as e:
        current_app.logger.error(f"ZeptoMail send failed: {e}")
        return False, "Unexpected error while sending email"


def news_feed_employee_emails(circle, emp_type):
    """Active employees with email, filtered like dashboard news feed visibility."""
    q = Admin.query.filter(
        Admin.is_active.is_(True),
        db.or_(Admin.is_exited.is_(False), Admin.is_exited.is_(None)),
        Admin.email.isnot(None),
        Admin.email != "",
    )
    circle_val = (circle or "").strip()
    if circle_val and circle_val.lower() != "all":
        q = q.filter(func.lower(func.coalesce(Admin.circle, "")) == circle_val.lower())
    emp_val = (emp_type or "").strip()
    if emp_val and emp_val.lower() not in ("all", "all employees"):
        q = q.filter(Admin.emp_type == emp_val)
    emails = []
    seen = set()
    for row in q.all():
        addr = (row.email or "").strip().lower()
        if not addr or addr in seen:
            continue
        seen.add(addr)
        emails.append(addr)
    return sorted(emails)


def send_news_feed_announcement_email(title, content, circle, emp_type, attachment_abs_path=None):
    """
    Announcement email: From ZEPTO_SENDER_EMAIL, To ZEPTO_CC_HR, CC filtered employees (+ HR in CC on first batch).
    Returns (success, message, recipient_count).
    """
    zepto_from = (current_app.config.get("ZEPTO_SENDER_EMAIL") or "").strip()
    hr_email = (current_app.config.get("ZEPTO_CC_HR") or "").strip().lower()
    if not zepto_from:
        return False, "ZEPTO_SENDER_EMAIL not configured", 0
    if not hr_email:
        return False, "ZEPTO_CC_HR not configured", 0

    employee_emails = news_feed_employee_emails(circle, emp_type)
    employee_emails = [e for e in employee_emails if e and e != hr_email]
    if not employee_emails:
        return False, "No employee email addresses found for the selected filters", 0

    subject = (title or "Announcement").strip()
    safe_content = html.escape((content or "").strip()).replace("\n", "<br>")
    sender_name = (current_app.config.get("ZEPTO_SENDER_NAME") or "HR Team").strip()
    body = f"""
    <p>Dear Team,</p>
    <div>{safe_content}</div>
    <br>
    <p>
        Regards,<br>
        <strong>HR Team</strong><br>
        {html.escape(sender_name)}
    </p>
    """

    attachment = _zeptomail_attachment_from_path(attachment_abs_path)
    attachments = [attachment] if attachment else None

    cc_all = list(dict.fromkeys(employee_emails))
    total_recipients = 1 + len(cc_all)

    chunks = [
        cc_all[i : i + ZEPTO_MAX_CC_PER_MESSAGE]
        for i in range(0, len(cc_all), ZEPTO_MAX_CC_PER_MESSAGE)
    ]
    if not chunks:
        chunks = [[]]

    for idx, cc_chunk in enumerate(chunks):
        ok, msg = send_email_via_zeptomail(
            sender_email=zepto_from,
            subject=subject,
            body=body,
            recipient_email=hr_email,
            cc_emails=cc_chunk,
            attachments=attachments if idx == 0 else None,
            from_name=sender_name,
        )
        if not ok:
            return False, msg, 0

    return True, "Email sent successfully", total_recipients


def send_it_assignment_notification(
    *,
    target_admin,
    actor_admin=None,
    assignment_kind,
    unit=None,
    license_obj=None,
    inventory_item=None,
    quantity=None,
):
    """
    Notify manager + employee + IT when IT assigns an asset.
    From: ZEPTO_SENDER_EMAIL
    TO: manager (first), fallback employee
    CC: remaining managers, IT actor, employee, IT mailbox (when configured)
    """
    try:
        if not target_admin or not target_admin.email:
            return False, "Target employee email unavailable"

        manager_contact = ManagerContact.query.filter_by(
            user_email=target_admin.email
        ).first()
        if not manager_contact:
            manager_contact = ManagerContact.query.filter_by(
                circle_name=target_admin.circle,
                user_type=target_admin.emp_type,
            ).first()

        manager_emails = get_manager_emails(
            manager_contact, exclude_email=target_admin.email
        ) if manager_contact else []

        to_email = (manager_emails[0] if manager_emails else (target_admin.email or "")).strip()
        if not to_email:
            return False, "No recipient email found"

        cc_emails = []
        for addr in manager_emails[1:]:
            if addr:
                cc_emails.append(addr.strip())

        if actor_admin and actor_admin.email:
            cc_emails.append(actor_admin.email.strip())
        if target_admin.email:
            cc_emails.append(target_admin.email.strip())

        it_mailbox = (
            current_app.config.get("ZEPTO_CC_IT") or current_app.config.get("EMAIL_IT") or ""
        ).strip()
        if it_mailbox:
            cc_emails.append(it_mailbox)

        zepto_from = (current_app.config.get("ZEPTO_SENDER_EMAIL") or "").strip()
        if not zepto_from:
            return False, "ZEPTO_SENDER_EMAIL not configured"

        seen = set()
        deduped_cc = []
        to_lower = to_email.lower()
        for email in cc_emails:
            if not email:
                continue
            addr = email.strip()
            key = addr.lower()
            if key and key != to_lower and key not in seen:
                seen.add(key)
                deduped_cc.append(addr)

        emp_name = (target_admin.first_name or target_admin.email or "Employee").strip()
        actor_name = (
            ((actor_admin.first_name or "").strip() if actor_admin else "")
            or (actor_admin.email if actor_admin else "")
            or "IT Team"
        )

        details_rows = []
        if assignment_kind == "unit" and unit is not None:
            details_rows.extend(
                [
                    ("Assignment Type", "Hardware Unit"),
                    ("Asset Name", unit.asset_name or "-"),
                    ("Brand / Model", f"{unit.brand or '-'} / {unit.model or '-'}"),
                    ("Serial Number", unit.serial_number or "-"),
                    ("Asset Tag", unit.asset_tag or "-"),
                ]
            )
        elif assignment_kind == "software" and license_obj is not None:
            details_rows.extend(
                [
                    ("Assignment Type", "Software License"),
                    ("Software Name", license_obj.name or "-"),
                    ("License Code", license_obj.license_code or "-"),
                    ("Subscription End", str(license_obj.subscription_end or "-")),
                ]
            )
        elif assignment_kind == "inventory_quantity" and inventory_item is not None:
            details_rows.extend(
                [
                    ("Assignment Type", "Accessories / Consumables"),
                    ("Item Name", inventory_item.name or "-"),
                    ("Category", inventory_item.category or "-"),
                    ("Quantity Assigned", str(int(quantity or 0))),
                ]
            )

        details_html = "".join(
            f"<tr><td><strong>{label}</strong></td><td>{value}</td></tr>"
            for label, value in details_rows
        )

        subject = f"IT Asset Assigned – {emp_name}"
        body = f"""
        <p>Hello,</p>
        <p>An IT asset has been assigned to <strong>{emp_name}</strong>.</p>
        <table border="1" cellpadding="6" cellspacing="0">
            <tr><td><strong>Employee Name</strong></td><td>{emp_name}</td></tr>
            <tr><td><strong>Employee ID</strong></td><td>{target_admin.emp_id or '-'}</td></tr>
            <tr><td><strong>Employee Email</strong></td><td>{target_admin.email or '-'}</td></tr>
            <tr><td><strong>Department</strong></td><td>{target_admin.emp_type or '-'}</td></tr>
            <tr><td><strong>Circle</strong></td><td>{target_admin.circle or '-'}</td></tr>
            <tr><td><strong>Assigned By (IT)</strong></td><td>{actor_name}</td></tr>
            {details_html}
            <tr><td><strong>Assigned At</strong></td><td>{format_ist_display()} IST</td></tr>
        </table>
        <p>Regards,<br><strong>IT Team</strong></p>
        """

        return send_email_via_zeptomail(
            sender_email=zepto_from,
            subject=subject,
            body=body,
            recipient_email=to_email,
            cc_emails=deduped_cc or None,
        )
    except Exception as e:
        current_app.logger.warning(f"IT assignment email failed: {e}")
        return False, str(e)


def send_it_return_request_email(*, requester_admin, reason, asset_label):
    """
    Notify IT + manager(s) + employee when employee raises return request.
    From: ZEPTO_SENDER_EMAIL
    TO: IT mailbox
    CC: managers + employee
    """
    try:
        if not requester_admin:
            return False, "Requester missing"
        it_email = (
            current_app.config.get("ZEPTO_CC_IT")
            or current_app.config.get("EMAIL_IT")
            or current_app.config.get("ZEPTO_SENDER_EMAIL")
        )
        if not it_email:
            return False, "IT mailbox not configured"

        zepto_from = (current_app.config.get("ZEPTO_SENDER_EMAIL") or "").strip()
        if not zepto_from:
            return False, "ZEPTO_SENDER_EMAIL not configured"

        manager_contact = ManagerContact.query.filter_by(user_email=requester_admin.email).first()
        if not manager_contact:
            manager_contact = ManagerContact.query.filter_by(
                circle_name=requester_admin.circle,
                user_type=requester_admin.emp_type,
            ).first()
        manager_emails = get_manager_emails(manager_contact, exclude_email=requester_admin.email) if manager_contact else []

        cc_emails = list(manager_emails)
        if requester_admin.email:
            cc_emails.append(requester_admin.email.strip())

        seen = set()
        deduped_cc = []
        for e in cc_emails:
            if not e:
                continue
            addr = e.strip()
            k = addr.lower()
            if k and k not in seen and k != it_email.strip().lower():
                seen.add(k)
                deduped_cc.append(addr)

        emp_name = (requester_admin.first_name or requester_admin.email or "Employee").strip()
        subject = f"Asset Return Request – {emp_name}"
        body = f"""
        <p>Hello IT Team,</p>
        <p>An employee has raised a return request.</p>
        <table border="1" cellpadding="6" cellspacing="0">
            <tr><td><strong>Employee Name</strong></td><td>{emp_name}</td></tr>
            <tr><td><strong>Employee ID</strong></td><td>{requester_admin.emp_id or '-'}</td></tr>
            <tr><td><strong>Employee Email</strong></td><td>{requester_admin.email or '-'}</td></tr>
            <tr><td><strong>Asset</strong></td><td>{asset_label or '-'}</td></tr>
            <tr><td><strong>Return Reason</strong></td><td>{reason or '-'}</td></tr>
            <tr><td><strong>Requested At</strong></td><td>{format_ist_display()} IST</td></tr>
        </table>
        <p>Please review and approve/reject from IT Management.</p>
        """
        return send_email_via_zeptomail(
            sender_email=zepto_from,
            subject=subject,
            body=body,
            recipient_email=it_email,
            cc_emails=deduped_cc or None,
        )
    except Exception as e:
        current_app.logger.warning(f"IT return request mail failed: {e}")
        return False, str(e)


def send_it_return_request_status_email(*, requester_admin, status, asset_label, acted_by=None, rejection_reason=None):
    """Notify employee on approve/reject/complete status update. From: ZEPTO_SENDER_EMAIL; CC IT when configured."""
    try:
        if not requester_admin or not requester_admin.email:
            return False, "Requester email missing"
        it_email = (
            current_app.config.get("ZEPTO_CC_IT")
            or current_app.config.get("EMAIL_IT")
            or current_app.config.get("ZEPTO_SENDER_EMAIL")
        )
        zepto_from = (current_app.config.get("ZEPTO_SENDER_EMAIL") or "").strip()
        if not zepto_from:
            return False, "ZEPTO_SENDER_EMAIL not configured"

        actor = (acted_by.first_name or acted_by.email) if acted_by else "IT Team"
        pretty = {"approved": "Approved", "rejected": "Rejected", "completed": "Completed"}.get(status, status.title())
        subject = f"Asset Return Request {pretty} – {asset_label or 'Asset'}"
        body = f"""
        <p>Hello {requester_admin.first_name or requester_admin.email},</p>
        <p>Your asset return request has been <strong>{pretty}</strong>.</p>
        <table border="1" cellpadding="6" cellspacing="0">
            <tr><td><strong>Asset</strong></td><td>{asset_label or '-'}</td></tr>
            <tr><td><strong>Status</strong></td><td>{pretty}</td></tr>
            <tr><td><strong>Processed By</strong></td><td>{actor}</td></tr>
            {f"<tr><td><strong>Rejection Reason</strong></td><td>{rejection_reason}</td></tr>" if rejection_reason else ""}
        </table>
        """
        return send_email_via_zeptomail(
            sender_email=zepto_from,
            subject=subject,
            body=body,
            recipient_email=requester_admin.email,
            cc_emails=[it_email] if it_email and it_email.strip().lower() != requester_admin.email.strip().lower() else None,
        )
    except Exception as e:
        current_app.logger.warning(f"IT return status mail failed: {e}")
        return False, str(e)


from datetime import datetime, timedelta
from .datetime_utils import format_ist_display, utc_now
import secrets
from flask import current_app



def send_login_alert_email(user):
    """
    Sends login notification email after successful authentication
    """

    subject = "New Login Detected"
    body = f"""
    <p>Dear {user.first_name},</p>

    <p>Your account was just logged in successfully.</p>

    <table border="1" cellpadding="6" cellspacing="0">
        <tr>
            <td><strong>Email</strong></td>
            <td>{user.email}</td>
        </tr>
        <tr>
            <td><strong>Login Time</strong></td>
            <td>{datetime.now().strftime('%d %b %Y, %I:%M %p')}</td>
        </tr>
    </table>

    <p>If this was not you, please contact IT support immediately.</p>

    <p>Regards,<br>
    <strong>HRMS Security Team</strong></p>
    """
    print(f"Preparing to send login alert email to {user.email}")
    return send_email_via_zeptomail(
        sender_email=current_app.config.get("ZEPTO_SENDER_EMAIL"),
        subject=subject,
        body=body,
        recipient_email=user.email
    )


def send_payslip_uploaded_email(admin, month, year):
    """
    Notify employee that payslip is uploaded in HRMS portal.
    Non-blocking helper; returns (success, message).
    """
    try:
        subject = f"Payslip Uploaded - {month} {year}"
        body = f"""
        <p>Dear {admin.first_name},</p>
        <p>Your payslip for <strong>{month} {year}</strong> has been uploaded.</p>
        <p>Please check it in the HRMS portal.</p>
        <p>Regards,<br><strong>Accounts Team</strong></p>
        """

        accounts_email = current_app.config.get("ZEPTO_CC_ACCOUNT") or current_app.config.get("EMAIL_ACCOUNTS")
        cc_emails = []
        if accounts_email and accounts_email.strip().lower() != (admin.email or "").strip().lower():
            cc_emails.append(accounts_email.strip())

        return send_email_via_zeptomail(
            sender_email=current_app.config.get("ZEPTO_SENDER_EMAIL"),
            subject=subject,
            body=body,
            recipient_email=admin.email,
            cc_emails=cc_emails or None
        )
    except Exception as e:
        current_app.logger.warning(f"Payslip email failed for {admin.email}: {e}")
        return False, str(e)


def send_form16_uploaded_email(admin, financial_year):
    """
    Notify employee that Form 16 is uploaded in HRMS portal.
    Non-blocking helper; returns (success, message).
    """
    try:
        subject = f"Form 16 Uploaded - {financial_year}"
        body = f"""
        <p>Dear {admin.first_name},</p>
        <p>Your Form 16 for <strong>{financial_year}</strong> has been uploaded.</p>
        <p>Please check it in the HRMS portal.</p>
        <p>Regards,<br><strong>Accounts Team</strong></p>
        """

        accounts_email = current_app.config.get("ZEPTO_CC_ACCOUNT") or current_app.config.get("EMAIL_ACCOUNTS")
        cc_emails = []
        if accounts_email and accounts_email.strip().lower() != (admin.email or "").strip().lower():
            cc_emails.append(accounts_email.strip())

        return send_email_via_zeptomail(
            sender_email=current_app.config.get("ZEPTO_SENDER_EMAIL"),
            subject=subject,
            body=body,
            recipient_email=admin.email,
            cc_emails=cc_emails or None
        )
    except Exception as e:
        current_app.logger.warning(f"Form16 email failed for {admin.email}: {e}")
        return False, str(e)


def get_department_email(department):
    department_map = {
        "Human Resource": current_app.config.get("EMAIL_HR"),
        "Accounts": current_app.config.get("EMAIL_ACCOUNTS"),
        "IT Department": current_app.config.get("EMAIL_IT"),
        "Administration": current_app.config.get("EMAIL_ADMIN"),
    }
    return department_map.get(department)


def send_query_closed_email(query_obj, closed_by_email, summary_text, attachments=None):
    recipient_email = get_department_email(query_obj.department)
    if not recipient_email:
        current_app.logger.warning(
            f"No department email configured for query close: {query_obj.department}"
        )
        return False, "No department email configured"

    subject = f"Query Closed: {query_obj.title}"
    attachments = attachments or []
    attachments_html = ""
    if attachments:
        attachments_html = "<ul>" + "".join([f"<li>{name}</li>" for name in attachments]) + "</ul>"

    body = f"""
    <p>Hello {query_obj.department} team,</p>
    <p>The following query has been closed:</p>
    <table border="1" cellpadding="6" cellspacing="0">
        <tr><td><strong>Query ID</strong></td><td>{query_obj.id}</td></tr>
        <tr><td><strong>Title</strong></td><td>{query_obj.title}</td></tr>
        <tr><td><strong>Employee</strong></td><td>{query_obj.admin.email}</td></tr>
        <tr><td><strong>Closed By</strong></td><td>{closed_by_email}</td></tr>
        <tr><td><strong>Summary</strong></td><td>{summary_text}</td></tr>
    </table>
    {attachments_html}
    """

    return send_email_via_zeptomail(
        sender_email=current_app.config.get("ZEPTO_SENDER_EMAIL"),
        subject=subject,
        body=body,
        recipient_email=recipient_email
    )

import requests
from flask import current_app


def Company_verify_oauth2_and_send_email(
    sender_email,
    subject,
    body,
    recipient_email,
    cc_emails=None
):
    """
    Send email using Zoho ZeptoMail API
    Returns: (success: bool, message: str)
    """

    try:
        url = "https://api.zeptomail.in/v1.1/email"

        headers = {
            "accept": "application/json",
            "content-type": "application/json",
            "authorization": current_app.config["ZEPTO_API_KEY"]
        }

        payload = {
            "from": {
                "address": sender_email
            },
            "to": [
                {
                    "email_address": {
                        "address": recipient_email
                    }
                }
            ],
            "subject": subject,
            "htmlbody": body
        }

        if cc_emails:
            payload["cc"] = [
                {"email_address": {"address": email}}
                for email in cc_emails
            ]

        response = requests.post(
            url,
            json=payload,
            headers=headers,
            timeout=10
        )

        if response.status_code in (200, 201):
            return True, "Email sent successfully"

        return False, f"Zoho email error: {response.text}"

    except Exception as e:
        return False, str(e)
    

def send_wfh_approval_email_to_managers(admin, wfh):
    """
    Sends WFH approval email.
    Rule:
    - HR always receives email
    - Managers are CC'd only if available
    - Never fail due to missing manager
    """

    try:
        cc_emails = []

        # -------------------------
        # HR is ALWAYS included
        # -------------------------
        hr_email = current_app.config.get("ZEPTO_CC_HR")
        if hr_email:
            cc_emails.append(hr_email)

        # -------------------------
        # Try finding manager mapping
        # -------------------------
        manager_contact = ManagerContact.query.filter_by(
            user_email=admin.email
        ).first()

        if not manager_contact:
            manager_contact = ManagerContact.query.filter_by(
                circle_name=admin.circle,
                user_type=admin.emp_type
            ).first()

        # -------------------------
        # Add managers IF found (exclude applicant to prevent self-approval)
        # -------------------------
        if manager_contact:
            for email in get_manager_emails(manager_contact, exclude_email=admin.email):
                cc_emails.append(email)
        else:
            # This warning is OK, but email still goes out
            current_app.logger.warning(
                f"No manager mapping found for WFH approval: {admin.email}"
            )

        # -------------------------
        # Email content
        # -------------------------
        subject = f"WFH Request Submitted – {admin.first_name}"

        body = f"""
        <p>Hello,</p>

        <p>
            <strong>{admin.first_name}</strong> has submitted a
            <strong>Work From Home (WFH)</strong> request.
        </p>

        <table cellpadding="8" cellspacing="0" border="1">
            <tr><td><strong>Employee</strong></td><td>{admin.first_name}</td></tr>
            <tr><td><strong>Email</strong></td><td>{admin.email}</td></tr>
            <tr><td><strong>Circle</strong></td><td>{admin.circle}</td></tr>
            <tr><td><strong>Department</strong></td><td>{admin.emp_type}</td></tr>
            <tr><td><strong>Start Date</strong></td>
                <td>{wfh.start_date.strftime('%d-%m-%Y')}</td></tr>
            <tr><td><strong>End Date</strong></td>
                <td>{wfh.end_date.strftime('%d-%m-%Y')}</td></tr>
            <tr><td><strong>Reason</strong></td>
                <td>{wfh.reason.replace(chr(40), '<br>')}</td></tr>
            <tr><td><strong>Status</strong></td>
                <td><strong>{wfh.status}</strong></td></tr>
        </table>

        <p>Please review the request in HRMS.</p>

        <br>
        <p>
            Regards,<br>
            <strong>HRMS System</strong>
        </p>
        """

        # -------------------------
        # Also CC the employee who submitted WFH
        # -------------------------
        if admin.email:
            emp_email = admin.email.strip()
            if emp_email:
                cc_emails.append(emp_email)

        # De-duplicate CC list and remove blanks
        seen = set()
        deduped_cc = []
        for e in cc_emails:
            if not e:
                continue
            addr = e.strip()
            key = addr.lower()
            if key and key not in seen:
                seen.add(key)
                deduped_cc.append(addr)
        cc_emails = deduped_cc

        # -------------------------
        # Send email (TO HR, CC managers + employee)
        # -------------------------
        send_email_via_zeptomail(
            sender_email=current_app.config["ZEPTO_SENDER_EMAIL"],
            subject=subject,
            body=body,
            recipient_email=hr_email,
            cc_emails=cc_emails or None
        )

        return True

    except Exception as e:
        current_app.logger.error(
            f"WFH approval email failed for {admin.email}: {e}"
        )
        return False


def send_wfh_decision_email(wfh_obj, approver, action: str):
    """
    Notify employee + HR (+ managers if mapped) when a WFH request is approved/rejected.
    """
    try:
        admin = wfh_obj.admin
        if not admin:
            return False

        to_email = (admin.email or "").strip()
        if not to_email:
            return False

        hr_email = current_app.config.get("ZEPTO_CC_HR")
        cc_emails = []

        # HR always in CC (if configured and not same as TO)
        if hr_email and hr_email.strip().lower() != to_email.lower():
            cc_emails.append(hr_email.strip())

        # Manager mapping (optional)
        manager_contact = ManagerContact.query.filter_by(
            user_email=admin.email
        ).first()
        if not manager_contact:
            manager_contact = ManagerContact.query.filter_by(
                circle_name=admin.circle,
                user_type=admin.emp_type
            ).first()

        if manager_contact:
            for addr in get_manager_emails(manager_contact, exclude_email=to_email):
                if addr and addr.lower() != to_email.lower():
                    cc_emails.append(addr)

        # De-duplicate CCs
        seen = set()
        deduped_cc = []
        for e in cc_emails:
            if not e:
                continue
            addr = e.strip()
            key = addr.lower()
            if key and key not in seen:
                seen.add(key)
                deduped_cc.append(addr)

        status_text = "approved" if action == "approve" else "rejected"
        subject = f"WFH Request {status_text.capitalize()}"

        body = f"""
        <p>Hello {admin.first_name or admin.email},</p>

        <p>Your Work From Home (WFH) request has been <strong>{status_text}</strong> by {approver.first_name or approver.email}.</p>

        <table border="1" cellpadding="6" cellspacing="0">
            <tr><td><strong>Employee</strong></td><td>{admin.first_name} ({admin.email})</td></tr>
            <tr><td><strong>Circle</strong></td><td>{admin.circle}</td></tr>
            <tr><td><strong>Department</strong></td><td>{admin.emp_type}</td></tr>
            <tr><td><strong>Start Date</strong></td><td>{wfh_obj.start_date}</td></tr>
            <tr><td><strong>End Date</strong></td><td>{wfh_obj.end_date}</td></tr>
            <tr><td><strong>Reason</strong></td><td>{wfh_obj.reason}</td></tr>
            <tr><td><strong>Status</strong></td><td>{wfh_obj.status}</td></tr>
        </table>

        <p>Please log in to the HRMS portal if you need more details.</p>
        """

        send_email_via_zeptomail(
            sender_email=current_app.config["ZEPTO_SENDER_EMAIL"],
            subject=subject,
            body=body,
            recipient_email=to_email,
            cc_emails=deduped_cc or None,
        )
        return True

    except Exception as e:
        current_app.logger.warning(
            f"WFH decision email failed for wfh_id={getattr(wfh_obj, 'id', None)}: {e}"
        )
        return False


def send_performance_submitted_email(perf_row):
    """
    Notify manager(s) + HR + employee when a self-performance review is submitted.
    """
    try:
        admin = perf_row.admin
        if not admin:
            return False

        # Base recipients
        hr_email = current_app.config.get("ZEPTO_CC_HR")
        to_email = None
        cc_emails = []

        # Manager mapping: prefer employee-specific, then group
        manager_contact = ManagerContact.query.filter_by(
            user_email=admin.email
        ).first()
        if not manager_contact:
            manager_contact = ManagerContact.query.filter_by(
                circle_name=admin.circle,
                user_type=admin.emp_type
            ).first()

        if manager_contact:
            manager_emails = get_manager_emails(manager_contact, exclude_email=admin.email)
            if manager_emails:
                to_email = manager_emails[0]
                for addr in manager_emails[1:]:
                    if addr and addr.lower() != (to_email or "").lower():
                        cc_emails.append(addr)

        # Fallbacks: if no manager, send to HR or employee
        if not to_email:
            if hr_email:
                to_email = hr_email.strip()
            elif admin.email:
                to_email = admin.email.strip()

        if not to_email:
            return False

        # HR in CC if not already TO
        if hr_email and hr_email.strip().lower() != to_email.lower():
            cc_emails.append(hr_email.strip())

        # Always CC employee if not TO
        if admin.email:
            emp_email = admin.email.strip()
            if emp_email and emp_email.lower() != to_email.lower():
                cc_emails.append(emp_email)

        # De-duplicate CCs
        seen = set()
        deduped_cc = []
        for e in cc_emails:
            if not e:
                continue
            addr = e.strip()
            key = addr.lower()
            if key and key not in seen:
                seen.add(key)
                deduped_cc.append(addr)

        month = perf_row.month or ""
        status_text = perf_row.status or "Submitted"
        subject = f"Performance Review Submitted – {admin.first_name or admin.email} ({month})"

        # Shorten achievements text for email
        achievements = (perf_row.achievements or "").strip()
        short_ach = " ".join(achievements.split()[:40]) + ("..." if len(achievements.split()) > 40 else "")

        body = f"""
        <p>Hello,</p>

        <p><strong>{admin.first_name or admin.email}</strong> has submitted a self-performance review for <strong>{month}</strong>.</p>

        <table border="1" cellpadding="6" cellspacing="0">
            <tr><td><strong>Employee</strong></td><td>{admin.first_name} ({admin.email})</td></tr>
            <tr><td><strong>Circle</strong></td><td>{admin.circle}</td></tr>
            <tr><td><strong>Department</strong></td><td>{admin.emp_type}</td></tr>
            <tr><td><strong>Month</strong></td><td>{month}</td></tr>
            <tr><td><strong>Status</strong></td><td>{status_text}</td></tr>
        </table>

        <p><strong>Achievements (preview):</strong></p>
        <p>{short_ach or 'N/A'}</p>

        <p>Please log in to the HRMS portal to view the full review and add your feedback.</p>
        """

        send_email_via_zeptomail(
            sender_email=current_app.config["ZEPTO_SENDER_EMAIL"],
            subject=subject,
            body=body,
            recipient_email=to_email,
            cc_emails=deduped_cc or None,
        )
        return True

    except Exception as e:
        current_app.logger.warning(
            f"Performance submitted email failed for perf_id={getattr(perf_row, 'id', None)}: {e}"
        )
        return False


def send_performance_reviewed_email(perf_row, manager_admin, rating: str, comments: str):
    """
    Notify employee + HR (+ manager/other managers) when a performance review is completed.
    """
    try:
        admin = perf_row.admin
        if not admin:
            return False

        to_email = (admin.email or "").strip()
        if not to_email:
            return False

        hr_email = current_app.config.get("ZEPTO_CC_HR")
        cc_emails = []

        # HR in CC if not TO
        if hr_email and hr_email.strip().lower() != to_email.lower():
            cc_emails.append(hr_email.strip())

        # Reviewing manager in CC (if not TO)
        if manager_admin and manager_admin.email:
            mgr_email = manager_admin.email.strip()
            if mgr_email and mgr_email.lower() != to_email.lower():
                cc_emails.append(mgr_email)

        # Optional: other mapped managers (L2/L3)
        manager_contact = ManagerContact.query.filter_by(
            user_email=admin.email
        ).first()
        if not manager_contact:
            manager_contact = ManagerContact.query.filter_by(
                circle_name=admin.circle,
                user_type=admin.emp_type
            ).first()

        if manager_contact:
            for addr in get_manager_emails(manager_contact, exclude_email=admin.email):
                if addr and addr.lower() not in {to_email.lower()}:
                    cc_emails.append(addr)

        # De-duplicate CCs
        seen = set()
        deduped_cc = []
        for e in cc_emails:
            if not e:
                continue
            addr = e.strip()
            key = addr.lower()
            if key and key not in seen:
                seen.add(key)
                deduped_cc.append(addr)

        month = perf_row.month or ""
        subject = f"Performance Review Completed – {month}"

        body = f"""
        <p>Hello {admin.first_name or admin.email},</p>

        <p>Your performance review for <strong>{month}</strong> has been completed by {manager_admin.first_name or manager_admin.email}.</p>

        <table border="1" cellpadding="6" cellspacing="0">
            <tr><td><strong>Employee</strong></td><td>{admin.first_name} ({admin.email})</td></tr>
            <tr><td><strong>Circle</strong></td><td>{admin.circle}</td></tr>
            <tr><td><strong>Department</strong></td><td>{admin.emp_type}</td></tr>
            <tr><td><strong>Rating</strong></td><td>{rating}</td></tr>
        </table>

        <p><strong>Manager Comments:</strong></p>
        <p>{(comments or '').strip() or 'N/A'}</p>

        <p>Please log in to the HRMS portal to view your full performance review details.</p>
        """

        send_email_via_zeptomail(
            sender_email=current_app.config["ZEPTO_SENDER_EMAIL"],
            subject=subject,
            body=body,
            recipient_email=to_email,
            cc_emails=deduped_cc or None,
        )
        return True

    except Exception as e:
        current_app.logger.warning(
            f"Performance reviewed email failed for perf_id={getattr(perf_row, 'id', None)}: {e}"
        )
        return False


def send_claim_submission_email(header):
    """
    Sends expense claim submission email using ManagerContact & ZeptoMail
    """

    try:
        admin = Admin.query.get(header.admin_id)
        if not admin:
            return False, "Admin not found for expense claim"

        subject = f"Expense Claim Submitted: {admin.first_name} ({admin.emp_id})"

        # -------------------------
        # Expense line items
        # -------------------------
        items = ExpenseLineItem.query.filter_by(
            claim_id=header.id
        ).all()

        line_items_html = ""
        for item in items:
            static_fn = claim_attach_static_filename(item.Attach_file)
            file_link = (
                f'<a href="{url_for("static", filename=static_fn, _external=True)}" '
                f'style="color:#007bff;" target="_blank">Download File</a>'
                if static_fn else "No attachment"
            )

            line_items_html += f"""
                <p>
                    <strong>{item.sr_no}.</strong>
                    {item.date.strftime('%Y-%m-%d')} |
                    {item.purpose} |
                    {item.amount} {item.currency} |
                    {file_link} |
                    Status: {item.status}
                </p>
                <hr>
            """

        body = f"""
        <html>
        <body style="font-family: Arial, sans-serif;">

            <p><strong>An expense claim has been submitted.</strong></p>

            <table border="1" cellpadding="8" cellspacing="0" width="100%">
                <tr><td><strong>Employee</strong></td><td>{admin.first_name}</td></tr>
                <tr><td><strong>Employee ID</strong></td><td>{admin.emp_id}</td></tr>
                <tr><td><strong>Designation</strong></td><td>{header.designation}</td></tr>
                <tr><td><strong>Project</strong></td><td>{header.project_name}</td></tr>
                <tr><td><strong>Country / State</strong></td><td>{header.country_state}</td></tr>
                <tr>
                    <td><strong>Travel Dates</strong></td>
                    <td>{header.travel_from_date} to {header.travel_to_date}</td>
                </tr>
            </table>

            <br>
            <p><strong>Expense Details:</strong></p>
            {line_items_html}

        </body>
        </html>
        """

        # -------------------------
        # Manager lookup (ManagerContact)
        # -------------------------
        manager_contact = ManagerContact.query.filter_by(
            user_email=admin.email
        ).first()

        if not manager_contact:
            manager_contact = ManagerContact.query.filter_by(
                circle_name=admin.circle,
                user_type=admin.emp_type
            ).first()

        cc_emails = []
        if manager_contact:
            for email in get_manager_emails(manager_contact, exclude_email=admin.email):
                cc_emails.append(email)

        # Always CC HR if configured
        hr_email = current_app.config.get("ZEPTO_CC_HR")
        if hr_email:
            cc_emails.append(hr_email)

        # -------------------------
        # Accounts is primary recipient
        # -------------------------
        recipient_email = current_app.config.get(
            "ZEPTO_CC_ACCOUNT",
            "accounts@saffotech.com"
        )

        send_email_via_zeptomail(
            sender_email=current_app.config["ZEPTO_SENDER_EMAIL"],
            subject=subject,
            body=body,
            recipient_email=recipient_email,
            cc_emails=cc_emails or None
        )

        return True

    except Exception as e:
        current_app.logger.error(f"Claim Email Error: {e}")
        return False


def send_claim_line_item_decision_email(
    *,
    line_item,
    claim_header,
    employee,
    approver,
    action,
    rejection_reason=None,
):
    """Notify employee and manager when Accounts approves/rejects a claim line item."""
    try:
        if not employee:
            return False

        to_email = (employee.email or claim_header.email or "").strip()
        if not to_email:
            return False

        hr_email = current_app.config.get("ZEPTO_CC_HR")
        cc_emails = []
        if hr_email and hr_email.strip().lower() != to_email.lower():
            cc_emails.append(hr_email.strip())

        manager_contact = ManagerContact.query.filter_by(user_email=employee.email).first()
        if not manager_contact:
            manager_contact = ManagerContact.query.filter_by(
                circle_name=employee.circle,
                user_type=employee.emp_type,
            ).first()

        if manager_contact:
            for addr in get_manager_emails(manager_contact, exclude_email=to_email):
                if addr and addr.lower() != to_email.lower():
                    cc_emails.append(addr)

        seen = set()
        deduped_cc = []
        for e in cc_emails:
            if not e:
                continue
            addr = e.strip()
            key = addr.lower()
            if key and key not in seen:
                seen.add(key)
                deduped_cc.append(addr)

        status_text = "approved" if action == "approve" else "rejected"
        approver_name = html.escape((approver.first_name or approver.email or "Accounts").strip())
        emp_name = html.escape((employee.first_name or employee.email or "").strip())
        purpose = html.escape(line_item.purpose or "")
        project = html.escape(claim_header.project_name or "")
        country_state = html.escape(claim_header.country_state or "")
        reason_block = ""
        if action == "reject" and rejection_reason:
            reason_block = f"""
            <tr><td><strong>Rejection Reason</strong></td>
            <td>{html.escape(rejection_reason.strip())}</td></tr>
            """

        static_fn = claim_attach_static_filename(line_item.Attach_file)
        file_link = (
            f'<a href="{url_for("static", filename=static_fn, _external=True)}" '
            f'style="color:#007bff;" target="_blank">Download attachment</a>'
            if static_fn
            else "No attachment"
        )

        subject = (
            f"Expense Claim Item {status_text.capitalize()}: "
            f"{employee.first_name or employee.emp_id} – Item #{line_item.sr_no}"
        )

        body = f"""
        <html>
        <body style="font-family: Arial, sans-serif;">
            <p>Hello {emp_name},</p>
            <p>Your expense claim line item has been <strong>{status_text}</strong> by Accounts ({approver_name}).</p>

            <table border="1" cellpadding="8" cellspacing="0" width="100%">
                <tr><td><strong>Employee</strong></td><td>{emp_name} ({html.escape(employee.emp_id or "")})</td></tr>
                <tr><td><strong>Project</strong></td><td>{project}</td></tr>
                <tr><td><strong>Country / State</strong></td><td>{country_state}</td></tr>
                <tr>
                    <td><strong>Travel Dates</strong></td>
                    <td>{claim_header.travel_from_date} to {claim_header.travel_to_date}</td>
                </tr>
            </table>

            <br>
            <p><strong>Expense line item:</strong></p>
            <table border="1" cellpadding="8" cellspacing="0" width="100%">
                <tr><td><strong>Sr. No.</strong></td><td>{line_item.sr_no}</td></tr>
                <tr><td><strong>Date</strong></td><td>{line_item.date}</td></tr>
                <tr><td><strong>Purpose</strong></td><td>{purpose}</td></tr>
                <tr><td><strong>Amount</strong></td><td>{line_item.amount} {line_item.currency}</td></tr>
                <tr><td><strong>Status</strong></td><td>{line_item.status}</td></tr>
                <tr><td><strong>Attachment</strong></td><td>{file_link}</td></tr>
                {reason_block}
            </table>

            <p>Please log in to the HRMS portal for more details.</p>
        </body>
        </html>
        """

        send_email_via_zeptomail(
            sender_email=current_app.config["ZEPTO_SENDER_EMAIL"],
            subject=subject,
            body=body,
            recipient_email=to_email,
            cc_emails=deduped_cc or None,
        )
        return True
    except Exception as e:
        current_app.logger.warning(
            "Claim line item decision email failed (line_item_id=%s): %s",
            getattr(line_item, "id", None),
            e,
        )
        return False



def asset_email(sender_email, recipient_email, first_name):
    """sender_email argument is ignored; Zepto From is always ZEPTO_SENDER_EMAIL."""
    from_addr = (current_app.config.get("ZEPTO_SENDER_EMAIL") or "").strip()
    if not from_addr:
        return False
    subject = "New Asset Assigned to You"
    body = f"""
    <p>Dear {first_name},</p>
    <p>This is to inform you that a new asset has been assigned to you.</p>
    <p>Thanks,<br><strong>Accounts Team</strong></p>
    """

    success, message = Company_verify_oauth2_and_send_email(
        sender_email=from_addr,
        subject=subject,
        body=body,
        recipient_email=recipient_email
    )

    return success


def update_asset_email(sender_email, recipient_email, first_name):
    """sender_email argument is ignored; Zepto From is always ZEPTO_SENDER_EMAIL."""
    from_addr = (current_app.config.get("ZEPTO_SENDER_EMAIL") or "").strip()
    if not from_addr:
        return False
    subject = "Your Asset Has Been Updated"
    body = f"""
    <p>Dear {first_name},</p>
    <p>This is to inform you that your assigned asset has been updated.</p>
    <p>Thanks,<br><strong>Accounts Team</strong></p>
    """

    success, message = Company_verify_oauth2_and_send_email(
        sender_email=from_addr,
        subject=subject,
        body=body,
        recipient_email=recipient_email
    )

    return success




def send_welcome_email(admin,data):
    """
    Sends welcome email to newly created employee.
    This function should NEVER raise an exception to caller.
    """
    

    try:
        subject = "Welcome to Saffo HRMS 🎉"

        body = f"""
        <p>Hi <strong>{admin.first_name}</strong>,</p>

        <p>Welcome to <strong>Saffo HRMS</strong>!</p>

        <p>Your employee account has been created successfully.</p>

        <table cellpadding="6" cellspacing="0" border="1">
            <tr><td><strong>Employee ID</strong></td><td>{admin.emp_id}</td></tr>
            <tr><td><strong>Email</strong></td><td>{admin.email}</td></tr>
            <tr><td><strong>Password</strong></td><td>{data.get("password") or "You will receive a separate email to set your password."}</td></tr>
            <tr><td><strong>Department</strong></td><td>{admin.emp_type}</td></tr>
            <tr><td><strong>Circle</strong></td><td>{admin.circle}</td></tr>
            <tr><td><strong>Date of Joining</strong></td><td>{admin.doj}</td></tr>
        </table>

        <p>
            🔗 <strong>HRMS Portal:</strong>
            <a href="{current_app.config.get('BASE_URL', 'https://solviotec.com/')}" target="_blank">
                {current_app.config.get('BASE_URL', 'https://solviotec.com/')}
            </a>
        </p>

        <p>You can now log in to the HRMS portal and start using the system.</p>

        <p>If you face any issues, please contact HR.</p>

        <br>
        <p>
            Regards,<br>
            <strong>HR Team</strong><br>
            Saffo Technologies
        </p>
        """

        # ✅ SAFE env access
        cc_hr = current_app.config.get("ZEPTO_CC_HR")

        # ✅ Normalize to list (important)
        cc_emails = [cc_hr] if cc_hr else None
        
        send_email_via_zeptomail(
            sender_email=current_app.config["ZEPTO_SENDER_EMAIL"],
            subject=subject,
            body=body,
            recipient_email=admin.email,
            cc_emails=cc_emails
        )

        return True

    except Exception as e:
        current_app.logger.warning(
            f"Welcome email failed for {admin.email}: {e}"
        )
        return False




def send_asset_assigned_email(admin, asset):
    try:
        image_links = ""
        if asset.image_files:
            for img in asset.image_files.split(","):
                image_links += f"""
                <li>
                    <a href="{current_app.config['BASE_URL']}/static/uploads/{img}" target="_blank">
                        View Asset Image
                    </a>
                </li>
                """

        subject = "Asset Assigned – Saffo HRMS 🧾"

        body = f"""
        <p>Hi <strong>{admin.first_name}</strong>,</p>

        <p>The following asset has been assigned to you:</p>

        <table cellpadding="6" cellspacing="0" border="1">
            <tr><td><strong>Asset Name</strong></td><td>{asset.name}</td></tr>
            <tr><td><strong>Description</strong></td><td>{asset.description or '-'}</td></tr>
            <tr><td><strong>Issue Date</strong></td><td>{asset.issue_date}</td></tr>
            <tr><td><strong>Remark</strong></td><td>{asset.remark or '-'}</td></tr>
        </table>

        <p><strong>Asset Images:</strong></p>
        <ul>
            {image_links or "<li>No images uploaded</li>"}
        </ul>

        <br>
        <p>
            Regards,<br>
            <strong>HR Team</strong><br>
            Saffo Technologies
        </p>
        """

        send_email_via_zeptomail(
            sender_email=current_app.config["ZEPTO_SENDER_EMAIL"],
            subject=subject,
            body=body,
            recipient_email=admin.email,
            cc_emails=[current_app.config.get("ZEPTO_CC_HR")]
        )

    except Exception as e:
        current_app.logger.warning(
            f"Asset email failed for {admin.email}: {e}"
        )



def send_resignation_email(admin, resignation):
    """
    Sends resignation submission email using ManagerContact
    """

    try:
        # -------------------------
        # Manager lookup
        # -------------------------
        manager_contact = ManagerContact.query.filter_by(
            user_email=admin.email
        ).first()

        if not manager_contact:
            manager_contact = ManagerContact.query.filter_by(
                circle_name=admin.circle,
                user_type=admin.emp_type
            ).first()

        if not manager_contact:
            current_app.logger.warning(
                f"No manager mapping for resignation: {admin.email}"
            )
            return False, "Manager not configured"

        # -------------------------
        # Decide TO / CC (first manager as TO, rest as CC)
        # -------------------------
        manager_emails = get_manager_emails(manager_contact)
        if not manager_emails:
            return False, "No valid manager email found"
        to_email = manager_emails[0]
        cc_emails = list(manager_emails[1:])

        hr_email = current_app.config.get("ZEPTO_CC_HR")
        if hr_email:
            cc_emails.append(hr_email)

        # -------------------------
        # Email content
        # -------------------------
        subject = f"Resignation Submitted – {admin.first_name} ({admin.emp_id})"

        body = f"""
        <p>Hi,</p>

        <p>
            <strong>{admin.first_name}</strong> has submitted a
            <strong>Resignation</strong>.
        </p>

        <table cellpadding="8" cellspacing="0" border="1">
            <tr>
                <td><strong>Employee Name</strong></td>
                <td>{admin.first_name}</td>
            </tr>
            <tr>
                <td><strong>Employee ID</strong></td>
                <td>{admin.emp_id}</td>
            </tr>
            <tr>
                <td><strong>Circle</strong></td>
                <td>{admin.circle}</td>
            </tr>
            <tr>
                <td><strong>Department</strong></td>
                <td>{admin.emp_type}</td>
            </tr>
            <tr>
                <td><strong>Resignation Date</strong></td>
                <td>{resignation.resignation_date.strftime('%d-%m-%Y')}</td>
            </tr>
            <tr>
                <td><strong>Reason</strong></td>
                <td>{resignation.reason.replace(chr(10), '<br>')}</td>
            </tr>
        </table>

        <p>Please review and initiate separation formalities.</p>

        <br>
        <p>
            Regards,<br>
            <strong>HRMS System</strong>
        </p>
        """

        send_email_via_zeptomail(
            sender_email=current_app.config["ZEPTO_SENDER_EMAIL"],
            subject=subject,
            body=body,
            recipient_email=to_email,
            cc_emails=cc_emails or None
        )

        return True, "Email sent"

    except Exception as e:
        current_app.logger.error(f"Resignation Email Error: {e}")
        return False, str(e)


def send_noc_request_email(admin, resignation, noc_date, department_names, recipient_emails):
    """
    Notify selected departments to provide NOC for a separating employee.

    TO: first resolved recipient.
    CC: all other resolved recipients, HR CC config (if set), and the employee requester.
    """
    try:
        if not recipient_emails:
            return False, "No recipient emails resolved"

        to_email = (recipient_emails[0] or "").strip()
        if not to_email:
            return False, "Invalid recipient email"

        cc_set = []
        seen = {to_email.lower()}
        for addr in recipient_emails[1:]:
            a = (addr or "").strip()
            if a and a.lower() not in seen:
                seen.add(a.lower())
                cc_set.append(a)

        hr_cc = current_app.config.get("ZEPTO_CC_HR")
        if hr_cc and hr_cc.strip().lower() not in seen:
            cc_set.append(hr_cc.strip())
            seen.add(hr_cc.strip().lower())

        emp = (admin.email or "").strip()
        if emp and emp.lower() not in seen:
            cc_set.append(emp)

        noc_str = noc_date.strftime("%d-%m-%Y") if hasattr(noc_date, "strftime") else str(noc_date)
        res_date = resignation.resignation_date.strftime("%d-%m-%Y") if resignation.resignation_date else "—"
        dept_items = "".join(f"<li>{html.escape(str(d))}</li>" for d in (department_names or []))
        reason_html = html.escape(resignation.reason or "").replace("\n", "<br>")

        subject = f"NOC Request – {admin.first_name or 'Employee'} ({admin.emp_id or admin.id})"

        body = f"""
        <p>Hi,</p>

        <p>
            <strong>{html.escape(admin.first_name or '')}</strong>
            (Emp ID: <strong>{html.escape(str(admin.emp_id or ''))}</strong>,
            Email: <strong>{html.escape(admin.email or '')}</strong>)
            has requested a <strong>No Objection Certificate (NOC)</strong> as part of separation.
        </p>

        <p><strong>NOC Date requested:</strong> {html.escape(noc_str)}</p>

        <p><strong>Departments selected for NOC:</strong></p>
        <ul>{dept_items}</ul>

        <p><strong>Separation details</strong></p>
        <table cellpadding="8" cellspacing="0" border="1">
            <tr><td><strong>Resignation date</strong></td><td>{html.escape(res_date)}</td></tr>
            <tr><td><strong>Reason</strong></td><td>{reason_html}</td></tr>
            <tr><td><strong>Circle</strong></td><td>{html.escape(admin.circle or '')}</td></tr>
            <tr><td><strong>Department</strong></td><td>{html.escape(admin.emp_type or '')}</td></tr>
        </table>

        <p>Please review and provide NOC clearance as applicable.</p>

        <br>
        <p>Regards,<br><strong>HRMS System</strong></p>
        """

        ok, msg = send_email_via_zeptomail(
            sender_email=current_app.config["ZEPTO_SENDER_EMAIL"],
            subject=subject,
            body=body,
            recipient_email=to_email,
            cc_emails=cc_set or None,
        )
        return ok, msg

    except Exception as e:
        current_app.logger.error(f"NOC request email error: {e}")
        return False, str(e)


def send_resignation_revoked_email(admin, resignation):
    """
    Notify manager(s) and HR that an employee has revoked their resignation.
    Mirrors the routing logic of send_resignation_email.
    """

    try:
        manager_contact = ManagerContact.query.filter_by(
            user_email=admin.email
        ).first()

        if not manager_contact:
            manager_contact = ManagerContact.query.filter_by(
                circle_name=admin.circle,
                user_type=admin.emp_type
            ).first()

        if not manager_contact:
            current_app.logger.warning(
                f"No manager mapping for resignation revoke: {admin.email}"
            )
            return False, "Manager not configured"

        manager_emails = get_manager_emails(manager_contact)
        if not manager_emails:
            return False, "No valid manager email found"
        to_email = manager_emails[0]
        cc_emails = list(manager_emails[1:])

        hr_email = current_app.config.get("ZEPTO_CC_HR")
        if hr_email:
            cc_emails.append(hr_email)

        subject = f"Resignation Revoked – {admin.first_name} ({admin.emp_id})"

        body = f"""
        <p>Hi,</p>

        <p>
            <strong>{admin.first_name}</strong> has <strong>revoked</strong> their resignation.
        </p>

        <table cellpadding="8" cellspacing="0" border="1">
            <tr>
                <td><strong>Employee Name</strong></td>
                <td>{admin.first_name}</td>
            </tr>
            <tr>
                <td><strong>Employee ID</strong></td>
                <td>{admin.emp_id}</td>
            </tr>
            <tr>
                <td><strong>Circle</strong></td>
                <td>{admin.circle}</td>
            </tr>
            <tr>
                <td><strong>Department</strong></td>
                <td>{admin.emp_type}</td>
            </tr>
            <tr>
                <td><strong>Original Resignation Date</strong></td>
                <td>{resignation.resignation_date.strftime('%d-%m-%Y') if resignation.resignation_date else 'N/A'}</td>
            </tr>
            <tr>
                <td><strong>Current Status</strong></td>
                <td>{resignation.status}</td>
            </tr>
        </table>

        <p>Please update any pending separation actions accordingly.</p>

        <br>
        <p>
            Regards,<br>
            <strong>HRMS System</strong>
        </p>
        """

        send_email_via_zeptomail(
            sender_email=current_app.config["ZEPTO_SENDER_EMAIL"],
            subject=subject,
            body=body,
            recipient_email=to_email,
            cc_emails=cc_emails or None
        )

        return True, "Email sent"

    except Exception as e:
        current_app.logger.error(f"Resignation Revoke Email Error: {e}")
        return False, str(e)


#qurery realted email functions can be added here




from .models.query import Query





def _notify_query_created(query: Query):
    admin = query.admin

    subject = f"New Query Raised – {query.title}"

    body = f"""
    <p>A new query has been raised.</p>

    <table border="1" cellpadding="6">
        <tr><td><strong>Employee</strong></td><td>{admin.first_name}</td></tr>
        <tr><td><strong>Email</strong></td><td>{admin.email}</td></tr>
        <tr><td><strong>Department</strong></td><td>{query.department}</td></tr>
        <tr><td><strong>Title</strong></td><td>{query.title}</td></tr>
        <tr><td><strong>Message</strong></td><td>{query.query_text}</td></tr>
        <tr><td><strong>Status</strong></td><td>{query.status}</td></tr>
    </table>

    <p>Please log in to HRMS to respond.</p>
    """

    # Route to department
    if query.department == "Human Resource":
        to_email = current_app.config.get("ZEPTO_CC_HR")
    else:
        to_email = current_app.config.get("ZEPTO_CC_ACCOUNT")

    # CC employee who raised the query (if email present)
    cc_emails = []
    if admin.email:
        addr = admin.email.strip()
        if addr:
            cc_emails.append(addr)

    send_email_via_zeptomail(
        sender_email=current_app.config["ZEPTO_SENDER_EMAIL"],
        subject=subject,
        body=body,
        recipient_email=to_email,
        cc_emails=cc_emails or None
    )




def _notify_query_closed(query):
    """
    Sends query closure email with FULL chat history
    """

    admin = query.admin  # employee who raised the query

    # -------------------------
    # Build chat history
    # -------------------------
    chat_html = ""
    for reply in query.replies:
        sender = reply.admin.first_name if reply.admin else "System"
        role = reply.user_type
        time = reply.created_at.strftime("%d-%m-%Y %H:%M")

        chat_html += f"""
        <tr>
            <td>{time}</td>
            <td>{sender} ({role})</td>
            <td>{reply.reply_text}</td>
        </tr>
        """

    if not chat_html:
        chat_html = """
        <tr>
            <td colspan="3">No replies were added.</td>
        </tr>
        """

    # -------------------------
    # Email body
    # -------------------------
    body = f"""
    <p><strong>The following query has been resolved and closed.</strong></p>

    <table border="1" cellpadding="6" cellspacing="0" width="100%">
        <tr><td><strong>Query Title</strong></td><td>{query.title}</td></tr>
        <tr><td><strong>Department</strong></td><td>{query.department}</td></tr>
        <tr><td><strong>Employee</strong></td><td>{admin.first_name} ({admin.email})</td></tr>
        <tr><td><strong>Status</strong></td><td>Closed</td></tr>
    </table>

    <br>
    <p><strong>Chat History</strong></p>

    <table border="1" cellpadding="6" cellspacing="0" width="100%">
        <tr>
            <th>Date & Time</th>
            <th>Sender</th>
            <th>Message</th>
        </tr>
        {chat_html}
    </table>

    <br>
    <p>This query is now officially closed.</p>
    """

    # -------------------------
    # Decide recipient
    # -------------------------
    if query.department == "Human Resource":
        to_email = current_app.config.get("ZEPTO_CC_HR")
    else:
        to_email = current_app.config.get("ZEPTO_CC_ACCOUNT")

    # CC employee (recommended)
    cc_emails = [admin.email]

    # -------------------------
    # Send email
    # -------------------------
    send_email_via_zeptomail(
        sender_email=current_app.config["ZEPTO_SENDER_EMAIL"],
        subject=f"Query Closed – {query.title}",
        body=body,
        recipient_email=to_email,
        cc_emails=cc_emails
    )




def notify_query_event(query: Query, action: str, reply_text=None):
    """
    Central notification handler for query events.

    action:
    - created
    - replied
    - closed
    """

    try:
        if action == "created":
            _notify_query_created(query)

        elif action == "closed":
            _notify_query_closed(query)

    except Exception as e:
        # NEVER break API flow
        current_app.logger.warning(
            f"Query notification failed (action={action}, query_id={query.id}): {e}"
        )




def send_leave_applied_email(admin, leave):
    """
    Sends leave application email to HR / Manager
    Includes deducted days and unpaid (extra) days
    NON-BLOCKING
    """

    try:
        # -------------------------
        # HR (always)
        # -------------------------
        hr_email = current_app.config.get("ZEPTO_CC_HR")
        cc_emails = []

        # -------------------------
        # Manager lookup (optional)
        # -------------------------
        manager_contact = ManagerContact.query.filter_by(
            user_email=admin.email
        ).first()

        if not manager_contact:
            manager_contact = ManagerContact.query.filter_by(
                circle_name=admin.circle,
                user_type=admin.emp_type
            ).first()

        if manager_contact:
            for addr in get_manager_emails(manager_contact, exclude_email=admin.email):
                cc_emails.append(addr)

        # -------------------------
        # Ensure employee is also CC'd (if not same as HR)
        # -------------------------
        if admin.email:
            emp_email = admin.email.strip()
            if emp_email and (not hr_email or emp_email.lower() != hr_email.strip().lower()):
                cc_emails.append(emp_email)

        # De-duplicate CC list and remove blanks
        seen = set()
        deduped_cc = []
        for e in cc_emails:
            if not e:
                continue
            addr = e.strip()
            key = addr.lower()
            if key and key not in seen:
                seen.add(key)
                deduped_cc.append(addr)
        cc_emails = deduped_cc

        # -------------------------
        # Leave calculations for mail
        # -------------------------
        unpaid_days = leave.extra_days or 0.0
        deducted_days = leave.deducted_days or 0.0

        # -------------------------
        # Email content
        # -------------------------
        subject = f"Leave Applied – {admin.first_name}"

        body = f"""
                <p>Hi,</p>

               

                <p>
                This is to inform you that the following leave application has been submitted.
                Please find the details below for your review and necessary action.
                </p>

                <table border="1" cellpadding="6" cellspacing="0" width="60%" style="border-collapse: collapse;">
                    <tr>
                        <td><strong>Employee Name</strong></td>
                        <td>{admin.first_name}</td>
                    </tr>
                    <tr>
                        <td><strong>Employee Email</strong></td>
                        <td>{admin.email}</td>
                    </tr>
                    <tr>
                        <td><strong>Employee Circle</strong></td>
                        <td>{admin.circle}</td>
                    </tr>
                    <tr>
                        <td><strong>Employee Department</strong></td>
                        <td>{admin.emp_type}</td>
                    </tr>
                    <tr>
                        <td><strong>Leave Type</strong></td>
                        <td>{leave.leave_type}</td>
                    </tr>
                    <tr>
                        <td><strong>Leave Period</strong></td>
                        <td>{leave.start_date} to {leave.end_date}</td>
                    </tr>
                    <tr>
                        <td><strong>Reason</strong></td>
                        <td>{(leave.reason or '').replace(chr(10), '<br>')}</td>
                    </tr>
                    <tr>
                        <td><strong>Total Days</strong></td>
                        <td>{leave.deducted_days + leave.extra_days}</td>
                    </tr>
                    <tr>
                        <td><strong>Deducted Days (Paid)</strong></td>
                        <td>{leave.deducted_days}</td>
                    </tr>
                    <tr>
                        <td><strong>Unpaid Leave (LWP)</strong></td>
                        <td style="color: red;"><strong>{leave.extra_days}</strong></td>
                    </tr>
                    <tr>
                        <td><strong>Status</strong></td>
                        <td>{leave.status}</td>
                    </tr>
                </table>

                <br>

                <p style="font-size: 13px; color: #555;">
                <strong>Note:</strong><br>
                • Deducted days are adjusted from the available leave balance.<br>
                • Unpaid Leave (LWP) days will be treated as unpaid days.
                </p>

                <p>
                To review or take action on this leave request, please log in to the HRMS portal using the link below:
                </p>

                <p>
                <a href="{current_app.config.get('BASE_URL', 'https://solviotec.com/')}"
                style="background-color:#007bff;color:#ffffff;
                        padding:10px 15px;text-decoration:none;
                        border-radius:5px;"
                target="_blank">
                Login to HRMS Portal
                </a>
                </p>

                <br>

                <p>
                Thanks & Regards,<br>
                <strong>{admin.first_name}</strong><br>
                Saffo Technologies
                </p>
                """


        send_email_via_zeptomail(
            sender_email=current_app.config["ZEPTO_SENDER_EMAIL"],
            subject=subject,
            body=body,
            recipient_email=hr_email,
            cc_emails=cc_emails or None
        )

        return True

    except Exception as e:
        current_app.logger.warning(
            f"Leave email failed for {admin.email}: {e}"
        )
        return False


def send_leave_pending_reminder(leave_application, manager_emails, hr_cc=True):
    """
    Send reminder to concern department (managers) when leave has been pending 6+ days.
    TO: first manager (or HR if no manager); CC: other managers + HR.
    """
    try:
        admin = leave_application.admin
        if not admin:
            return False

        hr_email = (current_app.config.get("ZEPTO_CC_HR") or "").strip()
        to_email = None
        cc_emails = []

        if manager_emails:
            to_email = manager_emails[0].strip() if manager_emails[0] else None
            for addr in manager_emails[1:]:
                if addr and addr.strip():
                    cc_emails.append(addr.strip())
        if not to_email:
            to_email = hr_email or (admin.email or "").strip()
        if hr_cc and hr_email and hr_email.lower() != (to_email or "").lower():
            cc_emails.append(hr_email)
        if admin.email and (admin.email or "").strip().lower() not in {(to_email or "").lower(), *(e.lower() for e in cc_emails)}:
            cc_emails.append((admin.email or "").strip())

        to_lower = (to_email or "").lower()
        seen = set()
        deduped_cc = []
        for e in cc_emails:
            if not e or not e.strip():
                continue
            key = e.strip().lower()
            if key != to_lower and key not in seen:
                seen.add(key)
                deduped_cc.append(e.strip())
        cc_emails = deduped_cc

        if not to_email:
            current_app.logger.warning("Leave pending reminder: no recipient (HR or manager) configured")
            return False

        applied_date = leave_application.created_at.date() if leave_application.created_at else None
        applied_str = applied_date.isoformat() if applied_date else "N/A"

        subject = f"Reminder: Leave pending 6+ days – {admin.first_name or admin.email}"
        body = f"""
        <p>Hi,</p>
        <p>This is a reminder that the following leave application has been <strong>pending for more than 6 days</strong> and is awaiting your approval or rejection.</p>
        <table border="1" cellpadding="6" cellspacing="0" width="60%" style="border-collapse: collapse;">
            <tr><td><strong>Employee Name</strong></td><td>{admin.first_name or 'N/A'}</td></tr>
            <tr><td><strong>Employee Email</strong></td><td>{admin.email or 'N/A'}</td></tr>
            <tr><td><strong>Circle / Department</strong></td><td>{admin.circle or 'N/A'} / {admin.emp_type or 'N/A'}</td></tr>
            <tr><td><strong>Leave Type</strong></td><td>{leave_application.leave_type}</td></tr>
            <tr><td><strong>Leave Period</strong></td><td>{leave_application.start_date} to {leave_application.end_date}</td></tr>
            <tr><td><strong>Applied On</strong></td><td>{applied_str}</td></tr>
            <tr><td><strong>Status</strong></td><td>{leave_application.status}</td></tr>
        </table>
        <p>Please approve or reject this request from the <strong>Manager panel (Leave Requests)</strong> in the HRMS portal at the earliest.</p>
        <p><a href="{current_app.config.get('BASE_URL', 'https://solviotec.com/')}" style="background-color:#007bff;color:#ffffff;padding:10px 15px;text-decoration:none;border-radius:5px;" target="_blank">Login to HRMS Portal</a></p>
        <p>Thanks &amp; Regards,<br>HRMS</p>
        """
        send_email_via_zeptomail(
            sender_email=current_app.config.get("ZEPTO_SENDER_EMAIL"),
            subject=subject,
            body=body,
            recipient_email=to_email,
            cc_emails=cc_emails or None,
        )
        return True
    except Exception as e:
        current_app.logger.warning(f"Leave pending reminder email failed (leave_id={getattr(leave_application, 'id', None)}): {e}")
        return False


def send_leave_decision_email(leave_obj, approver, action: str):
    """
    Notify employee + HR (+ managers if mapped) when a leave request is approved/rejected.
    """
    try:
        admin = leave_obj.admin
        if not admin:
            return False

        # Build recipient + CC list
        to_email = (admin.email or "").strip()
        if not to_email:
            return False

        hr_email = current_app.config.get("ZEPTO_CC_HR")
        cc_emails = []

        # HR always in CC (if configured and not same as TO)
        if hr_email and hr_email.strip().lower() != to_email.lower():
            cc_emails.append(hr_email.strip())

        # Manager mapping (optional) - use same pattern as WFH
        manager_contact = ManagerContact.query.filter_by(
            user_email=admin.email
        ).first()
        if not manager_contact:
            manager_contact = ManagerContact.query.filter_by(
                circle_name=admin.circle,
                user_type=admin.emp_type
            ).first()

        if manager_contact:
            for addr in get_manager_emails(manager_contact, exclude_email=to_email):
                if addr and addr.lower() != to_email.lower():
                    cc_emails.append(addr)

        # De-duplicate CCs
        seen = set()
        deduped_cc = []
        for e in cc_emails:
            if not e:
                continue
            addr = e.strip()
            key = addr.lower()
            if key and key not in seen:
                seen.add(key)
                deduped_cc.append(addr)

        status_text = "approved" if action == "approve" else "rejected"
        subject = f"Leave Request {status_text.capitalize()} – {leave_obj.leave_type}"

        body = f"""
        <p>Hello {admin.first_name or admin.email},</p>

        <p>Your leave request has been <strong>{status_text}</strong> by {approver.first_name or approver.email}.</p>

        <table border="1" cellpadding="6" cellspacing="0">
            <tr><td><strong>Employee</strong></td><td>{admin.first_name} ({admin.email})</td></tr>
            <tr><td><strong>Circle</strong></td><td>{admin.circle}</td></tr>
            <tr><td><strong>Department</strong></td><td>{admin.emp_type}</td></tr>
            <tr><td><strong>Leave Type</strong></td><td>{leave_obj.leave_type}</td></tr>
            <tr><td><strong>Period</strong></td><td>{leave_obj.start_date} to {leave_obj.end_date}</td></tr>
            <tr><td><strong>Deducted Days (Paid)</strong></td><td>{leave_obj.deducted_days}</td></tr>
            <tr><td><strong>Unpaid Days (LWP)</strong></td><td>{leave_obj.extra_days}</td></tr>
            <tr><td><strong>Status</strong></td><td>{leave_obj.status}</td></tr>
        </table>

        <p>Please log in to the HRMS portal if you need more details.</p>
        """

        send_email_via_zeptomail(
            sender_email=current_app.config["ZEPTO_SENDER_EMAIL"],
            subject=subject,
            body=body,
            recipient_email=to_email,
            cc_emails=deduped_cc or None,
        )
        return True

    except Exception as e:
        current_app.logger.warning(
            f"Leave decision email failed for leave_id={getattr(leave_obj, 'id', None)}: {e}"
        )
        return False


def _dedupe_cc_emails(cc_emails, to_email):
    seen = set()
    deduped = []
    to_key = (to_email or "").strip().lower()
    for e in cc_emails or []:
        if not e:
            continue
        addr = e.strip()
        key = addr.lower()
        if key and key not in seen and key != to_key:
            seen.add(key)
            deduped.append(addr)
    return deduped


def _hr_updation_cc_emails(admin, hr_admin):
    """CC list: HR mailbox, acting HR user, and employee manager(s)."""
    to_email = (getattr(admin, "email", None) or "").strip()
    cc_emails = []

    hr_cc = (current_app.config.get("ZEPTO_CC_HR") or current_app.config.get("EMAIL_HR") or "").strip()
    if hr_cc:
        cc_emails.append(hr_cc)

    actor_email = (getattr(hr_admin, "email", None) or "").strip()
    if actor_email:
        cc_emails.append(actor_email)

    manager_contact = resolve_manager_contact_for_employee(admin)
    if manager_contact:
        for addr in get_manager_emails(manager_contact, exclude_email=to_email):
            if addr:
                cc_emails.append(addr.strip())

    return _dedupe_cc_emails(cc_emails, to_email)


def _hr_change_row(label, old_val, new_val):
    old_s = html.escape(str(old_val if old_val not in (None, "") else "-"))
    new_s = html.escape(str(new_val if new_val not in (None, "") else "-"))
    if old_s == new_s:
        return f"<tr><td><strong>{html.escape(label)}</strong></td><td>{new_s}</td></tr>"
    return (
        f"<tr><td><strong>{html.escape(label)}</strong></td>"
        f"<td>{old_s} &rarr; <strong>{new_s}</strong></td></tr>"
    )


def send_hr_leave_updation_email(*, leave_obj, hr_admin, old_data=None, adjustment_data=None, balance_after=None):
    """
    Notify employee about HR leave edits.
    TO: employee | CC: HR mailbox, acting HR user, mapped manager(s)
    """
    try:
        admin = getattr(leave_obj, "admin", None)
        if not admin or not admin.email:
            return False, "Employee email missing"

        to_email = (admin.email or "").strip()
        sender_email = (current_app.config.get("ZEPTO_SENDER_EMAIL") or "").strip()
        if not sender_email:
            return False, "ZEPTO_SENDER_EMAIL not configured"

        old_data = old_data or {}
        adjustment_data = adjustment_data or {}
        balance_after = balance_after or {}
        actor_name = html.escape(
            getattr(hr_admin, "first_name", None) or getattr(hr_admin, "email", None) or "HR Team"
        )
        emp_name = html.escape(admin.first_name or admin.email)

        reversal_note = ""
        if adjustment_data.get("reversal_applied"):
            reversal_note = (
                "<p><em>Previously approved leave balance was reversed and recalculated based on this update.</em></p>"
            )

        balance_html = ""
        if balance_after:
            balance_html = f"""
            <h4 style="margin:16px 0 8px;">Updated leave balance</h4>
            <table border="1" cellpadding="6" cellspacing="0">
                <tr><td><strong>Privilege Leave (PL)</strong></td><td>{html.escape(balance_after.get('pl', '-'))}</td></tr>
                <tr><td><strong>Casual Leave (CL)</strong></td><td>{html.escape(balance_after.get('cl', '-'))}</td></tr>
                <tr><td><strong>Compensatory Leave</strong></td><td>{html.escape(balance_after.get('comp', '-'))}</td></tr>
            </table>
            """

        subject = f"Leave Updated by HR – {admin.first_name or admin.email}"
        body = f"""
        <p>Hello {emp_name},</p>
        <p>Your leave application has been updated by <strong>{actor_name}</strong> from HR.</p>
        {reversal_note}
        <table border="1" cellpadding="6" cellspacing="0">
            <tr><td><strong>Application ID</strong></td><td>{leave_obj.id}</td></tr>
            {_hr_change_row("Status", old_data.get("status"), leave_obj.status)}
            {_hr_change_row("Leave Type", old_data.get("leave_type"), leave_obj.leave_type)}
            {_hr_change_row(
                "Period",
                f"{old_data.get('start_date', '-')} to {old_data.get('end_date', '-')}",
                f"{leave_obj.start_date} to {leave_obj.end_date}",
            )}
            {_hr_change_row("Paid Days (Deducted)", old_data.get("deducted_days"), leave_obj.deducted_days)}
            {_hr_change_row("Unpaid Days (LWP)", old_data.get("extra_days"), leave_obj.extra_days)}
            {_hr_change_row("Reason", old_data.get("reason"), leave_obj.reason)}
            <tr><td><strong>Paid Days Adjustment</strong></td><td>{adjustment_data.get('paid_adjustment', 0)}</td></tr>
            <tr><td><strong>LWP Adjustment</strong></td><td>{adjustment_data.get('lwp_adjustment', 0)}</td></tr>
            <tr><td><strong>Updated At</strong></td><td>{format_ist_display()} IST</td></tr>
        </table>
        {balance_html}
        <p>If this update is unexpected, contact HR immediately.</p>
        <p>Regards,<br><strong>HR Team</strong></p>
        """
        return send_email_via_zeptomail(
            sender_email=sender_email,
            subject=subject,
            body=body,
            recipient_email=to_email,
            cc_emails=_hr_updation_cc_emails(admin, hr_admin) or None,
        )
    except Exception as e:
        current_app.logger.warning(f"HR leave updation email failed: {e}")
        return False, str(e)


def send_hr_wfh_updation_email(*, wfh_obj, hr_admin, old_data=None):
    """
    Notify employee about HR WFH edits.
    TO: employee | CC: HR mailbox, acting HR user, mapped manager(s)
    """
    try:
        admin = getattr(wfh_obj, "admin", None)
        if not admin or not admin.email:
            return False, "Employee email missing"

        to_email = (admin.email or "").strip()
        sender_email = (current_app.config.get("ZEPTO_SENDER_EMAIL") or "").strip()
        if not sender_email:
            return False, "ZEPTO_SENDER_EMAIL not configured"

        old_data = old_data or {}
        actor_name = html.escape(
            getattr(hr_admin, "first_name", None) or getattr(hr_admin, "email", None) or "HR Team"
        )
        emp_name = html.escape(admin.first_name or admin.email)

        subject = f"WFH Updated by HR – {admin.first_name or admin.email}"
        body = f"""
        <p>Hello {emp_name},</p>
        <p>Your work-from-home request has been updated by <strong>{actor_name}</strong> from HR.</p>
        <table border="1" cellpadding="6" cellspacing="0">
            <tr><td><strong>Application ID</strong></td><td>{wfh_obj.id}</td></tr>
            {_hr_change_row("Status", old_data.get("status"), wfh_obj.status)}
            {_hr_change_row(
                "Period",
                f"{old_data.get('start_date', '-')} to {old_data.get('end_date', '-')}",
                f"{wfh_obj.start_date} to {wfh_obj.end_date}",
            )}
            {_hr_change_row("Reason", old_data.get("reason"), wfh_obj.reason)}
            <tr><td><strong>Updated At</strong></td><td>{format_ist_display()} IST</td></tr>
        </table>
        <p>If this update is unexpected, contact HR immediately.</p>
        <p>Regards,<br><strong>HR Team</strong></p>
        """
        return send_email_via_zeptomail(
            sender_email=sender_email,
            subject=subject,
            body=body,
            recipient_email=to_email,
            cc_emails=_hr_updation_cc_emails(admin, hr_admin) or None,
        )
    except Exception as e:
        current_app.logger.warning(f"HR WFH updation email failed: {e}")
        return False, str(e)


def send_compoff_expiry_reminder(admin, gain_date, expiry_date):
    """Notify employee that their comp-off (gained on gain_date) will expire in 7 days."""
    try:
        to_email = (admin.email or "").strip()
        if not to_email:
            return False
        gain_str = gain_date.isoformat() if hasattr(gain_date, "isoformat") else str(gain_date)
        expiry_str = expiry_date.isoformat() if hasattr(expiry_date, "isoformat") else str(expiry_date)
        subject = "Reminder: Your comp-off will expire in 7 days"
        body = f"""
        <p>Hello {admin.first_name or admin.email},</p>

        <p>This is a reminder that your <strong>1 comp-off</strong> gained on <strong>{gain_str}</strong> will expire on <strong>{expiry_str}</strong> (in 7 days).</p>

        <p>Please apply for Compensatory Leave before the expiry date if you wish to use it.</p>

        <p>— HRMS</p>
        """
        send_email_via_zeptomail(
            sender_email=current_app.config["ZEPTO_SENDER_EMAIL"],
            subject=subject,
            body=body,
            recipient_email=to_email,
        )
        return True
    except Exception as e:
        current_app.logger.warning(f"Compoff expiry reminder email failed: {e}")
        return False


def send_probation_reminder_email(admin, probation_end_date, manager_emails):
    """
    Send to HR and concerned manager(s): employee will complete 6-month probation on probation_end_date.
    One email: primary recipient is first manager (L1 order); other managers + HR are CC (deduped).
    """
    try:
        hr_email = (current_app.config.get("EMAIL_HR") or "").strip()
        emp_name = (getattr(admin, "first_name", None) or "").strip() or (admin.email or "Employee")
        doj = getattr(admin, "doj", None)
        doj_str = doj.isoformat() if doj and hasattr(doj, "isoformat") else "N/A"
        end_str = probation_end_date.isoformat() if hasattr(probation_end_date, "isoformat") else str(probation_end_date)
        subject = f"Probation Review Due: {emp_name} – 6-month completion on {end_str}"
        body = f"""
        <p>Hello,</p>
        <p>This is a reminder that the following employee will complete their 6-month probation period soon.</p>
        <table border="1" cellpadding="6" cellspacing="0">
            <tr><td><strong>Employee</strong></td><td>{emp_name}</td></tr>
            <tr><td><strong>Email</strong></td><td>{admin.email or 'N/A'}</td></tr>
            <tr><td><strong>Date of Joining</strong></td><td>{doj_str}</td></tr>
            <tr><td><strong>Probation End Date</strong></td><td>{end_str}</td></tr>
        </table>
        <p>Please submit your review from the Manager panel (Probation Reviews) at least 15 days before the probation end date.</p>
        <p>— HRMS</p>
        """

        mgr_ordered = []
        seen_lower = set()
        for e in manager_emails or []:
            if not e:
                continue
            addr = e.strip()
            key = addr.lower()
            if key and key not in seen_lower:
                seen_lower.add(key)
                mgr_ordered.append(addr)

        if mgr_ordered:
            primary = mgr_ordered[0]
            cc_list = []
            for addr in mgr_ordered[1:]:
                if addr.lower() != primary.lower():
                    cc_list.append(addr)
            if hr_email:
                hr_low = hr_email.lower()
                if hr_low != primary.lower() and hr_low not in {c.lower() for c in cc_list}:
                    cc_list.append(hr_email)
            cc_emails = cc_list if cc_list else None
        else:
            if not hr_email:
                current_app.logger.warning("Probation reminder: no HR or manager email configured")
                return False
            primary = hr_email
            cc_emails = None

        ok, _msg = send_email_via_zeptomail(
            sender_email=current_app.config.get("ZEPTO_SENDER_EMAIL"),
            subject=subject,
            body=body,
            recipient_email=primary,
            cc_emails=cc_emails,
        )
        return ok
    except Exception as e:
        current_app.logger.warning(f"Probation reminder email failed: {e}")
        return False


def send_probation_review_submitted_email(admin_employee, manager_name, feedback_preview=None):
    """Notify HR that manager has submitted probation review for the employee."""
    try:
        hr_email = current_app.config.get("EMAIL_HR")
        if not hr_email:
            current_app.logger.warning("EMAIL_HR not set; cannot send probation review submitted email")
            return False
        emp_name = (getattr(admin_employee, "first_name", None) or "").strip() or (admin_employee.email or "Employee")
        subject = f"Probation Review Submitted: {emp_name}"
        feedback_snippet = (feedback_preview or "")[:200] + ("..." if (feedback_preview or "") and len(feedback_preview or "") > 200 else "")
        body = f"""
        <p>Hello HR,</p>
        <p>Manager <strong>{manager_name or 'N/A'}</strong> has submitted the probation review for the following employee.</p>
        <table border="1" cellpadding="6" cellspacing="0">
            <tr><td><strong>Employee</strong></td><td>{emp_name}</td></tr>
            <tr><td><strong>Email</strong></td><td>{admin_employee.email or 'N/A'}</td></tr>
        </table>
        {f'<p><strong>Feedback preview:</strong> {feedback_snippet}</p>' if feedback_snippet else ''}
        <p>— HRMS</p>
        """
        send_email_via_zeptomail(
            sender_email=current_app.config.get("ZEPTO_SENDER_EMAIL"),
            subject=subject,
            body=body,
            recipient_email=hr_email,
        )
        return True
    except Exception as e:
        current_app.logger.warning(f"Probation review submitted email failed: {e}")
        return False


def send_password_set_email(admin):
    """Send initial password-set link using secure token (1 hour expiry)."""
    try:
        token = secrets.token_urlsafe(32)
        admin.password_reset_token = token
        admin.password_reset_expiry = utc_now() + timedelta(hours=1)
        db.session.commit()

        base_url = current_app.config.get("BASE_URL", "").rstrip("/")
        reset_link = f"{base_url}/set-password?token={token}"

        subject = "Set your HRMS password"
        body = f"""
        <p>Hello {admin.first_name or "User"},</p>

        <p>Your HRMS account has been created/updated.</p>

        <p>Please set your password using the link below. This link is valid for <strong>1 hour</strong>.</p>

        <p><a href="{reset_link}">Set Password</a></p>

        <p>If you did not expect this email, please contact HR.</p>

        <br>
        <p>Regards,<br>HR Team</p>
        """

        ok, msg = send_email_via_zeptomail(
            sender_email=current_app.config.get("ZEPTO_SENDER_EMAIL"),
            subject=subject,
            body=body,
            recipient_email=admin.email,
        )
        if not ok:
            current_app.logger.warning(f"Password set email failed for {admin.email}: {msg}")
            return False

        current_app.logger.info(f"Password set email sent to {admin.email}")
        return True
    except Exception as e:
        db.session.rollback()
        current_app.logger.warning(f"Password set email failed for {admin.email}: {e}")
        return False


def send_ex_employee_documents_email(*, recipient_email, doc_link, document_names, valid_hours=48):
    """
    Notify ex-employee with document names + time-limited link (no HRMS login).
    CC: ZEPTO_CC_HR env (comma-separated allowed), else EMAIL_HR — skipped if same as recipient.
    Returns (success: bool, message: str).
    """
    cfg_err = zeptomail_config_error()
    if cfg_err:
        return False, cfg_err

    to_addr = (recipient_email or "").strip()
    if not to_addr or "@" not in to_addr:
        return False, "A valid recipient email is required."

    names = [html.escape(str(n).strip()) for n in (document_names or []) if str(n or "").strip()]
    if not names:
        names = [html.escape("Shared documents")]

    if len(names) == 1:
        names_block = f"<p><strong>Document shared:</strong> {names[0]}</p>"
    else:
        li = "".join(f"<li>{n}</li>" for n in names)
        names_block = f"<p><strong>Documents shared:</strong></p><ul style=\"margin:8px 0;padding-left:18px;\">{li}</ul>"

    subject = "Documents from Human Resources - secure download"
    href_attr = doc_link.replace("&", "&amp;")
    link_text = html.escape(doc_link)
    sender_name = (current_app.config.get("ZEPTO_SENDER_NAME") or "Human Resources").strip()
    body = f"""
<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1e293b;line-height:1.55;max-width:560px;">
<p>Good day,</p>
<p>The Human Resources team is sharing the following with you. Please use it for your records as applicable.</p>
{names_block}
<p>Your file(s) are available at the link below. You do <strong>not</strong> need to sign in to HRMS. The link is
valid for <strong>{valid_hours} hours</strong> and is intended for you only.</p>
<p style="margin:14px 0;word-break:break-all;"><a href="{href_attr}" style="color:#0d9488;">{link_text}</a></p>
<p style="font-size:13px;color:#64748b;">If this message was not meant for you, you may ignore it. For questions, contact HR through your usual official channel.</p>
<p style="margin-top:18px;">Kind regards,<br /><strong>Human Resources</strong></p>
</div>
"""
    raw_hr_cc = (current_app.config.get("ZEPTO_CC_HR") or "").strip()
    if not raw_hr_cc:
        raw_hr_cc = (current_app.config.get("EMAIL_HR") or "").strip()
    cc_list = []
    rec_lower = to_addr.lower()
    if raw_hr_cc:
        for part in raw_hr_cc.replace(";", ",").split(","):
            addr = part.strip()
            if not addr or "@" not in addr:
                continue
            if addr.lower() == rec_lower:
                continue
            if addr.lower() not in {e.lower() for e in cc_list}:
                cc_list.append(addr)
    cc_emails = cc_list or None
    zepto_from = (current_app.config.get("ZEPTO_SENDER_EMAIL") or "").strip()

    try:
        ok, msg = send_email_via_zeptomail(
            sender_email=zepto_from,
            subject=subject,
            body=body,
            recipient_email=to_addr,
            cc_emails=cc_emails,
            from_name=sender_name,
        )
        if not ok and cc_emails:
            current_app.logger.warning(
                "Ex-employee email with HR CC failed for %s (%s); retrying without CC.",
                to_addr,
                msg,
            )
            ok, msg = send_email_via_zeptomail(
                sender_email=zepto_from,
                subject=subject,
                body=body,
                recipient_email=to_addr,
                cc_emails=None,
                from_name=sender_name,
            )
        if ok:
            current_app.logger.info("Ex-employee documents email sent to %s", to_addr)
        else:
            current_app.logger.warning(
                "Ex-employee documents email failed for %s: %s",
                to_addr,
                msg,
            )
        return ok, msg
    except Exception as e:
        current_app.logger.warning("Ex-employee documents email failed for %s: %s", to_addr, e)
        return False, str(e)


def send_password_reset_email(admin, reset_token):
    """Send password reset link with token. Link expires in 1 hour. Returns (success: bool, message: str)."""
    base_url = current_app.config.get("BASE_URL", "").rstrip("/")
    reset_link = f"{base_url}/set-password?token={reset_token}"

    subject = "Reset your HRMS password"
    body = f"""
    <p>Hello {admin.first_name or "User"},</p>

    <p>HR has initiated a password reset for your account.</p>

    <p>Click the link below to set a new password. This link is valid for <strong>1 hour</strong> only.</p>

    <p><a href="{reset_link}">Set new password</a></p>

    <p>If you did not request this, please ignore this email or contact HR.</p>

    <br>
    <p>Regards,<br>HR Team</p>
    """
    try:
        ok, msg = send_email_via_zeptomail(
            sender_email=current_app.config.get("ZEPTO_SENDER_EMAIL"),
            subject=subject,
            body=body,
            recipient_email=admin.email,
        )
        if not ok:
            current_app.logger.warning(f"Password reset email failed for {admin.email}: {msg}")
        return ok
    except Exception as e:
        current_app.logger.warning(f"Password reset email failed for {admin.email}: {e}")
        return False


def send_assessment_invite_email(*, to_email, candidate_name, department, token, valid_minutes=15, cc_emails=None):
    """Send candidate assessment link mail (tokenized URL)."""
    try:
        base_url = (current_app.config.get("BASE_URL") or "").rstrip("/")
        assessment_url = f"{base_url}/assessment?t={token}"
        sender_email = (current_app.config.get("ZEPTO_SENDER_EMAIL") or "").strip()
        if not sender_email:
            return False, "ZEPTO_SENDER_EMAIL not configured"
        vm = max(1, int(valid_minutes))
        subject = f"Assessment Test Link (Start within {vm} minutes)"
        body = f"""
        <p>Hello {html.escape(candidate_name or 'Candidate')},</p>
        <p>Your assessment link is ready.</p>
        <p><strong>Department:</strong> {html.escape(department or '-')}</p>
        <p><a href="{assessment_url}" target="_blank">Click here to open your assessment</a></p>
        <p>This link must be opened and started within <strong>{vm}</strong> minutes. After you start, you have the full test duration to complete and submit (see instructions on the assessment page).</p>
        <p>Regards,<br><strong>HR Team</strong></p>
        """
        cc_candidates = []
        configured_hr = (
            current_app.config.get("ZEPTO_CC_HR")
            or current_app.config.get("EMAIL_HR")
            or ""
        ).strip()
        if configured_hr:
            for part in configured_hr.replace(";", ",").split(","):
                addr = (part or "").strip()
                if addr and "@" in addr:
                    cc_candidates.append(addr)

        for addr in (cc_emails or []):
            mail = (addr or "").strip()
            if mail and "@" in mail:
                cc_candidates.append(mail)

        seen = set()
        deduped_cc = []
        to_lower = (to_email or "").strip().lower()
        for addr in cc_candidates:
            key = addr.lower()
            if not key or key == to_lower or key in seen:
                continue
            seen.add(key)
            deduped_cc.append(addr)

        ok, provider_msg = send_email_via_zeptomail(
            sender_email=sender_email,
            subject=subject,
            body=body,
            recipient_email=(to_email or "").strip(),
            cc_emails=deduped_cc or None,
        )
        return bool(ok), str(provider_msg or "")
    except Exception as e:
        current_app.logger.warning("send_assessment_invite_email failed: %s", e)
        return False, str(e)


def send_assessment_submitted_email_to_hr(*, candidate_name, candidate_email, department):
    """Notify HR mailbox when candidate submits assessment."""
    try:
        to_email = (
            current_app.config.get("EMAIL_HR")
            or current_app.config.get("ZEPTO_CC_HR")
            or current_app.config.get("ZEPTO_SENDER_EMAIL")
        )
        if not to_email:
            return False
        sender_email = (current_app.config.get("ZEPTO_SENDER_EMAIL") or "").strip()
        if not sender_email:
            current_app.logger.warning("send_assessment_submitted_email_to_hr: ZEPTO_SENDER_EMAIL not configured")
            return False
        subject = "Assessment Submitted by Candidate"
        submitted_on = f"{format_ist_display()} IST"
        body = f"""
        <p>Hello HR Team,</p>
        <p>An assessment has been submitted.</p>
        <table border="1" cellpadding="6" cellspacing="0">
            <tr><td><strong>Name</strong></td><td>{html.escape(candidate_name or '-')}</td></tr>
            <tr><td><strong>Email</strong></td><td>{html.escape(candidate_email or '-')}</td></tr>
            <tr><td><strong>Department</strong></td><td>{html.escape(department or '-')}</td></tr>
            <tr><td><strong>Submitted At</strong></td><td>{submitted_on}</td></tr>
        </table>
        <p>Regards,<br><strong>Assessment System</strong></p>
        """
        ok, _msg = send_email_via_zeptomail(
            sender_email=sender_email,
            subject=subject,
            body=body,
            recipient_email=to_email,
            cc_emails=None,
        )
        return ok
    except Exception as e:
        current_app.logger.warning("send_assessment_submitted_email_to_hr failed: %s", e)
        return False


def send_assessment_hr_report_email(*, subject, html_body):
    """Send HR the proficiency summary (Arithmetic + English) and Section 2 Q&A from review."""
    try:
        to_email = (
            current_app.config.get("EMAIL_HR")
            or current_app.config.get("ZEPTO_CC_HR")
            or current_app.config.get("ZEPTO_SENDER_EMAIL")
        )
        if not to_email:
            return False, "HR recipient email is not configured (EMAIL_HR / ZEPTO_CC_HR)."
        sender_email = (current_app.config.get("ZEPTO_SENDER_EMAIL") or "").strip()
        if not sender_email:
            current_app.logger.warning("send_assessment_hr_report_email: ZEPTO_SENDER_EMAIL not configured")
            return False, "ZEPTO_SENDER_EMAIL is not configured."
        ok, msg = send_email_via_zeptomail(
            sender_email=sender_email,
            subject=(subject or "Assessment report").strip()[:200],
            body=html_body or "<p>(empty)</p>",
            recipient_email=(to_email or "").strip(),
            cc_emails=None,
        )
        return bool(ok), str(msg or "")
    except Exception as e:
        current_app.logger.warning("send_assessment_hr_report_email failed: %s", e)
        return False, str(e)
