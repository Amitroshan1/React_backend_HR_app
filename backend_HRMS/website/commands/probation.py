"""
Probation review reminders:
- T-15 days: initial reminder to manager + HR
- T-7 days: follow-up if manager has not submitted
- Overdue: escalation after probation end if still pending

Run daily via scheduler or: flask probation-reminder [--run-date YYYY-MM-DD] [--dry-run]
"""
from datetime import date, datetime, timedelta

import click
from sqlalchemy import func, or_

from ..datetime_utils import utc_now
from .. import db
from ..models.Admin_models import Admin
from ..models.manager_model import ManagerContact
from ..models.probation import ProbationReview
from ..manager_utils import get_manager_emails
from ..email import (
    send_probation_reminder_email,
    send_probation_followup_reminder_email,
    send_probation_overdue_escalation_email,
)
from ..probation_utils import (
    STATUS_MANAGER_SUBMITTED,
    STATUS_REMINDER_SENT,
    TERMINAL_STATUSES,
    REMINDER_DAYS_BEFORE,
    FOLLOWUP_DAYS_BEFORE,
    compute_probation_end_date,
    infer_status_from_row,
)


def dedupe_probation_review_rows():
    """
    Merge duplicate ProbationReview rows for the same (admin_id, probation_end_date).
    Keeps one canonical row (prefer one with reviewed_at, else lowest id), merges timestamps.
    Returns number of duplicate rows removed (0 if none).
    """
    dup_groups = (
        db.session.query(
            ProbationReview.admin_id,
            ProbationReview.probation_end_date,
            func.count(ProbationReview.id),
        )
        .group_by(ProbationReview.admin_id, ProbationReview.probation_end_date)
        .having(func.count(ProbationReview.id) > 1)
        .all()
    )
    removed = 0
    for admin_id, end_date, _cnt in dup_groups:
        rows = (
            ProbationReview.query.filter_by(admin_id=admin_id, probation_end_date=end_date)
            .order_by(ProbationReview.id.asc())
            .all()
        )
        if len(rows) < 2:
            continue
        reviewed = [r for r in rows if r.reviewed_at]
        if reviewed:
            keeper = min(reviewed, key=lambda r: r.id)
        else:
            keeper = rows[0]
        others = [r for r in rows if r.id != keeper.id]

        def _latest_ts(attr):
            latest = getattr(keeper, attr, None)
            for r in rows:
                val = getattr(r, attr, None)
                if val and (latest is None or val > latest):
                    latest = val
            return latest

        keeper.reminder_sent_at = _latest_ts("reminder_sent_at")
        keeper.followup_reminder_sent_at = _latest_ts("followup_reminder_sent_at")
        keeper.overdue_escalation_sent_at = _latest_ts("overdue_escalation_sent_at")
        if not keeper.status:
            keeper.status = infer_status_from_row(keeper)
        for r in others:
            db.session.delete(r)
            removed += 1
    return removed


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


def _manager_emails_for_admin(admin):
    contact = _get_contact_for_admin(admin)
    return get_manager_emails(contact) if contact else []


def _is_active_employee(admin):
    if not admin or not admin.doj:
        return False
    if getattr(admin, "is_active", True) is False:
        return False
    if getattr(admin, "is_exited", False):
        return False
    return True


def _pending_manager_review(row):
    status = infer_status_from_row(row)
    if status in TERMINAL_STATUSES or status == STATUS_MANAGER_SUBMITTED:
        return False
    return bool(row.reminder_sent_at) and not row.reviewed_at


def _get_or_create_review(admin, end_date):
    existing = ProbationReview.query.filter_by(
        admin_id=admin.id,
        probation_end_date=end_date,
    ).first()
    if existing:
        return existing
    row = ProbationReview(admin_id=admin.id, probation_end_date=end_date)
    db.session.add(row)
    db.session.flush()
    return row


def _process_initial_reminders(run_date, summary):
    target_end = run_date + timedelta(days=REMINDER_DAYS_BEFORE)
    admins = Admin.query.filter(
        Admin.doj.isnot(None),
        db.func.coalesce(Admin.is_active, True) == True,
        db.func.coalesce(Admin.is_exited, False) == False,
    ).all()

    for admin in admins:
        end = compute_probation_end_date(admin.doj)
        if not end or end != target_end:
            continue
        existing = _get_or_create_review(admin, end)
        if existing.reminder_sent_at:
            summary["skipped_already_sent"] += 1
            continue
        manager_emails = _manager_emails_for_admin(admin)
        send_probation_reminder_email(admin, end, manager_emails)
        existing.reminder_sent_at = utc_now()
        existing.status = STATUS_REMINDER_SENT
        summary["reminders_sent"] += 1


def _process_followup_reminders(run_date, summary):
    target_end = run_date + timedelta(days=FOLLOWUP_DAYS_BEFORE)
    rows = (
        ProbationReview.query.filter(
            ProbationReview.reminder_sent_at.isnot(None),
            ProbationReview.reviewed_at.is_(None),
            ProbationReview.probation_end_date == target_end,
        )
        .all()
    )
    for row in rows:
        if row.followup_reminder_sent_at:
            summary["followup_skipped_already_sent"] += 1
            continue
        status = infer_status_from_row(row)
        if status in TERMINAL_STATUSES or status == STATUS_MANAGER_SUBMITTED:
            summary["followup_skipped_submitted"] += 1
            continue
        admin = Admin.query.get(row.admin_id)
        if not _is_active_employee(admin):
            summary["followup_skipped_inactive"] += 1
            continue
        manager_emails = _manager_emails_for_admin(admin)
        send_probation_followup_reminder_email(admin, row.probation_end_date, manager_emails)
        row.followup_reminder_sent_at = utc_now()
        summary["followup_reminders_sent"] += 1


def _process_overdue_escalations(run_date, summary):
    rows = (
        ProbationReview.query.filter(
            ProbationReview.reminder_sent_at.isnot(None),
            ProbationReview.reviewed_at.is_(None),
            ProbationReview.probation_end_date < run_date,
        )
        .all()
    )
    for row in rows:
        if row.overdue_escalation_sent_at:
            summary["overdue_skipped_already_sent"] += 1
            continue
        status = infer_status_from_row(row)
        if status in TERMINAL_STATUSES or status == STATUS_MANAGER_SUBMITTED:
            summary["overdue_skipped_submitted"] += 1
            continue
        admin = Admin.query.get(row.admin_id)
        if not _is_active_employee(admin):
            summary["overdue_skipped_inactive"] += 1
            continue
        manager_emails = _manager_emails_for_admin(admin)
        send_probation_overdue_escalation_email(admin, row.probation_end_date, manager_emails)
        row.overdue_escalation_sent_at = utc_now()
        summary["overdue_escalations_sent"] += 1


def run_probation_reminder(run_date):
    """Run T-15, T-7, and overdue probation reminder jobs for run_date."""
    summary = {
        "run_date": run_date.isoformat(),
        "reminders_sent": 0,
        "skipped_already_sent": 0,
        "followup_reminders_sent": 0,
        "followup_skipped_already_sent": 0,
        "followup_skipped_submitted": 0,
        "followup_skipped_inactive": 0,
        "overdue_escalations_sent": 0,
        "overdue_skipped_already_sent": 0,
        "overdue_skipped_submitted": 0,
        "overdue_skipped_inactive": 0,
        "dedupe_removed": 0,
    }
    merged = dedupe_probation_review_rows()
    summary["dedupe_removed"] = merged
    if merged:
        db.session.flush()

    _process_initial_reminders(run_date, summary)
    _process_followup_reminders(run_date, summary)
    _process_overdue_escalations(run_date, summary)
    return summary


def register_probation_command(app):
    @app.cli.command("probation-dedupe")
    def probation_dedupe_command():
        """Merge duplicate probation_reviews rows (same employee + probation end date)."""
        with app.app_context():
            n = dedupe_probation_review_rows()
            db.session.commit()
            click.echo(f"probation-dedupe: removed {n} duplicate row(s).")

    @app.cli.command("probation-reminder")
    @click.option("--run-date", default=None, help="Date to run for (YYYY-MM-DD). Default: today.")
    @click.option("--dry-run", is_flag=True, help="Do not commit changes.")
    def probation_reminder_command(run_date, dry_run):
        """Send probation reminders (T-15, T-7 follow-up, overdue escalation)."""
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
                "probation-reminder: "
                f"date={summary['run_date']}, "
                f"reminders_sent={summary['reminders_sent']}, "
                f"followup_reminders_sent={summary['followup_reminders_sent']}, "
                f"overdue_escalations_sent={summary['overdue_escalations_sent']}, "
                f"dedupe_removed={summary['dedupe_removed']}"
            )
