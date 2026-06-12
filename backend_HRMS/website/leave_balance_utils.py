"""Helpers for leave balance total/used tracking (entitlement vs remaining)."""
from __future__ import annotations

from typing import Optional

from .models.attendance import LeaveBalance


def _round_leave(value: float) -> float:
    return round(float(value or 0.0), 2)


def computed_total_entitlement(
    remaining: float,
    used: float,
    stored_total: float,
) -> float:
    """Entitlement = max(stored total, remaining + used)."""
    return _round_leave(max(float(stored_total or 0.0), float(remaining or 0.0) + float(used or 0.0)))


def sync_leave_balance_totals(leave_balance: Optional[LeaveBalance]) -> bool:
    """
    Align total_* with remaining + used when stored totals lag behind.
    Returns True if any total_* field was updated.
    """
    if leave_balance is None:
        return False

    changed = False

    pl_total = computed_total_entitlement(
        leave_balance.privilege_leave_balance,
        leave_balance.used_privilege_leave,
        leave_balance.total_privilege_leave,
    )
    if _round_leave(leave_balance.total_privilege_leave or 0) != pl_total:
        leave_balance.total_privilege_leave = pl_total
        changed = True

    cl_total = computed_total_entitlement(
        leave_balance.casual_leave_balance,
        leave_balance.used_casual_leave,
        leave_balance.total_casual_leave,
    )
    if _round_leave(leave_balance.total_casual_leave or 0) != cl_total:
        leave_balance.total_casual_leave = cl_total
        changed = True

    comp_total = computed_total_entitlement(
        leave_balance.compensatory_leave_balance,
        leave_balance.used_comp_leave,
        leave_balance.total_compensatory_leave,
    )
    if _round_leave(leave_balance.total_compensatory_leave or 0) != comp_total:
        leave_balance.total_compensatory_leave = comp_total
        changed = True

    return changed


def credit_pl_entitlement(leave_balance: LeaveBalance, amount: float) -> None:
    amount = float(amount or 0.0)
    if amount <= 0:
        return
    leave_balance.privilege_leave_balance = _round_leave(
        float(leave_balance.privilege_leave_balance or 0.0) + amount
    )
    leave_balance.total_privilege_leave = _round_leave(
        float(leave_balance.total_privilege_leave or 0.0) + amount
    )


def credit_cl_entitlement(leave_balance: LeaveBalance, amount: float) -> None:
    amount = float(amount or 0.0)
    if amount <= 0:
        return
    leave_balance.casual_leave_balance = _round_leave(
        float(leave_balance.casual_leave_balance or 0.0) + amount
    )
    leave_balance.total_casual_leave = _round_leave(
        float(leave_balance.total_casual_leave or 0.0) + amount
    )


def credit_comp_entitlement(leave_balance: LeaveBalance, amount: float) -> None:
    amount = float(amount or 0.0)
    if amount <= 0:
        return
    leave_balance.total_compensatory_leave = _round_leave(
        float(leave_balance.total_compensatory_leave or 0.0) + amount
    )


def reset_annual_casual_entitlement_counters(leave_balance: LeaveBalance) -> None:
    """CL does not carry forward — reset annual used/total counters on year rollover."""
    leave_balance.casual_leave_balance = 0.0
    leave_balance.used_casual_leave = 0.0
    leave_balance.total_casual_leave = 0.0


def leave_balance_payload(
    leave_balance: Optional[LeaveBalance],
    *,
    comp_balance: Optional[float] = None,
    sync: bool = True,
) -> dict:
    """Serialize balances for API responses (optionally syncing totals first)."""
    if sync and leave_balance is not None:
        sync_leave_balance_totals(leave_balance)

    if leave_balance is None:
        comp = float(comp_balance or 0.0)
        return {
            "pl": 0.0,
            "cl": 0.0,
            "comp": comp,
            "total_pl": 0.0,
            "total_cl": 0.0,
            "total_comp": 0.0,
            "used_pl": 0.0,
            "used_cl": 0.0,
            "used_comp": 0.0,
        }

    comp = (
        float(comp_balance)
        if comp_balance is not None
        else float(leave_balance.compensatory_leave_balance or 0.0)
    )

    return {
        "pl": float(leave_balance.privilege_leave_balance or 0.0),
        "cl": float(leave_balance.casual_leave_balance or 0.0),
        "comp": comp,
        "total_pl": float(leave_balance.total_privilege_leave or 0.0),
        "total_cl": float(leave_balance.total_casual_leave or 0.0),
        "total_comp": float(leave_balance.total_compensatory_leave or 0.0),
        "used_pl": float(leave_balance.used_privilege_leave or 0.0),
        "used_cl": float(leave_balance.used_casual_leave or 0.0),
        "used_comp": float(leave_balance.used_comp_leave or 0.0),
    }
