"""Tax regime resolution, HR override rules, and employee change guards."""
from __future__ import annotations

from . import tds_settings as tds_cfg
from .commands.tds_logic import normalize_regime
from .datetime_utils import isoformat_api, utc_now
from . import tax_declaration_service as tax_decl
from .models.employee_accounts import EmployeeAccounts
from .models.employee_tax_declaration import EmployeeTaxDeclaration
from . import db


def _profile_regime(acct: EmployeeAccounts | None) -> str | None:
    if not acct:
        return None
    override = (getattr(acct, "tax_regime_override", None) or "").strip()
    if override:
        return override
    return (acct.tax_regime or "").strip() or None


def effective_tax_regime(
    acct: EmployeeAccounts | None,
    *,
    declaration: EmployeeTaxDeclaration | None = None,
) -> dict:
    """Resolved regime for TDS with source metadata."""
    profile_regime = _profile_regime(acct)
    decl_regime = (declaration.tax_regime or "").strip() if declaration else None
    override = (getattr(acct, "tax_regime_override", None) or "").strip() if acct else ""
    has_override = bool(override)

    if declaration and decl_regime and (declaration.status or "").lower() in ("submitted", "approved"):
        regime = decl_regime
        source = "declaration"
    elif has_override:
        regime = override
        source = "hr_override"
    else:
        regime = profile_regime
        source = "profile"

    return {
        "tax_regime": regime,
        "source": source,
        "has_hr_override": has_override,
        "profile_regime": acct.tax_regime if acct else None,
        "override_regime": override or None,
        "override_reason": getattr(acct, "tax_regime_override_reason", None) if acct else None,
        "override_at": isoformat_api(getattr(acct, "tax_regime_override_at", None)) if acct else None,
        "declaration_regime": decl_regime,
        "regime_norm": normalize_regime(regime),
    }


def employee_may_change_regime(admin_id: int, financial_year: str | None = None) -> tuple[bool, str]:
    settings = tds_cfg.load_tds_settings()
    if not settings.get("block_employee_regime_change_after_submit", True):
        return True, ""

    fy = tax_decl.normalize_financial_year(financial_year) if financial_year else None
    q = EmployeeTaxDeclaration.query.filter(
        EmployeeTaxDeclaration.admin_id == admin_id,
        EmployeeTaxDeclaration.status.in_(("submitted", "approved")),
    )
    if fy:
        q = q.filter(EmployeeTaxDeclaration.financial_year == fy)
    row = q.order_by(EmployeeTaxDeclaration.updated_at.desc()).first()
    if row:
        return False, (
            "Tax regime is locked after declaration submission. "
            "Contact Finance for a regime override."
        )
    return True, ""


def set_tax_regime_override(
    admin_id: int,
    tax_regime: str,
    reason: str,
    actor_admin_id: int,
) -> EmployeeAccounts:
    regime = (tax_regime or "").strip()
    if not regime:
        raise ValueError("tax_regime is required")
    reason = (reason or "").strip()
    if not reason:
        raise ValueError("reason is required for HR regime override")

    acct = EmployeeAccounts.query.filter_by(admin_id=admin_id).first()
    if not acct:
        acct = EmployeeAccounts(admin_id=admin_id)
        db.session.add(acct)

    acct.tax_regime_override = regime
    acct.tax_regime_override_reason = reason
    acct.tax_regime_override_at = utc_now()
    acct.tax_regime_override_by_admin_id = actor_admin_id
    if not acct.tax_regime:
        acct.tax_regime = regime
    acct.updated_at = utc_now()
    db.session.commit()
    return acct


def clear_tax_regime_override(admin_id: int) -> EmployeeAccounts | None:
    acct = EmployeeAccounts.query.filter_by(admin_id=admin_id).first()
    if not acct:
        return None
    acct.tax_regime_override = None
    acct.tax_regime_override_reason = None
    acct.tax_regime_override_at = None
    acct.tax_regime_override_by_admin_id = None
    acct.updated_at = utc_now()
    db.session.commit()
    return acct
