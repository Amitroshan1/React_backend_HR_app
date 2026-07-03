"""
Full Indian CTC breakup logic (pure functions, no Flask).

Fixed Annual CTC = (Gross × 12) + Employer PF + PF Admin + EDLI + ESIC + Mediclaim + Gratuity
Total Annual CTC = Fixed Annual CTC + Variable pay (bonus / incentive)

Gross (monthly) = Basic + DA + HRA + Special + Conveyance + Medical + LTA
Gratuity (yearly) = (Basic + DA) / 26 × 15
Employer PF (yearly) = 12% × min(Basic + DA, 15000) × 12
PF Admin (yearly) = 0.5% × min(Basic + DA, 15000) × 12  (optional in CTC)
EDLI (yearly) = 0.5% × min(Basic + DA, 15000) × 12  (optional in CTC)
Employer ESIC (yearly) = 3.25% × Gross × 12  if Gross < 21,001 else 0

Basic + DA rule: 40% to 50% of monthly fixed CTC (Indian salary structuring norm).
"""

DEFAULT_HRA_PCT = 40.0
BASIC_MIN_PCT_OF_CTC = 40.0
BASIC_MAX_PCT_OF_CTC = 50.0
PF_WAGE_CAP_MONTHLY = 15000.0
PF_RATE = 12.0
PF_ADMIN_PCT = 0.5
EDLI_EMPLOYER_PCT = 0.5
STATUTORY_BONUS_PCT_DEFAULT = 8.33
ESIC_GROSS_CAP = 21001.0
ESIC_EMPLOYEE_PCT = 0.75
ESIC_EMPLOYER_PCT = 3.25
HRA_MIN_PCT = 5.0
HRA_MAX_PCT = 50.0
CTC_SOLVE_TOLERANCE = 50.0
BASIC_FLOOR_MAX_ITER = 20

# Standard monthly allowance heads (Indian CTC annexure)
ALLOWANCE_HEADS = (
    "special_allowance",
    "conveyance_allowance",
    "medical_allowance",
    "lta_allowance",
)

_MONTH_NAME_TO_NUM = {
    "january": 1, "february": 2, "march": 3, "april": 4,
    "may": 5, "june": 6, "july": 7, "august": 8,
    "september": 9, "october": 10, "november": 11, "december": 12,
    "jan": 1, "feb": 2, "mar": 3, "apr": 4,
    "jun": 6, "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
}


def pf_wage_monthly(basic_salary=0, dearness_allowance=0):
    """Statutory wage base for PF, gratuity, and HRA percentage."""
    return max(0.0, float(basic_salary or 0)) + max(0.0, float(dearness_allowance or 0))


def normalize_allowance_heads(
    *,
    special_allowance=0,
    conveyance_allowance=0,
    medical_allowance=0,
    lta_allowance=0,
    other_allowance=None,
):
    """
    Resolve standard allowance heads. Legacy `other_allowance` maps to special when
    no head amounts are provided.
    """
    heads = {
        "special_allowance": max(0.0, float(special_allowance or 0)),
        "conveyance_allowance": max(0.0, float(conveyance_allowance or 0)),
        "medical_allowance": max(0.0, float(medical_allowance or 0)),
        "lta_allowance": max(0.0, float(lta_allowance or 0)),
    }
    total = sum(heads.values())
    legacy = max(0.0, float(other_allowance or 0)) if other_allowance is not None else 0.0
    if total <= 0 and legacy > 0:
        heads["special_allowance"] = legacy
        total = legacy
    return heads, total


def total_ctc_annual(fixed_ctc_annual, variable_ctc_annual=0):
    fixed = max(0.0, float(fixed_ctc_annual or 0))
    variable = max(0.0, float(variable_ctc_annual or 0))
    return round(fixed + variable, 2)


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

    PTAX_MALE_SLAB_LOW_MAX = 7500.0
    PTAX_MALE_SLAB_MID_MAX = 10000.0
    PTAX_MALE_MID_AMOUNT = 175.0
    PTAX_STANDARD_AMOUNT = 200.0
    PTAX_FEBRUARY_AMOUNT = 300.0
    PTAX_FEMALE_EXEMPT_MAX = 25000.0

    if is_female:
        if gross <= PTAX_FEMALE_EXEMPT_MAX:
            return 0.0
        return PTAX_FEBRUARY_AMOUNT if is_february else PTAX_STANDARD_AMOUNT

    # Male or gender not on file — apply standard Maharashtra slabs.
    if gross <= PTAX_MALE_SLAB_LOW_MAX:
        return 0.0
    if gross <= PTAX_MALE_SLAB_MID_MAX:
        return PTAX_MALE_MID_AMOUNT
    return PTAX_FEBRUARY_AMOUNT if is_february else PTAX_STANDARD_AMOUNT


def _clamp_hra_pct(hra_pct):
    if hra_pct is None or str(hra_pct).strip() == "":
        return DEFAULT_HRA_PCT
    val = float(hra_pct)
    if val < HRA_MIN_PCT or val > HRA_MAX_PCT:
        raise ValueError(f"HRA percentage must be between {HRA_MIN_PCT} and {HRA_MAX_PCT}")
    return val


def gratuity_yearly(basic_salary=0, dearness_allowance=0):
    wage = pf_wage_monthly(basic_salary, dearness_allowance)
    if wage <= 0:
        return 0.0
    return wage / 26.0 * 15.0


def gratuity_monthly(basic_salary=0, dearness_allowance=0):
    return gratuity_yearly(basic_salary, dearness_allowance) / 12.0


def pf_wage_capped(basic_salary=0, dearness_allowance=0):
    return min(pf_wage_monthly(basic_salary, dearness_allowance), PF_WAGE_CAP_MONTHLY)


def employer_pf_yearly(basic_salary=0, dearness_allowance=0):
    wage = pf_wage_capped(basic_salary, dearness_allowance)
    return wage * (PF_RATE / 100.0) * 12.0


def employer_pf_monthly(basic_salary=0, dearness_allowance=0):
    return employer_pf_yearly(basic_salary, dearness_allowance) / 12.0


def pf_admin_yearly(basic_salary=0, dearness_allowance=0):
    wage = pf_wage_capped(basic_salary, dearness_allowance)
    if wage <= 0:
        return 0.0
    return wage * (PF_ADMIN_PCT / 100.0) * 12.0


def pf_admin_monthly(basic_salary=0, dearness_allowance=0):
    return pf_admin_yearly(basic_salary, dearness_allowance) / 12.0


def edli_yearly(basic_salary=0, dearness_allowance=0):
    wage = pf_wage_capped(basic_salary, dearness_allowance)
    if wage <= 0:
        return 0.0
    return wage * (EDLI_EMPLOYER_PCT / 100.0) * 12.0


def edli_monthly(basic_salary=0, dearness_allowance=0):
    return edli_yearly(basic_salary, dearness_allowance) / 12.0


def statutory_bonus_yearly(
    basic_salary=0,
    dearness_allowance=0,
    bonus_pct=STATUTORY_BONUS_PCT_DEFAULT,
):
    wage = pf_wage_monthly(basic_salary, dearness_allowance)
    if wage <= 0:
        return 0.0
    return wage * 12.0 * float(bonus_pct or STATUTORY_BONUS_PCT_DEFAULT) / 100.0


def statutory_bonus_monthly(basic_salary=0, dearness_allowance=0, bonus_pct=STATUTORY_BONUS_PCT_DEFAULT):
    return statutory_bonus_yearly(basic_salary, dearness_allowance, bonus_pct) / 12.0


def lwf_employer_yearly(lwf_employer_yearly_amount=12.0):
    return max(0.0, float(lwf_employer_yearly_amount or 0))


def apply_allowance_caps(
    special_allowance=0,
    conveyance_allowance=0,
    medical_allowance=0,
    lta_allowance=0,
    conveyance_cap_monthly=None,
    medical_cap_monthly=None,
):
    """Cap conveyance / medical per company policy (Indian norms)."""
    heads = {
        "special_allowance": max(0.0, float(special_allowance or 0)),
        "conveyance_allowance": max(0.0, float(conveyance_allowance or 0)),
        "medical_allowance": max(0.0, float(medical_allowance or 0)),
        "lta_allowance": max(0.0, float(lta_allowance or 0)),
    }
    if conveyance_cap_monthly is not None:
        heads["conveyance_allowance"] = min(
            heads["conveyance_allowance"], max(0.0, float(conveyance_cap_monthly))
        )
    if medical_cap_monthly is not None:
        heads["medical_allowance"] = min(
            heads["medical_allowance"], max(0.0, float(medical_cap_monthly))
        )
    total = sum(heads.values())
    return heads, total


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


def _annual_ctc_raw(
    basic_salary,
    dearness_allowance,
    hra_pct,
    allowance_total,
    mediclaim_yearly=0,
    include_pf_admin_in_ctc=True,
    include_edli_in_ctc=True,
    include_statutory_bonus_in_ctc=False,
    statutory_bonus_pct=STATUTORY_BONUS_PCT_DEFAULT,
    include_lwf_in_ctc=False,
    lwf_employer_yearly_amount=12.0,
    include_nps_in_ctc=False,
    nps_employer_pct_of_basic=10.0,
):
    wage = pf_wage_monthly(basic_salary, dearness_allowance)
    hra_pct_val = float(hra_pct)
    other = max(0.0, float(allowance_total or 0))
    hra = wage * hra_pct_val / 100.0
    gross = wage + hra + other
    extras = 0.0
    if include_pf_admin_in_ctc:
        extras += pf_admin_yearly(basic_salary, dearness_allowance)
    if include_edli_in_ctc:
        extras += edli_yearly(basic_salary, dearness_allowance)
    if include_statutory_bonus_in_ctc:
        extras += statutory_bonus_yearly(basic_salary, dearness_allowance, statutory_bonus_pct)
    if include_lwf_in_ctc:
        extras += lwf_employer_yearly(lwf_employer_yearly_amount)
    if include_nps_in_ctc:
        from .ctc_advanced_logic import nps_employer_yearly

        extras += nps_employer_yearly(
            basic_salary=basic_salary,
            dearness_allowance=dearness_allowance,
            nps_employer_pct_of_basic=nps_employer_pct_of_basic,
        )
    return (
        gross * 12.0
        + employer_pf_yearly(basic_salary, dearness_allowance)
        + extras
        + employer_esic_yearly(gross)
        + float(mediclaim_yearly or 0)
        + gratuity_yearly(basic_salary, dearness_allowance)
    )


def monthly_ctc_from_components(
    basic_salary,
    dearness_allowance,
    hra_pct,
    allowance_total,
    mediclaim_yearly=0,
    include_pf_admin_in_ctc=True,
    include_edli_in_ctc=True,
    include_statutory_bonus_in_ctc=False,
    statutory_bonus_pct=STATUTORY_BONUS_PCT_DEFAULT,
    include_lwf_in_ctc=False,
    lwf_employer_yearly_amount=12.0,
):
    return (
        _annual_ctc_raw(
            basic_salary,
            dearness_allowance,
            hra_pct,
            allowance_total,
            mediclaim_yearly,
            include_pf_admin_in_ctc=include_pf_admin_in_ctc,
            include_edli_in_ctc=include_edli_in_ctc,
            include_statutory_bonus_in_ctc=include_statutory_bonus_in_ctc,
            statutory_bonus_pct=statutory_bonus_pct,
            include_lwf_in_ctc=include_lwf_in_ctc,
            lwf_employer_yearly_amount=lwf_employer_yearly_amount,
        )
        / 12.0
    )


def basic_pct_of_monthly_ctc(
    basic_salary,
    dearness_allowance,
    hra_pct,
    allowance_total,
    mediclaim_yearly=0,
    include_pf_admin_in_ctc=True,
    include_edli_in_ctc=True,
    include_statutory_bonus_in_ctc=False,
    statutory_bonus_pct=STATUTORY_BONUS_PCT_DEFAULT,
    include_lwf_in_ctc=False,
    lwf_employer_yearly_amount=12.0,
):
    monthly_ctc = monthly_ctc_from_components(
        basic_salary,
        dearness_allowance,
        hra_pct,
        allowance_total,
        mediclaim_yearly,
        include_pf_admin_in_ctc=include_pf_admin_in_ctc,
        include_edli_in_ctc=include_edli_in_ctc,
        include_statutory_bonus_in_ctc=include_statutory_bonus_in_ctc,
        statutory_bonus_pct=statutory_bonus_pct,
        include_lwf_in_ctc=include_lwf_in_ctc,
        lwf_employer_yearly_amount=lwf_employer_yearly_amount,
    )
    if monthly_ctc <= 0:
        return 0.0
    return pf_wage_monthly(basic_salary, dearness_allowance) / monthly_ctc * 100.0


def _solve_basic_for_target_ctc_pct(
    target_pct,
    dearness_allowance,
    hra_pct,
    allowance_total,
    mediclaim_yearly=0,
    include_pf_admin_in_ctc=True,
    include_edli_in_ctc=True,
    include_statutory_bonus_in_ctc=False,
    statutory_bonus_pct=STATUTORY_BONUS_PCT_DEFAULT,
    include_lwf_in_ctc=False,
    lwf_employer_yearly_amount=12.0,
):
    """Binary-search monthly basic so Basic + DA ≈ target_pct% of monthly fixed CTC."""
    target = float(target_pct)
    da = max(0.0, float(dearness_allowance or 0))
    other = max(0.0, float(allowance_total or 0))
    lo = max(1.0, da + 1.0)
    hi = 10000.0
    while (
        basic_pct_of_monthly_ctc(
            hi, da, hra_pct, other, mediclaim_yearly,
            include_pf_admin_in_ctc=include_pf_admin_in_ctc,
            include_edli_in_ctc=include_edli_in_ctc,
            include_statutory_bonus_in_ctc=include_statutory_bonus_in_ctc,
            statutory_bonus_pct=statutory_bonus_pct,
            include_lwf_in_ctc=include_lwf_in_ctc,
            lwf_employer_yearly_amount=lwf_employer_yearly_amount,
        ) < target
        and hi < 500000.0
    ):
        hi *= 2.0

    for _ in range(80):
        mid = (lo + hi) / 2.0
        pct = basic_pct_of_monthly_ctc(
            mid, da, hra_pct, other, mediclaim_yearly,
            include_pf_admin_in_ctc=include_pf_admin_in_ctc,
            include_edli_in_ctc=include_edli_in_ctc,
            include_statutory_bonus_in_ctc=include_statutory_bonus_in_ctc,
            statutory_bonus_pct=statutory_bonus_pct,
            include_lwf_in_ctc=include_lwf_in_ctc,
            lwf_employer_yearly_amount=lwf_employer_yearly_amount,
        )
        if pct < target:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2.0


def enforce_ctc_band_on_components(
    basic_salary,
    dearness_allowance,
    hra_pct,
    allowance_total,
    mediclaim_yearly=0,
    include_pf_admin_in_ctc=True,
    include_edli_in_ctc=True,
    include_statutory_bonus_in_ctc=False,
    statutory_bonus_pct=STATUTORY_BONUS_PCT_DEFAULT,
    include_lwf_in_ctc=False,
    lwf_employer_yearly_amount=12.0,
):
    """
    Enforce Basic + DA within 40–50% of monthly fixed CTC by adjusting basic only.
    DA and allowance heads are never modified.
    """
    b = float(basic_salary or 0)
    da = max(0.0, float(dearness_allowance or 0))
    hra_pct_val = float(hra_pct)
    other = max(0.0, float(allowance_total or 0))
    mediclaim = max(0.0, float(mediclaim_yearly or 0))

    wage = pf_wage_monthly(b, da)
    if wage <= 0:
        return b, da, 0.0, other, other

    pct = basic_pct_of_monthly_ctc(
        b, da, hra_pct_val, other, mediclaim,
        include_pf_admin_in_ctc=include_pf_admin_in_ctc,
        include_edli_in_ctc=include_edli_in_ctc,
        include_statutory_bonus_in_ctc=include_statutory_bonus_in_ctc,
        statutory_bonus_pct=statutory_bonus_pct,
        include_lwf_in_ctc=include_lwf_in_ctc,
        lwf_employer_yearly_amount=lwf_employer_yearly_amount,
    )
    if BASIC_MIN_PCT_OF_CTC <= pct:
        hra = wage * hra_pct_val / 100.0
        return b, da, hra, other, wage + hra + other

    b_candidate = _solve_basic_for_target_ctc_pct(
        BASIC_MIN_PCT_OF_CTC, da, hra_pct_val, other, mediclaim,
        include_pf_admin_in_ctc=include_pf_admin_in_ctc,
        include_edli_in_ctc=include_edli_in_ctc,
        include_statutory_bonus_in_ctc=include_statutory_bonus_in_ctc,
        statutory_bonus_pct=statutory_bonus_pct,
        include_lwf_in_ctc=include_lwf_in_ctc,
        lwf_employer_yearly_amount=lwf_employer_yearly_amount,
    )
    pct_candidate = basic_pct_of_monthly_ctc(
        b_candidate, da, hra_pct_val, other, mediclaim,
        include_pf_admin_in_ctc=include_pf_admin_in_ctc,
        include_edli_in_ctc=include_edli_in_ctc,
        include_statutory_bonus_in_ctc=include_statutory_bonus_in_ctc,
        statutory_bonus_pct=statutory_bonus_pct,
        include_lwf_in_ctc=include_lwf_in_ctc,
        lwf_employer_yearly_amount=lwf_employer_yearly_amount,
    )
    if pct_candidate >= BASIC_MIN_PCT_OF_CTC - 0.5:
        b = b_candidate

    wage = pf_wage_monthly(b, da)
    hra = wage * hra_pct_val / 100.0
    gross = wage + hra + other
    return b, da, hra, other, gross


def monthly_components(
    basic_salary,
    dearness_allowance=0,
    hra_pct=DEFAULT_HRA_PCT,
    allowance_total=0,
    apply_floor=True,
    mediclaim_yearly=0,
    include_pf_admin_in_ctc=True,
    include_edli_in_ctc=True,
    include_statutory_bonus_in_ctc=False,
    statutory_bonus_pct=STATUTORY_BONUS_PCT_DEFAULT,
    include_lwf_in_ctc=False,
    lwf_employer_yearly_amount=12.0,
    *,
    other_allowance=None,
    special_allowance=0,
    conveyance_allowance=0,
    medical_allowance=0,
    lta_allowance=0,
):
    """
    Resolve Basic, DA, HRA, allowance total, and gross.
    When apply_floor is True, enforce Basic + DA within 40–50% of monthly fixed CTC.
    """
    _, allowance_sum = normalize_allowance_heads(
        special_allowance=special_allowance,
        conveyance_allowance=conveyance_allowance,
        medical_allowance=medical_allowance,
        lta_allowance=lta_allowance,
        other_allowance=other_allowance if allowance_total in (0, None) else allowance_total,
    )
    if allowance_total not in (0, None):
        allowance_sum = max(0.0, float(allowance_total or 0))

    b = float(basic_salary or 0)
    da = max(0.0, float(dearness_allowance or 0))
    hra_pct_val = float(hra_pct)
    mediclaim = max(0.0, float(mediclaim_yearly or 0))

    if not apply_floor:
        wage = pf_wage_monthly(b, da)
        hra = wage * hra_pct_val / 100.0
        return b, da, hra, allowance_sum, wage + hra + allowance_sum

    return enforce_ctc_band_on_components(
        b, da, hra_pct_val, allowance_sum, mediclaim,
        include_pf_admin_in_ctc=include_pf_admin_in_ctc,
        include_edli_in_ctc=include_edli_in_ctc,
        include_statutory_bonus_in_ctc=include_statutory_bonus_in_ctc,
        statutory_bonus_pct=statutory_bonus_pct,
        include_lwf_in_ctc=include_lwf_in_ctc,
        lwf_employer_yearly_amount=lwf_employer_yearly_amount,
    )


def annual_ctc_from_monthly(
    basic_salary,
    hra_pct,
    allowance_total=0,
    mediclaim_yearly=0,
    dearness_allowance=0,
    include_pf_admin_in_ctc=True,
    include_edli_in_ctc=True,
    include_statutory_bonus_in_ctc=False,
    statutory_bonus_pct=STATUTORY_BONUS_PCT_DEFAULT,
    include_lwf_in_ctc=False,
    lwf_employer_yearly_amount=12.0,
    include_nps_in_ctc=False,
    nps_employer_pct_of_basic=10.0,
    *,
    other_allowance=None,
    special_allowance=0,
    conveyance_allowance=0,
    medical_allowance=0,
    lta_allowance=0,
):
    mediclaim = max(0.0, float(mediclaim_yearly or 0))
    nps_kw = dict(
        include_nps_in_ctc=include_nps_in_ctc,
        nps_employer_pct_of_basic=nps_employer_pct_of_basic,
    )
    _, allowance_sum = normalize_allowance_heads(
        special_allowance=special_allowance,
        conveyance_allowance=conveyance_allowance,
        medical_allowance=medical_allowance,
        lta_allowance=lta_allowance,
        other_allowance=other_allowance if allowance_total in (0, None) else allowance_total,
    )
    if allowance_total not in (0, None):
        allowance_sum = max(0.0, float(allowance_total or 0))

    b, da, _hra, other, _gross = monthly_components(
        basic_salary,
        dearness_allowance,
        hra_pct,
        allowance_sum,
        apply_floor=True,
        mediclaim_yearly=mediclaim,
        include_pf_admin_in_ctc=include_pf_admin_in_ctc,
        include_edli_in_ctc=include_edli_in_ctc,
        include_statutory_bonus_in_ctc=include_statutory_bonus_in_ctc,
        statutory_bonus_pct=statutory_bonus_pct,
        include_lwf_in_ctc=include_lwf_in_ctc,
        lwf_employer_yearly_amount=lwf_employer_yearly_amount,
    )
    return _annual_ctc_raw(
        b, da, hra_pct, other, mediclaim,
        include_pf_admin_in_ctc=include_pf_admin_in_ctc,
        include_edli_in_ctc=include_edli_in_ctc,
        include_statutory_bonus_in_ctc=include_statutory_bonus_in_ctc,
        statutory_bonus_pct=statutory_bonus_pct,
        include_lwf_in_ctc=include_lwf_in_ctc,
        lwf_employer_yearly_amount=lwf_employer_yearly_amount,
        **nps_kw,
    )


def employer_costs_summary(
    basic_salary,
    monthly_gross,
    mediclaim_yearly=0,
    dearness_allowance=0,
    include_pf_admin_in_ctc=True,
    include_edli_in_ctc=True,
    include_statutory_bonus_in_ctc=False,
    statutory_bonus_pct=STATUTORY_BONUS_PCT_DEFAULT,
    include_lwf_in_ctc=False,
    lwf_employer_yearly_amount=12.0,
    include_nps_in_ctc=False,
    nps_employer_pct_of_basic=10.0,
):
    pf_admin_y = (
        pf_admin_yearly(basic_salary, dearness_allowance)
        if include_pf_admin_in_ctc else 0.0
    )
    edli_y = (
        edli_yearly(basic_salary, dearness_allowance)
        if include_edli_in_ctc else 0.0
    )
    bonus_y = (
        statutory_bonus_yearly(basic_salary, dearness_allowance, statutory_bonus_pct)
        if include_statutory_bonus_in_ctc else 0.0
    )
    lwf_y = (
        lwf_employer_yearly(lwf_employer_yearly_amount)
        if include_lwf_in_ctc else 0.0
    )
    from .ctc_advanced_logic import employer_pf_eps_split, nps_employer_monthly, nps_employer_yearly

    eps_split = employer_pf_eps_split(
        basic_salary=basic_salary,
        dearness_allowance=dearness_allowance,
    )
    nps_m = (
        nps_employer_monthly(
            basic_salary=basic_salary,
            dearness_allowance=dearness_allowance,
            nps_employer_pct_of_basic=nps_employer_pct_of_basic,
        )
        if include_nps_in_ctc else 0.0
    )
    nps_y = (
        nps_employer_yearly(
            basic_salary=basic_salary,
            dearness_allowance=dearness_allowance,
            nps_employer_pct_of_basic=nps_employer_pct_of_basic,
        )
        if include_nps_in_ctc else 0.0
    )
    return {
        "gratuity_yearly": round(gratuity_yearly(basic_salary, dearness_allowance), 2),
        "gratuity_monthly": round(gratuity_monthly(basic_salary, dearness_allowance), 2),
        "employer_pf_yearly": round(employer_pf_yearly(basic_salary, dearness_allowance), 2),
        "employer_pf_monthly": round(employer_pf_monthly(basic_salary, dearness_allowance), 2),
        "pf_admin_yearly": round(pf_admin_y, 2),
        "pf_admin_monthly": round(pf_admin_y / 12.0, 2),
        "edli_yearly": round(edli_y, 2),
        "edli_monthly": round(edli_y / 12.0, 2),
        "statutory_bonus_yearly": round(bonus_y, 2),
        "statutory_bonus_monthly": round(bonus_y / 12.0, 2),
        "lwf_employer_yearly": round(lwf_y, 2),
        "lwf_employer_monthly": round(lwf_y / 12.0, 2),
        "employer_esic_yearly": round(employer_esic_yearly(monthly_gross), 2),
        "employer_esic_monthly": round(employer_esic_monthly(monthly_gross), 2),
        "mediclaim_yearly": round(float(mediclaim_yearly or 0), 2),
        "include_pf_admin_in_ctc": bool(include_pf_admin_in_ctc),
        "include_edli_in_ctc": bool(include_edli_in_ctc),
        "include_statutory_bonus_in_ctc": bool(include_statutory_bonus_in_ctc),
        "include_lwf_in_ctc": bool(include_lwf_in_ctc),
        "include_nps_in_ctc": bool(include_nps_in_ctc),
        "nps_employer_monthly": round(nps_m, 2),
        "nps_employer_yearly": round(nps_y, 2),
        "eps_contribution_monthly": eps_split["eps_contribution_monthly"],
        "eps_contribution_yearly": eps_split["eps_contribution_yearly"],
        "epf_er_contribution_monthly": eps_split["epf_er_contribution_monthly"],
        "epf_er_contribution_yearly": eps_split["epf_er_contribution_yearly"],
    }


def _build_solved_result(
    b,
    da,
    hra,
    allowance_heads,
    allowance_total,
    gross,
    hra_pct_val,
    target,
    mediclaim,
    actual_annual,
    variable_ctc_annual=0,
    include_pf_admin_in_ctc=True,
    include_edli_in_ctc=True,
    include_statutory_bonus_in_ctc=False,
    statutory_bonus_pct=STATUTORY_BONUS_PCT_DEFAULT,
    include_lwf_in_ctc=False,
    lwf_employer_yearly_amount=12.0,
):
    return {
        "basic_salary": round(b, 2),
        "dearness_allowance": round(da, 2),
        "basic_wage": round(pf_wage_monthly(b, da), 2),
        "hra_amount": round(hra, 2),
        "special_allowance": round(allowance_heads["special_allowance"], 2),
        "conveyance_allowance": round(allowance_heads["conveyance_allowance"], 2),
        "medical_allowance": round(allowance_heads["medical_allowance"], 2),
        "lta_allowance": round(allowance_heads["lta_allowance"], 2),
        "other_allowance": round(allowance_total, 2),
        "gross_salary": round(gross, 2),
        "hra_pct": round(hra_pct_val, 2),
        "annual_ctc": round(target, 2),
        "annual_ctc_computed": round(actual_annual, 2),
        "fixed_ctc_annual": round(actual_annual, 2),
        "variable_ctc_annual": round(max(0.0, float(variable_ctc_annual or 0)), 2),
        "total_ctc_annual": total_ctc_annual(actual_annual, variable_ctc_annual),
        "mediclaim_yearly": round(mediclaim, 2),
        "basic_pct_of_monthly_ctc": round(
            basic_pct_of_monthly_ctc(
                b, da, hra_pct_val, allowance_total, mediclaim,
                include_pf_admin_in_ctc=include_pf_admin_in_ctc,
                include_edli_in_ctc=include_edli_in_ctc,
            include_statutory_bonus_in_ctc=include_statutory_bonus_in_ctc,
            statutory_bonus_pct=statutory_bonus_pct,
            include_lwf_in_ctc=include_lwf_in_ctc,
            lwf_employer_yearly_amount=lwf_employer_yearly_amount,
            ),
            2,
        ),
        "basic_band_applied": (
            BASIC_MIN_PCT_OF_CTC - 0.5
            <= basic_pct_of_monthly_ctc(
                b, da, hra_pct_val, allowance_total, mediclaim,
                include_pf_admin_in_ctc=include_pf_admin_in_ctc,
                include_edli_in_ctc=include_edli_in_ctc,
            include_statutory_bonus_in_ctc=include_statutory_bonus_in_ctc,
            statutory_bonus_pct=statutory_bonus_pct,
            include_lwf_in_ctc=include_lwf_in_ctc,
            lwf_employer_yearly_amount=lwf_employer_yearly_amount,
            )
            <= BASIC_MAX_PCT_OF_CTC + 0.5
        ),
        "employer_costs": employer_costs_summary(
            b, gross, mediclaim, da,
            include_pf_admin_in_ctc=include_pf_admin_in_ctc,
            include_edli_in_ctc=include_edli_in_ctc,
            include_statutory_bonus_in_ctc=include_statutory_bonus_in_ctc,
            statutory_bonus_pct=statutory_bonus_pct,
            include_lwf_in_ctc=include_lwf_in_ctc,
            lwf_employer_yearly_amount=lwf_employer_yearly_amount,
        ),
        "pf_admin_yearly": round(
            pf_admin_yearly(b, da) if include_pf_admin_in_ctc else 0.0, 2
        ),
        "edli_yearly": round(edli_yearly(b, da) if include_edli_in_ctc else 0.0, 2),
        "statutory_bonus_yearly": round(
            statutory_bonus_yearly(b, da, statutory_bonus_pct)
            if include_statutory_bonus_in_ctc else 0.0,
            2,
        ),
        "lwf_employer_yearly": round(
            lwf_employer_yearly(lwf_employer_yearly_amount) if include_lwf_in_ctc else 0.0,
            2,
        ),
        "include_pf_admin_in_ctc": bool(include_pf_admin_in_ctc),
        "include_edli_in_ctc": bool(include_edli_in_ctc),
        "include_statutory_bonus_in_ctc": bool(include_statutory_bonus_in_ctc),
        "include_lwf_in_ctc": bool(include_lwf_in_ctc),
    }


def reverse_ctc_breakup(
    annual_ctc,
    hra_pct,
    allowance_total=0,
    mediclaim_yearly=0,
    dearness_allowance=0,
    variable_ctc_annual=0,
    include_pf_admin_in_ctc=True,
    include_edli_in_ctc=True,
    include_statutory_bonus_in_ctc=False,
    statutory_bonus_pct=STATUTORY_BONUS_PCT_DEFAULT,
    include_lwf_in_ctc=False,
    lwf_employer_yearly_amount=12.0,
    include_nps_in_ctc=False,
    nps_employer_pct_of_basic=10.0,
    *,
    other_allowance=None,
    special_allowance=0,
    conveyance_allowance=0,
    medical_allowance=0,
    lta_allowance=0,
):
    """
    Solve monthly Basic from fixed annual CTC (Basic + DA within 40–50% of monthly CTC).
    DA and allowance heads are fixed; only Basic is derived.
  Variable pay is excluded from the reverse solve and added to total CTC for display.
    """
    target = float(annual_ctc or 0)
    if target <= 0:
        raise ValueError("Annual CTC must be greater than 0")

    nps_kw = dict(
        include_nps_in_ctc=include_nps_in_ctc,
        nps_employer_pct_of_basic=nps_employer_pct_of_basic,
    )
    hra_pct_val = _clamp_hra_pct(hra_pct)
    mediclaim = max(0.0, float(mediclaim_yearly or 0))
    da = max(0.0, float(dearness_allowance or 0))
    allowance_heads, allowance_sum = normalize_allowance_heads(
        special_allowance=special_allowance,
        conveyance_allowance=conveyance_allowance,
        medical_allowance=medical_allowance,
        lta_allowance=lta_allowance,
        other_allowance=other_allowance if allowance_total in (0, None) else allowance_total,
    )
    if allowance_total not in (0, None):
        allowance_sum = max(0.0, float(allowance_total or 0))
        if allowance_sum > 0 and sum(allowance_heads.values()) <= 0:
            allowance_heads["special_allowance"] = allowance_sum

    monthly_target = target / 12.0
    lo_b = max(1.0, monthly_target * BASIC_MIN_PCT_OF_CTC / 100.0 * 0.75)
    hi_b = max(lo_b + 1.0, monthly_target * BASIC_MAX_PCT_OF_CTC / 100.0 * 1.25)
    best = None
    best_diff = float("inf")

    for _ in range(90):
        basic_try = (lo_b + hi_b) / 2.0
        computed = annual_ctc_from_monthly(
            basic_try,
            hra_pct_val,
            allowance_sum,
            mediclaim,
            dearness_allowance=da,
            include_pf_admin_in_ctc=include_pf_admin_in_ctc,
            include_edli_in_ctc=include_edli_in_ctc,
            include_statutory_bonus_in_ctc=include_statutory_bonus_in_ctc,
            statutory_bonus_pct=statutory_bonus_pct,
            include_lwf_in_ctc=include_lwf_in_ctc,
            lwf_employer_yearly_amount=lwf_employer_yearly_amount,
            **nps_kw,
        )
        diff = computed - target

        if abs(diff) < abs(best_diff):
            b, d, hra, o, gross = monthly_components(
                basic_try,
                da,
                hra_pct_val,
                allowance_sum,
                apply_floor=True,
                mediclaim_yearly=mediclaim,
                include_pf_admin_in_ctc=include_pf_admin_in_ctc,
                include_edli_in_ctc=include_edli_in_ctc,
            include_statutory_bonus_in_ctc=include_statutory_bonus_in_ctc,
            statutory_bonus_pct=statutory_bonus_pct,
            include_lwf_in_ctc=include_lwf_in_ctc,
            lwf_employer_yearly_amount=lwf_employer_yearly_amount,
            )
            actual = _annual_ctc_raw(
                b, d, hra_pct_val, o, mediclaim,
                include_pf_admin_in_ctc=include_pf_admin_in_ctc,
                include_edli_in_ctc=include_edli_in_ctc,
            include_statutory_bonus_in_ctc=include_statutory_bonus_in_ctc,
            statutory_bonus_pct=statutory_bonus_pct,
            include_lwf_in_ctc=include_lwf_in_ctc,
            lwf_employer_yearly_amount=lwf_employer_yearly_amount,
            **nps_kw,
            )
            best_diff = diff
            best = _build_solved_result(
                b,
                d,
                hra,
                allowance_heads,
                o,
                gross,
                hra_pct_val,
                target,
                mediclaim,
                actual,
                variable_ctc_annual,
                include_pf_admin_in_ctc=include_pf_admin_in_ctc,
                include_edli_in_ctc=include_edli_in_ctc,
            include_statutory_bonus_in_ctc=include_statutory_bonus_in_ctc,
            statutory_bonus_pct=statutory_bonus_pct,
            include_lwf_in_ctc=include_lwf_in_ctc,
            lwf_employer_yearly_amount=lwf_employer_yearly_amount,
            )

        if abs(diff) <= CTC_SOLVE_TOLERANCE:
            b, d, hra, o, gross = monthly_components(
                basic_try,
                da,
                hra_pct_val,
                allowance_sum,
                apply_floor=True,
                mediclaim_yearly=mediclaim,
                include_pf_admin_in_ctc=include_pf_admin_in_ctc,
                include_edli_in_ctc=include_edli_in_ctc,
            include_statutory_bonus_in_ctc=include_statutory_bonus_in_ctc,
            statutory_bonus_pct=statutory_bonus_pct,
            include_lwf_in_ctc=include_lwf_in_ctc,
            lwf_employer_yearly_amount=lwf_employer_yearly_amount,
            )
            actual = _annual_ctc_raw(
                b, d, hra_pct_val, o, mediclaim,
                include_pf_admin_in_ctc=include_pf_admin_in_ctc,
                include_edli_in_ctc=include_edli_in_ctc,
            include_statutory_bonus_in_ctc=include_statutory_bonus_in_ctc,
            statutory_bonus_pct=statutory_bonus_pct,
            include_lwf_in_ctc=include_lwf_in_ctc,
            lwf_employer_yearly_amount=lwf_employer_yearly_amount,
            )
            return _build_solved_result(
                b,
                d,
                hra,
                allowance_heads,
                o,
                gross,
                hra_pct_val,
                target,
                mediclaim,
                actual,
                variable_ctc_annual,
                include_pf_admin_in_ctc=include_pf_admin_in_ctc,
                include_edli_in_ctc=include_edli_in_ctc,
            include_statutory_bonus_in_ctc=include_statutory_bonus_in_ctc,
            statutory_bonus_pct=statutory_bonus_pct,
            include_lwf_in_ctc=include_lwf_in_ctc,
            lwf_employer_yearly_amount=lwf_employer_yearly_amount,
            )

        if diff > 0:
            hi_b = basic_try
        else:
            lo_b = basic_try

    if best is None:
        raise ValueError("Unable to derive CTC breakup for the given annual CTC")

    return best
