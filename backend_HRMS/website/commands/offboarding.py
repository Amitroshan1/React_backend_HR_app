"""Offboarding scheduled jobs — LWD login deactivation."""
from __future__ import annotations

import click
from datetime import datetime
from zoneinfo import ZoneInfo

IST = ZoneInfo("Asia/Kolkata")


def run_offboarding_daily(run_date=None, *, dry_run: bool = False) -> dict:
    from .. import db
    from ..offboarding_service import run_lwd_deactivation_job

    today = run_date or datetime.now(IST).date()
    if dry_run:
        from ..models.Admin_models import Admin

        count = (
            Admin.query.filter(Admin.is_exited.is_(True))
            .filter(Admin.exit_login_until.isnot(None))
            .filter(Admin.exit_login_until < today)
            .count()
        )
        return {"deactivated": 0, "would_deactivate": count, "run_date": today.isoformat()}

    n = run_lwd_deactivation_job(today)
    db.session.commit()
    return {"deactivated": n, "run_date": today.isoformat()}


def register_offboarding_commands(app):
    @app.cli.command("offboarding-daily")
    @click.option("--run-date", default=None, help="YYYY-MM-DD (IST calendar date)")
    @click.option("--dry-run", is_flag=True, help="Count only; do not deactivate")
    def offboarding_daily_cmd(run_date, dry_run):
        """Deactivate login for employees past scheduled last working day."""
        parsed = None
        if run_date:
            parsed = datetime.strptime(run_date, "%Y-%m-%d").date()
        result = run_offboarding_daily(parsed, dry_run=dry_run)
        click.echo(result)
