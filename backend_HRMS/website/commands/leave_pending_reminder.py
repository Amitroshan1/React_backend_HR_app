"""
Remind concern department (managers) when a leave has been pending 6+ days.
Run daily via scheduler or: flask leave-pending-reminder [--run-date YYYY-MM-DD] [--dry-run]
"""
from datetime import datetime, timedelta, time as dt_time

import click
from sqlalchemy import func, or_

from .. import db
from ..models.Admin_models import Admin
from ..models.attendance import LeaveApplication
from ..models.manager_model import ManagerContact
from ..manager_utils import get_manager_emails
from ..email import send_leave_pending_reminder


PENDING_DAYS_THRESHOLD = 6


def _get_contact_for_admin(admin):
    """ManagerContact for this employee (circle + emp_type + optional user_email)."""
    circle = (getattr(admin, "circle", None) or "").strip().lower()
    emp_type = (getattr(admin, "emp_type", None) or "").strip().lower()
    user_email = (getattr(admin, "email", None) or "").strip() or None
    if not circle or not emp_type:
        return None
    if user_email:
        contact = ManagerContact.query.filter(
            func.lower(func.coalesce(ManagerContact.circle_name, "")) == circle,
            func.lower(func.coalesce(ManagerContact.user_type, "")) == emp_type,
            ManagerContact.user_email == user_email,
        ).first()
        if contact:
            return contact
    return ManagerContact.query.filter(
        func.lower(func.coalesce(ManagerContact.circle_name, "")) == circle,
        func.lower(func.coalesce(ManagerContact.user_type, "")) == emp_type,
        or_(ManagerContact.user_email.is_(None), ManagerContact.user_email == ""),
    ).first()


def run_leave_pending_reminder(run_date):
    """
    Find leave applications pending 6+ days (not approved/rejected); send reminder to managers; set pending_reminder_sent_at.
    Returns summary dict.
    """
    summary = {
        "run_date": run_date.isoformat(),
        "reminders_sent": 0,
        "skipped": 0,
    }
    cutoff = run_date - timedelta(days=PENDING_DAYS_THRESHOLD)
    # Applied on or before cutoff: created_at < (cutoff + 1 day) at midnight
    created_before = datetime.combine(cutoff + timedelta(days=1), dt_time.min)

    leaves = LeaveApplication.query.filter(
        LeaveApplication.status == "Pending",
        LeaveApplication.created_at.isnot(None),
        LeaveApplication.created_at < created_before,
        LeaveApplication.pending_reminder_sent_at.is_(None),
    ).all()

    for leave in leaves:
        admin = leave.admin
        if not admin:
            summary["skipped"] += 1
            continue
        contact = _get_contact_for_admin(admin)
        manager_emails = get_manager_emails(contact, exclude_email=admin.email) if contact else []
        if send_leave_pending_reminder(leave, manager_emails, hr_cc=True):
            leave.pending_reminder_sent_at = datetime.utcnow()
            summary["reminders_sent"] += 1
        else:
            summary["skipped"] += 1

    return summary


def register_leave_pending_reminder_command(app):
    @app.cli.command("leave-pending-reminder")
    @click.option("--run-date", default=None, help="Date to run for (YYYY-MM-DD). Default: today.")
    @click.option("--dry-run", is_flag=True, help="Do not commit changes.")
    def leave_pending_reminder_command(run_date, dry_run):
        """Send reminders to managers for leaves pending 6+ days."""
        if run_date:
            try:
                run_date_obj = datetime.strptime(run_date, "%Y-%m-%d").date()
            except ValueError:
                raise click.ClickException("Invalid --run-date. Use YYYY-MM-DD.")
        else:
            from datetime import date
            run_date_obj = date.today()

        with app.app_context():
            summary = run_leave_pending_reminder(run_date_obj)
            if dry_run:
                db.session.rollback()
                click.echo("Dry run. No DB changes committed.")
            else:
                db.session.commit()
            click.echo(
                f"leave-pending-reminder: date={summary['run_date']}, "
                f"reminders_sent={summary['reminders_sent']}, skipped={summary['skipped']}"
            )
