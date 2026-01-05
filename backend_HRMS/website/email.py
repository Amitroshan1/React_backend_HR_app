from .models.Admin_models import Admin 
from .models.signup import Signup
from .models.manager_model import ManagerContact
from flask import current_app,url_for
from .models.expense import ExpenseLineItem
import requests
from . import db


def refresh_access_token(admin):
    """
    Refresh Microsoft OAuth2 access token
    Returns: access_token (str) or None
    """

    if not admin or not admin.oauth_refresh_token:
        current_app.logger.error("No refresh token available")
        return None

    token_data = {
        "client_id": current_app.config["OAUTH2_CLIENT_ID"],
        "client_secret": current_app.config["OAUTH2_CLIENT_SECRET"],
        "refresh_token": admin.oauth_refresh_token,
        "grant_type": "refresh_token",
        "scope": "https://graph.microsoft.com/.default"
    }

    try:
        response = requests.post(
            current_app.config["MICROSOFT_TOKEN_URL"],
            data=token_data,
            timeout=10
        )

        token_json = response.json()

        if "access_token" not in token_json:
            current_app.logger.error(
                f"Token refresh failed for {admin.email}: {token_json}"
            )
            return None

        # 🔄 Update refresh token if Microsoft rotated it
        if "refresh_token" in token_json:
            admin.oauth_refresh_token = token_json["refresh_token"]
            db.session.commit()

        return token_json["access_token"]

    except Exception as e:
        current_app.logger.error(f"OAuth token refresh error: {e}")
        return None


def send_email_via_microsoft_oauth(
    sender_email,
    subject,
    body,
    recipient_email,
    cc_emails=None
):
    """
    Sends email using Microsoft Graph OAuth2
    Returns: (success: bool, message: str)
    """

    try:
        user = Admin.query.filter_by(email=sender_email).first()

        if not user:
            return False, "Sender not found"

        if not user.oauth_refresh_token:
            return False, "OAuth token missing. Please re-login."

        access_token = refresh_access_token(user)

        if not access_token:
            return False, "Failed to refresh OAuth token"

        headers = {
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json"
        }

        email_data = {
            "message": {
                "subject": subject,
                "body": {
                    "contentType": "HTML",
                    "content": body
                },
                "toRecipients": [
                    {"emailAddress": {"address": recipient_email}}
                ],
                "ccRecipients": [
                    {"emailAddress": {"address": email}}
                    for email in (cc_emails or [])
                ]
            },
            "saveToSentItems": True
        }

        response = requests.post(
            "https://graph.microsoft.com/v1.0/me/sendMail",
            headers=headers,
            json=email_data,
            timeout=10
        )

        if response.status_code == 202:
            return True, "Email sent successfully"

        return False, f"Graph API error: {response.text}"

    except Exception as e:
        current_app.logger.error(f"Email send failed: {e}")
        return False, "Unexpected error while sending email"

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



def send_wfh_approval_email_to_managers(user, wfh):
    """
    Sends WFH approval request email.
    Returns: (success: bool, message: str)
    """

    hr_mail = "hr@saffotech.com"

    # Fetch Signup details
    signup = Signup.query.filter_by(email=user.email).first()
    if not signup:
        return False, "Signup record not found for user"

    # Fetch manager contacts
    manager_contacts = ManagerContact.query.filter_by(
        circle_name=signup.circle,
        user_type=signup.emp_type
    ).first()

    manager_emails = []
    if manager_contacts:
        manager_emails = [
            email for email in [
                manager_contacts.l2_email,
                manager_contacts.l3_email
            ]
            if email
        ]

    # Email content
    subject = f"WFH Request from {user.first_name} ({user.email})"

    body = f"""
    <p>Hi,</p>

    <p>
        This is to inform you that <strong>{user.first_name}</strong>
        has submitted a <strong>Work From Home (WFH)</strong> request.
        Please review the details below.
    </p>

    <table style="border-collapse: collapse; width: 100%;" border="1" cellpadding="8">
        <tr>
            <td><strong>Employee Name</strong></td>
            <td>{user.first_name}</td>
        </tr>
        <tr>
            <td><strong>Start Date</strong></td>
            <td>{wfh.start_date.strftime('%d-%m-%Y')}</td>
        </tr>
        <tr>
            <td><strong>End Date</strong></td>
            <td>{wfh.end_date.strftime('%d-%m-%Y')}</td>
        </tr>
        <tr>
            <td><strong>Reason</strong></td>
            <td>{wfh.reason.replace(chr(10), '<br>')}</td>
        </tr>
        <tr>
            <td><strong>Status</strong></td>
            <td><strong>{wfh.status}</strong></td>
        </tr>
    </table>

    <p>Please log in to the HRMS portal to approve or reject this request.</p>
    """

    # Send email using unified OAuth sender
    return send_email_via_microsoft_oauth(
        sender_email=user.email,
        subject=subject,
        body=body,
        recipient_email=hr_mail,
        cc_emails=manager_emails or None
    )


def send_claim_submission_email(header):
    """
    Sends expense claim submission email using Microsoft OAuth2
    Returns: (success: bool, message: str)
    """

    try:
        subject = f"Expense Claim Submitted: {header.employee_name} ({header.emp_id})"

        # Fetch expense items safely
        items = ExpenseLineItem.query.filter_by(claim_id=header.id).all()

        # Build line items HTML
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

        # Email body
        body = f"""
        <html>
        <body style="font-family: Arial, sans-serif;">

            <p><strong>An expense claim has been submitted.</strong></p>

            <table border="1" cellpadding="8" cellspacing="0" width="100%">
                <tr><td><strong>Employee</strong></td><td>{header.employee_name}</td></tr>
                <tr><td><strong>Employee ID</strong></td><td>{header.emp_id}</td></tr>
                <tr><td><strong>Designation</strong></td><td>{header.designation}</td></tr>
                <tr><td><strong>Project</strong></td><td>{header.project_name}</td></tr>
                <tr><td><strong>Country/State</strong></td><td>{header.country_state}</td></tr>
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

        # Fetch employee signup data
        signup = Signup.query.filter_by(email=header.email).first()
        if not signup:
            return False, "Signup record not found"

        # Fetch manager contacts
        manager_contacts = ManagerContact.query.filter_by(
            circle_name=signup.circle,
            user_type=signup.emp_type
        ).first()

        cc_emails = []
        if manager_contacts:
            cc_emails = list(filter(None, [
                manager_contacts.l2_email,
                manager_contacts.l3_email
            ]))

        recipient_email = "accounts@saffotech.com"

        # ✅ Send email via Microsoft OAuth
        success, message = send_email_via_microsoft_oauth(
            sender_email=header.email,
            subject=subject,
            body=body,
            recipient_email=recipient_email,
            cc_emails=cc_emails
        )

        return success, message

    except Exception as e:
        current_app.logger.error(f"Claim Email Error: {e}")
        return False, str(e)




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
