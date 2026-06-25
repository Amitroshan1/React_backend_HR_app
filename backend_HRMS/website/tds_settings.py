"""Runtime TDS / payroll policy settings (JSON file, Accounts-configurable)."""
from __future__ import annotations

import json
from datetime import date, timedelta
from pathlib import Path

from .commands.tds_logic import fy_start_end

_SETTINGS_PATH = Path(__file__).resolve().parent / "data" / "tds_settings.json"

_DEFAULTS = {
    "payroll_tds_approved_only": False,
    "block_employee_regime_change_after_submit": True,
    "regime_override_hr_only": True,
    "employer_name": "Saffo Solution Technology LLP",
    "employer_tan": "",
    "employer_pan": "",
    "form16_variance_tolerance_inr": 100,
    "form16_variance_alert_enabled": True,
    "max_declaration_amendments_per_fy": 2,
    "declaration_deadline_default_day": 25,
    "declaration_deadline_default_month": 2,
    "declaration_deadline_overrides": {},
}


def form16_variance_tolerance() -> float:
    return float(load_tds_settings().get("form16_variance_tolerance_inr") or 100)


def max_declaration_amendments_per_fy() -> int:
    return int(load_tds_settings().get("max_declaration_amendments_per_fy") or 2)


def employer_details() -> dict:
    s = load_tds_settings()
    return {
        "name": (s.get("employer_name") or _DEFAULTS["employer_name"]).strip(),
        "tan": (s.get("employer_tan") or "").strip() or "—",
        "pan": (s.get("employer_pan") or "").strip() or "—",
    }


def load_tds_settings() -> dict:
    if _SETTINGS_PATH.is_file():
        try:
            with open(_SETTINGS_PATH, encoding="utf-8") as fh:
                data = json.load(fh)
            if isinstance(data, dict):
                return {**_DEFAULTS, **data}
        except (json.JSONDecodeError, OSError):
            pass
    return dict(_DEFAULTS)


def save_tds_settings(updates: dict) -> dict:
    current = load_tds_settings()
    if "payroll_tds_approved_only" in updates:
        current["payroll_tds_approved_only"] = bool(updates["payroll_tds_approved_only"])
    if "block_employee_regime_change_after_submit" in updates:
        current["block_employee_regime_change_after_submit"] = bool(
            updates["block_employee_regime_change_after_submit"]
        )
    if "regime_override_hr_only" in updates:
        current["regime_override_hr_only"] = bool(updates["regime_override_hr_only"])
    for key in ("employer_name", "employer_tan", "employer_pan"):
        if key in updates:
            current[key] = (updates.get(key) or "").strip()
    if "form16_variance_tolerance_inr" in updates:
        try:
            current["form16_variance_tolerance_inr"] = max(
                0.0, float(updates["form16_variance_tolerance_inr"])
            )
        except (TypeError, ValueError):
            pass
    if "form16_variance_alert_enabled" in updates:
        current["form16_variance_alert_enabled"] = bool(updates["form16_variance_alert_enabled"])
    if "max_declaration_amendments_per_fy" in updates:
        try:
            current["max_declaration_amendments_per_fy"] = max(
                0, int(updates["max_declaration_amendments_per_fy"])
            )
        except (TypeError, ValueError):
            pass
    if "declaration_deadline_default_day" in updates:
        try:
            current["declaration_deadline_default_day"] = max(
                1, min(31, int(updates["declaration_deadline_default_day"]))
            )
        except (TypeError, ValueError):
            pass
    if "declaration_deadline_default_month" in updates:
        try:
            current["declaration_deadline_default_month"] = max(
                1, min(12, int(updates["declaration_deadline_default_month"]))
            )
        except (TypeError, ValueError):
            pass
    if "declaration_deadline_overrides" in updates:
        raw = updates.get("declaration_deadline_overrides")
        if isinstance(raw, dict):
            cleaned: dict[str, str] = {}
            for fy_key, val in raw.items():
                if not fy_key:
                    continue
                if val in (None, ""):
                    continue
                try:
                    cleaned[str(fy_key).strip()] = date.fromisoformat(str(val).strip()).isoformat()
                except ValueError:
                    continue
            current["declaration_deadline_overrides"] = cleaned
    _SETTINGS_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(_SETTINGS_PATH, "w", encoding="utf-8") as fh:
        json.dump(current, fh, indent=2)
    return current


def payroll_tds_approved_only() -> bool:
    return bool(load_tds_settings().get("payroll_tds_approved_only"))


def payroll_declaration_statuses() -> frozenset[str]:
    if payroll_tds_approved_only():
        return frozenset({"approved"})
    return frozenset({"approved", "submitted"})


def fy_compact_key(financial_year: str) -> str:
    fy_start, _ = fy_start_end(financial_year)
    y = fy_start.year
    return f"{y}-{str(y + 1)[-2:]}"


def _format_fy_display(financial_year: str) -> str:
    fy_start, _ = fy_start_end(financial_year)
    y = fy_start.year
    return f"{y}-{y + 1}"


def _format_deadline_display(deadline: date) -> str:
    return deadline.strftime("%d %B %Y")


def default_declaration_deadline(financial_year: str) -> date:
    settings = load_tds_settings()
    day = int(settings.get("declaration_deadline_default_day") or 25)
    month = int(settings.get("declaration_deadline_default_month") or 2)
    _, fy_end = fy_start_end(financial_year)
    end_year = fy_end.year
    try:
        return date(end_year, month, day)
    except ValueError:
        # Invalid day for month (e.g. 31 Feb) — use last valid day of month
        if month == 12:
            return date(end_year, 12, 31)
        return date(end_year, month + 1, 1) - timedelta(days=1)


def effective_declaration_deadline(financial_year: str) -> date:
    settings = load_tds_settings()
    overrides = settings.get("declaration_deadline_overrides") or {}
    compact = fy_compact_key(financial_year)
    fy_display = _format_fy_display(financial_year)
    default = default_declaration_deadline(financial_year)
    for key in (compact, fy_display, str(financial_year).strip()):
        raw = overrides.get(key)
        if raw:
            try:
                override = date.fromisoformat(str(raw).strip())
                if override != default:
                    return override
            except ValueError:
                pass
    return default


def is_declaration_submission_open(financial_year: str, as_of: date | None = None) -> bool:
    as_of = as_of or date.today()
    return as_of <= effective_declaration_deadline(financial_year)


def declaration_deadline_payload(financial_year: str, as_of: date | None = None) -> dict:
    as_of = as_of or date.today()
    deadline = effective_declaration_deadline(financial_year)
    default_deadline = default_declaration_deadline(financial_year)
    is_override = deadline != default_deadline
    is_open = as_of <= deadline
    fy_label = _format_fy_display(financial_year)
    deadline_label = _format_deadline_display(deadline)

    if is_open:
        if is_override:
            notice = (
                f"Tax declaration submission for FY {fy_label} is open until "
                f"{deadline_label} (extended by Finance). Please submit before the deadline."
            )
        else:
            notice = (
                f"Tax declaration submission for FY {fy_label} is open until "
                f"{deadline_label}. Please submit before the deadline."
            )
    else:
        notice = (
            f"Tax declaration submission for FY {fy_label} closed on {deadline_label}. "
            f"Contact Finance for assistance."
        )

    return {
        "financial_year": fy_label,
        "deadline": deadline.isoformat(),
        "deadline_display": deadline_label,
        "is_open": is_open,
        "is_extended": is_override,
        "default_deadline": default_deadline.isoformat(),
        "notice": notice,
    }


def set_declaration_deadline_override(financial_year: str, deadline: date | None) -> dict:
    settings = load_tds_settings()
    overrides = dict(settings.get("declaration_deadline_overrides") or {})
    compact = fy_compact_key(financial_year)
    fy_display = _format_fy_display(financial_year)
    keys = (compact, fy_display, str(financial_year).strip())
    if deadline is None or deadline == default_declaration_deadline(financial_year):
        for key in keys:
            overrides.pop(key, None)
    else:
        for key in keys:
            overrides.pop(key, None)
        overrides[compact] = deadline.isoformat()
    return save_tds_settings({"declaration_deadline_overrides": overrides})
