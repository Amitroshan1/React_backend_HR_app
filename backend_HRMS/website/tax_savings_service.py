"""Tax savings comparison — declaration vs no-declaration baseline."""
from __future__ import annotations

from datetime import date

from .commands.tds_logic import normalize_regime, run_tds_projection


def _zero_tds_inputs() -> dict:
    return {
        "rent_paid_annual": 0.0,
        "is_metro": False,
        "section_80c_extra": 0.0,
        "section_80d": 0.0,
        "previous_employer_taxable": 0.0,
        "previous_employer_tds": 0.0,
        "section_80ccd1b": 0.0,
        "section_24_interest": 0.0,
        "lta_exemption": 0.0,
        "section_80e": 0.0,
        "section_80g": 0.0,
        "other_deductions": 0.0,
        "other_income": 0.0,
        "new_regime_deductions": 0.0,
    }


def build_tax_savings_comparison(
    *,
    monthly_gross: float,
    monthly_basic: float,
    monthly_hra: float,
    monthly_epf: float,
    tax_regime: str | None,
    financial_year: str,
    pan: str | None,
    date_of_joining: date | None,
    ytd_gross: float,
    ytd_tds: float,
    ptax_annual: float,
    as_of: date,
    declaration_inputs: dict,
) -> dict:
    """
    Compare projected tax with declaration inputs vs CTC/profile baseline (no deductions).
  """
    regime = normalize_regime(tax_regime)
    base_kwargs = dict(
        monthly_gross=monthly_gross,
        monthly_basic=monthly_basic,
        monthly_hra=monthly_hra,
        monthly_epf=monthly_epf,
        tax_regime=tax_regime,
        financial_year=financial_year,
        pan=pan,
        date_of_joining=date_of_joining,
        ytd_gross=ytd_gross,
        ytd_tds=ytd_tds,
        ptax_annual=ptax_annual,
        as_of=as_of,
    )

    zero = _zero_tds_inputs()
    without = run_tds_projection(
        **base_kwargs,
        previous_employer_taxable=zero["previous_employer_taxable"],
        previous_employer_tds=zero["previous_employer_tds"],
        rent_paid_annual=zero["rent_paid_annual"],
        is_metro=zero["is_metro"],
        section_80c_extra=zero["section_80c_extra"],
        section_80d=zero["section_80d"],
        section_80ccd1b=zero["section_80ccd1b"],
        section_24_interest=zero["section_24_interest"],
        lta_exemption=zero["lta_exemption"],
        section_80e=zero["section_80e"],
        section_80g=zero["section_80g"],
        other_deductions=zero["other_deductions"],
        other_income=zero["other_income"],
        new_regime_deductions=zero["new_regime_deductions"],
    )

    decl = declaration_inputs or {}
    with_decl = run_tds_projection(
        **base_kwargs,
        previous_employer_taxable=decl.get("previous_employer_taxable") or 0,
        previous_employer_tds=decl.get("previous_employer_tds") or 0,
        rent_paid_annual=decl.get("rent_paid_annual") or 0,
        is_metro=bool(decl.get("is_metro")),
        section_80c_extra=decl.get("section_80c_extra") or 0,
        section_80d=decl.get("section_80d") or 0,
        section_80ccd1b=decl.get("section_80ccd1b") or 0,
        section_24_interest=decl.get("section_24_interest") or 0,
        lta_exemption=decl.get("lta_exemption") or 0,
        section_80e=decl.get("section_80e") or 0,
        section_80g=decl.get("section_80g") or 0,
        other_deductions=decl.get("other_deductions") or 0,
        other_income=decl.get("other_income") or 0,
        new_regime_deductions=decl.get("new_regime_deductions") or 0,
    )

    tax_without = float(without.get("tax", {}).get("annual_tax") or 0)
    tax_with = float(with_decl.get("tax", {}).get("annual_tax") or 0)
    tds_without = float(without.get("tds", {}).get("monthly_tds") or 0)
    tds_with = float(with_decl.get("tds", {}).get("monthly_tds") or 0)
    tax_saved = round(max(0.0, tax_without - tax_with), 2)
    monthly_tds_saved = round(max(0.0, tds_without - tds_with), 2)

    note = None
    if regime == "new":
        note = (
            "New Tax Regime — most Chapter VI-A deductions do not apply. "
            "Savings come mainly from eligible new-regime deductions declared."
        )
    elif tax_saved <= 0:
        note = "Your declaration does not reduce projected tax vs baseline (check amounts or regime)."

    return {
        "regime": regime,
        "without_declaration": {
            "annual_tax": tax_without,
            "monthly_tds": tds_without,
            "taxable_income": float(without.get("taxable_income") or 0),
            "label": "CTC + profile only (no declaration deductions)",
        },
        "with_declaration": {
            "annual_tax": tax_with,
            "monthly_tds": tds_with,
            "taxable_income": float(with_decl.get("taxable_income") or 0),
            "label": "With your tax declaration",
        },
        "tax_saved_annual": tax_saved,
        "monthly_tds_saved": monthly_tds_saved,
        "note": note,
    }
