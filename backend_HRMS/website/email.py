# send_email_via_zeptomail,send_login_alert_email,Company_verify_oauth2_and_send_email,
# send_wfh_approval_email_to_managers,send_claim_submission_email
# asset_email,update_asset_email,send_welcome_email,send_asset_assigned_email,
# send_resignation_email,notify_query_event,send_leave_applied_email,

from .models.Admin_models import Admin
from .models.manager_model import ManagerContact
from flask import current_app,url_for
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

    return send_email_via_zeptomail(
        subject=subject,
        body=body,
        recipient_email=user.email
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
        # Add managers IF found
        # -------------------------
        if manager_contact:
            if manager_contact.l1_email:
                cc_emails.append(manager_contact.l1_email)

            if manager_contact.l2_email:
                cc_emails.append(manager_contact.l2_email)

            if manager_contact.l3_email:
                cc_emails.append(manager_contact.l3_email)
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
                <td>{wfh.reason.replace(chr(10), '<br>')}</td></tr>
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
        # Send email (TO HR, CC managers if any)
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
            if manager_contact.l1_email:
                cc_emails.append(manager_contact.l1_email)

            if manager_contact.l2_email:
                cc_emails.append(manager_contact.l2_email)

            if manager_contact.l3_email:
                cc_emails.append(manager_contact.l3_email)

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
        # Decide TO / CC
        # -------------------------
        to_email = None
        cc_emails = []

        if manager_contact.l1_email:
            to_email = manager_contact.l1_email

            if manager_contact.l2_email:
                cc_emails.append(manager_contact.l2_email)
            if manager_contact.l3_email:
                cc_emails.append(manager_contact.l3_email)

        elif manager_contact.l2_email:
            to_email = manager_contact.l2_email

            if manager_contact.l3_email:
                cc_emails.append(manager_contact.l3_email)
        else:
            return False, "No valid manager email found"

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

    send_email_via_zeptomail(
        sender_email=current_app.config["ZEPTO_SENDER_EMAIL"],
        subject=subject,
        body=body,
        recipient_email=to_email
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
            if manager_contact.l1_email:
                cc_emails.append(manager_contact.l1_email)
            elif manager_contact.l2_email:
                cc_emails.append(manager_contact.l2_email)

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
                • Unpaid Leave (LWP) days will be treated as salary-unpaid days.
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
