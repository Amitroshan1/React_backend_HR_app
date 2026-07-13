"""
Comp-off (compensatory off) logic: balance from CompOffGain, deduct oldest-first, sync to LeaveBalance.
"""
from datetime import date, timedelta
from collections import defaultdict

from sqlalchemy.exc import IntegrityError

from . import db
from .models.attendance import CompOffGain, LeaveBalance
from .models.Admin_models import Admin
from .leave_balance_utils import credit_comp_entitlement, sync_leave_balance_totals

MAX_COMPOFF_APPLICATIONS_PER_MONTH = 2
MAX_COMPOFF_DAYS_PER_APPLICATION = 2
COMP_OFF_VALID_DAYS = 30


def sunday_dedupe_key(admin_id, gain_date):
    """Stable unique key so Sunday punch job creates at most one gain per employee/date."""
    return f"{int(admin_id)}:{gain_date.isoformat()}:sunday"


def dedupe_duplicate_sunday_compoff_gains():
    """
    Collapse triplicate/duplicate Sunday CompOffGain rows (multi-worker scheduler race).
    Keeps one row per (admin_id, Sunday gain_date); merges used (capped at 1.0).
    Returns number of rows deleted.
    """
    gains = CompOffGain.query.order_by(CompOffGain.id.asc()).all()
    groups = defaultdict(list)
    for g in gains:
        if g.gain_date is None or g.gain_date.weekday() != 6:
            continue
        groups[(g.admin_id, g.gain_date)].append(g)

    deleted = 0
    touched_admins = set()
    for (admin_id, gain_date), rows in groups.items():
        key = sunday_dedupe_key(admin_id, gain_date)
        expected_expiry = gain_date + timedelta(days=COMP_OFF_VALID_DAYS)

        if len(rows) == 1:
            survivor = rows[0]
            if not survivor.dedupe_key:
                try:
                    with db.session.begin_nested():
                        survivor.dedupe_key = key
                        db.session.flush()
                except IntegrityError:
                    pass
            continue

        rows_sorted = sorted(rows, key=lambda r: (-float(r.used or 0), r.id))
        survivor = rows_sorted[0]
        extras = [r for r in rows if r.id != survivor.id]
        try:
            with db.session.begin_nested():
                survivor.used = min(1.0, sum(float(r.used or 0) for r in rows))
                survivor.dedupe_key = key
                survivor.expiry_date = expected_expiry
                for r in extras:
                    db.session.delete(r)
                db.session.flush()
            deleted += len(extras)
            touched_admins.add(admin_id)
        except IntegrityError:
            continue

    for admin_id in touched_admins:
        sync_comp_balance_for_admin(admin_id)

    return deleted


def count_compoff_applications_in_month(admin_id, year, month, exclude_leave_id=None):
    """
    Count Comp Off applications that start in the given calendar month.
    Pending and Approved count toward the limit; Cancelled/Rejected do not.
    """
    from .models.attendance import LeaveApplication
    import calendar

    first = date(year, month, 1)
    last = date(year, month, calendar.monthrange(year, month)[1])
    q = LeaveApplication.query.filter(
        LeaveApplication.admin_id == admin_id,
        LeaveApplication.leave_type == "Compensatory Leave",
        LeaveApplication.start_date >= first,
        LeaveApplication.start_date <= last,
        LeaveApplication.status.in_(("Pending", "Approved")),
    )
    if exclude_leave_id:
        q = q.filter(LeaveApplication.id != exclude_leave_id)
    return q.count()


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


def _preview_fifo_allocation(admin_id, days, as_of_date=None, remaining=None, gains=None):
    """
    Which credits would be used for `days` (does not mutate DB).
    If `remaining` / `gains` are provided, allocation mutates `remaining` so callers can
    reserve credits across multiple pending applications.
    """
    if days <= 0:
        return []
    as_of = as_of_date or date.today()
    if gains is None:
        gains = (
            CompOffGain.query.filter(
                CompOffGain.admin_id == admin_id,
                CompOffGain.expiry_date >= as_of,
                CompOffGain.used < 1.0,
            )
            .order_by(CompOffGain.expiry_date.asc(), CompOffGain.id.asc())
            .all()
        )
        remaining = {
            g.id: 1.0 - float(g.used or 0)
            for g in gains
        }
    elif remaining is None:
        remaining = {
            g.id: 1.0 - float(g.used or 0)
            for g in gains
        }

    remaining_need = float(days)
    slices = []
    for g in gains:
        if remaining_need <= 1e-9:
            break
        if g.expiry_date < as_of:
            continue
        available = float(remaining.get(g.id, 0.0))
        if available <= 1e-9:
            continue
        take = min(remaining_need, available)
        remaining[g.id] = available - take
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


def _compoff_days_for_leave(leave_obj):
    """Working Comp Off days to deduct (exclude sandwich PL from preview)."""
    requested = float(getattr(leave_obj, "requested_deducted_days", 0.0) or 0.0)
    if requested > 0:
        return requested
    deducted = float(leave_obj.deducted_days or 0.0)
    if deducted > 0:
        return deducted
    if leave_obj.start_date and leave_obj.end_date:
        return max(0.0, (leave_obj.end_date - leave_obj.start_date).days + 1.0)
    return 0.0


def _build_pending_will_use(admin_id, pending_leaves, today=None):
    """
    For each pending Comp Off leave, show which earned credit dates FIFO will consume.
    Reserves credits across apps (oldest application first) so rows don't all claim the same days.
    Includes credits that are still unused even if already past expiry, so Applied still
    shows the earned dates; flags approval risk when those credits are already expired.
    """
    today = today or date.today()
    gains = (
        CompOffGain.query.filter_by(admin_id=admin_id)
        .order_by(CompOffGain.expiry_date.asc(), CompOffGain.id.asc())
        .all()
    )
    remaining = {g.id: max(0.0, 1.0 - float(g.used or 0)) for g in gains}

    # Allocate in apply order so first application gets oldest-expiring credits.
    ordered = sorted(
        pending_leaves,
        key=lambda lv: (
            lv.created_at.timestamp() if lv.created_at else 0.0,
            lv.id or 0,
        ),
    )
    by_id = {}
    for lv in ordered:
        days = _compoff_days_for_leave(lv)
        # Plan against credits that were valid for the leave start date.
        as_of = lv.start_date or today
        slices = _preview_fifo_allocation(
            admin_id,
            days,
            as_of_date=as_of,
            remaining=remaining,
            gains=gains,
        )
        allocated = sum(float(s["days"]) for s in slices)
        shortfall = _round_days(max(0.0, days - allocated))
        expired_slices = [
            s for s in slices
            if date.fromisoformat(s["expiry_date"]) < today
        ]
        # What approval can still take today (non-expired only) — informational.
        approval_ok = shortfall <= 1e-9 and not expired_slices
        warning = None
        if expired_slices and slices:
            warning = (
                "One or more planned credits have already expired. "
                "Approval will fail unless newer Comp Off is available."
            )
        elif shortfall > 1e-9:
            warning = (
                f"Short by {shortfall:g} day(s) of Comp Off credit for this request."
            )
        by_id[lv.id] = {
            "will_use": slices,
            "days": _round_days(days),
            "shortfall": shortfall,
            "approval_ok": approval_ok,
            "warning": warning,
        }
    return by_id


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
        need = _compoff_days_for_leave(lv)
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
    will_use_by_id = _build_pending_will_use(admin_id, pending_apps, today=today)
    pending_applications = []
    for lv in pending_apps:
        preview = will_use_by_id.get(lv.id) or {}
        pending_applications.append(
            {
                "leave_id": lv.id,
                "start_date": lv.start_date.isoformat(),
                "end_date": lv.end_date.isoformat(),
                "days": preview.get("days", _round_days(_compoff_days_for_leave(lv))),
                "status": "Applied",
                "reason": lv.reason or "",
                "will_use": preview.get("will_use") or [],
                "shortfall": preview.get("shortfall", 0),
                "approval_ok": preview.get("approval_ok", False),
                "warning": preview.get("warning"),
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
                "days": _round_days(_compoff_days_for_leave(lv)),
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
            "max_per_application": MAX_COMPOFF_DAYS_PER_APPLICATION,
            "max_applications_per_month": MAX_COMPOFF_APPLICATIONS_PER_MONTH,
        },
        "credits": credits,
        "pending_applications": pending_applications,
        "usage_history": usage_history,
    }
