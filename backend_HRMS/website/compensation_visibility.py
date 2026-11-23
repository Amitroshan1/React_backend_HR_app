"""Phase 3: who may see compensation amounts (mask vs full). No encryption."""
from __future__ import annotations

from dataclasses import dataclass

from flask import jsonify, request

from .compensation_security import COMPENSATION_MONEY_TABLES, redact_compensation_text
from .plan_features import is_accounts_role, is_finance_role, is_hr_role, is_org_admin, is_platform_super_admin
from .sensitive_data_auth import SENSITIVE_AUTH_CODE, validate_sensitive_token

FULL = "full"
MASKED = "masked"
DENIED = "denied"
NEEDS_OTP = "needs_otp"

MONEY_KEYS = frozenset(
    col for cols in COMPENSATION_MONEY_TABLES.values() for col in cols
) | frozenset(
    {
        "fixed_ctc_annual",
        "total_ctc_annual",
        "annual_ctc_total",
        "old_annual_ctc",
        "new_annual_ctc",
        "gross_salary",
        "net_salary",
        "total_gross_final",
        "one_day_salary",
    }
)

PII_KEYS = frozenset(
    {
        "bank_details",
        "bank_account_number",
        "pan",
        "pan_number",
        "aadhaar_number",
        "uan",
        "pf_account_number",
        "esi_number",
        "pran",
    }
)

PAYROLL_FULL_TYPES = frozenset(
    {"account", "accounts", "accountant", "finance"}
)
HR_TYPES = frozenset({"hr", "human resource", "human resources"})
COMPANY_ADMIN_TYPES = frozenset({"admin"})


def _emp_type(admin) -> str:
    return (getattr(admin, "emp_type", None) or "").strip().lower()


def is_payroll_full_role(admin) -> bool:
    """Accounts / Finance / company Admin — operate payroll; unmasked amounts."""
    if admin is None:
        return False
    t = _emp_type(admin)
    if t in PAYROLL_FULL_TYPES or t in COMPANY_ADMIN_TYPES:
        return True
    claims = {
        "emp_type": getattr(admin, "emp_type", None),
        "tenant_id": getattr(admin, "tenant_id", None),
    }
    if is_platform_super_admin(claims):
        return False
    return bool(is_accounts_role(claims) or is_finance_role(claims) or is_org_admin(claims))


def is_hr_viewer(admin) -> bool:
    t = _emp_type(admin)
    if t in HR_TYPES:
        return True
    claims = {"emp_type": getattr(admin, "emp_type", None)}
    return is_hr_role(claims)


def _wants_reveal() -> bool:
    q = str(request.args.get("reveal") or "").strip().lower()
    h = str(request.headers.get("X-Compensation-Reveal") or "").strip().lower()
    return q in {"1", "true", "yes", "on"} or h in {"1", "true", "yes", "on"}


def _has_sensitive_otp(admin) -> bool:
    token = (request.headers.get("X-Sensitive-Token") or "").strip()
    if not token or admin is None:
        return False
    return validate_sensitive_token(token, int(admin.id))


@dataclass
class CompensationAccess:
    status: str
    own: bool = False

    @property
    def ok(self) -> bool:
        return self.status in {FULL, MASKED}


def evaluate_compensation_access(admin, target_admin_id: int, *, export: bool = False) -> CompensationAccess:
    if admin is None:
        return CompensationAccess(DENIED)
    try:
        own = int(target_admin_id) == int(admin.id)
    except (TypeError, ValueError):
        return CompensationAccess(DENIED)

    if is_payroll_full_role(admin):
        return CompensationAccess(FULL, own=own)

    if is_hr_viewer(admin) or is_platform_super_admin(
        {"emp_type": getattr(admin, "emp_type", None), "tenant_id": getattr(admin, "tenant_id", None)}
    ):
        if own and not export:
            return CompensationAccess(FULL, own=True)
        reveal = _wants_reveal()
        if export:
            if not reveal:
                return CompensationAccess(DENIED, own=own)
            if _has_sensitive_otp(admin):
                return CompensationAccess(FULL, own=own)
            return CompensationAccess(NEEDS_OTP, own=own)
        if reveal:
            if _has_sensitive_otp(admin):
                return CompensationAccess(FULL, own=own)
            return CompensationAccess(NEEDS_OTP, own=own)
        return CompensationAccess(MASKED, own=own)

    if not own:
        return CompensationAccess(DENIED, own=False)
    if _has_sensitive_otp(admin):
        return CompensationAccess(FULL, own=True)
    return CompensationAccess(NEEDS_OTP, own=True)


def access_flask_error(decision: CompensationAccess):
    if decision.status == DENIED:
        return jsonify({"success": False, "message": "Access denied"}), 403
    if decision.status == NEEDS_OTP:
        return jsonify({
            "success": False,
            "message": "OTP verification required to view salary and tax data.",
            "code": SENSITIVE_AUTH_CODE,
        }), 403
    return None


def mask_money_tree(value):
    """Replace rupee / payout PII with None; leave flags, dates, ids."""
    if isinstance(value, dict):
        out = {}
        for k, v in value.items():
            key = str(k)
            if key in MONEY_KEYS or key in PII_KEYS:
                out[k] = None
            else:
                out[k] = mask_money_tree(v)
        return out
    if isinstance(value, list):
        return [mask_money_tree(v) for v in value]
    return value


def apply_visibility(payload: dict, decision: CompensationAccess) -> dict:
    data = dict(payload or {})
    data["salary_visibility"] = decision.status
    if decision.status == MASKED:
        for key in ("ctc_breakup", "pending_request", "history", "revisions", "payroll", "profile"):
            if key in data and data[key] is not None:
                data[key] = mask_money_tree(data[key])
        if "snapshot" in data:
            data["snapshot"] = mask_money_tree(data["snapshot"])
    return data


def sanitize_field_changes(changes: dict | None) -> dict | None:
    """Persist that a field changed, never old/new rupees."""
    if not changes:
        return None
    out = {}
    for key, spec in changes.items():
        if key == "actual_working_days" or key == "status":
            out[key] = spec
            continue
        if key in MONEY_KEYS or (
            isinstance(spec, dict) and ("from" in spec or "to" in spec)
        ):
            out[key] = {"changed": True}
        else:
            out[key] = spec
    return out or None


def log_compensation_view(viewer, target_admin_id: int, resource: str, visibility: str) -> None:
    if viewer is None or visibility not in {FULL, MASKED}:
        return
    try:
        from . import db
        from .models.compensation_view_log import CompensationViewLog

        db.session.add(
            CompensationViewLog(
                viewer_admin_id=int(viewer.id),
                target_admin_id=int(target_admin_id),
                resource=(resource or "")[:80],
                visibility=visibility,
            )
        )
        db.session.commit()
    except Exception:
        try:
            from . import db

            db.session.rollback()
        except Exception:
            pass


def last4(value: str | None) -> str | None:
    digits = "".join(ch for ch in str(value or "") if ch.isdigit())
    if len(digits) < 4:
        return None
    return digits[-4:]


# Used by log redaction tests / emails
redact_compensation_text = redact_compensation_text
