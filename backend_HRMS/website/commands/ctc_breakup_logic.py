"""
Full Indian CTC breakup logic (pure functions, no Flask).

Annual CTC = (Gross × 12) + Employer PF + Employer ESIC + Mediclaim + Gratuity

Gross (monthly) = Basic + DA + HRA + Other Allowance
Gratuity (yearly) = (Basic + DA) / 26 × 15
Employer PF (yearly) = 12% × min(Basic, 15000) × 12
Employer ESIC (yearly) = 3.25% × Gross × 12  if Gross < 21,001 else 0

Basic + DA rule: 40% to 50% of monthly CTC (Indian salary structuring norm).
"""

DEFAULT_HRA_PCT = 40.0
BASIC_MIN_PCT_OF_CTC = 40.0
BASIC_MAX_PCT_OF_CTC = 50.0
PF_WAGE_CAP_MONTHLY = 15000.0
PF_RATE = 12.0
ESIC_GROSS_CAP = 21001.0
ESIC_EMPLOYEE_PCT = 0.75
ESIC_EMPLOYER_PCT = 3.25
HRA_MIN_PCT = 5.0
HRA_MAX_PCT = 50.0
CTC_SOLVE_TOLERANCE = 50.0
BASIC_FLOOR_MAX_ITER = 20

# Maharashtra Professional Tax (monthly gross salary slabs)
PTAX_MALE_SLAB_LOW_MAX = 7500.0
PTAX_MALE_SLAB_MID_MAX = 10000.0
PTAX_MALE_MID_AMOUNT = 175.0
PTAX_STANDARD_AMOUNT = 200.0
PTAX_FEBRUARY_AMOUNT = 300.0
PTAX_FEMALE_EXEMPT_MAX = 25000.0

_MONTH_NAME_TO_NUM = {
    "january": 1, "february": 2, "march": 3, "april": 4,
    "may": 5, "june": 6, "july": 7, "august": 8,
    "september": 9, "october": 10, "november": 11, "december": 12,
    "jan": 1, "feb": 2, "mar": 3, "apr": 4,
    "jun": 6, "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
}


def parse_month_num(month):
    """
    Parse month from YYYY-MM, month name/abbreviation, or int 1..12.
    Returns int 1..12 or None if unparseable.
    """
    if month is None:
        return None
    if isinstance(month, int):
        m = month
        return m if 1 <= m <= 12 else None

    s = str(month).strip()
    if not s:
        return None

    if len(s) >= 7 and s[4] == "-" and s[:4].isdigit() and s[5:7].isdigit():
        try:
            m = int(s[5:7])
            return m if 1 <= m <= 12 else None
        except ValueError:
            pass

    if s.isdigit():
        m = int(s)
        return m if 1 <= m <= 12 else None

    return _MONTH_NAME_TO_NUM.get(s.lower())


def maharashtra_professional_tax(monthly_gross, gender, month=None):
    """
    Maharashtra Professional Tax on monthly gross salary.

    Male:
      - Up to ₹7,500: Nil
      - ₹7,501 to ₹10,000: ₹175
      - Above ₹10,000: ₹200 (₹300 in February)

    Female:
      - Up to ₹25,000: Nil
      - Above ₹25,000: ₹200 (₹300 in February)
    """
    gross = float(monthly_gross or 0)
    if gross <= 0:
        return 0.0

    g = (gender or "").strip().lower()
    is_male = g.startswith("m")
    is_female = g.startswith("f")
    month_num = parse_month_num(month)
    is_february = month_num == 2

    if is_male:
        if gross <= PTAX_MALE_SLAB_LOW_MAX:
            return 0.0
        if gross <= PTAX_MALE_SLAB_MID_MAX:
            return PTAX_MALE_MID_AMOUNT
        return PTAX_FEBRUARY_AMOUNT if is_february else PTAX_STANDARD_AMOUNT

    if is_female:
        if gross <= PTAX_FEMALE_EXEMPT_MAX:
            return 0.0
        return PTAX_FEBRUARY_AMOUNT if is_february else PTAX_STANDARD_AMOUNT

    return 0.0


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


def _annual_ctc_raw(monthly_basic, hra_pct, other_allowance, mediclaim_yearly=0):
    """Annual CTC from resolved monthly components (no basic-band re-entry)."""
    b = float(monthly_basic or 0)
    hra_pct_val = float(hra_pct)
    other = max(0.0, float(other_allowance or 0))
    hra = b * hra_pct_val / 100.0
    gross = b + hra + other
    return (
        gross * 12.0
        + employer_pf_yearly(b)
        + employer_esic_yearly(gross)
        + float(mediclaim_yearly or 0)
        + gratuity_yearly(b)
    )


def monthly_ctc_from_basic(monthly_basic, hra_pct, other_allowance, mediclaim_yearly=0):
    return _annual_ctc_raw(monthly_basic, hra_pct, other_allowance, mediclaim_yearly) / 12.0


def basic_pct_of_monthly_ctc(monthly_basic, hra_pct, other_allowance, mediclaim_yearly=0):
    monthly_ctc = monthly_ctc_from_basic(
        monthly_basic, hra_pct, other_allowance, mediclaim_yearly
    )
    if monthly_ctc <= 0:
        return 0.0
    return float(monthly_basic or 0) / monthly_ctc * 100.0


def _solve_basic_for_target_ctc_pct(
    target_pct,
    hra_pct,
    other_allowance,
    mediclaim_yearly=0,
):
    """Binary-search monthly basic so Basic + DA ≈ target_pct% of monthly CTC."""
    target = float(target_pct)
    other = max(0.0, float(other_allowance or 0))
    lo = 1.0
    hi = 10000.0
    while (
        basic_pct_of_monthly_ctc(hi, hra_pct, other, mediclaim_yearly) < target
        and hi < 500000.0
    ):
        hi *= 2.0

    for _ in range(80):
        mid = (lo + hi) / 2.0
        pct = basic_pct_of_monthly_ctc(mid, hra_pct, other, mediclaim_yearly)
        if pct < target:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2.0


def enforce_ctc_band_on_components(
    monthly_basic,
    hra_pct,
    other_allowance,
    mediclaim_yearly=0,
):
    """
    Enforce Basic + DA within 40–50% of monthly CTC by adjusting basic only.
    Other allowance is never modified (stays as entered, e.g. zero).
    """
    b = float(monthly_basic or 0)
    hra_pct_val = float(hra_pct)
    other = max(0.0, float(other_allowance or 0))
    mediclaim = max(0.0, float(mediclaim_yearly or 0))

    if b <= 0:
        return b, 0.0, other, other

    pct = basic_pct_of_monthly_ctc(b, hra_pct_val, other, mediclaim)
    if BASIC_MIN_PCT_OF_CTC <= pct:
        hra = b * hra_pct_val / 100.0
        return b, hra, other, b + hra + other

    # Only raise basic when below 40% of monthly CTC — never slash basic when above 50%
    # (adding mediclaim or other CTC components must not collapse salary).
    b_candidate = _solve_basic_for_target_ctc_pct(
        BASIC_MIN_PCT_OF_CTC, hra_pct_val, other, mediclaim
    )
    pct_candidate = basic_pct_of_monthly_ctc(
        b_candidate, hra_pct_val, other, mediclaim
    )
    if pct_candidate >= BASIC_MIN_PCT_OF_CTC - 0.5:
        b = b_candidate

    hra = b * hra_pct_val / 100.0
    gross = b + hra + other
    return b, hra, other, gross


def monthly_components(
    monthly_basic,
    hra_pct,
    other_allowance,
    apply_floor=True,
    mediclaim_yearly=0,
):
    """
    Resolve Basic + DA, HRA, and gross.
    When apply_floor is True, enforce Basic + DA within 40–50% of monthly CTC.
    """
    b = float(monthly_basic or 0)
    hra_pct_val = float(hra_pct)
    other = max(0.0, float(other_allowance or 0))
    mediclaim = max(0.0, float(mediclaim_yearly or 0))

    if not apply_floor:
        hra = b * hra_pct_val / 100.0
        return b, hra, other, b + hra + other

    return enforce_ctc_band_on_components(b, hra_pct_val, other, mediclaim)


def annual_ctc_from_monthly(basic, hra_pct, other_allowance, mediclaim_yearly=0):
    mediclaim = max(0.0, float(mediclaim_yearly or 0))
    b, _hra, other, _gross = monthly_components(
        basic,
        hra_pct,
        other_allowance,
        apply_floor=True,
        mediclaim_yearly=mediclaim,
    )
    return _annual_ctc_raw(b, hra_pct, other, mediclaim)


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
        "basic_pct_of_monthly_ctc": round(basic_pct_of_monthly_ctc(b, hra_pct_val, o, mediclaim), 2),
        "basic_band_applied": (
            BASIC_MIN_PCT_OF_CTC - 0.5
            <= basic_pct_of_monthly_ctc(b, hra_pct_val, o, mediclaim)
            <= BASIC_MAX_PCT_OF_CTC + 0.5
        ),
        "employer_costs": employer_costs_summary(b, gross, mediclaim),
    }


def reverse_ctc_breakup(
    annual_ctc,
    hra_pct,
    other_allowance=0,
    mediclaim_yearly=0,
):
    """
    Solve monthly Basic + DA from annual CTC (Basic + DA within 40–50% of monthly CTC).
    Other Allowance is fixed; only Basic is derived.
    If the band prevents reaching the target, returns the closest feasible breakup.
    """
    target = float(annual_ctc or 0)
    if target <= 0:
        raise ValueError("Annual CTC must be greater than 0")

    hra_pct_val = _clamp_hra_pct(hra_pct)
    mediclaim = max(0.0, float(mediclaim_yearly or 0))
    other = max(0.0, float(other_allowance or 0))

    monthly_target = target / 12.0
    lo_b = max(1.0, monthly_target * BASIC_MIN_PCT_OF_CTC / 100.0 * 0.75)
    hi_b = max(lo_b + 1.0, monthly_target * BASIC_MAX_PCT_OF_CTC / 100.0 * 1.25)
    best = None
    best_diff = float("inf")

    for _ in range(90):
        basic_try = (lo_b + hi_b) / 2.0
        computed = annual_ctc_from_monthly(basic_try, hra_pct_val, other, mediclaim)
        diff = computed - target

        if abs(diff) < abs(best_diff):
            b, hra, o, gross = monthly_components(
                basic_try, hra_pct_val, other, apply_floor=True, mediclaim_yearly=mediclaim
            )
            actual = _annual_ctc_raw(b, hra_pct_val, o, mediclaim)
            best_diff = diff
            best = _build_solved_result(
                b, hra, o, gross, hra_pct_val, target, mediclaim, actual
            )

        if abs(diff) <= CTC_SOLVE_TOLERANCE:
            b, hra, o, gross = monthly_components(
                basic_try, hra_pct_val, other, apply_floor=True, mediclaim_yearly=mediclaim
            )
            actual = _annual_ctc_raw(b, hra_pct_val, o, mediclaim)
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
