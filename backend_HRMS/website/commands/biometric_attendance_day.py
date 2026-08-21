"""Rebuild biometric_attendance_day from biometric_logs (HR reporting read model)."""

from __future__ import annotations

import click


def register_biometric_attendance_day_command(app):
    @app.cli.command("biometric-rebuild-attendance-days")
    def biometric_rebuild_attendance_days():
        """Rebuild biometric_attendance_day from biometric_logs. Does not touch Punch."""
        from .. import db
        from ..biometric.day_rollup import rebuild_attendance_days_from_logs

        n = rebuild_attendance_days_from_logs()
        db.session.commit()
        click.echo(f"rebuilt {n} biometric_attendance_day rows")
