"""Phase 7: fail-closed JSON seal, dump scan, dual-control, tenant AAD isolation."""
from __future__ import annotations

import json
import os
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from website.compensation_dump_audit import dump_is_clean, findings_in_bytes
from website.compensation_key_rotation import CompensationCryptoError, require_dual_control
from website.money_vault import pack_json_attr, unpack_json_attr
from website.pii_crypto import decrypt_bytes, decrypt_with_deks, encrypt_bytes


class TestJsonSeal(unittest.TestCase):
    def test_revision_json_round_trip_and_sealed_column(self):
        dek = AESGCM.generate_key(bit_length=256)
        row = SimpleNamespace(
            admin_id=9,
            tenant_id=3,
            __tablename__="ctc_breakup_revisions",
            snapshot={"annual_ctc_computed": 1200000, "basic_salary": 50000},
            json_blob=None,
        )
        with patch("website.money_vault.kek_is_ready", return_value=True), patch(
            "website.money_vault.get_or_create_dek", return_value=dek
        ), patch("website.money_vault._tenant_for", return_value=3), patch(
            "website.pii_crypto.tenant_crypto_revoked", return_value=False
        ), patch(
            "website.money_vault.decrypt_with_tenant_deks",
            side_effect=lambda _tid, blob, aad: decrypt_bytes(dek, blob, aad),
        ):
            pack_json_attr(row, "snapshot")
            self.assertEqual(row.snapshot, {"_sealed": True})
            self.assertTrue(row.json_blob)
            self.assertNotIn(b"1200000", bytes(row.json_blob))
            unpack_json_attr(row, "snapshot")
            self.assertEqual(row.snapshot["basic_salary"], 50000)

    def test_fail_closed_json_when_kek_missing(self):
        row = SimpleNamespace(
            admin_id=9,
            __tablename__="ctc_breakup_revisions",
            snapshot={"annual_ctc_computed": 1},
            json_blob=b"\x01blob",
        )
        with patch("website.money_vault.kek_is_ready", return_value=False):
            pack_json_attr(row, "snapshot")
        self.assertEqual(row.snapshot, {"_sealed": True})


class TestDumpAudit(unittest.TestCase):
    def test_pan_in_dump_is_a_finding(self):
        self.assertIn("pan_pattern", findings_in_bytes(b"INSERT VALUES ('ABCDE1234F')"))
        self.assertTrue(dump_is_clean(b'INSERT INTO ctc VALUES ("_sealed")'))

    def test_sealed_blob_bytes_are_clean(self):
        dek = AESGCM.generate_key(bit_length=256)
        blob = encrypt_bytes(dek, json.dumps({"pan": "ABCDE1234F"}).encode(), b"aad")
        self.assertTrue(dump_is_clean(blob))


class TestDualControl(unittest.TestCase):
    def test_tokens_must_be_distinct_and_match(self):
        os.environ["COMPENSATION_BREAK_GLASS_A"] = "holder-a-secret-xx"
        os.environ["COMPENSATION_BREAK_GLASS_B"] = "holder-b-secret-yy"
        try:
            require_dual_control("holder-a-secret-xx", "holder-b-secret-yy")
            with self.assertRaises(CompensationCryptoError):
                require_dual_control("holder-a-secret-xx", "wrong-token-here!!")
            os.environ["COMPENSATION_BREAK_GLASS_B"] = "holder-a-secret-xx"
            with self.assertRaises(CompensationCryptoError):
                require_dual_control("holder-a-secret-xx", "holder-a-secret-xx")
        finally:
            os.environ.pop("COMPENSATION_BREAK_GLASS_A", None)
            os.environ.pop("COMPENSATION_BREAK_GLASS_B", None)


class TestTenantIsolation(unittest.TestCase):
    def test_wrong_tenant_dek_cannot_open_blob(self):
        dek_a = AESGCM.generate_key(bit_length=256)
        dek_b = AESGCM.generate_key(bit_length=256)
        aad = b"1|ctc_breakups|admin:4|amount_blob"
        blob = encrypt_bytes(dek_a, b'{"net":1}', aad)
        self.assertEqual(decrypt_with_deks([dek_a], blob, aad), b'{"net":1}')
        with self.assertRaises(InvalidTag):
            decrypt_with_deks([dek_b], blob, aad)


if __name__ == "__main__":
    unittest.main()
