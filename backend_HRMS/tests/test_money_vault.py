"""Phase 5 amount_blob encryption."""
from __future__ import annotations

import json
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from website.money_vault import pack_amount_blob, unpack_amount_blob
from website.pii_crypto import decrypt_bytes


class TestAmountBlob(unittest.TestCase):
    def test_pack_nulls_columns_and_round_trips(self):
        dek = AESGCM.generate_key(bit_length=256)
        row = SimpleNamespace(
            admin_id=4,
            __tablename__="monthly_payrolls",
            year="2026",
            month_num=11,
            gross_salary_for_month=50000.25,
            net_salary_final=42000.5,
            amount_blob=None,
        )
        fields = ("gross_salary_for_month", "net_salary_final")
        with patch("website.money_vault.kek_is_ready", return_value=True), patch(
            "website.money_vault.get_or_create_dek", return_value=dek
        ), patch("website.money_vault._tenant_for", return_value=1), patch(
            "website.pii_crypto.tenant_crypto_revoked", return_value=False
        ), patch(
            "website.money_vault.decrypt_with_tenant_deks",
            side_effect=lambda _tid, blob, aad: decrypt_bytes(dek, blob, aad),
        ):
            pack_amount_blob(row, fields)
            self.assertIsNone(row.gross_salary_for_month)
            self.assertTrue(row.amount_blob)
            raw = decrypt_bytes(
                dek,
                bytes(row.amount_blob),
                b"1|monthly_payrolls|admin:4|2026-11|amount_blob",
            )
            data = json.loads(raw.decode())
            self.assertEqual(data["net_salary_final"], 42000.5)
            unpack_amount_blob(row, fields)
            self.assertEqual(row.net_salary_final, 42000.5)

    def test_pack_fail_closed_does_not_write_plaintext_over_blob(self):
        row = SimpleNamespace(
            admin_id=4,
            __tablename__="ctc_breakups",
            year=None,
            month_num=None,
            basic_salary=99999.0,
            amount_blob=b"\x01sealed",
        )
        with patch("website.money_vault.kek_is_ready", return_value=False):
            pack_amount_blob(row, ("basic_salary",))
        self.assertIsNone(row.basic_salary)
        self.assertEqual(row.amount_blob, b"\x01sealed")


if __name__ == "__main__":
    unittest.main()
