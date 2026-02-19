"""
Comp-off (compensatory off) logic: balance from CompOffGain, deduct oldest-first, sync to LeaveBalance.
"""
from datetime import date, timedelta

from . import db
from .models.attendance import CompOffGain, LeaveBalance
from .models.Admin_models import Admin


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


def sync_comp_balance_for_admin(admin_id):
    """Set LeaveBalance.compensatory_leave_balance from current CompOffGain total."""
    balance = get_effective_comp_balance(admin_id)
    lb = LeaveBalance.query.filter_by(admin_id=admin_id).first()
    if lb is not None:
        lb.compensatory_leave_balance = balance
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
