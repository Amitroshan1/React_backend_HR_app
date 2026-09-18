"""CLI: reprocess biometric mapping-failure logs."""

from __future__ import annotations

import json

import click


def register_biometric_reprocess_command(app):
    @app.cli.command("biometric-reprocess-mapping")
    @click.option("--lookback-days", default=30, show_default=True, type=int)
    @click.option("--max-attempts", default=7, show_default=True, type=int)
    @click.option("--limit", default=500, show_default=True, type=int)
    @click.option("--dry-run", is_flag=True, help="Report without writing")
    def biometric_reprocess_mapping(lookback_days, max_attempts, limit, dry_run):
        """Retry unknown/invalid mapping logs after emp_id fixes; exhaust ghost PINs."""
        from ..biometric.reprocess import reprocess_mapping_failure_logs

        summary = reprocess_mapping_failure_logs(
            lookback_days=lookback_days,
            max_attempts=max_attempts,
            limit=limit,
            dry_run=dry_run,
        )
        click.echo(json.dumps(summary, default=str, indent=2))
