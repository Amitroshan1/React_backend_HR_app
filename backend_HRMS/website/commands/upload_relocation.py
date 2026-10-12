"""Move pre-tenancy uploads into tenants/{company id}/ (dry run unless --apply)."""

from __future__ import annotations

import json

import click


def register_upload_relocation_commands(app):
    @app.cli.command("uploads-relocate")
    @click.option("--apply", "apply_", is_flag=True, help="Copy files and update rows (default: dry run)")
    @click.option("--kind", "kinds", multiple=True, help="Only this file kind (repeatable); see --list-kinds")
    @click.option("--tenant", "tenants", multiple=True, type=int, help="Only files owned by this company id (repeatable)")
    @click.option("--manifest", "manifest_path", default=None, help="Manifest path (default: instance/upload_relocation/)")
    @click.option("--list-kinds", is_flag=True, help="Print the file kinds and exit")
    def uploads_relocate(apply_, kinds, tenants, manifest_path, list_kinds):
        """Copy legacy uploads under tenants/{id}/ and point rows at them. Old files are kept."""
        from ..upload_relocation import relocate_uploads, relocation_kinds

        known = relocation_kinds()
        if list_kinds:
            click.echo("\n".join(known))
            return
        unknown = sorted(set(kinds) - set(known))
        if unknown:
            raise click.BadParameter(f"Unknown kind(s): {', '.join(unknown)}", param_hint="--kind")
        result = relocate_uploads(
            apply=apply_, kinds=kinds or None, tenants=tenants or None, manifest_path=manifest_path
        )
        click.echo(json.dumps(result, indent=2, default=str))
        if not apply_:
            click.echo("Dry run: nothing was changed. Re-run with --apply to copy files and update rows.")

    @app.cli.command("uploads-relocate-cleanup")
    @click.argument("manifest_path")
    @click.option("--apply", "apply_", is_flag=True, help="Delete the old files (default: dry run)")
    def uploads_relocate_cleanup(manifest_path, apply_):
        """Delete old files of an applied run (identical copy exists, no row uses them)."""
        from ..upload_relocation import cleanup_relocation

        click.echo(json.dumps(cleanup_relocation(manifest_path, apply=apply_), indent=2))

    @app.cli.command("uploads-relocate-rollback")
    @click.argument("manifest_path")
    @click.option("--apply", "apply_", is_flag=True, help="Restore rows and remove copies (default: dry run)")
    def uploads_relocate_rollback(manifest_path, apply_):
        """Undo an applied run that has not been cleaned up."""
        from ..upload_relocation import rollback_relocation

        click.echo(json.dumps(rollback_relocation(manifest_path, apply=apply_), indent=2))
