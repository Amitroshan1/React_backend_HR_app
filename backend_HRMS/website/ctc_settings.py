"""Company-wide CTC structuring policy (JSON file, Accounts-configurable)."""
from __future__ import annotations

import json
from pathlib import Path

_SETTINGS_PATH = Path(__file__).resolve().parent / "data" / "ctc_settings.json"

_DEFAULTS = {
    "default_ptax_state": "MH",
    "hra_min_pct": 5.0,
    "hra_max_pct": 50.0,
    "basic_min_pct_of_ctc": 40.0,
    "basic_max_pct_of_ctc": 50.0,
    "default_hra_pct": 40.0,
    "include_pf_admin_in_ctc": True,
    "include_edli_in_ctc": True,
    "include_statutory_bonus_in_ctc": False,
    "statutory_bonus_pct": 8.33,
    "include_lwf_in_ctc": False,
    "lwf_employer_yearly": 12.0,
    "lwf_employee_yearly": 6.0,
    "conveyance_cap_monthly": 1600.0,
    "medical_cap_monthly": 1250.0,
}

_FLOAT_KEYS = (
    "hra_min_pct",
    "hra_max_pct",
    "basic_min_pct_of_ctc",
    "basic_max_pct_of_ctc",
    "default_hra_pct",
    "statutory_bonus_pct",
    "lwf_employer_yearly",
    "lwf_employee_yearly",
    "conveyance_cap_monthly",
    "medical_cap_monthly",
)

_BOOL_KEYS = (
    "include_pf_admin_in_ctc",
    "include_edli_in_ctc",
    "include_statutory_bonus_in_ctc",
    "include_lwf_in_ctc",
)


def load_ctc_settings() -> dict:
    if _SETTINGS_PATH.is_file():
        try:
            with open(_SETTINGS_PATH, encoding="utf-8") as fh:
                data = json.load(fh)
            if isinstance(data, dict):
                return {**_DEFAULTS, **data}
        except (json.JSONDecodeError, OSError):
            pass
    return dict(_DEFAULTS)


def save_ctc_settings(updates: dict) -> dict:
    current = load_ctc_settings()
    if "default_ptax_state" in updates:
        code = str(updates.get("default_ptax_state") or "MH").strip().upper()
        current["default_ptax_state"] = code[:2] if code else "MH"
    for key in _BOOL_KEYS:
        if key in updates:
            current[key] = bool(updates[key])
    for key in _FLOAT_KEYS:
        if key in updates:
            try:
                current[key] = max(0.0, float(updates[key]))
            except (TypeError, ValueError):
                pass
    _SETTINGS_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(_SETTINGS_PATH, "w", encoding="utf-8") as fh:
        json.dump(current, fh, indent=2)
    return current


def ctc_policy_payload() -> dict:
    from .commands.professional_tax import list_ptax_states

    settings = load_ctc_settings()
    return {
        **settings,
        "ptax_states": list_ptax_states(),
    }
