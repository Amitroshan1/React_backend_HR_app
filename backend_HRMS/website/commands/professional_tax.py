"""Multi-state Professional Tax (India) — monthly gross salary basis."""
from __future__ import annotations

import json
import re
from pathlib import Path

from .ctc_breakup_logic import maharashtra_professional_tax, parse_month_num

_RULES_PATH = Path(__file__).resolve().parents[1] / "data" / "professional_tax_rules.json"

# Common location / state name aliases → ISO 3166-2:IN code
_STATE_ALIASES: dict[str, str] = {
    "andaman and nicobar": "AN",
    "andaman": "AN",
    "andhra pradesh": "AP",
    "andhra": "AP",
    "arunachal pradesh": "AR",
    "assam": "AS",
    "guwahati": "AS",
    "bihar": "BR",
    "patna": "BR",
    "chhattisgarh": "CG",
    "chattisgarh": "CG",
    "goa": "GA",
    "gujarat": "GJ",
    "ahmedabad": "GJ",
    "surat": "GJ",
    "haryana": "HR",
    "gurgaon": "HR",
    "gurugram": "HR",
    "faridabad": "HR",
    "himachal pradesh": "HP",
    "himachal": "HP",
    "jharkhand": "JH",
    "ranchi": "JH",
    "jammu and kashmir": "JK",
    "jammu & kashmir": "JK",
    "j&k": "JK",
    "karnataka": "KA",
    "bangalore": "KA",
    "bengaluru": "KA",
    "mysore": "KA",
    "kerala": "KL",
    "kochi": "KL",
    "thiruvananthapuram": "KL",
    "ladakh": "LA",
    "maharashtra": "MH",
    "mumbai": "MH",
    "pune": "MH",
    "navi mumbai": "MH",
    "thane": "MH",
    "meghalaya": "ML",
    "shillong": "ML",
    "manipur": "MN",
    "madhya pradesh": "MP",
    "bhopal": "MP",
    "indore": "MP",
    "mizoram": "MZ",
    "aizawl": "MZ",
    "nagaland": "NL",
    "odisha": "OR",
    "orissa": "OR",
    "bhubaneswar": "OR",
    "punjab": "PB",
    "chandigarh": "CH",
    "puducherry": "PY",
    "pondicherry": "PY",
    "rajasthan": "RJ",
    "jaipur": "RJ",
    "sikkim": "SK",
    "gangtok": "SK",
    "tamil nadu": "TN",
    "tamilnadu": "TN",
    "chennai": "TN",
    "telangana": "TS",
    "hyderabad": "TS",
    "tripura": "TR",
    "uttar pradesh": "UP",
    "uttarakhand": "UK",
    "dehradun": "UK",
    "west bengal": "WB",
    "kolkata": "WB",
    "delhi": "DL",
    "new delhi": "DL",
    "dadra and nagar haveli": "DD",
    "daman and diu": "DD",
    "lakshadweep": "LD",
}


def _load_rules() -> dict:
    if _RULES_PATH.is_file():
        try:
            with open(_RULES_PATH, encoding="utf-8") as fh:
                data = json.load(fh)
            if isinstance(data, dict):
                return data
        except (json.JSONDecodeError, OSError):
            pass
    return {"MH": {"name": "Maharashtra", "engine": "maharashtra", "levies_pt": True}}


def list_ptax_states() -> list[dict]:
    rules = _load_rules()
    items = []
    for code, spec in rules.items():
        items.append({
            "code": code,
            "name": spec.get("name") or code,
            "levies_pt": bool(spec.get("levies_pt", spec.get("engine") not in ("none",))),
            "frequency": spec.get("frequency") or "monthly",
        })
    return sorted(items, key=lambda x: (not x["levies_pt"], x["name"]))


def normalize_ptax_state(state_or_location: str | None, default: str = "MH") -> str:
    if not state_or_location:
        d = (default or "MH").strip().upper()
        return d if len(d) == 2 else "MH"
    raw = str(state_or_location).strip()
    if not raw:
        return normalize_ptax_state(None, default)
    upper = raw.upper()
    rules = _load_rules()
    if len(upper) == 2 and upper in rules:
        return upper
    key = re.sub(r"\s+", " ", raw.lower())
    if key in _STATE_ALIASES:
        return _STATE_ALIASES[key]
    for alias, code in _STATE_ALIASES.items():
        if alias in key or key in alias:
            return code
    for code, spec in rules.items():
        name = str(spec.get("name") or "").lower()
        if name and name in key:
            return code
    return normalize_ptax_state(None, default)


def _slab_amount(gross: float, slabs: list[dict]) -> float:
    for slab in slabs:
        upto = slab.get("upto")
        if upto is None:
            return float(slab.get("amount") or 0)
        if gross <= float(upto):
            return float(slab.get("amount") or 0)
    return 0.0


def _half_yearly_monthly_equiv(monthly_gross: float, slabs: list[dict]) -> float:
    half_year = float(monthly_gross or 0) * 6.0
    tax_half_year = _slab_amount(half_year, slabs)
    return round(tax_half_year / 6.0, 2)


def _annual_tax_monthly_equiv(monthly_gross: float, slabs: list[dict]) -> float:
    """Annual tax amount from slabs → spread as monthly payroll deduction."""
    annual = float(monthly_gross or 0) * 12.0
    annual_tax = _slab_amount(annual, slabs)
    return round(annual_tax / 12.0, 2)


def _annual_gross_monthly_deduction(
    monthly_gross: float,
    slabs: list[dict],
    *,
    month=None,
    peak_month: int | None = None,
    peak_month_amount: float | None = None,
    peak_annual_min: float | None = None,
) -> float:
    """
    Slabs keyed on annual gross; `amount` is the usual monthly deduction.
    Optional higher deduction in one month (e.g. Odisha March, MP February).
    """
    annual = float(monthly_gross or 0) * 12.0
    monthly_amt = _slab_amount(annual, slabs)
    month_num = parse_month_num(month)
    if (
        peak_month
        and peak_month_amount is not None
        and peak_annual_min is not None
        and annual >= float(peak_annual_min)
        and month_num == int(peak_month)
    ):
        return float(peak_month_amount)
    return monthly_amt


def professional_tax(
    monthly_gross,
    gender=None,
    month=None,
    state_code: str = "MH",
):
    """Compute monthly Professional Tax for Indian states / UTs."""
    gross = float(monthly_gross or 0)
    if gross <= 0:
        return 0.0

    code = normalize_ptax_state(state_code, "MH")
    rules = _load_rules()
    spec = rules.get(code) or rules.get("MH") or {"engine": "maharashtra"}
    engine = (spec.get("engine") or "maharashtra").lower()

    if engine in ("none", "no_pt"):
        return 0.0

    if engine == "maharashtra":
        return maharashtra_professional_tax(gross, gender, month)

    if engine == "flat":
        min_gross = float(spec.get("min_gross") or 0)
        if gross < min_gross:
            return 0.0
        amount = float(spec.get("amount") or 0)
        month_num = parse_month_num(month)
        if spec.get("february_amount") and month_num == 2:
            return float(spec["february_amount"])
        if spec.get("peak_month_amount") and month_num == int(spec.get("peak_month") or 0):
            if not spec.get("peak_min_gross") or gross >= float(spec["peak_min_gross"]):
                return float(spec["peak_month_amount"])
        return amount

    if engine == "slab":
        base = _slab_amount(gross, spec.get("slabs") or [])
        month_num = parse_month_num(month)
        if spec.get("february_amount") and month_num == 2 and base > 0:
            return float(spec["february_amount"])
        if spec.get("peak_month_amount") and month_num == int(spec.get("peak_month") or 0):
            if base >= float(spec.get("peak_base_min") or 0):
                return float(spec["peak_month_amount"])
        return base

    if engine == "half_yearly_slab":
        return _half_yearly_monthly_equiv(gross, spec.get("slabs") or [])

    if engine == "annual_tax_slab":
        return _annual_tax_monthly_equiv(gross, spec.get("slabs") or [])

    if engine == "annual_gross_monthly":
        return _annual_gross_monthly_deduction(
            gross,
            spec.get("slabs") or [],
            month=month,
            peak_month=spec.get("peak_month"),
            peak_month_amount=spec.get("peak_month_amount"),
            peak_annual_min=spec.get("peak_annual_min"),
        )

    return maharashtra_professional_tax(gross, gender, month)


def resolve_ptax_state_for_employee(
    *,
    explicit_state=None,
    saved_state=None,
    location=None,
    default_state="MH",
):
    for candidate in (explicit_state, saved_state, location):
        if candidate and str(candidate).strip():
            return normalize_ptax_state(candidate, default_state)
    return normalize_ptax_state(None, default_state)
