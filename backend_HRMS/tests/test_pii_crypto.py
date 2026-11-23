"""Phase 4 PII envelope encryption."""
from __future__ import annotations

import unittest
from types import SimpleNamespace

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from website.pii_crypto import (
    decrypt_bytes,
    encrypt_bytes,
    last4_digits,
    last4_pan,
    pii_get,
    pii_set,
)


class TestEnvelope(unittest.TestCase):
    def test_round_trip_and_aad_bind(self):
        dek = AESGCM.generate_key(bit_length=256)
        aad = b"1|upload_docs|admin:9|bank_account_number"
        blob = encrypt_bytes(dek, b"123456789012", aad)
        self.assertNotIn(b"123456789012", blob)
        self.assertEqual(decrypt_bytes(dek, blob, aad), b"123456789012")
        with self.assertRaises(InvalidTag):
            decrypt_bytes(dek, blob, b"1|upload_docs|admin:8|bank_account_number")

    def test_last4(self):
        self.assertEqual(last4_digits("123456789012"), "9012")
        self.assertEqual(last4_pan("ABCDE1234F"), "234F")


class TestPiiSetGet(unittest.TestCase):
    def test_set_clears_plaintext_when_dek_present(self):
        dek = AESGCM.generate_key(bit_length=256)
        row = SimpleNamespace(
            admin_id=9,
            __tablename__="upload_docs",
            bank_account_number="123456789012",
            bank_account_number_enc=None,
            bank_account_last4=None,
        )
        from unittest.mock import patch

        with patch("website.pii_crypto.get_or_create_dek", return_value=dek), patch(
            "website.pii_crypto._tenant_for_row", return_value=1
        ):
            pii_set(row, "bank_account_number", "123456789012")
            self.assertIsNone(row.bank_account_number)
            self.assertTrue(row.bank_account_number_enc)
            self.assertEqual(row.bank_account_last4, "9012")
            self.assertEqual(pii_get(row, "bank_account_number"), "123456789012")

    def test_passthrough_without_dek(self):
        row = SimpleNamespace(
            admin_id=9,
            __tablename__="upload_docs",
            pan_number=None,
            pan_number_enc=None,
            pan_last4=None,
        )
        from unittest.mock import patch

        with patch("website.pii_crypto.get_or_create_dek", return_value=None), patch(
            "website.pii_crypto._tenant_for_row", return_value=1
        ):
            pii_set(row, "pan_number", "ABCDE1234F")
            self.assertEqual(row.pan_number, "ABCDE1234F")
            self.assertIsNone(row.pan_number_enc)


if __name__ == "__main__":
    unittest.main()
