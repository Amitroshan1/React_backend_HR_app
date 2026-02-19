"""
Daily comp-off job: create gains from Sunday work (max 2/month), sync balance, send expiry reminders.
Run via: flask compoff-process [--run-date YYYY-MM-DD] [--dry-run]
"""
from datetime import date, datetime, timedelta

import click

from .. import db
from ..models.Admin_models import Admin
from ..models.attendance import Punch, CompOffGain, LeaveBalance
from ..compoff_utils import get_effective_comp_balance, sync_comp_balance_for_admin
from ..email import send_compoff_expiry_reminder

COMP_OFF_VALID_DAYS = 30
REMINDER_DAYS_BEFORE = 7
MAX_GAINS_PER_MONTH = 2
LOOKBACK_DAYS = 62  # look back for Sunday punches


def _sundays_in_range(start_date, end_date):
    """Yield all dates that are Sunday (weekday 6) in [start_date, end_date]."""
    d = start_date
    while d <= end_date:
        if d.weekday() == 6:
            yield d
        d += timedelta(days=1)


def _gains_count_in_month(admin_id, year, month):
    """Number of CompOffGain rows for this admin in this calendar month."""
    import calendar
    first = date(year, month, 1)
    last_day = calendar.monthrange(year, month)[1]
    last = date(year, month, last_day)
    return CompOffGain.query.filter(
        CompOffGain.admin_id == admin_id,
        CompOffGain.gain_date >= first,
        CompOffGain.gain_date <= last,
    ).count()


def _already_has_gain_for_date(admin_id, gain_date):
    return CompOffGain.query.filter_by(
        admin_id=admin_id,
        gain_date=gain_date,
    ).first() is not None


def _worked_sunday(admin_id, punch_date):
    """True if admin has a punch on this date with punch_in or punch_out set."""
    p = Punch.query.filter_by(admin_id=admin_id, punch_date=punch_date).first()
    if not p:
        return False
    return p.punch_in is not None or p.punch_out is not None


def run_compoff_process(run_date):
    """
    Create comp-off gains from Sunday punches, sync balances, send 7-day expiry reminders.
    Returns a summary dict.
    """
    today = run_date
    summary = {
        "run_date": today.isoformat(),
        "gains_created": 0,
        "balances_synced": 0,
        "reminders_sent": 0,
    }

    # 1) Create gains from Sunday punches (look back LOOKBACK_DAYS)
    start = today - timedelta(days=LOOKBACK_DAYS)
    admins = Admin.query.filter(
        db.func.coalesce(Admin.is_exited, False) == False,
    ).all()

    for admin in admins:
        admin_id = admin.id
        for sunday in _sundays_in_range(start, today):
            if not _worked_sunday(admin_id, sunday):
                continue
            if _already_has_gain_for_date(admin_id, sunday):
                continue
            year, month = sunday.year, sunday.month
            if _gains_count_in_month(admin_id, year, month) >= MAX_GAINS_PER_MONTH:
                continue
            expiry = sunday + timedelta(days=COMP_OFF_VALID_DAYS)
            db.session.add(
                CompOffGain(
                    admin_id=admin_id,
                    gain_date=sunday,
                    expiry_date=expiry,
                    used=0.0,
                )
            )
            summary["gains_created"] += 1

    # 2) Sync LeaveBalance.compensatory_leave_balance for all admins with comp_off_gains or leave_balance
    for admin in admins:
        sync_comp_balance_for_admin(admin.id)
        summary["balances_synced"] += 1

    # 3) Send reminders for gains expiring in REMINDER_DAYS_BEFORE days
    expiry_target = today + timedelta(days=REMINDER_DAYS_BEFORE)
    reminder_gains = CompOffGain.query.filter(
        CompOffGain.expiry_date == expiry_target,
        CompOffGain.reminder_sent_at.is_(None),
        CompOffGain.used < 1.0,
    ).all()

    for g in reminder_gains:
        admin = Admin.query.get(g.admin_id)
        if admin and admin.email:
            if send_compoff_expiry_reminder(admin, g.gain_date, g.expiry_date):
                g.reminder_sent_at = datetime.utcnow()
                summary["reminders_sent"] += 1

    return summary


def register_compoff_command(app):
    @app.cli.command("compoff-process")
    @click.option("--run-date", default=None, help="Date to run for (YYYY-MM-DD). Default: today.")
    @click.option("--dry-run", is_flag=True, help="Do not commit changes.")
    def compoff_process_command(run_date, dry_run):
        """Create comp-off from Sunday work, sync balance, send expiry reminders."""
        if run_date:
            try:
                run_date_obj = datetime.strptime(run_date, "%Y-%m-%d").date()
            except ValueError:
                raise click.ClickException("Invalid --run-date. Use YYYY-MM-DD.")
        else:
            from datetime import date as d
            run_date_obj = d.today()

        with app.app_context():
            summary = run_compoff_process(run_date_obj)
            if dry_run:
                db.session.rollback()
                click.echo("Dry run. No DB changes committed.")
            else:
                db.session.commit()

            click.echo(
                f"compoff-process: date={summary['run_date']}, "
                f"gains_created={summary['gains_created']}, "
                f"balances_synced={summary['balances_synced']}, "
                f"reminders_sent={summary['reminders_sent']}"
            )
