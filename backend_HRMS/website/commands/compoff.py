"""
Daily comp-off job: create gains from Sunday and public-holiday work (max 2/month),
sync balance, send expiry reminders.
Run via: flask compoff-process [--run-date YYYY-MM-DD] [--dry-run]
"""
from datetime import date, datetime, timedelta
from ..datetime_utils import utc_now

import click
from sqlalchemy.exc import IntegrityError

from .. import db
from ..models.Admin_models import Admin
from ..models.attendance import Punch, CompOffGain
from ..compoff_utils import (
    COMP_OFF_VALID_DAYS,
    dedupe_duplicate_sunday_compoff_gains,
    work_gain_dedupe_key,
    sync_comp_balance_for_admin,
)
from ..email import send_compoff_expiry_reminder
from ..tenant_jobs import (
    admin_id_scope,
    admin_scope,
    merge_tenant_summaries,
    run_in_each_tenant_scope,
)

REMINDER_DAYS_BEFORE = 7
MAX_GAINS_PER_MONTH = 2
LOOKBACK_DAYS = 62  # look back for Sunday / public-holiday punches


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


def _worked_sunday(punch):
    """Sunday credit: any clock-in or clock-out (unchanged historical rule)."""
    if not punch:
        return False
    return punch.punch_in is not None or punch.punch_out is not None


def _worked_public_holiday(punch):
    """Public-holiday credit: both punch in and punch out must exist."""
    if not punch:
        return False
    return punch.punch_in is not None and punch.punch_out is not None


def _mandatory_holiday_dates(start_date, end_date, tenant_id=None):
    """Active non-optional company holidays in [start_date, end_date]."""
    from ..cache import active_holidays_for_year, holiday_as_date
    from ..tenant_context import get_current_tenant_id

    tid = tenant_id if tenant_id is not None else get_current_tenant_id()
    out = set()
    for year in range(start_date.year, end_date.year + 1):
        for row in active_holidays_for_year(tid, year):
            if row.get("is_optional"):
                continue
            d = holiday_as_date(row.get("holiday_date"))
            if d is None or d < start_date or d > end_date:
                continue
            out.add(d)
    return out


def _try_create_gain(admin_id, gain_date, summary):
    if _already_has_gain_for_date(admin_id, gain_date):
        return
    year, month = gain_date.year, gain_date.month
    if _gains_count_in_month(admin_id, year, month) >= MAX_GAINS_PER_MONTH:
        return
    expiry = gain_date + timedelta(days=COMP_OFF_VALID_DAYS)
    key = work_gain_dedupe_key(admin_id, gain_date)
    try:
        with db.session.begin_nested():
            db.session.add(
                CompOffGain(
                    admin_id=admin_id,
                    gain_date=gain_date,
                    expiry_date=expiry,
                    used=0.0,
                    dedupe_key=key,
                )
            )
            db.session.flush()
        summary["gains_created"] += 1
    except IntegrityError:
        return


def run_compoff_process(run_date, tenant_id=None):
    """
    Create comp-off gains from Sunday and public-holiday punches, sync balances,
    send 7-day expiry reminders. One tenant, or all when tenant_id is None.
    """
    today = run_date
    summary = {
        "run_date": today.isoformat(),
        "gains_created": 0,
        "duplicates_removed": 0,
        "balances_synced": 0,
        "reminders_sent": 0,
    }

    # 0) Remove triplicate Sunday rows from multi-worker races (production cleanup)
    summary["duplicates_removed"] = dedupe_duplicate_sunday_compoff_gains(tenant_id)

    start = today - timedelta(days=LOOKBACK_DAYS)
    admins = Admin.query.filter(
        admin_scope(tenant_id),
        db.func.coalesce(Admin.is_exited, False) == False,
    ).all()
    admin_ids = [a.id for a in admins]
    holiday_dates = _mandatory_holiday_dates(start, today, tenant_id)

    punches = []
    if admin_ids:
        punches = Punch.query.filter(
            Punch.admin_id.in_(admin_ids),
            Punch.punch_date >= start,
            Punch.punch_date <= today,
        ).all()
    punch_map = {(p.admin_id, p.punch_date): p for p in punches}

    for admin in admins:
        admin_id = admin.id
        for sunday in _sundays_in_range(start, today):
            if not _worked_sunday(punch_map.get((admin_id, sunday))):
                continue
            _try_create_gain(admin_id, sunday, summary)
        for holiday in sorted(holiday_dates):
            if holiday.weekday() == 6:
                continue
            if not _worked_public_holiday(punch_map.get((admin_id, holiday))):
                continue
            _try_create_gain(admin_id, holiday, summary)

    # 2) Sync LeaveBalance.compensatory_leave_balance for all admins with comp_off_gains or leave_balance
    for admin in admins:
        sync_comp_balance_for_admin(admin.id)
        summary["balances_synced"] += 1

    # 3) Send reminders for gains expiring in REMINDER_DAYS_BEFORE days
    expiry_target = today + timedelta(days=REMINDER_DAYS_BEFORE)
    reminder_gains = CompOffGain.query.filter(
        admin_id_scope(CompOffGain.admin_id, tenant_id),
        CompOffGain.expiry_date == expiry_target,
        CompOffGain.reminder_sent_at.is_(None),
        CompOffGain.used < 1.0,
    ).all()

    for g in reminder_gains:
        admin = Admin.query.get(g.admin_id)
        if admin and admin.email:
            if send_compoff_expiry_reminder(admin, g.gain_date, g.expiry_date):
                g.reminder_sent_at = utc_now()
                summary["reminders_sent"] += 1

    return summary


def register_compoff_command(app):
    @app.cli.command("compoff-process")
    @click.option("--run-date", default=None, help="Date to run for (YYYY-MM-DD). Default: today.")
    @click.option("--dry-run", is_flag=True, help="Do not commit changes.")
    def compoff_process_command(run_date, dry_run):
        """Create comp-off from Sunday and public-holiday work, sync balance, send expiry reminders."""
        if run_date:
            try:
                run_date_obj = datetime.strptime(run_date, "%Y-%m-%d").date()
            except ValueError:
                raise click.ClickException("Invalid --run-date. Use YYYY-MM-DD.")
        else:
            from datetime import date as d
            run_date_obj = d.today()

        with app.app_context():
            summary = merge_tenant_summaries(
                run_in_each_tenant_scope(lambda tid: run_compoff_process(run_date_obj, tenant_id=tid))
            )
            if dry_run:
                db.session.rollback()
                click.echo("Dry run. No DB changes committed.")
            else:
                db.session.commit()

            click.echo(
                f"compoff-process: date={summary['run_date']}, "
                f"gains_created={summary['gains_created']}, "
                f"duplicates_removed={summary['duplicates_removed']}, "
                f"balances_synced={summary['balances_synced']}, "
                f"reminders_sent={summary['reminders_sent']}"
            )

    @app.cli.command("compoff-dedupe")
    @click.option("--dry-run", is_flag=True, help="Do not commit changes.")
    def compoff_dedupe_command(dry_run):
        """Remove duplicate Sunday Comp Off gains (keeps one per employee/date)."""
        with app.app_context():
            removed = dedupe_duplicate_sunday_compoff_gains()
            if dry_run:
                db.session.rollback()
                click.echo(f"Dry run. Would remove {removed} duplicate Comp Off gain(s).")
            else:
                db.session.commit()
                click.echo(f"Removed {removed} duplicate Comp Off gain(s).")
