"""Turn IT photos stored as image data into files under tenants/{company}/itam/."""

from __future__ import annotations

import json

import click


def register_itam_media_commands(app):
    @app.cli.command("itam-extract-photos")
    @click.option("--apply", "apply_", is_flag=True, help="Write the files and update rows (default: dry run)")
    @click.option("--batch-size", default=10, show_default=True, help="Rows read and committed together")
    @click.option("--backup-dir", default=None, help="Folder for the restore file (default: instance/itam_photo_backups)")
    def itam_extract_photos(apply_, batch_size, backup_dir):
        """Replace data: images in IT photo columns with tenants/{id}/itam/ files."""
        from ..itam.media import extract_itam_data_urls

        result = extract_itam_data_urls(apply=apply_, batch_size=batch_size, backup_dir=backup_dir)
        click.echo(json.dumps(result, indent=2))
        if not apply_:
            click.echo("Dry run: nothing was changed. Re-run with --apply to write the files.")
        elif result.get("backup"):
            click.echo(f"To undo: flask itam-restore-photos {result['backup']} --apply")

    @app.cli.command("itam-restore-photos")
    @click.argument("backup_file", type=click.Path(exists=True, dir_okay=False))
    @click.option("--apply", "apply_", is_flag=True, help="Write the old values back (default: dry run)")
    def itam_restore_photos(backup_file, apply_):
        """Put back image data saved by itam-extract-photos (rows edited since are left alone)."""
        from ..itam.media import restore_itam_photos

        result = restore_itam_photos(backup_file, apply=apply_)
        click.echo(json.dumps(result, indent=2))
        if not apply_:
            click.echo("Dry run: nothing was changed. Re-run with --apply to restore.")
