"""Phase 3 compensation access: mask, deny managers, sanitize audit amounts."""
from __future__ import annotations

import unittest
from types import SimpleNamespace

from flask import Flask

from website.compensation_visibility import (
    DENIED,
    FULL,
    MASKED,
    NEEDS_OTP,
    apply_visibility,
    evaluate_compensation_access,
    mask_money_tree,
    sanitize_field_changes,
)


def _admin(**kwargs):
    base = {"id": 1, "emp_type": "employee", "tenant_id": 2}
    base.update(kwargs)
    return SimpleNamespace(**base)


class TestMaskAndAudit(unittest.TestCase):
    def test_mask_zeros_money_keeps_flags(self):
        tree = {
            "basic_salary": 50000,
            "include_edli_in_ctc": True,
            "pending_request": {"old_annual_ctc": 900000, "note": "ok"},
            "pan": "ABCDE1234F",
        }
        out = mask_money_tree(tree)
        self.assertIsNone(out["basic_salary"])
        self.assertTrue(out["include_edli_in_ctc"])
        self.assertIsNone(out["pending_request"]["old_annual_ctc"])
        self.assertEqual(out["pending_request"]["note"], "ok")
        self.assertIsNone(out["pan"])

    def test_sanitize_field_changes_drops_rupees(self):
        raw = {"epf_final": {"from": 100.0, "to": 120.0}, "status": {"from": "draft", "to": "reviewed"}}
        out = sanitize_field_changes(raw)
        self.assertEqual(out["epf_final"], {"changed": True})
        self.assertEqual(out["status"]["to"], "reviewed")


class TestEvaluateAccess(unittest.TestCase):
    def setUp(self):
        self.app = Flask("vis")

    def test_manager_denied_other_employee(self):
        with self.app.test_request_context("/"):
            d = evaluate_compensation_access(_admin(id=1, emp_type="manager"), 99)
            self.assertEqual(d.status, DENIED)

    def test_accounts_full_other_employee(self):
        with self.app.test_request_context("/"):
            d = evaluate_compensation_access(_admin(id=1, emp_type="accounts"), 99)
            self.assertEqual(d.status, FULL)

    def test_hr_masked_without_reveal(self):
        with self.app.test_request_context("/"):
            d = evaluate_compensation_access(_admin(id=1, emp_type="hr"), 99)
            self.assertEqual(d.status, MASKED)

    def test_hr_reveal_without_otp(self):
        with self.app.test_request_context("/?reveal=1"):
            d = evaluate_compensation_access(_admin(id=1, emp_type="hr"), 99)
            self.assertEqual(d.status, NEEDS_OTP)

    def test_hr_export_denied_without_reveal(self):
        with self.app.test_request_context("/"):
            d = evaluate_compensation_access(_admin(id=1, emp_type="hr"), 99, export=True)
            self.assertEqual(d.status, DENIED)

    def test_employee_own_needs_otp(self):
        with self.app.test_request_context("/"):
            d = evaluate_compensation_access(_admin(id=5, emp_type="sales"), 5)
            self.assertEqual(d.status, NEEDS_OTP)

    def test_apply_visibility_adds_flag(self):
        from website.compensation_visibility import CompensationAccess

        payload = apply_visibility(
            {"success": True, "ctc_breakup": {"basic_salary": 10, "epf_mode": "statutory"}},
            CompensationAccess(MASKED),
        )
        self.assertEqual(payload["salary_visibility"], MASKED)
        self.assertIsNone(payload["ctc_breakup"]["basic_salary"])
        self.assertEqual(payload["ctc_breakup"]["epf_mode"], "statutory")


if __name__ == "__main__":
    unittest.main()
