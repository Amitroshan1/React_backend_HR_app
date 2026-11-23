import unittest

from website.commands.kyb_identity import (
    assert_identity_set,
    gstin_checksum_ok,
    make_gstin,
    sniff_file_type,
    validate_cin,
    validate_gstin,
    validate_llpin,
    validate_pan,
)


class KybIdentityTests(unittest.TestCase):
    def test_pan_gstin_cin_llpin(self):
        self.assertEqual(validate_pan("aabcu9603r"), "AABCU9603R")
        gstin = make_gstin(27, "AABCU9603R")
        self.assertTrue(gstin_checksum_ok(gstin))
        self.assertEqual(validate_gstin(gstin), gstin)
        self.assertEqual(validate_cin("U12345MH2014PTC123456"), "U12345MH2014PTC123456")
        self.assertEqual(validate_llpin("aaa1234"), "AAA-1234")

    def test_bad_pan(self):
        with self.assertRaises(ValueError):
            validate_pan("123")

    def test_gstin_pan_must_match(self):
        with self.assertRaises(ValueError):
            assert_identity_set(
                entity_type="pvt_ltd",
                pan="AABCU9603R",
                gstin=make_gstin(27, "AAAAA0000A"),
                cin="U12345MH2014PTC123456",
                llpin="",
            )

    def test_pvt_ltd_needs_cin_or_gstin(self):
        with self.assertRaises(ValueError):
            assert_identity_set(
                entity_type="pvt_ltd",
                pan="AABCU9603R",
                gstin="",
                cin="",
                llpin="",
                gst_exempt_reason="unregistered",
            )

    def test_ok_company(self):
        out = assert_identity_set(
            entity_type="pvt_ltd",
            pan="AABCU9603R",
            gstin=make_gstin(27, "AABCU9603R"),
            cin="U12345MH2014PTC123456",
            llpin="",
        )
        self.assertEqual(out["gstin"], make_gstin(27, "AABCU9603R"))
        self.assertTrue(gstin_checksum_ok(out["gstin"]))

    def test_sniff_pdf(self):
        self.assertEqual(sniff_file_type(b"%PDF-1.4 hello", "coi.pdf"), "application/pdf")
        with self.assertRaises(ValueError):
            sniff_file_type(b"MZ", "virus.exe")


class KybGatesTests(unittest.TestCase):
    def test_accounts_markers(self):
        from website.kyb_gates import accounts_path_needs_kyb, finance_path_needs_kyb

        self.assertTrue(accounts_path_needs_kyb("/api/accounts/payroll/generate"))
        self.assertTrue(accounts_path_needs_kyb("/api/accounts/compliance/pf-ecr"))
        self.assertTrue(accounts_path_needs_kyb("/api/accounts/form16/upload"))
        self.assertTrue(accounts_path_needs_kyb("/api/accounts/ctc-breakup"))
        self.assertFalse(accounts_path_needs_kyb("/api/accounts/ctc-breakup/12"))
        self.assertFalse(accounts_path_needs_kyb("/api/accounts/payslip/history/9"))
        self.assertFalse(accounts_path_needs_kyb("/api/accounts/form16/history/9"))
        self.assertTrue(finance_path_needs_kyb("/api/finance/payroll"))
        self.assertFalse(finance_path_needs_kyb("/api/finance/expense-claims"))

    def test_gstin_checksum_rejects_typo(self):
        good = make_gstin(27, "AABCU9603R")
        bad = good[:14] + ("A" if good[14] != "A" else "B")
        self.assertFalse(gstin_checksum_ok(bad))
        with self.assertRaises(ValueError):
            validate_gstin(bad)

    def test_registry_local_does_not_claim_live_gst(self):
        from website.commands.kyb_registry import lookup_cin, lookup_gstin

        gst = lookup_gstin(make_gstin(27, "AABCU9603R"), legal_name="Acme")
        self.assertTrue(gst["checksum_ok"])
        self.assertIsNone(gst["live_status"])
        mca = lookup_cin("U12345MH2014PTC123456")
        self.assertTrue(mca["format_ok"])
        self.assertIsNone(mca["live_status"])


if __name__ == "__main__":
    unittest.main()
