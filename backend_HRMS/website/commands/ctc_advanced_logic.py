"""Advanced Indian CTC — VPF, NPS, EPS split, metro HRA (pure functions)."""
from __future__ import annotations

from .ctc_breakup_logic import PF_RATE, PF_WAGE_CAP_MONTHLY, pf_wage_capped, pf_wage_monthly

EPS_RATE = 8.33
EPS_CONTRIB_MAX = 1250.0
NPS_EMPLOYER_PCT_MAX = 10.0

METRO_LOCATION_KEYWORDS = (
    "mumbai",
    "delhi",
    "new delhi",
    "ncr",
    "gurgaon",
    "gurugram",
    "noida",
    "kolkata",
    "chennai",
    "hyderabad",
    "bangalore",
    "bengaluru",
    "pune",
    "ahmedabad",
)


def resolve_is_metro_hra(*, location: str | None = None, explicit: bool | None = None) -> bool:
    if explicit is not None:
        return bool(explicit)
    loc = (location or "").strip().lower()
    if not loc:
        return False
    return any(k in loc for k in METRO_LOCATION_KEYWORDS)


def employer_pf_eps_split(*, basic_salary: float = 0, dearness_allowance: float = 0) -> dict:
    """Employer PF 12% split into EPS (8.33% capped) + EPF employer balance."""
    wage = pf_wage_capped(basic_salary, dearness_allowance)
    eps = min(round(wage * EPS_RATE / 100.0), EPS_CONTRIB_MAX)
    employer_total = round(wage * PF_RATE / 100.0, 2)
    epf_er = round(max(0.0, employer_total - eps), 2)
    return {
        "pf_wage_capped": round(wage, 2),
        "employer_pf_total_monthly": employer_total,
        "eps_contribution_monthly": round(eps, 2),
        "epf_er_contribution_monthly": epf_er,
        "eps_contribution_yearly": round(eps * 12, 2),
        "epf_er_contribution_yearly": round(epf_er * 12, 2),
    }


def vpf_monthly_amount(
    *,
    basic_salary: float = 0,
    dearness_allowance: float = 0,
    vpf_monthly: float | None = None,
    vpf_pct_of_pf_wage: float | None = None,
) -> float:
    """Voluntary PF — extra employee contribution above statutory EPF."""
    if vpf_monthly is not None and float(vpf_monthly) > 0:
        return round(float(vpf_monthly), 2)
    if vpf_pct_of_pf_wage is not None and float(vpf_pct_of_pf_wage) > 0:
        wage = pf_wage_monthly(basic_salary, dearness_allowance)
        return round(wage * float(vpf_pct_of_pf_wage) / 100.0, 2)
    return 0.0


def nps_employer_monthly(
    *,
    basic_salary: float = 0,
    dearness_allowance: float = 0,
    nps_employer_pct_of_basic: float = 10.0,
) -> float:
    """Employer NPS (80CCD(2) style) — typically up to 10% of basic wages."""
    wage = pf_wage_monthly(basic_salary, dearness_allowance)
    pct = min(float(nps_employer_pct_of_basic or 0), NPS_EMPLOYER_PCT_MAX)
    if wage <= 0 or pct <= 0:
        return 0.0
    return round(wage * pct / 100.0, 2)


def nps_employer_yearly(
    *,
    basic_salary: float = 0,
    dearness_allowance: float = 0,
    nps_employer_pct_of_basic: float = 10.0,
) -> float:
    return round(
        nps_employer_monthly(
            basic_salary=basic_salary,
            dearness_allowance=dearness_allowance,
            nps_employer_pct_of_basic=nps_employer_pct_of_basic,
        )
        * 12,
        2,
    )


def hra_exemption_hint_old_regime(
    *,
    is_metro: bool,
    basic_monthly: float,
    hra_monthly: float,
    rent_paid_monthly: float = 0,
) -> dict:
    """Simplified HRA exemption preview (old regime) for CTC/TDS guidance."""
    basic_a = float(basic_monthly or 0) * 12
    hra_a = float(hra_monthly or 0) * 12
    rent_a = float(rent_paid_monthly or 0) * 12
    pct = 50.0 if is_metro else 40.0
    opt1 = hra_a
    opt2 = max(0.0, rent_a - (basic_a * 0.1))
    opt3 = basic_a * (pct / 100.0)
    exempt = round(min(opt1, opt2, opt3), 2)
    return {
        "is_metro": bool(is_metro),
        "hra_annual": round(hra_a, 2),
        "exemption_annual_estimate": exempt,
        "taxable_hra_annual_estimate": round(max(0.0, hra_a - exempt), 2),
    }
