"""Manual NHQ biometric day finalization (ops / catch-up)."""

from __future__ import annotations

import json
from datetime import datetime

import click


def register_biometric_finalize_command(app):
    @app.cli.command("biometric-finalize-day")
    @click.option(
        "--date",
        "run_date",
        default=None,
        help="Attendance date YYYY-MM-DD (default: today IST when past 20:00, else catch-up only)",
    )
    @click.option("--dry-run", is_flag=True, help="Report actions without committing")
    @click.option(
        "--no-catchup",
        is_flag=True,
        help="Only process --date (or today), skip prior-day catch-up",
    )
    def biometric_finalize_day(run_date, dry_run, no_catchup):
        """Finalize NHQ biometric open sessions at 20:00 IST cutoff for the given day(s)."""
        from ..biometric.finalization import finalize_all_nhq_biometric_days
        from ..datetime_utils import IST

        for_date = None
        if run_date:
            for_date = datetime.strptime(run_date, "%Y-%m-%d").date()

        summary = finalize_all_nhq_biometric_days(
            for_date=for_date,
            include_catchup=not no_catchup and for_date is None,
            dry_run=dry_run,
        )
        click.echo(json.dumps(summary, default=str, indent=2))
