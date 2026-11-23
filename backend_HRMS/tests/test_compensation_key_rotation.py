"""Phase 6: KEK rewrap, dual-DEK decrypt, tenant AAD isolation."""
from __future__ import annotations

import base64
import os
import unittest

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from website.pii_crypto import (
    KEK_ENV,
    KEK_PREV_ENV,
    decrypt_with_deks,
    encrypt_bytes,
    unwrap_dek_any_kek,
    wrap_dek,
)


class TestKeyRotationPrimitives(unittest.TestCase):
    def test_previous_kek_unwraps_old_wrap(self):
        old_kek = AESGCM.generate_key(bit_length=256)
        new_kek = AESGCM.generate_key(bit_length=256)
        dek = AESGCM.generate_key(bit_length=256)
        wrapped = wrap_dek(old_kek, dek, 7)
        os.environ[KEK_ENV] = base64.urlsafe_b64encode(new_kek).decode()
        os.environ[KEK_PREV_ENV] = base64.urlsafe_b64encode(old_kek).decode()
        try:
            self.assertEqual(unwrap_dek_any_kek(wrapped, 7), dek)
        finally:
            os.environ.pop(KEK_ENV, None)
            os.environ.pop(KEK_PREV_ENV, None)

    def test_wrong_tenant_aad_on_wrapped_dek(self):
        kek = AESGCM.generate_key(bit_length=256)
        dek = AESGCM.generate_key(bit_length=256)
        wrapped = wrap_dek(kek, dek, 1)
        os.environ[KEK_ENV] = base64.urlsafe_b64encode(kek).decode()
        try:
            with self.assertRaises(InvalidTag):
                unwrap_dek_any_kek(wrapped, 2)
        finally:
            os.environ.pop(KEK_ENV, None)

    def test_decrypt_tries_previous_dek(self):
        old = AESGCM.generate_key(bit_length=256)
        new = AESGCM.generate_key(bit_length=256)
        aad = b"1|upload_docs|admin:9|pan_number"
        blob = encrypt_bytes(old, b"ABCDE1234F", aad)
        self.assertEqual(decrypt_with_deks([new, old], blob, aad), b"ABCDE1234F")
        with self.assertRaises(InvalidTag):
            decrypt_with_deks([new], blob, aad)


if __name__ == "__main__":
    unittest.main()
