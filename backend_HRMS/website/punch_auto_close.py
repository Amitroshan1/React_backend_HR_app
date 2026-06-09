"""
Server-side auto punch-out: close open PunchSession when daily work on that punch hits 10 hours.

- Sums closed sessions on the same punch_date row (since last auto punch-out) plus the open segment.
- After auto punch-out, a new punch-in starts a fresh 10h block (repeat reason required).
- Single night session: full 10h from punch-in (punch-out may be the next calendar day).
- clock_out is stored at the cap deadline (punch_in + remaining cap), even if the job runs late.
- Scheduler runs every 2 minutes; homepage load also closes overdue sessions for the user.
"""
from datetime import datetime, timedelta

from . import db
from .models.attendance import Punch, PunchSession
from .punch_aggregate import ensure_punch_sessions_backfill, recompute_punch_aggregate

SESSION_CAP_SEC = 10 * 3600
AUTO_CAP_REASON = "Auto punch-out after 10 hr daily cap"
# Server scheduler close has no live GPS — do not copy punch-in geofence to punch-out.
AUTO_PUNCH_NO_LIVE_GPS = "auto_punch_out_no_live_gps"


def _last_auto_close_at_on_punch(punch_id):
    """Latest clock_out among auto-closed segments on this punch (cap resets after this)."""
    if not punch_id:
        return None
    last = None
    rows = PunchSession.query.filter(
        PunchSession.punch_id == punch_id,
        PunchSession.clock_out.isnot(None),
        PunchSession.auto_punched_out.is_(True),
    ).all()
    for s in rows:
        if s.clock_out and (last is None or s.clock_out > last):
            last = s.clock_out
    return last


def closed_seconds_for_cap(punch_id, open_sess):
    """
    Closed work counted toward the 10h cap for this open segment.
    Sums closed sessions on the punch; after an auto punch-out, only sessions
    closed after that time count (so a new punch-in can start a fresh 10h block).
    """
    if not punch_id:
        return 0
    cap_reset_after = _last_auto_close_at_on_punch(punch_id)
    total = 0
    rows = PunchSession.query.filter(
        PunchSession.punch_id == punch_id,
        PunchSession.clock_out.isnot(None),
    ).all()
    for s in rows:
        if not s.clock_in or not s.clock_out:
            continue
        if cap_reset_after and s.clock_out <= cap_reset_after:
            continue
        if open_sess and open_sess.id and s.id == open_sess.id:
            continue
        total += int((s.clock_out - s.clock_in).total_seconds())
    return max(0, total)


def daily_work_seconds(open_sess, now=None):
    """Closed sessions on punch + elapsed time on this open segment."""
    now = now or datetime.now()
    if not open_sess or not open_sess.clock_in:
        return 0
    closed = closed_seconds_for_cap(open_sess.punch_id, open_sess)
    open_secs = int((now - open_sess.clock_in).total_seconds())
    return closed + max(0, open_secs)


def auto_close_deadline(open_sess):
    """Datetime when the open segment reaches the 10h daily cap."""
    cin = open_sess.clock_in if open_sess else None
    if not cin:
        return None
    closed = closed_seconds_for_cap(open_sess.punch_id, open_sess)
    remaining = max(0, SESSION_CAP_SEC - closed)
    return cin + timedelta(seconds=remaining)


def capped_daily_work_seconds(open_sess, now=None):
    """Daily work for display/eligibility, never exceeding SESSION_CAP_SEC."""
    now = now or datetime.now()
    if not open_sess or not open_sess.clock_in:
        return 0
    closed = closed_seconds_for_cap(open_sess.punch_id, open_sess)
    remaining = max(0, SESSION_CAP_SEC - closed)
    open_secs = int((now - open_sess.clock_in).total_seconds())
    return min(SESSION_CAP_SEC, closed + min(max(0, open_secs), remaining))


def session_auto_close_deadline(open_sess, now=None):
    """When today's total work (all sessions + this open one) reaches 10 hours."""
    return auto_close_deadline(open_sess)


def evaluate_auto_close(open_sess, now=None):
    """Returns (should_close, reason, clock_out_at) or (False, None, None)."""
    now = now or datetime.now()
    cin = open_sess.clock_in
    if not cin:
        return False, None, None

    cap_at = auto_close_deadline(open_sess)
    if not cap_at or now < cap_at:
        return False, None, None

    return True, AUTO_CAP_REASON, cap_at


def session_cap_hours_display(open_sess):
    """Hours until auto-close (for UI), based on remaining daily 10h."""
    cin = open_sess.clock_in
    if not cin:
        return 10
    deadline = session_auto_close_deadline(open_sess)
    if not deadline:
        return 10
    remaining = max(0, int((deadline - datetime.now()).total_seconds()))
    return max(1, (remaining + 3599) // 3600)


def validate_manual_punch_out_extended_reason(open_sess, data, now=None):
    """
    Require a reason only if manual punch-out exceeds 10h total for the day (auto job may lag).
    """
    if data.get("auto_system_punch_out") is True:
        return None, None
    now = now or datetime.now()
    if not open_sess.clock_in:
        return None, None
    if daily_work_seconds(open_sess, now) <= SESSION_CAP_SEC:
        return None, None
    ext_reason = (data.get("extended_hours_reason") or "").strip()
    if len(ext_reason) < 3:
        return (
            {
                "success": False,
                "message": (
                    "Today's total work is over 10 hours. "
                    "Please provide a reason (at least 3 characters) to punch out."
                ),
                "requires_extended_hours_reason": True,
            },
            400,
        )
    return None, None


def close_punch_session(
    open_sess,
    punch,
    *,
    is_auto=False,
    lat=None,
    lon=None,
    location_status_out=None,
    extended_hours_reason=None,
    now=None,
    clock_out_at=None,
):
    """Close an open session and recompute punch aggregate. Caller commits."""
    now = now or datetime.now()
    out_time = clock_out_at or now
    open_sess.clock_out = out_time
    if lat is not None:
        open_sess.lat = lat
    if lon is not None:
        open_sess.lon = lon
    if location_status_out:
        open_sess.location_status_out = location_status_out
        open_sess.location_status = location_status_out
    if is_auto:
        open_sess.auto_punched_out = True
        open_sess.extended_hours_reason = extended_hours_reason or AUTO_CAP_REASON
    elif extended_hours_reason:
        open_sess.extended_hours_reason = extended_hours_reason
        open_sess.auto_punched_out = False
    if punch:
        if lat is not None:
            punch.lat = lat
        if lon is not None:
            punch.lon = lon
        recompute_punch_aggregate(punch)
    return out_time


def _close_overdue_session(open_sess, now=None):
    """Close one open session if it is past the 10h cap. Returns True if closed."""
    now = now or datetime.now()
    should_close, reason, out_at = evaluate_auto_close(open_sess, now)
    if not should_close:
        return False

    punch = Punch.query.get(open_sess.punch_id) if open_sess.punch_id else None
    if punch and ensure_punch_sessions_backfill(punch):
        db.session.flush()

    close_punch_session(
        open_sess,
        punch,
        is_auto=True,
        lat=open_sess.lat,
        lon=open_sess.lon,
        location_status_out=AUTO_PUNCH_NO_LIVE_GPS,
        extended_hours_reason=reason,
        now=now,
        clock_out_at=out_at,
    )
    return True


def process_auto_punch_out_for_admin(admin_id):
    """Close overdue open session for one employee (e.g. on dashboard load)."""
    from .punch_aggregate import open_punch_session_for_admin

    now = datetime.now()
    open_sess = open_punch_session_for_admin(admin_id)
    if not open_sess:
        return False
    try:
        closed = _close_overdue_session(open_sess, now)
        if closed:
            db.session.commit()
        return closed
    except Exception:
        db.session.rollback()
        raise


def process_auto_punch_outs():
    """Close open sessions when punch-day total work reaches 10h. Returns sessions closed."""
    now = datetime.now()
    open_sessions = PunchSession.query.filter(PunchSession.clock_out.is_(None)).all()
    closed_count = 0

    for open_sess in open_sessions:
        try:
            if _close_overdue_session(open_sess, now):
                closed_count += 1
        except Exception:
            db.session.rollback()
            raise

    if closed_count:
        db.session.commit()
    return closed_count


def _has_valid_extended_reason(sess):
    reason = (getattr(sess, "extended_hours_reason", None) or "").strip()
    return len(reason) >= 3 and reason != AUTO_CAP_REASON


def _closed_seconds_before_session(punch_id, session, sessions_ordered):
    """Closed cap time from earlier segments in the same 10h block before `session`."""
    cap_reset_after = _last_auto_close_at_on_punch(punch_id)
    total = 0
    for s in sessions_ordered:
        if s.id == session.id:
            break
        if not s.clock_in or not s.clock_out:
            continue
        if cap_reset_after and s.clock_out <= cap_reset_after:
            continue
        total += int((s.clock_out - s.clock_in).total_seconds())
    return max(0, total)


def repair_overlong_sessions_for_punch(punch):
    """
    Cap closed sessions that exceed the 10h block (e.g. late auto-close stored midnight).
    Skips sessions with a valid manual extended-hours reason.
    """
    if not punch or not punch.id:
        return False
    sessions = (
        PunchSession.query.filter_by(punch_id=punch.id)
        .order_by(PunchSession.clock_in.asc())
        .all()
    )
    changed = False
    for sess in sessions:
        if not sess.clock_in or not sess.clock_out:
            continue
        if _has_valid_extended_reason(sess):
            continue
        closed_before = _closed_seconds_before_session(punch.id, sess, sessions)
        remaining = max(0, SESSION_CAP_SEC - closed_before)
        max_out = sess.clock_in + timedelta(seconds=remaining)
        if sess.clock_out > max_out:
            sess.clock_out = max_out
            sess.auto_punched_out = True
            sess.extended_hours_reason = AUTO_CAP_REASON
            changed = True
    if changed:
        recompute_punch_aggregate(punch)
    return changed


def repair_misdated_sessions_for_admin(admin_id):
    """
    Move sessions onto the punch row matching clock_in.date() (attendance day).
    Fixes yesterday's session incorrectly attached to today's punch row.
    """
    if not admin_id:
        return False
    changed = False
    punches = Punch.query.filter_by(admin_id=admin_id).all()
    touched_punch_ids = set()

    for punch in punches:
        sessions = PunchSession.query.filter_by(punch_id=punch.id).all()
        for sess in sessions:
            if not sess.clock_in:
                continue
            sess_date = sess.clock_in.date()
            if sess_date == punch.punch_date:
                continue
            target = Punch.query.filter_by(admin_id=admin_id, punch_date=sess_date).first()
            if not target:
                target = Punch(admin_id=admin_id, punch_date=sess_date)
                db.session.add(target)
                db.session.flush()
            sess.punch_id = target.id
            touched_punch_ids.add(punch.id)
            touched_punch_ids.add(target.id)
            changed = True

    for punch_id in touched_punch_ids:
        punch = Punch.query.get(punch_id)
        if punch:
            repair_overlong_sessions_for_punch(punch)
            recompute_punch_aggregate(punch)
            from .punch_aggregate import cleanup_empty_punch

            cleanup_empty_punch(punch)

    return changed


def repair_attendance_integrity_for_admin(admin_id):
    """Repair misdated + overlong sessions, then close any overdue open session."""
    from .punch_aggregate import open_punch_session_for_admin

    changed = False
    try:
        if repair_misdated_sessions_for_admin(admin_id):
            changed = True
        punches = Punch.query.filter_by(admin_id=admin_id).all()
        for punch in punches:
            if repair_overlong_sessions_for_punch(punch):
                changed = True
        # Overdue cap close: scheduler (no live GPS) or dashboard client punch-out with GPS.
        if changed:
            db.session.commit()
    except Exception:
        db.session.rollback()
        raise
    return changed
