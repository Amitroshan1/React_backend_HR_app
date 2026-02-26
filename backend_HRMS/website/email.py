# send_email_via_zeptomail,send_login_alert_email,Company_verify_oauth2_and_send_email,
# send_wfh_approval_email_to_managers,send_claim_submission_email
# asset_email,update_asset_email,send_welcome_email,send_asset_assigned_email,
# send_resignation_email,notify_query_event,send_leave_applied_email,

from .models.Admin_models import Admin
from .models.manager_model import ManagerContact
from .manager_utils import get_manager_emails
from flask import current_app, url_for
from .models.expense import ExpenseLineItem
import requests
from . import db



def send_email_via_zeptomail(sender_email,
    subject,
    body,
    recipient_email,
    cc_emails=None
):
    """
    Sends email using Zoho ZeptoMail API
    Returns: (success: bool, message: str)
    """
    
    try:
        url = current_app.config.get(
            "ZEPTO_BASE_URL",
            "https://api.zeptomail.in/v1.1/email"
        )

        headers = {
            "accept": "application/json",
            "content-type": "application/json",
            "authorization": current_app.config["ZEPTO_API_KEY"]
        }

        payload = {
            "from": {
                "address": sender_email,
                "name": subject
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
                {
                    "email_address": {
                        "address": email
                    }
                }
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

        return False, f"ZeptoMail error: {response.text}"

    except Exception as e:
        current_app.logger.error(f"ZeptoMail send failed: {e}")
        return False, "Unexpected error while sending email"



from datetime import datetime
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
            file_link = (
                f'<a href="{url_for("static", filename="uploads/" + item.Attach_file, _external=True)}" '
                f'style="color:#007bff;" target="_blank">Download File</a>'
                if item.Attach_file else "No attachment"
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



def asset_email(sender_email, recipient_email, first_name):
    subject = "New Asset Assigned to You"
    body = f"""
    <p>Dear {first_name},</p>
    <p>This is to inform you that a new asset has been assigned to you.</p>
    <p>Thanks,<br><strong>Accounts Team</strong></p>
    """

    success, message = Company_verify_oauth2_and_send_email(
        sender_email=sender_email,
        subject=subject,
        body=body,
        recipient_email=recipient_email
    )

    return success


def update_asset_email(sender_email, recipient_email, first_name):
    subject = "Your Asset Has Been Updated"
    body = f"""
    <p>Dear {first_name},</p>
    <p>This is to inform you that your assigned asset has been updated.</p>
    <p>Thanks,<br><strong>Accounts Team</strong></p>
    """

    success, message = Company_verify_oauth2_and_send_email(
        sender_email=sender_email,
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
            <a href="https://solviotec.com/" target="_blank">
                www.solviotec.com
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
                <a href="https://solviotec.com/"
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
        <p><a href="https://solviotec.com/" style="background-color:#007bff;color:#ffffff;padding:10px 15px;text-decoration:none;border-radius:5px;" target="_blank">Login to HRMS Portal</a></p>
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
    manager_emails: list of manager email addresses to notify.
    """
    try:
        hr_email = current_app.config.get("EMAIL_HR")
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
        all_recipients = [e for e in manager_emails if e]
        if hr_email and hr_email not in all_recipients:
            all_recipients.append(hr_email)
        if not all_recipients:
            current_app.logger.warning("Probation reminder: no HR or manager email configured")
            return False
        for recipient in all_recipients:
            send_email_via_zeptomail(
                sender_email=current_app.config.get("ZEPTO_SENDER_EMAIL"),
                subject=subject,
                body=body,
                recipient_email=recipient,
            )
        return True
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
    reset_link = f"{current_app.config['BASE_URL']}/set-password?email={admin.email}"

    subject = "Set your HRMS password"
    body = f"""
    <p>Hello {admin.first_name},</p>

    <p>Your HRMS account has been upgraded.</p>

    <p>Please set your password using the link below:</p>

    <p><a href="{reset_link}">Set Password</a></p>

    <br>
    <p>Regards,<br>HR Team</p>
    """

    # replace with your actual mail sender
    current_app.logger.info(f"Password set email sent to {admin.email}")


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
