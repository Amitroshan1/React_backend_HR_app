"""Phase 6: rotate tenant DEKs, re-wrap with a new KEK, revoke a tenant vault."""
from __future__ import annotations

import hmac
import logging
import os

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from .datetime_utils import utc_now
from .pii_crypto import (
    ACCOUNTS_PII_FIELDS,
    UPLOAD_PII_FIELDS,
    clear_dek_cache,
    get_or_create_dek,
    kek_is_ready,
    load_kek,
    pii_get,
    pii_set,
    unwrap_dek_any_kek,
    wrap_dek,
)
from .tenant_context import DEFAULT_TENANT_ID

logger = logging.getLogger(__name__)

BREAK_GLASS_A_ENV = "COMPENSATION_BREAK_GLASS_A"
BREAK_GLASS_B_ENV = "COMPENSATION_BREAK_GLASS_B"


class CompensationCryptoError(RuntimeError):
    pass


def require_dual_control(token_a: str | None, token_b: str | None) -> None:
    a = (os.environ.get(BREAK_GLASS_A_ENV) or "").strip()
    b = (os.environ.get(BREAK_GLASS_B_ENV) or "").strip()
    if len(a) < 16 or len(b) < 16 or a == b:
        raise CompensationCryptoError(
            "Set distinct COMPENSATION_BREAK_GLASS_A and _B (16+ chars) before break-glass."
        )
    ta = (token_a or "").strip()
    tb = (token_b or "").strip()
    if not hmac.compare_digest(ta, a) or not hmac.compare_digest(tb, b):
        raise CompensationCryptoError("Break-glass tokens do not match dual-control holders.")


def crypto_status() -> dict:
    from .models.tenant_crypto_key import TenantCryptoKey
    from .pii_crypto import kek_is_ready, load_previous_kek

    tenants = []
    try:
        rows = TenantCryptoKey.query.all()
    except Exception:
        rows = []
    for row in rows:
        tenants.append(
            {
                "tenant_id": int(row.tenant_id),
                "key_version": int(row.key_version or 0),
                "revoked": bool(row.revoked_at),
                "has_previous_wrap": bool(row.wrapped_dek_previous),
            }
        )
    return {
        "kek_ready": kek_is_ready(),
        "previous_kek_ready": load_previous_kek() is not None,
        "tenant_count": len(tenants),
        "tenants": tenants,
    }


def break_glass_last4(admin_id: int, token_a: str | None, token_b: str | None) -> str:
    """Dual-control: confirm decrypt works; return PAN last4 only (never full PAN)."""
    require_dual_control(token_a, token_b)
    from .models.education import UploadDoc
    from .pii_crypto import pii_get

    row = UploadDoc.query.filter_by(admin_id=int(admin_id)).first()
    if not row:
        raise CompensationCryptoError("No identity row for that employee")
    pan = pii_get(row, "pan_number") or ""
    return pan[-4:] if len(pan) >= 4 else ""


def _require_kek():
    kek = load_kek()
    if kek is None:
        raise CompensationCryptoError("COMPENSATION_PII_KEK is not set")
    return kek


def _admin_ids(tenant_id: int) -> list[int]:
    from .models.Admin_models import Admin

    rows = Admin.query.filter(Admin.tenant_id == int(tenant_id)).with_entities(Admin.id).all()
    return [int(r[0]) for r in rows]


def reencrypt_tenant_payloads(tenant_id: int) -> dict:
    """Decrypt with current/previous DEK, write with current DEK. Call while previous wrap still stored."""
    from . import db
    from .models.ctc_breakup import CTCBreakup
    from .models.education import UploadDoc
    from .models.employee_accounts import EmployeeAccounts
    from .models.employee_salary_loan import EmployeeSalaryLoan
    from .models.fnf_settlement import FnfSettlement
    from .models.monthly_payroll import MonthlyPayroll
    from .models.payroll_finance_fact import PayrollFinanceFact
    from .models.ctc_breakup_revision import CTCBreakupRevision
    from .models.ctc_change_request import CTCChangeRequest
    from .money_vault import (
        CTC_MONEY_FIELDS,
        FNF_MONEY_FIELDS,
        LOAN_MONEY_FIELDS,
        PAYROLL_MONEY_FIELDS,
        pack_amount_blob,
        pack_json_attr,
        unpack_amount_blob,
        unpack_json_attr,
    )
    from .payroll_finance_facts import _pack_totals, _unpack_totals

    ids = _admin_ids(tenant_id)
    counts = {
        "upload_docs": 0,
        "employee_accounts": 0,
        "ctc": 0,
        "payroll": 0,
        "loans": 0,
        "fnf": 0,
        "facts": 0,
        "ctc_revisions": 0,
        "ctc_change_requests": 0,
    }
    if ids:
        for row in UploadDoc.query.filter(UploadDoc.admin_id.in_(ids)).yield_per(50):
            for field in UPLOAD_PII_FIELDS:
                val = pii_get(row, field)
                if val:
                    pii_set(row, field, val)
            counts["upload_docs"] += 1
        for row in EmployeeAccounts.query.filter(EmployeeAccounts.admin_id.in_(ids)).yield_per(50):
            for field in ACCOUNTS_PII_FIELDS:
                val = pii_get(row, field)
                if val:
                    pii_set(row, field, val)
            counts["employee_accounts"] += 1
        for row in CTCBreakup.query.filter(CTCBreakup.admin_id.in_(ids)).yield_per(50):
            unpack_amount_blob(row, CTC_MONEY_FIELDS)
            pack_amount_blob(row, CTC_MONEY_FIELDS)
            counts["ctc"] += 1
        for row in MonthlyPayroll.query.filter(MonthlyPayroll.admin_id.in_(ids)).yield_per(50):
            unpack_amount_blob(row, PAYROLL_MONEY_FIELDS)
            pack_amount_blob(row, PAYROLL_MONEY_FIELDS)
            counts["payroll"] += 1
        for row in EmployeeSalaryLoan.query.filter(EmployeeSalaryLoan.admin_id.in_(ids)).yield_per(50):
            unpack_amount_blob(row, LOAN_MONEY_FIELDS)
            pack_amount_blob(row, LOAN_MONEY_FIELDS)
            counts["loans"] += 1
        for row in FnfSettlement.query.filter(FnfSettlement.admin_id.in_(ids)).yield_per(50):
            unpack_amount_blob(row, FNF_MONEY_FIELDS)
            pack_amount_blob(row, FNF_MONEY_FIELDS)
            unpack_json_attr(row, "snapshot")
            pack_json_attr(row, "snapshot")
            counts["fnf"] += 1
        for row in CTCBreakupRevision.query.filter(CTCBreakupRevision.admin_id.in_(ids)).yield_per(50):
            unpack_json_attr(row, "snapshot")
            pack_json_attr(row, "snapshot")
            counts["ctc_revisions"] += 1
    for row in CTCChangeRequest.query.filter(CTCChangeRequest.tenant_id == int(tenant_id)).yield_per(50):
        unpack_json_attr(row, "payload")
        pack_json_attr(row, "payload")
        counts["ctc_change_requests"] += 1
    for fact in PayrollFinanceFact.query.filter_by(tenant_id=int(tenant_id)).yield_per(50):
        totals = _unpack_totals(fact)
        fact.totals_blob = _pack_totals(
            fact.tenant_id, fact.year, fact.month_num, fact.circle or "", fact.emp_type or "", totals
        )
        counts["facts"] += 1
    db.session.flush()
    return counts


def rotate_tenant_dek(tenant_id: int) -> dict:
    """New DEK, re-encrypt tenant blobs, drop previous wrap only after success."""
    from . import db
    from .models.tenant_crypto_key import TenantCryptoKey

    kek = _require_kek()
    tid = int(tenant_id or DEFAULT_TENANT_ID)
    get_or_create_dek(tid)
    row = TenantCryptoKey.query.filter_by(tenant_id=tid).first()
    if not row:
        raise CompensationCryptoError(f"No crypto row for tenant {tid}")
    if row.revoked_at:
        raise CompensationCryptoError(f"Tenant {tid} crypto is revoked")

    old_wrap = bytes(row.wrapped_dek)
    new_dek = AESGCM.generate_key(bit_length=256)
    row.wrapped_dek_previous = old_wrap
    row.wrapped_dek = wrap_dek(kek, new_dek, tid)
    row.key_version = int(row.key_version or 1) + 1
    row.rotated_at = utc_now()
    clear_dek_cache(tid)
    db.session.flush()
    counts = reencrypt_tenant_payloads(tid)
    row.wrapped_dek_previous = None
    clear_dek_cache(tid)
    db.session.commit()
    logger.info("Rotated compensation DEK for tenant %s version=%s", tid, row.key_version)
    return {"tenant_id": tid, "key_version": row.key_version, "reencrypted": counts}


def rewrap_all_tenant_deks() -> int:
    """Re-wrap current (and previous) DEKs with the active KEK after a KEK change."""
    from . import db
    from .models.tenant_crypto_key import TenantCryptoKey

    kek = _require_kek()
    n = 0
    for row in TenantCryptoKey.query.all():
        if row.revoked_at:
            continue
        tid = int(row.tenant_id)
        dek = unwrap_dek_any_kek(bytes(row.wrapped_dek), tid)
        row.wrapped_dek = wrap_dek(kek, dek, tid)
        if row.wrapped_dek_previous:
            prev = unwrap_dek_any_kek(bytes(row.wrapped_dek_previous), tid)
            row.wrapped_dek_previous = wrap_dek(kek, prev, tid)
        n += 1
    clear_dek_cache()
    db.session.commit()
    logger.info("Rewrapped compensation DEKs for %s tenants", n)
    return n


def revoke_tenant_dek(tenant_id: int) -> None:
    """Drop unwrap ability for a tenant. Existing ciphertext stays but will not decrypt."""
    from . import db
    from .models.tenant_crypto_key import TenantCryptoKey

    tid = int(tenant_id)
    row = TenantCryptoKey.query.filter_by(tenant_id=tid).first()
    kek = load_kek()
    junk = AESGCM.generate_key(bit_length=256)
    wrap = wrap_dek(kek, junk, tid) if kek else junk
    if not row:
        row = TenantCryptoKey(tenant_id=tid, wrapped_dek=wrap, key_version=0)
        db.session.add(row)
    else:
        row.wrapped_dek = wrap
        row.wrapped_dek_previous = None
    row.revoked_at = utc_now()
    clear_dek_cache(tid)
    db.session.commit()
    logger.critical("Revoked compensation crypto for tenant %s", tid)
