"""CLI: rotate / rewrap / revoke compensation DEKs. Never prints key material."""
from __future__ import annotations

import click


def register_compensation_key_commands(app):
    @app.cli.command("rotate-compensation-dek")
    @click.option("--tenant-id", required=True, type=int)
    def rotate_compensation_dek(tenant_id):
        """Generate a new per-tenant DEK and re-encrypt that tenant's PII and amount blobs."""
        from ..compensation_key_rotation import CompensationCryptoError, rotate_tenant_dek

        try:
            result = rotate_tenant_dek(tenant_id)
        except CompensationCryptoError as exc:
            raise click.ClickException(str(exc)) from exc
        click.echo(
            f"Rotated tenant {result['tenant_id']} to key_version {result['key_version']}"
        )

    @app.cli.command("rewrap-compensation-deks")
    def rewrap_compensation_deks():
        """After changing COMPENSATION_PII_KEK (keep old in COMPENSATION_PII_KEK_PREVIOUS)."""
        from ..compensation_key_rotation import CompensationCryptoError, rewrap_all_tenant_deks

        try:
            n = rewrap_all_tenant_deks()
        except CompensationCryptoError as exc:
            raise click.ClickException(str(exc)) from exc
        click.echo(f"Rewrapped DEKs for {n} tenant(s). You can drop COMPENSATION_PII_KEK_PREVIOUS.")

    @app.cli.command("revoke-compensation-dek")
    @click.option("--tenant-id", required=True, type=int)
    @click.option("--yes", is_flag=True, help="Confirm irreversible revoke")
    def revoke_compensation_dek(tenant_id, yes):
        """Make a tenant's sealed compensation/PII unreadable (offboarding / legal hold)."""
        from ..compensation_key_rotation import revoke_tenant_dek

        if not yes:
            raise click.ClickException("Pass --yes to revoke tenant crypto.")
        revoke_tenant_dek(tenant_id)
        click.echo(f"Revoked compensation crypto for tenant {tenant_id}")

    @app.cli.command("compensation-crypto-status")
    def compensation_crypto_status():
        """Show KEK readiness and tenant key versions (no key material)."""
        from ..compensation_key_rotation import crypto_status

        st = crypto_status()
        click.echo(
            f"kek_ready={st['kek_ready']} previous_kek={st['previous_kek_ready']} tenants={st['tenant_count']}"
        )
        for t in st["tenants"]:
            click.echo(
                f"  tenant={t['tenant_id']} version={t['key_version']} revoked={t['revoked']} prev_wrap={t['has_previous_wrap']}"
            )

    @app.cli.command("compensation-break-glass-decrypt")
    @click.option("--admin-id", required=True, type=int)
    @click.option("--token-a", required=True, envvar=False)
    @click.option("--token-b", required=True, envvar=False)
    def compensation_break_glass_decrypt(admin_id, token_a, token_b):
        """Two holders must supply matching env tokens. Prints PAN last4 only."""
        from ..compensation_key_rotation import CompensationCryptoError, break_glass_last4

        try:
            last4 = break_glass_last4(admin_id, token_a, token_b)
        except CompensationCryptoError as exc:
            raise click.ClickException(str(exc)) from exc
        click.echo(f"decrypt_ok last4={last4 or 'none'}")
