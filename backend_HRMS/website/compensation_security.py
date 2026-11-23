"""Phase 0+1 compensation hardening: inventory, log redaction, platform flags.

Column encryption is Phase 4–5. This module must not claim amounts are encrypted.
"""
from __future__ import annotations

import logging
import os
import re
from decimal import Decimal

from flask.json.provider import DefaultJSONProvider

# --- Phase 0 inventory (tables/columns that hold compensation or payout PII) ---

COMPENSATION_MONEY_TABLES = {
    "ctc_breakups": (
        "basic_salary",
        "dearness_allowance",
        "hra",
        "special_allowance",
        "conveyance_allowance",
        "medical_allowance",
        "lta_allowance",
        "other_allowance",
        "gross_salary",
        "net_salary",
        "annual_ctc",
        "annual_ctc_computed",
        "variable_ctc_annual",
        "mediclaim_yearly",
        "epf",
        "esic",
        "esic_employer",
        "ptax",
        "deductions_total",
        "gratuity_yearly",
        "gratuity_monthly",
        "employer_pf_yearly",
        "employer_pf_monthly",
        "employer_esic_yearly",
        "employer_esic_monthly",
        "pf_admin_yearly",
        "pf_admin_monthly",
        "edli_yearly",
        "edli_monthly",
        "statutory_bonus_yearly",
        "statutory_bonus_monthly",
        "lwf_employer_yearly",
        "lwf_employee_yearly",
        "vpf_monthly",
        "reimbursement_monthly",
    ),
    "monthly_payrolls": (
        "ctc_gross_salary",
        "one_day_salary",
        "gross_salary_for_month",
        "epf_computed",
        "esic_computed",
        "ptax_computed",
        "tds_computed",
        "tds_final",
        "epf_final",
        "esic_final",
        "ptax_final",
        "lwf_computed",
        "lwf_final",
        "arrears_gross_computed",
        "arrears_gross_final",
        "leave_encashment_computed",
        "leave_encashment_final",
        "loan_recovery_computed",
        "loan_recovery_final",
        "reimbursement_computed",
        "reimbursement_final",
        "statutory_bonus_computed",
        "statutory_bonus_final",
        "deductions_total_final",
        "net_salary_final",
    ),
    "employee_salary_loans": ("principal_amount", "emi_monthly", "balance_remaining"),
    "fnf_settlements": ("net_payable",),
    "salary_revision_requests": ("proposed_annual_ctc",),
    "compensation_bands": ("min_annual_ctc", "mid_annual_ctc", "max_annual_ctc"),
    "candidate_offers": ("annual_ctc",),
    "form16": (
        "parsed_gross_salary",
        "parsed_tds_deducted",
        "parsed_taxable_income",
        "parsed_annual_tax",
    ),
    "employee_tax_declarations": (
        "rent_paid_annual",
        "section_80c_extra",
        "section_80d",
        "previous_employer_tds",
        "previous_employer_taxable",
    ),
    "tax_declaration_items": ("amount", "final_amount"),
}

# Percent / days — not rupees; must stay out of DECIMAL money migrate.
NOT_MONEY_FLOATS = {
    "ctc_breakups": ("hra_pct", "epf_pct", "nps_employer_pct"),
    "monthly_payrolls": ("actual_working_days",),
    "ctc_change_requests": ("increment_pct",),
}

COMPENSATION_JSON_BLOBS = (
    "ctc_breakup_revisions.snapshot",
    "ctc_change_requests.payload",
    "fnf_settlements.snapshot",
    "payroll_audit_logs.field_changes",
)

PAYOUT_PII_COLUMNS = (
    "upload_docs.bank_account_number",
    "upload_docs.pan_number",
    "upload_docs.aadhaar_number",
    "employee_accounts.bank_details",
    "employee_accounts.pan",
    "employee_accounts.uan",
    "employee_accounts.pf_account_number",
    "employee_accounts.esi_number",
    "employee_accounts.pran",
)

_ASSIGN = re.compile(
    r"(?i)\b("
    r"net_salary(?:_final)?|gross_salary(?:_for_month)?|ctc_gross_salary|"
    r"annual_ctc(?:_computed|_total)?|proposed_annual_ctc|basic_salary|"
    r"one_day_salary|bank_account_number|pan_number|aadhaar_number|"
    r"principal_amount|emi_monthly|balance_remaining|net_payable"
    r")\b\s*[=:]\s*([^\s,;]+)"
)
_JSON_AMT = re.compile(
    r'(?i)("(?:net_salary(?:_final)?|gross_salary(?:_for_month)?|annual_ctc(?:_computed)?'
    r'|proposed_annual_ctc|basic_salary|bank_account_number|pan_number|aadhaar_number)")'
    r"\s*:\s*(-?[\d.]+|\"[^\"]*\")"
)
_INR = re.compile(r"₹\s*[\d,]+(?:\.\d+)?")


def redact_compensation_text(message: str) -> str:
    if not message:
        return message
    out = _ASSIGN.sub(r"\1=[REDACTED]", message)
    out = _JSON_AMT.sub(r"\1:[REDACTED]", out)
    out = _INR.sub("₹[REDACTED]", out)
    return out


class CompensationLogFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        try:
            if record.msg and isinstance(record.msg, str):
                record.msg = redact_compensation_text(record.msg)
            if record.args:
                if isinstance(record.args, dict):
                    record.args = {
                        k: redact_compensation_text(v) if isinstance(v, str) else v
                        for k, v in record.args.items()
                    }
                elif isinstance(record.args, tuple):
                    record.args = tuple(
                        redact_compensation_text(a) if isinstance(a, str) else a
                        for a in record.args
                    )
        except Exception:
            pass
        return True


def attach_compensation_log_filter(logger: logging.Logger | None = None) -> None:
    filt = CompensationLogFilter()
    targets = [logging.getLogger(), logging.getLogger("werkzeug"), logging.getLogger("sqlalchemy.engine")]
    if logger is not None:
        targets.append(logger)
    for log in targets:
        if not any(isinstance(f, CompensationLogFilter) for f in log.filters):
            log.addFilter(filt)


def _flag(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None or str(raw).strip() == "":
        return default
    return str(raw).strip().lower() in {"1", "true", "yes", "on"}


def is_production() -> bool:
    env = (
        os.getenv("FLASK_ENV")
        or os.getenv("APP_ENV")
        or os.getenv("ENV")
        or ""
    ).strip().lower()
    return env in {"production", "prod"}


class CompensationJSONProvider(DefaultJSONProvider):
    def default(self, o):
        if isinstance(o, Decimal):
            return float(o)
        return super().default(o)


def apply_compensation_platform(app) -> list[str]:
    """Phase 1: echo off, secure cookies, HSTS, TDE/backup contract. Returns gap codes."""
    attach_compensation_log_filter(app.logger)
    app.json_provider_class = CompensationJSONProvider
    app.json = CompensationJSONProvider(app)

    production = is_production()
    echo_requested = _flag("SQLALCHEMY_ECHO", False)
    if production:
        app.config["SQLALCHEMY_ECHO"] = False
        logging.getLogger("sqlalchemy.engine").setLevel(logging.WARNING)
    else:
        app.config["SQLALCHEMY_ECHO"] = bool(echo_requested)

    base = str(app.config.get("BASE_URL") or os.getenv("BASE_URL") or "").lower()
    https_base = base.startswith("https://")
    cookie_secure = bool(app.config.get("JWT_COOKIE_SECURE"))
    if production and https_base:
        cookie_secure = True
        app.config["JWT_COOKIE_SECURE"] = True
    app.config["SESSION_COOKIE_HTTPONLY"] = True
    app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
    app.config["SESSION_COOKIE_SECURE"] = cookie_secure
    if production and https_base:
        app.config["PREFERRED_URL_SCHEME"] = "https"

    gaps = []
    tde = _flag("DATABASE_ENCRYPTION_AT_REST", False)
    backups = _flag("BACKUP_ENCRYPTION", False)
    app.config["DATABASE_ENCRYPTION_AT_REST"] = tde
    app.config["BACKUP_ENCRYPTION"] = backups
    if production and not tde:
        gaps.append("database_encryption_at_rest_unset")
    if production and not backups:
        gaps.append("backup_encryption_unset")
    from .pii_crypto import kek_is_ready

    app.config["COMPENSATION_PII_KEK_READY"] = kek_is_ready()
    if production and not kek_is_ready():
        gaps.append("pii_kek_unset")
    if production and base and not https_base and "localhost" not in base:
        gaps.append("base_url_not_https")
        if not _flag("ALLOW_INSECURE_HTTP", False):
            raise RuntimeError(
                "Production BASE_URL must be https:// (or set ALLOW_INSECURE_HTTP=1 for break-glass)."
            )
    if production and echo_requested:
        app.logger.critical("SQLALCHEMY_ECHO ignored in production (compensation leak).")

    app.config["COMPENSATION_PLATFORM_GAPS"] = gaps
    for code in gaps:
        app.logger.critical("Compensation platform gap: %s", code)

    @app.after_request
    def _compensation_security_headers(response):
        from flask import request as flask_request

        try:
            proto = (request_proto() or "").lower()
        except Exception:
            proto = ""
        host = ""
        try:
            host = (flask_request.host or "").split(":")[0].lower()
        except Exception:
            host = ""
        local = host in {"localhost", "127.0.0.1", "::1"}
        if (proto == "https") and not local:
            response.headers.setdefault(
                "Strict-Transport-Security",
                "max-age=15552000; includeSubDomains",
            )
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        return response

    return gaps


def request_proto() -> str:
    from flask import request

    forwarded = (request.headers.get("X-Forwarded-Proto") or "").split(",")[0].strip()
    if forwarded:
        return forwarded
    return request.scheme or ""
