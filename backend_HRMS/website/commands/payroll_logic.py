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
