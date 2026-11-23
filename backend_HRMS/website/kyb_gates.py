"""Block payroll / PF / Form 16 until company KYB is verified (or skipped / legacy)."""
from __future__ import annotations

import re

from flask import jsonify

from .tenant_context import DEFAULT_TENANT_ID, get_current_tenant_id

KYB_STATUTORY_OK = frozenset({"not_required", "skipped", "verified"})
KYB_STATUTORY_BLOCKED = frozenset({
    "invite_sent",
    "in_progress",
    "submitted",
    "needs_fix",
})
KYB_REQUIRED_CODE = "kyb_required"
KYB_REQUIRED_MESSAGE = (
    "Complete company verification before payroll, PF filings, or Form 16."
)

# Accounts paths that write or generate statutory payroll artefacts.
ACCOUNTS_KYB_PATH_MARKERS = (
    "/form16/upload",
    "/form16/bulk-upload",
    "/form16/traces-import",
    "/payslip/upload",
    "/payslip/bulk-upload",
    "/payroll/generate",
    "/payroll/deductions-update",
    "/payroll/status",
    "/payroll/statutory-bonus-run",
    "/payroll/apply-arrears",
    "/payroll/list",
    "/payroll/history",
    "/payroll/loans",
    "/payroll/leave-encashment",
    "/payroll/fnf",
    "/payroll-summary",
    "/payroll-batches",
    "/compliance/",
    "/ctc-breakup/calculate",
    "/ctc-breakup/reverse-calculate",
    "/ctc-breakup/arrears-preview",
    "/ctc-policy/adopt-pack",
    "/tds/recalculate",
    "/tds/projection",
)

FINANCE_KYB_PATH_MARKERS = (
    "/payroll",
    "/payroll-batches",
    "/ctc-approvals",
    "/fnf",
    "/extra-payments",
)


def tenant_kyb_allows_statutory(tenant_id=None) -> bool:
    """True when this tenant may run payroll / PF / Form 16."""
    tid = tenant_id if tenant_id is not None else get_current_tenant_id()
    if tid in (None, "", DEFAULT_TENANT_ID):
        return True
    try:
        tid = int(tid)
    except (TypeError, ValueError):
        return False
    if tid == DEFAULT_TENANT_ID:
        return True
    from . import db
    from .models.tenant import Tenant

    tenant = db.session.get(Tenant, tid)
    if tenant is None:
        return False
    kyc = (tenant.kyc_status or "not_required").strip().lower()
    if not kyc:
        kyc = "not_required"
    return kyc in KYB_STATUTORY_OK


def kyb_forbidden_response():
    return jsonify({
        "success": False,
        "code": KYB_REQUIRED_CODE,
        "message": KYB_REQUIRED_MESSAGE,
    }), 403


def accounts_path_needs_kyb(path: str) -> bool:
    p = (path or "").lower()
    if re.search(r"/ctc-breakup/\d+", p):
        return False
    if any(marker in p for marker in ACCOUNTS_KYB_PATH_MARKERS):
        return True
    return p.rstrip("/").endswith("/ctc-breakup")


def finance_path_needs_kyb(path: str) -> bool:
    p = (path or "").lower()
    if "/expense-claims" in p:
        return False
    return any(marker in p for marker in FINANCE_KYB_PATH_MARKERS)
