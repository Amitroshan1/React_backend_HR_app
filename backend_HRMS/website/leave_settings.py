"""Runtime leave policy settings (JSON file)."""
from __future__ import annotations

import json
from pathlib import Path

_SETTINGS_PATH = Path(__file__).resolve().parent / "data" / "leave_settings.json"

_DEFAULTS = {
    "max_hr_backdate_days": 60,
    "block_on_payroll_locked": True,
    "max_regularization_backdate_days": 30,
    "manager_on_behalf_allowed": True,
}


def load_leave_settings() -> dict:
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
    return bool(load_leave_settings().get("manager_on_behalf_allowed", True))
