"""
Full Indian CTC breakup logic (pure functions, no Flask).

Annual CTC = (Gross × 12) + Employer PF + Employer ESIC + Mediclaim + Gratuity

Gross (monthly) = Basic + DA + HRA + Other Allowance
Gratuity (yearly) = (Basic + DA) / 26 × 15
Employer PF (yearly) = 12% × min(Basic, 15000) × 12
Employer ESIC (yearly) = 3.25% × Gross × 12  if Gross < 21,001 else 0

Basic + DA rule (spreadsheet): at least max(40% of Gross, ₹12,500/month).
"""

DEFAULT_HRA_PCT = 40.0
BASIC_MIN_MONTHLY = 12500.0
BASIC_PCT_OF_GROSS = 40.0
PF_WAGE_CAP_MONTHLY = 15000.0
PF_RATE = 12.0
ESIC_GROSS_CAP = 21001.0
ESIC_EMPLOYEE_PCT = 0.75
ESIC_EMPLOYER_PCT = 3.25
HRA_MIN_PCT = 5.0
HRA_MAX_PCT = 50.0
CTC_SOLVE_TOLERANCE = 50.0
BASIC_FLOOR_MAX_ITER = 20


def _clamp_hra_pct(hra_pct):
    if hra_pct is None or str(hra_pct).strip() == "":
        return DEFAULT_HRA_PCT
    val = float(hra_pct)
    if val < HRA_MIN_PCT or val > HRA_MAX_PCT:
        raise ValueError(f"HRA percentage must be between {HRA_MIN_PCT} and {HRA_MAX_PCT}")
    return val


def gratuity_yearly(monthly_basic):
    b = float(monthly_basic or 0)
    if b <= 0:
        return 0.0
    return b / 26.0 * 15.0


def gratuity_monthly(monthly_basic):
    return gratuity_yearly(monthly_basic) / 12.0


def employer_pf_yearly(monthly_basic):
    wage = min(float(monthly_basic or 0), PF_WAGE_CAP_MONTHLY)
    return wage * (PF_RATE / 100.0) * 12.0


def employer_pf_monthly(monthly_basic):
    return employer_pf_yearly(monthly_basic) / 12.0


def employer_esic_yearly(monthly_gross):
    g = float(monthly_gross or 0)
    if g <= 0 or g >= ESIC_GROSS_CAP:
        return 0.0
    return g * (ESIC_EMPLOYER_PCT / 100.0) * 12.0


def employer_esic_monthly(monthly_gross):
    return employer_esic_yearly(monthly_gross) / 12.0


def employee_esic_monthly(monthly_gross):
    g = float(monthly_gross or 0)
    if g <= 0 or g >= ESIC_GROSS_CAP:
        return 0.0
    return g * (ESIC_EMPLOYEE_PCT / 100.0)


def enforce_basic_floor_on_gross(monthly_basic, monthly_gross):
    b = float(monthly_basic or 0)
    g = float(monthly_gross or 0)
    required = max(BASIC_MIN_MONTHLY, g * BASIC_PCT_OF_GROSS / 100.0)
    return max(b, required)


def monthly_components(monthly_basic, hra_pct, other_allowance, apply_floor=True):
    """
    Resolve Basic + DA, HRA, and gross.
    When apply_floor is True, enforce max(40% of gross, ₹12,500) iteratively.
    """
    b = float(monthly_basic or 0)
    hra_pct_val = float(hra_pct)
    other = max(0.0, float(other_allowance or 0))

    for _ in range(BASIC_FLOOR_MAX_ITER):
        hra = b * hra_pct_val / 100.0
        gross = b + hra + other
        if not apply_floor:
            return b, hra, other, gross
        b_adj = enforce_basic_floor_on_gross(b, gross)
        if abs(b_adj - b) <= 0.01:
            hra = b * hra_pct_val / 100.0
            gross = b + hra + other
            return b, hra, other, gross
        b = b_adj

    hra = b * hra_pct_val / 100.0
    gross = b + hra + other
    return b, hra, other, gross


def annual_ctc_from_monthly(basic, hra_pct, other_allowance, mediclaim_yearly=0):
    b, _hra, other, gross = monthly_components(
        basic, hra_pct, other_allowance, apply_floor=True
    )
    return (
        gross * 12.0
        + employer_pf_yearly(b)
        + employer_esic_yearly(gross)
        + float(mediclaim_yearly or 0)
        + gratuity_yearly(b)
    )


def employer_costs_summary(monthly_basic, monthly_gross, mediclaim_yearly=0):
    return {
        "gratuity_yearly": round(gratuity_yearly(monthly_basic), 2),
        "gratuity_monthly": round(gratuity_monthly(monthly_basic), 2),
        "employer_pf_yearly": round(employer_pf_yearly(monthly_basic), 2),
        "employer_pf_monthly": round(employer_pf_monthly(monthly_basic), 2),
        "employer_esic_yearly": round(employer_esic_yearly(monthly_gross), 2),
        "employer_esic_monthly": round(employer_esic_monthly(monthly_gross), 2),
        "mediclaim_yearly": round(float(mediclaim_yearly or 0), 2),
    }


def _build_solved_result(b, hra, o, gross, hra_pct_val, target, mediclaim, actual_annual):
    return {
        "basic_salary": round(b, 2),
        "hra_amount": round(hra, 2),
        "other_allowance": round(o, 2),
        "gross_salary": round(gross, 2),
        "hra_pct": round(hra_pct_val, 2),
        "annual_ctc": round(target, 2),
        "annual_ctc_computed": round(actual_annual, 2),
        "mediclaim_yearly": round(mediclaim, 2),
        "basic_floor_applied": b >= BASIC_MIN_MONTHLY - 0.01,
        "employer_costs": employer_costs_summary(b, gross, mediclaim),
    }


def reverse_ctc_breakup(
    annual_ctc,
    hra_pct,
    other_allowance=0,
    mediclaim_yearly=0,
):
    """
    Solve monthly Basic + DA from annual CTC (with basic floor rule).
    Other Allowance is fixed; only Basic is derived.
    If the floor prevents reaching the target, returns the closest feasible breakup.
    """
    target = float(annual_ctc or 0)
    if target <= 0:
        raise ValueError("Annual CTC must be greater than 0")

    hra_pct_val = _clamp_hra_pct(hra_pct)
    mediclaim = max(0.0, float(mediclaim_yearly or 0))
    other = max(0.0, float(other_allowance or 0))

    lo_b = BASIC_MIN_MONTHLY
    hi_b = max(BASIC_MIN_MONTHLY, target / 4.0)
    best = None
    best_diff = float("inf")

    for _ in range(90):
        basic_try = (lo_b + hi_b) / 2.0
        computed = annual_ctc_from_monthly(basic_try, hra_pct_val, other, mediclaim)
        diff = computed - target

        if abs(diff) < abs(best_diff):
            b, hra, o, gross = monthly_components(basic_try, hra_pct_val, other, apply_floor=True)
            actual = annual_ctc_from_monthly(b, hra_pct_val, o, mediclaim)
            best_diff = diff
            best = _build_solved_result(
                b, hra, o, gross, hra_pct_val, target, mediclaim, actual
            )

        if abs(diff) <= CTC_SOLVE_TOLERANCE:
            b, hra, o, gross = monthly_components(basic_try, hra_pct_val, other, apply_floor=True)
            actual = annual_ctc_from_monthly(b, hra_pct_val, o, mediclaim)
            return _build_solved_result(
                b, hra, o, gross, hra_pct_val, target, mediclaim, actual
            )

        if diff > 0:
            hi_b = basic_try
        else:
            lo_b = basic_try

    if best is None:
        raise ValueError("Unable to derive CTC breakup for the given annual CTC")

    return best
