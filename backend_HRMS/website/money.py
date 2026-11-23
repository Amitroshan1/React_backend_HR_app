"""Exact rupee storage (NUMERIC 14,2) without changing in-memory payroll math.

Python round(x, 2) is bankers rounding (ROUND_HALF_EVEN). Bind/quantize uses the
same so persisted values match existing _round2 / calculate paths. ORM reads
return float rounded to 2 d.p. so `row.basic + 0.0` never TypeErrors.
"""
from __future__ import annotations

from decimal import Decimal, ROUND_HALF_EVEN, InvalidOperation

from sqlalchemy.types import Numeric, TypeDecorator

CENTS = Decimal("0.01")
MONEY_PRECISION = 14
MONEY_SCALE = 2


def quantize_money(value):
    """None-safe Decimal quantized to paise (bankers, matches Python round)."""
    if value is None or value == "":
        return None
    try:
        if isinstance(value, Decimal):
            d = value
        elif isinstance(value, bool):
            return None
        else:
            d = Decimal(str(value))
        if not d.is_finite():
            return None
        return d.quantize(CENTS, rounding=ROUND_HALF_EVEN)
    except (InvalidOperation, ValueError, TypeError):
        return None


def money_float(value, default=0.0):
    q = quantize_money(value)
    if q is None:
        return float(default)
    return float(q)


def money_json(value):
    """API payload: JSON number at 2 d.p., or None."""
    if value is None or value == "":
        return None
    q = quantize_money(value)
    return None if q is None else float(q)


class Money(TypeDecorator):
    impl = Numeric(MONEY_PRECISION, MONEY_SCALE)
    cache_ok = True

    def process_bind_param(self, value, dialect):
        q = quantize_money(value)
        return q

    def process_result_value(self, value, dialect):
        q = quantize_money(value)
        return None if q is None else float(q)
