"""
Probation review reminder: 15 days before 6-month completion, notify HR and manager.
Run daily via: flask probation-reminder [--run-date YYYY-MM-DD] [--dry-run]
"""
import calendar
from datetime import date, datetime, timedelta
import click
from sqlalchemy import func, or_

from .. import db
from ..models.Admin_models import Admin
from ..models.manager_model import ManagerContact
from ..models.probation import ProbationReview
from ..manager_utils import get_manager_emails, get_manager_detail
from ..email import send_probation_reminder_email


PROBATION_MONTHS = 6
REMINDER_DAYS_BEFORE = 15


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


def run_probation_reminder(run_date):
    """
    Find employees whose 6-month probation ends in 15 days; create ProbationReview, send email to HR + manager.
    Returns summary dict.
    """
    summary = {"run_date": run_date.isoformat(), "reminders_sent": 0, "skipped_no_doj": 0, "skipped_already_sent": 0}
    reminder_date = run_date  # we run for run_date; reminder_date = probation_end - 15
    # So probation_end_date = reminder_date + 15. We want employees with probation_end_date = run_date + 15.
    probation_end_date = run_date + timedelta(days=REMINDER_DAYS_BEFORE)

    admins = Admin.query.filter(
        Admin.doj.isnot(None),
        db.func.coalesce(Admin.is_active, True) == True,
        db.func.coalesce(Admin.is_exited, False) == False,
    ).all()

    for admin in admins:
        doj = admin.doj
        if not doj:
            summary["skipped_no_doj"] += 1
            continue
        # Probation end = doj + 6 months (calendar months)
        mo = doj.month + PROBATION_MONTHS
        yr = doj.year + (mo - 1) // 12
        mo = (mo - 1) % 12 + 1
        last = calendar.monthrange(yr, mo)[1]
        end = date(yr, mo, min(doj.day, last))
        if end != probation_end_date:
            continue
        # This employee's probation ends on probation_end_date; reminder_date is today (run_date)
        existing = ProbationReview.query.filter_by(
            admin_id=admin.id,
            probation_end_date=end,
        ).first()
        if existing and existing.reminder_sent_at:
            summary["skipped_already_sent"] += 1
            continue
        if not existing:
            existing = ProbationReview(admin_id=admin.id, probation_end_date=end)
            db.session.add(existing)
            db.session.flush()
        contact = _get_contact_for_admin(admin)
        manager_emails = get_manager_emails(contact) if contact else []
        send_probation_reminder_email(admin, end, manager_emails)
        existing.reminder_sent_at = datetime.utcnow()
        summary["reminders_sent"] += 1

    return summary


def register_probation_command(app):
    @app.cli.command("probation-reminder")
    @click.option("--run-date", default=None, help="Date to run for (YYYY-MM-DD). Default: today.")
    @click.option("--dry-run", is_flag=True, help="Do not commit changes.")
    def probation_reminder_command(run_date, dry_run):
        """Send probation reminders (15 days before 6-month completion) to HR and manager."""
        if run_date:
            try:
                run_date_obj = datetime.strptime(run_date, "%Y-%m-%d").date()
            except ValueError:
                raise click.ClickException("Invalid --run-date. Use YYYY-MM-DD.")
        else:
            run_date_obj = date.today()

        with app.app_context():
            summary = run_probation_reminder(run_date_obj)
            if dry_run:
                db.session.rollback()
                click.echo("Dry run. No DB changes committed.")
            else:
                db.session.commit()
            click.echo(
                f"probation-reminder: date={summary['run_date']}, "
                f"reminders_sent={summary['reminders_sent']}, "
                f"skipped_no_doj={summary['skipped_no_doj']}, "
                f"skipped_already_sent={summary['skipped_already_sent']}"
            )
