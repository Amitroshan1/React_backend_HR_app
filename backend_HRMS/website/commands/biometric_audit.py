"""Read-only biometric mapping audit (Phase 3E). Never repairs data."""

from __future__ import annotations

import json

import click


def register_biometric_audit_command(app):
    @app.cli.command("biometric-mapping-audit")
    @click.option(
        "--include-inactive",
        is_flag=True,
        help="Include inactive BiometricEmployeeMap rows",
    )
    def biometric_mapping_audit(include_inactive):
        """Classify biometric mappings vs Admin.emp_id. Does not write."""
        from ..biometric.mapping import audit_all_mappings

        report = audit_all_mappings(include_inactive_maps=include_inactive)
        click.echo(json.dumps(report, default=str, indent=2))
