"""CLI worker that drains Phase 6 background jobs."""

from __future__ import annotations

import time

import click


def register_jobs_worker_command(app):
    @app.cli.command("jobs-worker")
    @click.option("--once", is_flag=True, help="Process one batch and exit")
    @click.option("--limit", default=None, type=int, help="Max jobs per batch (default BACKGROUND_JOBS_BATCH)")
    @click.option("--poll-seconds", default=2.0, show_default=True, type=float, help="Sleep between empty polls")
    def jobs_worker(once, limit, poll_seconds):
        """Run pending background jobs (exports, mass emails, recalculations)."""
        from ..jobs import process_pending

        click.echo("jobs-worker started")
        while True:
            n = process_pending(limit=limit)
            if n:
                click.echo(f"processed {n} job(s)")
            if once:
                break
            time.sleep(max(0.2, float(poll_seconds)))
