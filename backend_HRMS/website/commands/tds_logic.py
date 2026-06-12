"""
Indian salary TDS projection (Section 192) — pure functions, no Flask.

Rules are loaded from JSON per financial year + regime so Accounts can update
when government slabs change without rewriting core logic.
"""

from __future__ import annotations

import json
import math
from datetime import date, datetime
from pathlib import Path
from typing import Any

_RULES_DIR = Path(__file__).resolve().parent.parent / "data" / "tax_rules"

FY_MONTH_ORDER = [4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3]


def _round0(x: float) -> float:
    return float(round(x))


def _round2(x: float) -> float:
    return float(round(x, 2))


def normalize_regime(tax_regime: str | None) -> str:
    s = (tax_regime or "").strip().lower()
    if "old" in s:
        return "old"
    if "new" in s:
        return "new"
    return "new"


def financial_year_for_date(d: date | None = None) -> str:
    d = d or date.today()
    if d.month >= 4:
        return f"{d.year}-{str(d.year + 1)[-2:]}"
    return f"{d.year - 1}-{str(d.year)[-2:]}"


def fy_start_end(financial_year: str) -> tuple[date, date]:
    parts = str(financial_year).strip().split("-")
    if len(parts) != 2 or not parts[0].isdigit():
        y = date.today().year
        start_year = y if date.today().month >= 4 else y - 1
    else:
        start_year = int(parts[0])
    start = date(start_year, 4, 1)
    end = date(start_year + 1, 3, 31)
    return start, end


def months_remaining_in_fy(
    financial_year: str,
    as_of: date | None = None,
) -> int:
    as_of = as_of or date.today()
    fy_start, fy_end = fy_start_end(financial_year)
    if as_of < fy_start:
        return 12
    if as_of > fy_end:
        return 0
    as_of_month = date(as_of.year, as_of.month, 1)
    count = 0
    for m in FY_MONTH_ORDER:
        y = fy_start.year if m >= 4 else fy_start.year + 1
        month_start = date(y, m, 1)
        if fy_start <= month_start <= fy_end and month_start >= as_of_month:
            count += 1
    return max(count, 1)


def load_tax_rules(financial_year: str, regime: str) -> dict[str, Any]:
    regime_key = normalize_regime(regime)
    fy_compact = str(financial_year).strip()
    # Try exact file e.g. 2025-26_new.json
    candidates = [
        _RULES_DIR / f"{fy_compact}_{regime_key}.json",
    ]
    # Also try 4-digit start only
    if "-" in fy_compact:
        start = fy_compact.split("-")[0]
        candidates.append(_RULES_DIR / f"{start}-{str(int(start) + 1)[-2:]}_{regime_key}.json")

    for path in candidates:
        if path.is_file():
            with open(path, encoding="utf-8") as f:
                return json.load(f)

    # Fallback to latest bundled rules for regime
    fallback = sorted(_RULES_DIR.glob(f"*_{regime_key}.json"))
    if fallback:
        with open(fallback[-1], encoding="utf-8") as f:
            data = json.load(f)
            data["_fallback"] = True
            return data

    raise ValueError(f"No tax rules found for FY {financial_year} regime {regime_key}")


def list_available_tax_rules() -> list[dict[str, str]]:
    out = []
    for path in sorted(_RULES_DIR.glob("*.json")):
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        out.append({
            "financial_year": data.get("financial_year"),
            "regime": data.get("regime"),
            "label": data.get("label"),
            "file": path.name,
        })
    return out


def compute_hra_exemption(
    *,
    basic_annual: float,
    hra_annual: float,
    rent_paid_annual: float = 0,
    is_metro: bool = False,
    rules: dict | None = None,
) -> float:
    if hra_annual <= 0:
        return 0.0
    metro_pct = float((rules or {}).get("hra_metro_pct", 50))
    non_metro_pct = float((rules or {}).get("hra_non_metro_pct", 40))
    pct = metro_pct if is_metro else non_metro_pct
    actual_hra = max(0.0, hra_annual)
    rent_minus_10pct_basic = max(0.0, rent_paid_annual - 0.10 * basic_annual)
    pct_of_basic = basic_annual * (pct / 100.0)
    return _round2(min(actual_hra, rent_minus_10pct_basic, pct_of_basic))


def compute_tax_on_slabs(taxable: float, slabs: list[dict]) -> tuple[float, list[dict]]:
    taxable = max(0.0, float(taxable))
    tax = 0.0
    prev = 0.0
    breakdown = []
    for slab in slabs:
        limit = slab.get("upto")
        rate = float(slab.get("rate", 0))
        if limit is None:
            band = max(0.0, taxable - prev)
            slab_tax = band * (rate / 100.0)
            if band > 0:
                breakdown.append({
                    "from": _round2(prev),
                    "to": None,
                    "rate_pct": rate,
                    "taxable_in_band": _round2(band),
                    "tax": _round2(slab_tax),
                })
            tax += slab_tax
            break
        limit_f = float(limit)
        if taxable <= prev:
            break
        upper = min(taxable, limit_f)
        band = max(0.0, upper - prev)
        slab_tax = band * (rate / 100.0)
        if band > 0:
            breakdown.append({
                "from": _round2(prev),
                "to": _round2(limit_f),
                "rate_pct": rate,
                "taxable_in_band": _round2(band),
                "tax": _round2(slab_tax),
            })
        tax += slab_tax
        prev = limit_f
    return _round2(tax), breakdown


def compute_annual_tax(taxable_income: float, rules: dict) -> dict[str, Any]:
    taxable = max(0.0, float(taxable_income))
    base_tax, slab_breakdown = compute_tax_on_slabs(taxable, rules.get("slabs", []))

    rebate_cfg = rules.get("rebate_87a") or {}
    income_limit = float(rebate_cfg.get("income_limit", 0))
    max_rebate = float(rebate_cfg.get("max_rebate", 0))
    rebate = min(base_tax, max_rebate) if taxable <= income_limit else 0.0
    rebate = _round2(rebate)

    tax_after_rebate = max(0.0, base_tax - rebate)
    cess_pct = float(rules.get("cess_pct", 4))
    cess = _round2(tax_after_rebate * (cess_pct / 100.0))
    annual_tax = _round2(tax_after_rebate + cess)

    return {
        "taxable_income": _round2(taxable),
        "tax_before_rebate": _round2(base_tax),
        "rebate_87a": rebate,
        "tax_after_rebate": _round2(tax_after_rebate),
        "cess_pct": cess_pct,
        "cess": cess,
        "annual_tax": annual_tax,
        "slab_breakdown": slab_breakdown,
    }


def project_annual_gross(
    *,
    monthly_gross: float,
    financial_year: str,
    date_of_joining: date | None = None,
    ytd_gross: float = 0,
    as_of: date | None = None,
) -> dict[str, float]:
    as_of = as_of or date.today()
    fy_start, fy_end = fy_start_end(financial_year)
    monthly = max(0.0, float(monthly_gross))

    if ytd_gross > 0:
        remaining = months_remaining_in_fy(financial_year, as_of)
        projected = ytd_gross + monthly * remaining
        return {
            "monthly_gross": _round2(monthly),
            "ytd_gross": _round2(ytd_gross),
            "months_remaining": remaining,
            "projected_annual_gross": _round2(projected),
        }

    months_in_fy = 12
    if date_of_joining:
        doj = date_of_joining
        if doj > fy_end:
            months_in_fy = 0
        elif doj > fy_start:
            count = 0
            for m in FY_MONTH_ORDER:
                y = fy_start.year if m >= 4 else fy_start.year + 1
                month_start = date(y, m, 1)
                if month_start >= date(doj.year, doj.month, 1) and month_start <= fy_end:
                    count += 1
            months_in_fy = max(count, 0)

    projected = monthly * months_in_fy
    return {
        "monthly_gross": _round2(monthly),
        "ytd_gross": _round2(ytd_gross),
        "months_in_fy": months_in_fy,
        "projected_annual_gross": _round2(projected),
    }


def run_tds_projection(
    *,
    monthly_gross: float,
    monthly_basic: float,
    monthly_hra: float,
    monthly_epf: float,
    tax_regime: str | None,
    financial_year: str | None = None,
    pan: str | None = None,
    date_of_joining: date | None = None,
    ytd_gross: float = 0,
    ytd_tds: float = 0,
    previous_employer_taxable: float = 0,
    previous_employer_tds: float = 0,
    rent_paid_annual: float = 0,
    is_metro: bool = False,
    section_80c_extra: float = 0,
    section_80d: float = 0,
    ptax_annual: float = 0,
    as_of: date | None = None,
    rules_override: dict | None = None,
) -> dict[str, Any]:
    as_of = as_of or date.today()
    fy = financial_year or financial_year_for_date(as_of)
    regime = normalize_regime(tax_regime)
    rules = rules_override or load_tax_rules(fy, regime)

    gross_proj = project_annual_gross(
        monthly_gross=monthly_gross,
        financial_year=fy,
        date_of_joining=date_of_joining,
        ytd_gross=ytd_gross,
        as_of=as_of,
    )
    projected_gross = gross_proj["projected_annual_gross"]
    basic_annual = monthly_basic * 12
    hra_annual = monthly_hra * 12
    epf_annual = monthly_epf * 12

    standard_deduction = float(rules.get("standard_deduction", 0))
    hra_exemption = 0.0
    section_80c = 0.0
    section_80d_allowed = 0.0

    if regime == "old":
        hra_exemption = compute_hra_exemption(
            basic_annual=basic_annual,
            hra_annual=hra_annual,
            rent_paid_annual=rent_paid_annual,
            is_metro=is_metro,
            rules=rules,
        )
        cap_80c = float(rules.get("section_80c_cap", 150000))
        section_80c = min(cap_80c, epf_annual + max(0.0, section_80c_extra))
        section_80d_allowed = max(0.0, section_80d)

    total_exemptions = standard_deduction + hra_exemption + section_80c + section_80d_allowed
    if regime == "old" and ptax_annual > 0:
        total_exemptions += ptax_annual

    taxable_income = max(0.0, projected_gross - total_exemptions)
    tax_result = compute_annual_tax(taxable_income, rules)

    annual_tax = tax_result["annual_tax"]
    remaining_tax = max(
        0.0,
        annual_tax - float(previous_employer_tds or 0) - float(ytd_tds or 0),
    )
    remaining_months = months_remaining_in_fy(fy, as_of)
    monthly_tds = _round0(remaining_tax / remaining_months) if remaining_months > 0 else 0.0

    schedule = []
    fy_start, _ = fy_start_end(fy)
    for m in FY_MONTH_ORDER:
        y = fy_start.year if m >= 4 else fy_start.year + 1
        month_date = date(y, m, 1)
        if month_date < date(as_of.year, as_of.month, 1):
            schedule.append({
                "month": month_date.strftime("%Y-%m"),
                "month_label": month_date.strftime("%b %Y"),
                "tds": 0.0,
                "status": "past",
            })
        else:
            schedule.append({
                "month": month_date.strftime("%Y-%m"),
                "month_label": month_date.strftime("%b %Y"),
                "tds": monthly_tds,
                "status": "projected",
            })

    warnings = []
    if not (pan or "").strip():
        warnings.append("PAN is missing — TDS may be deducted at higher rate under IT rules.")
    if not tax_regime:
        warnings.append("Tax regime not set in Employee Accounts — using New Tax Regime.")
    if rules.get("_fallback"):
        warnings.append(f"Tax rules for FY {fy} not found — using latest bundled rules.")

    return {
        "financial_year": fy,
        "regime": regime,
        "regime_label": rules.get("label", regime),
        "rules_version": rules.get("financial_year"),
        "pan": (pan or "").strip() or None,
        "as_of": as_of.isoformat(),
        "income": {
            **gross_proj,
            "basic_annual": _round2(basic_annual),
            "hra_annual": _round2(hra_annual),
            "epf_annual": _round2(epf_annual),
        },
        "deductions": {
            "standard_deduction": _round2(standard_deduction),
            "hra_exemption": _round2(hra_exemption),
            "section_80c": _round2(section_80c),
            "section_80d": _round2(section_80d_allowed),
            "professional_tax_annual": _round2(ptax_annual if regime == "old" else 0),
            "total_exemptions": _round2(total_exemptions),
        },
        "taxable_income": _round2(taxable_income),
        "tax": tax_result,
        "tds": {
            "annual_tax": annual_tax,
            "previous_employer_tds": _round2(float(previous_employer_tds or 0)),
            "ytd_tds": _round2(float(ytd_tds or 0)),
            "remaining_tax": _round2(remaining_tax),
            "remaining_months": remaining_months,
            "monthly_tds": monthly_tds,
            "schedule": schedule,
        },
        "warnings": warnings,
    }
