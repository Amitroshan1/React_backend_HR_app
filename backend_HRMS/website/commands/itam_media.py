"""Turn IT photos stored as image data into files under tenants/{company}/itam/."""

from __future__ import annotations

import json

import click


def register_itam_media_commands(app):
    @app.cli.command("itam-extract-photos")
    @click.option("--apply", "apply_", is_flag=True, help="Write the files and update rows (default: dry run)")
    def itam_extract_photos(apply_):
        """Replace data: images in IT photo columns with tenants/{id}/itam/ files."""
        from ..itam.media import extract_itam_data_urls

        result = extract_itam_data_urls(apply=apply_)
        click.echo(json.dumps(result, indent=2))
        if not apply_:
            click.echo("Dry run: nothing was changed. Re-run with --apply to write the files.")
