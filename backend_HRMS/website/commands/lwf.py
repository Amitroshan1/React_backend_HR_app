"""Labour Welfare Fund (LWF) — state-wise employee deduction for payroll."""
from __future__ import annotations

import json
from pathlib import Path

from .professional_tax import normalize_ptax_state

_RULES_PATH = Path(__file__).resolve().parents[1] / "data" / "lwf_rules.json"


def _load_rules() -> dict:
    if _RULES_PATH.is_file():
        try:
            with open(_RULES_PATH, encoding="utf-8") as fh:
                data = json.load(fh)
            if isinstance(data, dict):
                return data
        except (json.JSONDecodeError, OSError):
            pass
    return {}


def list_lwf_states() -> list[dict]:
    rules = _load_rules()
    return [
        {
            "code": code,
            "name": spec.get("name") or code,
            "levies_lwf": bool(spec.get("levies_lwf")),
        }
        for code, spec in sorted(rules.items())
    ]


def lwf_employee_monthly(
    state_code: str,
    month=None,
    *,
    policy_employee_yearly: float | None = None,
) -> float:
    """
    Employee LWF deduction for a payroll month (₹).
    Uses state rules when available; falls back to company policy yearly amount ÷ 12.
    """
    code = normalize_ptax_state(state_code, "MH")
    rules = _load_rules()
    spec = rules.get(code) or {}
    month_num = _parse_month(month)

    if not spec.get("levies_lwf"):
        if policy_employee_yearly and float(policy_employee_yearly) > 0:
            return round(float(policy_employee_yearly) / 12.0, 2)
        return 0.0

    yearly = float(spec.get("employee_yearly") or 0)
    if yearly <= 0 and policy_employee_yearly:
        yearly = float(policy_employee_yearly)

    freq = (spec.get("frequency") or "monthly").lower()
    if freq == "monthly":
        return round(yearly / 12.0, 2)

    if freq == "half_yearly":
        months = spec.get("deduction_months") or [6, 12]
        if month_num in [int(m) for m in months]:
            return round(yearly / float(len(months)), 2)
        return 0.0

    if freq == "annual":
        ded_month = int(spec.get("deduction_month") or 12)
        if month_num == ded_month:
            return round(yearly, 2)
        return 0.0

    return round(yearly / 12.0, 2)


def lwf_employer_yearly_for_state(state_code: str, *, policy_employer_yearly: float | None = None) -> float:
    code = normalize_ptax_state(state_code, "MH")
    spec = _load_rules().get(code) or {}
    if spec.get("levies_lwf"):
        return float(spec.get("employer_yearly") or 0)
    return float(policy_employer_yearly or 0)


def _parse_month(month) -> int:
    if month is None:
        return 0
    if isinstance(month, int):
        return month if 1 <= month <= 12 else 0
    s = str(month).strip()
    if not s:
        return 0
    if s.isdigit():
        n = int(s)
        return n if 1 <= n <= 12 else 0
    if len(s) >= 7 and s[4] == "-":
        try:
            n = int(s[5:7])
            return n if 1 <= n <= 12 else 0
        except ValueError:
            return 0
    return 0
