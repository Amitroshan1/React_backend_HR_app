"""Phase 0+1+2: money storage, log redaction, production platform locks."""
from __future__ import annotations

import logging
import os
import unittest
from decimal import Decimal

from website.compensation_security import (
    COMPENSATION_MONEY_TABLES,
    NOT_MONEY_FLOATS,
    redact_compensation_text,
)
from website.money import Money, money_float, quantize_money
from website.models.ctc_breakup import CTCBreakup
from website.models.monthly_payroll import MonthlyPayroll


class TestPhase0Inventory(unittest.TestCase):
    def test_pct_and_days_not_in_money_migrate(self):
        for table, cols in NOT_MONEY_FLOATS.items():
            money_cols = COMPENSATION_MONEY_TABLES.get(table, ())
            overlap = set(cols) & set(money_cols)
            self.assertFalse(overlap, overlap)

    def test_models_use_money_not_float_on_rupees(self):
        self.assertIsInstance(CTCBreakup.__table__.c.basic_salary.type, Money)
        self.assertIsInstance(MonthlyPayroll.__table__.c.net_salary_final.type, Money)
        self.assertNotIsInstance(MonthlyPayroll.__table__.c.actual_working_days.type, Money)
        self.assertNotIsInstance(CTCBreakup.__table__.c.hra_pct.type, Money)

    def test_redact_salary_and_bank_from_logs(self):
        raw = "saved net_salary_final=84210.50 bank_account_number=123456789012 annual_ctc: 1200000"
        out = redact_compensation_text(raw)
        self.assertNotIn("84210", out)
        self.assertNotIn("123456789012", out)
        self.assertNotIn("1200000", out)
        self.assertIn("[REDACTED]", out)
        self.assertIn("₹[REDACTED]", redact_compensation_text("Proposed CTC ₹ 12,50,000"))

    def test_log_filter_redacts_record(self):
        from website.compensation_security import CompensationLogFilter

        rec = logging.LogRecord(
            "t", logging.INFO, __file__, 1, "basic_salary=50000.00 emp=12", (), None
        )
        CompensationLogFilter().filter(rec)
        self.assertIn("[REDACTED]", rec.msg)
        self.assertNotIn("50000", rec.msg)


class TestPhase2Money(unittest.TestCase):
    def test_quantize_matches_python_round(self):
        self.assertEqual(quantize_money("1.225"), Decimal("1.22"))
        self.assertEqual(quantize_money("1.235"), Decimal("1.24"))
        self.assertEqual(money_float("10.10"), 10.1)
        self.assertIsNone(quantize_money(None))

    def test_bind_rejects_non_finite(self):
        col = Money()
        self.assertIsNone(col.process_bind_param(float("nan"), None))
        bound = col.process_bind_param("100000.126", None)
        self.assertEqual(bound, Decimal("100000.13"))

    def test_sqlite_round_trip(self):
        from flask import Flask
        from flask_sqlalchemy import SQLAlchemy

        from website.money import Money as MoneyType

        app = Flask("money_rt")
        app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///:memory:"
        app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
        test_db = SQLAlchemy(app)

        class Row(test_db.Model):
            __tablename__ = "money_rt"
            id = test_db.Column(test_db.Integer, primary_key=True)
            amount = test_db.Column(MoneyType(), nullable=True)

        with app.app_context():
            test_db.create_all()
            row = Row(amount=12345.678)
            test_db.session.add(row)
            test_db.session.commit()
            loaded = test_db.session.get(Row, row.id)
            self.assertEqual(loaded.amount, round(12345.678, 2))
            self.assertIsInstance(loaded.amount, float)


class TestPhase1Platform(unittest.TestCase):
    def test_echo_forced_off_in_production(self):
        from flask import Flask

        from website.compensation_security import apply_compensation_platform

        prev_env = os.environ.get("FLASK_ENV")
        prev_echo = os.environ.get("SQLALCHEMY_ECHO")
        os.environ["FLASK_ENV"] = "production"
        os.environ["SQLALCHEMY_ECHO"] = "1"
        os.environ["DATABASE_ENCRYPTION_AT_REST"] = "1"
        os.environ["BACKUP_ENCRYPTION"] = "1"
        os.environ["COMPENSATION_PII_KEK"] = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
        try:
            app = Flask("sec")
            app.config["BASE_URL"] = "https://hr.example.test"
            app.config["JWT_COOKIE_SECURE"] = True
            apply_compensation_platform(app)
            self.assertFalse(app.config["SQLALCHEMY_ECHO"])
            self.assertTrue(app.config["SESSION_COOKIE_HTTPONLY"])
            self.assertTrue(app.config["SESSION_COOKIE_SECURE"])
            self.assertEqual(app.config["COMPENSATION_PLATFORM_GAPS"], [])
        finally:
            for key, val in (
                ("FLASK_ENV", prev_env),
                ("SQLALCHEMY_ECHO", prev_echo),
            ):
                if val is None:
                    os.environ.pop(key, None)
                else:
                    os.environ[key] = val

    def test_production_http_base_url_refused(self):
        from flask import Flask

        from website.compensation_security import apply_compensation_platform

        os.environ["FLASK_ENV"] = "production"
        os.environ.pop("ALLOW_INSECURE_HTTP", None)
        app = Flask("sec2")
        app.config["BASE_URL"] = "http://insecure.example"
        app.config["JWT_COOKIE_SECURE"] = False
        with self.assertRaises(RuntimeError):
            apply_compensation_platform(app)
        os.environ.pop("FLASK_ENV", None)


if __name__ == "__main__":
    unittest.main()
