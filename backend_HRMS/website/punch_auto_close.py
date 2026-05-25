"""
Server-side auto punch-out: close open PunchSession when daily work on that punch hits 10 hours.

- Sums closed sessions on the same punch_date row (since last auto punch-out) plus the open segment.
- After auto punch-out, a new punch-in starts a fresh 10h block (repeat reason required).
- Single night session: full 10h from punch-in (punch-out may be the next calendar day).
- clock_out is stored as the actual datetime when the session closes.
- Scheduler runs every 2 minutes (no dashboard required).
"""
from datetime import datetime, timedelta

from . import db
from .models.attendance import Punch, PunchSession
from .punch_aggregate import ensure_punch_sessions_backfill, recompute_punch_aggregate

SESSION_CAP_SEC = 10 * 3600
AUTO_CAP_REASON = "Auto punch-out after 10 hr daily cap"


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


def session_auto_close_deadline(open_sess, now=None):
    """When today's total work (all sessions + this open one) reaches 10 hours."""
    now = now or datetime.now()
    cin = open_sess.clock_in
    if not cin:
        return None
    closed = closed_seconds_for_cap(open_sess.punch_id, open_sess)
    remaining = SESSION_CAP_SEC - closed
    if remaining <= 0:
        return now
    return cin + timedelta(seconds=remaining)


def evaluate_auto_close(open_sess, now=None):
    """Returns (should_close, reason, clock_out_at) or (False, None, None)."""
    now = now or datetime.now()
    cin = open_sess.clock_in
    if not cin:
        return False, None, None

    closed = closed_seconds_for_cap(open_sess.punch_id, open_sess)
    total = daily_work_seconds(open_sess, now)
    if total < SESSION_CAP_SEC:
        return False, None, None

    remaining = SESSION_CAP_SEC - closed
    cap_at = cin + timedelta(seconds=max(0, remaining))
    out_at = now if now >= cap_at else cap_at
    return True, AUTO_CAP_REASON, out_at


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


def process_auto_punch_outs():
    """Close open sessions when punch-day total work reaches 10h. Returns sessions closed."""
    now = datetime.now()
    open_sessions = PunchSession.query.filter(PunchSession.clock_out.is_(None)).all()
    closed_count = 0

    for open_sess in open_sessions:
        should_close, reason, out_at = evaluate_auto_close(open_sess, now)
        if not should_close:
            continue

        punch = Punch.query.get(open_sess.punch_id) if open_sess.punch_id else None
        if punch and ensure_punch_sessions_backfill(punch):
            db.session.flush()

        try:
            if open_sess.lat is not None and open_sess.lon is not None:
                from .auth import resolve_geofence_for_coordinates

                geo = resolve_geofence_for_coordinates(open_sess.lat, open_sess.lon)
                loc_out = geo["location_status"]
            else:
                loc_out = open_sess.location_status_in or open_sess.location_status

            close_punch_session(
                open_sess,
                punch,
                is_auto=True,
                lat=open_sess.lat,
                lon=open_sess.lon,
                location_status_out=loc_out,
                extended_hours_reason=reason,
                now=now,
                clock_out_at=out_at,
            )
            closed_count += 1
        except Exception:
            db.session.rollback()
            raise

    if closed_count:
        db.session.commit()
    return closed_count
