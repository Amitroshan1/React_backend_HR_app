import calendar
from datetime import date, datetime
from zoneinfo import ZoneInfo

import click

from .. import db
from ..models.Admin_models import Admin
from ..models.attendance import LeaveBalance
from ..models.leave_accrual_log import LeaveAccrualLog


PL_CARRY_FORWARD_CAP = 45.0
PL_CREDIT_VALUE = 1.0
CL_CREDIT_VALUE = 1.0
IST_ZONE = ZoneInfo("Asia/Kolkata")
PROBATION_MONTHS = 6


def _probation_end_date(doj):
    """Return date when 6-month probation ends (DOJ + 6 calendar months). Returns None if doj is None."""
    if doj is None:
        return None
    mo = doj.month + PROBATION_MONTHS
    yr = doj.year + (mo - 1) // 12
    mo = (mo - 1) % 12 + 1
    last = calendar.monthrange(yr, mo)[1]
    return date(yr, mo, min(doj.day, last))


def _event_exists(admin_id, event_key):
    return (
        LeaveAccrualLog.query.filter_by(admin_id=admin_id, event_key=event_key).first()
        is not None
    )


def _mark_event(admin_id, event_key, run_date):
    db.session.add(
        LeaveAccrualLog(admin_id=admin_id, event_key=event_key, run_date=run_date)
    )


def _ensure_leave_balance(admin_id):
    leave_balance = LeaveBalance.query.filter_by(admin_id=admin_id).first()
    if leave_balance:
        return leave_balance, False

    leave_balance = LeaveBalance(
        admin_id=admin_id,
        privilege_leave_balance=0.0,
        casual_leave_balance=0.0,
        compensatory_leave_balance=0.0,
        total_privilege_leave=0.0,
        total_casual_leave=0.0,
        total_compensatory_leave=0.0,
        used_privilege_leave=0.0,
        used_casual_leave=0.0,
        used_comp_leave=0.0,
    )
    db.session.add(leave_balance)
    db.session.flush()
    return leave_balance, True


def _run_leave_accrual_for_date(run_date):
    summary = {
        "run_date": run_date.isoformat(),
        "admins_scanned": 0,
        "balances_created": 0,
        "year_resets": 0,
        "pl_credits": 0,
        "cl_credits": 0,
        "events_skipped_existing": 0,
        "skipped_on_probation": 0,
    }

    should_reset_year = run_date.month == 1 and run_date.day == 1
    should_credit_20th = run_date.day == 20
    should_credit_pl_20th = should_credit_20th and 1 <= run_date.month <= 11
    should_credit_cl_20th = should_credit_20th and 1 <= run_date.month <= 8
    should_credit_pl_extra_july = run_date.month == 7 and run_date.day == 1
    should_credit_pl_dec_1 = run_date.month == 12 and run_date.day == 1

    admins = (
        Admin.query.filter(
            db.func.coalesce(Admin.is_active, True) == True,
            db.func.coalesce(Admin.is_exited, False) == False,
        )
        .order_by(Admin.id.asc())
        .all()
    )

    for admin in admins:
        summary["admins_scanned"] += 1
        leave_balance, created_new = _ensure_leave_balance(admin.id)
        if created_new:
            summary["balances_created"] += 1

        # PL/CL accrual only after 6-month probation; new joiners get no credits until then
        probation_end = _probation_end_date(admin.doj)
        if probation_end is None or run_date < probation_end:
            summary["skipped_on_probation"] += 1
            continue

        if should_reset_year:
            event_key = f"YEAR_RESET_{run_date.year}_01_01"
            if _event_exists(admin.id, event_key):
                summary["events_skipped_existing"] += 1
            else:
                leave_balance.casual_leave_balance = 0.0
                leave_balance.privilege_leave_balance = min(
                    float(leave_balance.privilege_leave_balance or 0.0),
                    PL_CARRY_FORWARD_CAP,
                )
                _mark_event(admin.id, event_key, run_date)
                summary["year_resets"] += 1

        if should_credit_pl_extra_july:
            event_key = f"PL_EXTRA_{run_date.year}_07_01"
            if _event_exists(admin.id, event_key):
                summary["events_skipped_existing"] += 1
            else:
                leave_balance.privilege_leave_balance = float(
                    leave_balance.privilege_leave_balance or 0.0
                ) + PL_CREDIT_VALUE
                _mark_event(admin.id, event_key, run_date)
                summary["pl_credits"] += 1

        if should_credit_pl_dec_1:
            event_key = f"PL_DEC_{run_date.year}_12_01"
            if _event_exists(admin.id, event_key):
                summary["events_skipped_existing"] += 1
            else:
                leave_balance.privilege_leave_balance = float(
                    leave_balance.privilege_leave_balance or 0.0
                ) + PL_CREDIT_VALUE
                _mark_event(admin.id, event_key, run_date)
                summary["pl_credits"] += 1

        if should_credit_pl_20th:
            event_key = f"PL_{run_date.year}_{run_date.month:02d}_20"
            if _event_exists(admin.id, event_key):
                summary["events_skipped_existing"] += 1
            else:
                leave_balance.privilege_leave_balance = float(
                    leave_balance.privilege_leave_balance or 0.0
                ) + PL_CREDIT_VALUE
                _mark_event(admin.id, event_key, run_date)
                summary["pl_credits"] += 1

        if should_credit_cl_20th:
            event_key = f"CL_{run_date.year}_{run_date.month:02d}_20"
            if _event_exists(admin.id, event_key):
                summary["events_skipped_existing"] += 1
            else:
                leave_balance.casual_leave_balance = float(
                    leave_balance.casual_leave_balance or 0.0
                ) + CL_CREDIT_VALUE
                _mark_event(admin.id, event_key, run_date)
                summary["cl_credits"] += 1

    return summary


def register_leave_accrual_command(app):
    @app.cli.command("leave-accrual-run")
    @click.option(
        "--run-date",
        "run_date_str",
        default=None,
        help="Run date in YYYY-MM-DD format. Defaults to today (Asia/Kolkata).",
    )
    @click.option("--dry-run", is_flag=True, default=False, help="Preview without committing.")
    def leave_accrual_run_command(run_date_str, dry_run):
        """Apply PL/CL accrual and yearly reset idempotently."""
        if run_date_str:
            try:
                run_date = datetime.strptime(run_date_str, "%Y-%m-%d").date()
            except ValueError:
                raise click.ClickException("Invalid --run-date. Use YYYY-MM-DD.")
        else:
            run_date = datetime.now(IST_ZONE).date()

        summary = _run_leave_accrual_for_date(run_date)
        if dry_run:
            db.session.rollback()
            click.echo("Dry run complete. No DB changes committed.")
        else:
            db.session.commit()

        click.echo(
            "leave-accrual-run summary: "
            f"date={summary['run_date']}, "
            f"admins_scanned={summary['admins_scanned']}, "
            f"skipped_on_probation={summary['skipped_on_probation']}, "
            f"year_resets={summary['year_resets']}, "
            f"pl_credits={summary['pl_credits']}, "
            f"cl_credits={summary['cl_credits']}, "
            f"events_skipped_existing={summary['events_skipped_existing']}"
        )
