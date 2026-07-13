"""
Comp-off (compensatory off) logic: balance from CompOffGain, deduct oldest-first, sync to LeaveBalance.
"""
from datetime import date, timedelta

from . import db
from .models.attendance import CompOffGain, LeaveBalance
from .models.Admin_models import Admin
from .leave_balance_utils import credit_comp_entitlement, sync_leave_balance_totals


def get_effective_comp_balance(admin_id):
    """Sum of unused, non-expired comp-off. Each gain valid 30 days from gain_date."""
    today = date.today()
    gains = (
        CompOffGain.query.filter(
            CompOffGain.admin_id == admin_id,
            CompOffGain.expiry_date >= today,
            CompOffGain.used < 1.0,
        )
        .all()
    )
    return sum(1.0 - float(g.used or 0) for g in gains)


def deduct_comp_leave(admin_id, days):
    """
    Deduct comp leave from oldest (by expiry_date) gains first. Returns True if deduction succeeded.
    Updates CompOffGain.used and LeaveBalance.compensatory_leave_balance.
    """
    if days <= 0:
        return True
    today = date.today()
    gains = (
        CompOffGain.query.filter(
            CompOffGain.admin_id == admin_id,
            CompOffGain.expiry_date >= today,
            CompOffGain.used < 1.0,
        )
        .order_by(CompOffGain.expiry_date.asc())
        .all()
    )
    remaining = float(days)
    for g in gains:
        if remaining <= 0:
            break
        available = 1.0 - float(g.used or 0)
        take = min(remaining, available)
        if take <= 0:
            continue
        g.used = float(g.used or 0) + take
        remaining -= take
    if remaining > 0:
        return False
    sync_comp_balance_for_admin(admin_id)
    return True


def restore_comp_leave(admin_id, days):
    """Add back comp leave (e.g. on leave reversal) by creating a new gain valid 30 days."""
    if days <= 0:
        return
    today = date.today()
    expiry = today + timedelta(days=30)
    for _ in range(int(days)):
        db.session.add(
            CompOffGain(
                admin_id=admin_id,
                gain_date=today,
                expiry_date=expiry,
                used=0.0,
            )
        )
    frac = days - int(days)
    if frac > 0:
        db.session.add(
            CompOffGain(
                admin_id=admin_id,
                gain_date=today,
                expiry_date=expiry,
                used=1.0 - frac,
            )
        )
    sync_comp_balance_for_admin(admin_id)
    lb = LeaveBalance.query.filter_by(admin_id=admin_id).first()
    if lb is not None:
        credit_comp_entitlement(lb, days)


def set_comp_balance_to_target(admin_id, target_balance):
    """
    Adjust CompOffGain rows so effective balance matches target.
    Increases create gains with 30-day expiry (same as restore_comp_leave);
    decreases consume oldest gains first (same as deduct_comp_leave).
    """
    target = max(0.0, round(float(target_balance or 0), 2))
    current = round(get_effective_comp_balance(admin_id), 2)
    delta = round(target - current, 2)

    if delta > 0:
        restore_comp_leave(admin_id, delta)
        return
    if delta < 0:
        if not deduct_comp_leave(admin_id, abs(delta)):
            raise ValueError(
                "Cannot reduce compensatory leave below available non-expired comp-off gains"
            )
        return
    sync_comp_balance_for_admin(admin_id)


def sync_comp_balance_for_admin(admin_id):
    """Set LeaveBalance.compensatory_leave_balance from current CompOffGain total."""
    balance = get_effective_comp_balance(admin_id)
    lb = LeaveBalance.query.filter_by(admin_id=admin_id).first()
    if lb is not None:
        lb.compensatory_leave_balance = balance
        sync_leave_balance_totals(lb)
    else:
        admin = Admin.query.get(admin_id)
        if admin:
            lb = LeaveBalance(
                admin_id=admin_id,
                privilege_leave_balance=0.0,
                casual_leave_balance=0.0,
                compensatory_leave_balance=balance,
                total_privilege_leave=0.0,
                total_casual_leave=0.0,
                total_compensatory_leave=0.0,
                used_privilege_leave=0.0,
                used_casual_leave=0.0,
                used_comp_leave=0.0,
            )
            db.session.add(lb)


def _round_days(value):
    return round(float(value or 0), 2)


def _credit_status(gain, today):
    available = _round_days(1.0 - float(gain.used or 0))
    # Past expiry always surfaces as expired so employees can see lapsed credits.
    if gain.expiry_date < today:
        return "expired"
    if available <= 0:
        return "used"
    if float(gain.used or 0) > 0:
        return "partially_used"
    if (gain.expiry_date - today).days <= 7:
        return "expiring_soon"
    return "available"


def _preview_fifo_allocation(admin_id, days, as_of_date=None):
    """Which active credits would be used for `days` (does not mutate DB)."""
    if days <= 0:
        return []
    today = as_of_date or date.today()
    gains = (
        CompOffGain.query.filter(
            CompOffGain.admin_id == admin_id,
            CompOffGain.expiry_date >= today,
            CompOffGain.used < 1.0,
        )
        .order_by(CompOffGain.expiry_date.asc(), CompOffGain.id.asc())
        .all()
    )
    remaining_need = float(days)
    slices = []
    for g in gains:
        if remaining_need <= 1e-9:
            break
        available = 1.0 - float(g.used or 0)
        if available <= 1e-9:
            continue
        take = min(remaining_need, available)
        slices.append(
            {
                "gain_id": g.id,
                "gain_date": g.gain_date.isoformat(),
                "expiry_date": g.expiry_date.isoformat(),
                "days": _round_days(take),
            }
        )
        remaining_need -= take
    return slices


def _simulate_approved_usage(admin_id):
    """
    Replay approved Compensatory Leave against gains (oldest expiry first).
    Returns list of {leave, consumed_from: [...]}.
    """
    from .models.attendance import LeaveApplication

    gains = (
        CompOffGain.query.filter_by(admin_id=admin_id)
        .order_by(CompOffGain.expiry_date.asc(), CompOffGain.id.asc())
        .all()
    )
    remaining = {g.id: 1.0 for g in gains}
    leaves = (
        LeaveApplication.query.filter(
            LeaveApplication.admin_id == admin_id,
            LeaveApplication.leave_type == "Compensatory Leave",
            LeaveApplication.status == "Approved",
        )
        .order_by(LeaveApplication.start_date.asc(), LeaveApplication.id.asc())
        .all()
    )
    out = []
    for lv in leaves:
        need = float(lv.deducted_days or 0)
        if need <= 1e-9:
            continue
        consumed = []
        for g in gains:
            if need <= 1e-9:
                break
            if remaining[g.id] <= 1e-9:
                continue
            if g.expiry_date < lv.start_date:
                continue
            take = min(need, remaining[g.id])
            remaining[g.id] -= take
            need -= take
            consumed.append(
                {
                    "gain_id": g.id,
                    "gain_date": g.gain_date.isoformat(),
                    "expiry_date": g.expiry_date.isoformat(),
                    "days": _round_days(take),
                }
            )
        if consumed:
            out.append({"leave": lv, "consumed_from": consumed})
    return out


def build_compoff_ledger(admin_id):
    """
    Employee-facing Comp Off ledger: active credits, pending applications, usage history.
    """
    from .models.attendance import LeaveApplication

    today = date.today()
    gains = (
        CompOffGain.query.filter_by(admin_id=admin_id)
        .order_by(CompOffGain.gain_date.desc(), CompOffGain.id.desc())
        .all()
    )

    credits = []
    available_total = 0.0
    expiring_soon_total = 0.0
    for g in gains:
        available = _round_days(1.0 - float(g.used or 0))
        status = _credit_status(g, today)
        days_remaining = (g.expiry_date - today).days
        if status in ("available", "partially_used", "expiring_soon") and available > 0:
            available_total += available
            if status == "expiring_soon":
                expiring_soon_total += available
        credits.append(
            {
                "id": g.id,
                "gain_date": g.gain_date.isoformat(),
                "expiry_date": g.expiry_date.isoformat(),
                "days_remaining": days_remaining,
                "available": max(0.0, available) if g.expiry_date >= today else 0.0,
                "used": _round_days(g.used),
                "status": status,
            }
        )

    pending_apps = (
        LeaveApplication.query.filter(
            LeaveApplication.admin_id == admin_id,
            LeaveApplication.leave_type == "Compensatory Leave",
            LeaveApplication.status == "Pending",
        )
        .order_by(LeaveApplication.created_at.desc())
        .all()
    )
    pending_applications = []
    for lv in pending_apps:
        days = float(lv.deducted_days or 0) or max(
            0.0,
            (lv.end_date - lv.start_date).days + 1.0,
        )
        pending_applications.append(
            {
                "leave_id": lv.id,
                "start_date": lv.start_date.isoformat(),
                "end_date": lv.end_date.isoformat(),
                "days": _round_days(days),
                "status": "Applied",
                "reason": lv.reason or "",
                "will_use": _preview_fifo_allocation(admin_id, days, as_of_date=today),
                "note": "Balance is deducted only after manager approval (oldest credit first).",
            }
        )

    usage_history = []
    for row in _simulate_approved_usage(admin_id):
        lv = row["leave"]
        usage_history.append(
            {
                "leave_id": lv.id,
                "start_date": lv.start_date.isoformat(),
                "end_date": lv.end_date.isoformat(),
                "days": _round_days(lv.deducted_days),
                "status": "Approved",
                "reason": lv.reason or "",
                "consumed_from": row["consumed_from"],
            }
        )
    usage_history.sort(key=lambda r: r["start_date"], reverse=True)

    next_to_use = _preview_fifo_allocation(admin_id, 1.0, as_of_date=today)

    return {
        "available": _round_days(available_total),
        "expiring_soon": _round_days(expiring_soon_total),
        "pending_count": len(pending_applications),
        "next_credit_to_use": next_to_use[0] if next_to_use else None,
        "rules": {
            "earned_on": "Sundays worked (subject to monthly cap)",
            "validity_days": 30,
            "deduction_order": "Oldest expiry first",
            "deduct_when": "On approval (not when applied)",
            "max_per_application": 2,
        },
        "credits": credits,
        "pending_applications": pending_applications,
        "usage_history": usage_history,
    }
