"""Runtime leave policy settings, per company (``company_settings``; default company: JSON file)."""
from __future__ import annotations

import json
from pathlib import Path

_SETTINGS_PATH = Path(__file__).resolve().parent / "data" / "leave_settings.json"

_DEFAULTS = {
    "max_hr_backdate_days": 60,
    "block_on_payroll_locked": True,
    "max_regularization_backdate_days": 30,
    "manager_on_behalf_allowed": False,
    "contract_leave_accrual_default": False,
}

_NAMESPACE = "leave"
_BOOL_KEYS = ("block_on_payroll_locked", "manager_on_behalf_allowed", "contract_leave_accrual_default")
_INT_KEYS = ("max_hr_backdate_days", "max_regularization_backdate_days")


def _company_store():
    """Per-company settings storage, or None without an app (file-only mode)."""
    try:
        from . import company_settings
    except Exception:
        return None
    return company_settings if company_settings.available() else None


def load_leave_settings(tenant_id=None) -> dict:
    store = _company_store()
    if store is not None:
        tid = store.settings_tenant_id(tenant_id)
        saved = store.stored_settings(_NAMESPACE, tid)
        if saved is not None:
            return {**_DEFAULTS, **saved}
        if tid != store.DEFAULT_TENANT_ID:
            return dict(_DEFAULTS)
    return _load_file()


def save_leave_settings(updates: dict, tenant_id=None, *, admin_id=None) -> dict:
    """Validate and save the company's leave policy (unknown keys are ignored)."""
    current = load_leave_settings(tenant_id)
    for key in _BOOL_KEYS:
        if key in updates:
            current[key] = bool(updates[key])
    for key in _INT_KEYS:
        if key in updates:
            try:
                current[key] = max(0, min(3650, int(updates[key])))
            except (TypeError, ValueError):
                raise ValueError(f"{key} must be a whole number of days")
    store = _company_store()
    if store is None:
        raise RuntimeError("Leave settings can only be saved inside the app")
    store.save_settings(_NAMESPACE, store.settings_tenant_id(tenant_id), current, admin_id=admin_id)
    return current


def _load_file() -> dict:
    if _SETTINGS_PATH.is_file():
        try:
            with open(_SETTINGS_PATH, encoding="utf-8") as fh:
                data = json.load(fh)
            if isinstance(data, dict):
                return {**_DEFAULTS, **data}
        except (json.JSONDecodeError, OSError):
            pass
    return dict(_DEFAULTS)


def max_hr_backdate_days() -> int:
    try:
        return max(0, int(load_leave_settings().get("max_hr_backdate_days") or 60))
    except (TypeError, ValueError):
        return 90


def block_on_payroll_locked() -> bool:
    return bool(load_leave_settings().get("block_on_payroll_locked", True))


def max_regularization_backdate_days() -> int:
    try:
        return max(0, int(load_leave_settings().get("max_regularization_backdate_days") or 30))
    except (TypeError, ValueError):
        return 30


def manager_on_behalf_allowed() -> bool:
    return bool(load_leave_settings().get("manager_on_behalf_allowed", False))
