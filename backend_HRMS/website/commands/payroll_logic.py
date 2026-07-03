"""Pure payroll helpers (no Flask / DB)."""


def normalize_payable_days(raw_payable: float, calendar_days: int) -> float:
    """Payable (paid) days for salary: never negative, never above calendar days in month."""
    cd = max(0, int(calendar_days or 0))
    if cd <= 0:
        return max(0.0, float(raw_payable or 0))
    return max(0.0, min(float(cd), float(raw_payable or 0)))


def payroll_earnings_factor(payable_days: float, calendar_days: int) -> float:
    """Prorate statutory deductions to earned wages (LOP model)."""
    cd = max(1, int(calendar_days or 0))
    return max(0.0, min(1.0, float(payable_days or 0) / float(cd)))


def financial_year_bounds(year: int, month_num: int) -> tuple[int, int, int, int]:
    """
    Indian FY (Apr–Mar) window from April through given year/month inclusive.
    Returns (start_year, start_month, end_year, end_month).
    """
    y, m = int(year), int(month_num)
    if m >= 4:
        return y, 4, y, m
    return y - 1, 4, y, m


def iter_fy_months_through(year: int, month_num: int):
    """Yield (year, month_num) from FY start through the given month."""
    sy, sm, ey, em = financial_year_bounds(year, month_num)
    y, m = sy, sm
    while (y < ey) or (y == ey and m <= em):
        yield y, m
        m += 1
        if m > 12:
            m = 1
            y += 1


def sum_payroll_ytd(rows, *, through_year: int, through_month: int) -> dict:
    """Aggregate payroll rows for YTD display (expects row-like dicts or ORM objects)."""
    keys = (
        "gross_salary_for_month",
        "arrears_gross_final",
        "leave_encashment_final",
        "epf_final",
        "esic_final",
        "ptax_final",
        "lwf_final",
        "loan_recovery_final",
        "tds_final",
        "tds_computed",
        "net_salary_final",
    )
    totals = {k: 0.0 for k in keys}
    totals["total_gross"] = 0.0
    count = 0
    allowed = set(iter_fy_months_through(through_year, through_month))

    for row in rows or []:
        if isinstance(row, dict):
            ry = int(row.get("year") or 0)
            rm = int(row.get("month_num") or 0)
        else:
            ry = int(getattr(row, "year", None) or 0)
            rm = int(getattr(row, "month_num", None) or 0)
        if (ry, rm) not in allowed:
            continue
        count += 1

        def _g(name):
            if isinstance(row, dict):
                return float(row.get(name) or 0)
            return float(getattr(row, name, 0) or 0)

        gross = _g("gross_salary_for_month")
        arrears = _g("arrears_gross_final")
        encash = _g("leave_encashment_final")
        totals["gross_salary_for_month"] += gross
        totals["arrears_gross_final"] += arrears
        totals["leave_encashment_final"] += encash
        totals["total_gross"] += gross + arrears + encash
        totals["epf_final"] += _g("epf_final")
        totals["esic_final"] += _g("esic_final")
        totals["ptax_final"] += _g("ptax_final")
        totals["lwf_final"] += _g("lwf_final")
        totals["loan_recovery_final"] += _g("loan_recovery_final")
        tds = _g("tds_final") if _g("tds_final") else _g("tds_computed")
        totals["tds_final"] += tds
        totals["net_salary_final"] += _g("net_salary_final")

    for k in totals:
        totals[k] = round(totals[k], 2)
    totals["months_included"] = count
    sy, sm, ey, em = financial_year_bounds(through_year, through_month)
    totals["fy_label"] = f"{sy}-{str((sy + 1) % 100).zfill(2)}"
    totals["through_year"] = through_year
    totals["through_month"] = through_month
    return totals
