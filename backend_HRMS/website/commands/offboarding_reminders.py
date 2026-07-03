"""
Offboarding reminders: LWD approaching (7/3/1 days) and NOC SLA overdue.
Run daily via scheduler or: flask offboarding-reminders [--run-date] [--dry-run]
"""
from __future__ import annotations

from datetime import datetime, timedelta

import click
from flask import current_app
from sqlalchemy import func

from .. import db
from ..datetime_utils import utc_now
from ..email import send_lwd_approaching_reminder, send_noc_sla_reminder
from ..models.Admin_models import Admin, EmployeeExitHistory
from ..models.offboarding_reminder import OffboardingReminderLog
from ..models.seperation import Resignation
from ..offboarding_service import (
    NOC_SLA_DAYS,
    _admin_display_name,
    get_noc_sla_overdue_items,
)

LWD_REMINDER_DAYS = (7, 3, 1)
NOC_SLA_DAYS = 5
NOTICE_PERIOD_DAYS = 90


def _claim_reminder(reminder_key: str, *, dry_run: bool) -> bool:
    if dry_run:
        existing = OffboardingReminderLog.query.filter_by(reminder_key=reminder_key).first()
        return existing is None
    try:
        row = OffboardingReminderLog(reminder_key=reminder_key, sent_at=utc_now())
        db.session.add(row)
        db.session.flush()
        return True
    except Exception:
        db.session.rollback()
        return False


def _release_reminder(reminder_key: str) -> None:
    OffboardingReminderLog.query.filter_by(reminder_key=reminder_key).delete(
        synchronize_session=False
    )


def _lwd_targets_for_offset(run_date, days_before: int) -> list[dict]:
    target_lwd = run_date + timedelta(days=days_before)
    out: list[dict] = []
    seen: set[int] = set()

    grace_rows = (
        Admin.query.filter(Admin.exit_login_until == target_lwd)
        .filter(func.coalesce(Admin.is_exited, False) == True)
        .all()
    )
    for admin in grace_rows:
        if admin.id in seen:
            continue
        seen.add(admin.id)
        out.append(
            {
                "admin_id": admin.id,
                "name": _admin_display_name(admin),
                "email": admin.email,
                "emp_id": admin.emp_id,
                "last_working_day": target_lwd,
                "days_before": days_before,
                "source": "exit_grace",
            }
        )

    active_res = (
        Resignation.query.filter(func.lower(func.coalesce(Resignation.status, "")) == "approved")
        .all()
    )
    for res in active_res:
        admin = Admin.query.get(res.admin_id)
        if not admin or admin.id in seen:
            continue
        if getattr(admin, "is_exited", False):
            continue
        if not res.resignation_date:
            continue
        notice_end = res.resignation_date + timedelta(days=NOTICE_PERIOD_DAYS)
        if notice_end != target_lwd:
            continue
        seen.add(admin.id)
        out.append(
            {
                "admin_id": admin.id,
                "name": _admin_display_name(admin),
                "email": admin.email,
                "emp_id": admin.emp_id,
                "last_working_day": target_lwd,
                "days_before": days_before,
                "source": "notice_end",
            }
        )

    hist_rows = (
        db.session.query(EmployeeExitHistory, Admin)
        .join(Admin, Admin.id == EmployeeExitHistory.admin_id)
        .filter(EmployeeExitHistory.last_working_day == target_lwd)
        .filter(func.coalesce(Admin.is_exited, False) == False)
        .all()
    )
    for hist, admin in hist_rows:
        if admin.id in seen:
            continue
        seen.add(admin.id)
        out.append(
            {
                "admin_id": admin.id,
                "name": _admin_display_name(admin),
                "email": admin.email,
                "emp_id": admin.emp_id,
                "last_working_day": target_lwd,
                "days_before": days_before,
                "source": "scheduled_exit",
            }
        )

    return out


def _noc_sla_overdue(run_date) -> list[dict]:
    return get_noc_sla_overdue_items(run_date)


def run_offboarding_reminders(run_date, *, dry_run: bool = False) -> dict:
    summary = {
        "run_date": run_date.isoformat(),
        "lwd_reminders_sent": 0,
        "noc_sla_reminders_sent": 0,
        "skipped": 0,
    }

    for days_before in LWD_REMINDER_DAYS:
        for target in _lwd_targets_for_offset(run_date, days_before):
            key = f"lwd:{target['admin_id']}:{days_before}"
            if not _claim_reminder(key, dry_run=dry_run):
                summary["skipped"] += 1
                continue
            if dry_run:
                summary["lwd_reminders_sent"] += 1
                continue
            ok = send_lwd_approaching_reminder(
                employee_email=target.get("email"),
                employee_name=target.get("name"),
                emp_id=target.get("emp_id"),
                last_working_day=target["last_working_day"],
                days_before=days_before,
            )
            if ok:
                summary["lwd_reminders_sent"] += 1
                db.session.commit()
            else:
                _release_reminder(key)
                db.session.commit()
                summary["skipped"] += 1

    for item in _noc_sla_overdue(run_date):
        key = f"noc_sla:{item['noc_id']}"
        if not _claim_reminder(key, dry_run=dry_run):
            summary["skipped"] += 1
            continue
        if dry_run:
            summary["noc_sla_reminders_sent"] += 1
            continue
        ok = send_noc_sla_reminder(
            department_key=item.get("department_key"),
            employee_name=item.get("employee_name"),
            employee_email=item.get("employee_email"),
            days_pending=item.get("days_pending"),
        )
        if ok:
            summary["noc_sla_reminders_sent"] += 1
            db.session.commit()
        else:
            _release_reminder(key)
            db.session.commit()
            summary["skipped"] += 1

    return summary


def register_offboarding_reminders_command(app):
    @app.cli.command("offboarding-reminders")
    @click.option("--run-date", default=None, help="YYYY-MM-DD (IST calendar date)")
    @click.option("--dry-run", is_flag=True, help="Count only; do not send or persist")
    def offboarding_reminders_cmd(run_date, dry_run):
        """Send LWD approaching and NOC SLA overdue reminders."""
        from zoneinfo import ZoneInfo

        if run_date:
            parsed = datetime.strptime(run_date, "%Y-%m-%d").date()
        else:
            parsed = datetime.now(ZoneInfo("Asia/Kolkata")).date()
        with app.app_context():
            result = run_offboarding_reminders(parsed, dry_run=dry_run)
            click.echo(result)
