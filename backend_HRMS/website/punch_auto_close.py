"""
Server-side auto punch-out: close open PunchSession when work on the current block hits 10 hours.

- Cap is per open segment: closed work before the latest punch-out does not carry over.
- After any punch-out (manual or auto), a new punch-in starts a fresh 10h block (repeat reason required).
- Single night session: full 10h from punch-in (punch-out may be the next calendar day).
- clock_out is stored at the cap deadline (punch_in + remaining cap), even if the job runs late.
- Scheduler runs every 2 minutes; homepage load also closes overdue sessions for the user.
- Client auto_system_punch_out must only close when evaluate_auto_close says the cap is due.
"""
from datetime import datetime, timedelta

from . import db
from .models.attendance import Punch, PunchSession
from .punch_aggregate import ensure_punch_sessions_backfill, recompute_punch_aggregate

SESSION_CAP_SEC = 10 * 3600
AUTO_CAP_REASON = "Auto punch-out after 10 hr daily cap"
NHQ_LAST_SCAN_REASON = "Biometric last scan (NHQ priority over 10 hr cap)"
BIOMETRIC_LAST_SCAN_REASON = "Biometric last scan (priority over 10 hr cap)"
# Server scheduler close has no live GPS — do not copy punch-in geofence to punch-out.
AUTO_PUNCH_NO_LIVE_GPS = "auto_punch_out_no_live_gps"


def closed_seconds_for_cap(punch_id, open_sess):
    """
    Closed work counted toward the 10h cap for this open segment.

    Each punch-in starts a fresh 10h block from that segment's clock_in. Prior
    closed sessions on the punch (manual or auto) do not reduce remaining time,
    which avoids immediate auto punch-out after re-punch-in.
    """
    # Prior closed work intentionally ignored while a segment is open.
    return 0


def daily_work_seconds(open_sess, now=None):
    """Elapsed time on this open segment (cap is per open session, not cumulative)."""
    now = now or datetime.now()
    if not open_sess or not open_sess.clock_in:
        return 0
    open_secs = int((now - open_sess.clock_in).total_seconds())
    return max(0, open_secs)


def auto_close_deadline(open_sess):
    """Datetime when the open segment reaches the 10h session cap."""
    cin = open_sess.clock_in if open_sess else None
    if not cin:
        return None
    return cin + timedelta(seconds=SESSION_CAP_SEC)


def capped_daily_work_seconds(open_sess, now=None):
    """Open-segment work for display/eligibility, never exceeding SESSION_CAP_SEC."""
    now = now or datetime.now()
    if not open_sess or not open_sess.clock_in:
        return 0
    open_secs = int((now - open_sess.clock_in).total_seconds())
    return min(SESSION_CAP_SEC, max(0, open_secs))


def session_auto_close_deadline(open_sess, now=None):
    """When today's total work (all sessions + this open one) reaches 10 hours."""
    try:
        punch = getattr(open_sess, "punch", None)
        if punch is None and open_sess and open_sess.punch_id:
            punch = Punch.query.get(open_sess.punch_id)
        from .biometric.scope import is_nhq_biometric_open_session

        if is_nhq_biometric_open_session(open_sess, punch):
            cin = getattr(open_sess, "clock_in", None)
            pd = getattr(punch, "punch_date", None) if punch else None
            if cin and pd and cin.date() == pd:
                return None
    except Exception:
        pass
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
    closed_by=None,
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
    # Additive provenance (NULL = legacy web). Do not fail if column missing.
    try:
        if closed_by:
            open_sess.closed_by = closed_by
        elif is_auto and not getattr(open_sess, "closed_by", None):
            open_sess.closed_by = "system"
    except Exception:
        pass
    if punch:
        if lat is not None:
            punch.lat = lat
        if lon is not None:
            punch.lon = lon
        recompute_punch_aggregate(punch)
    return out_time


def _biometric_preferred_clock_out(open_sess, cap_at):
    """
    For biometric-sourced open sessions, prefer last_scan_at when it is after clock_in
    (activity after IN). Still never exceed the 10h cap deadline.

    Returns (clock_out_at, used_last_scan: bool).
    If the only scan is clock_in itself, fall back to normal cap_at.
    """
    if not open_sess or not cap_at:
        return cap_at, False
    src = (getattr(open_sess, "source", None) or "").strip().lower()
    loc_in = (getattr(open_sess, "location_status_in", None) or "").strip().lower()
    loc = (getattr(open_sess, "location_status", None) or "").strip().lower()
    is_bio = src == "biometric" or loc_in == "biometric_device" or loc == "biometric_device"
    if not is_bio:
        return cap_at, False
    try:
        from .biometric.models import BiometricDayState

        punch = getattr(open_sess, "punch", None)
        if punch is None and open_sess.punch_id:
            punch = Punch.query.get(open_sess.punch_id)
        if not punch or not open_sess.clock_in:
            return cap_at, False
        day = BiometricDayState.query.filter_by(
            admin_id=punch.admin_id,
            punch_date=punch.punch_date,
        ).first()
        if not day or not day.last_scan_at:
            return cap_at, False
        if day.last_scan_at > open_sess.clock_in:
            preferred = day.last_scan_at
            if preferred > cap_at:
                return cap_at, False
            return preferred, True
    except Exception:
        return cap_at, False
    return cap_at, False


def _skip_same_day_nhq_biometric_auto_close(open_sess, punch):
    """NHQ biometric same-day sessions finalize at 20:00 IST, not 10h cap."""
    try:
        from .biometric.scope import is_nhq_biometric_open_session

        if not is_nhq_biometric_open_session(open_sess, punch):
            return False
        cin = getattr(open_sess, "clock_in", None)
        pd = getattr(punch, "punch_date", None) if punch else None
        return bool(cin and pd and cin.date() == pd)
    except Exception:
        return False


def _nhq_last_scan_out_at_open_session(open_sess, punch):
    """
    When NHQ biometric hits the 10h cap, close at the last scan after clock-in
    (<= 20:00) instead of the cap time. If no later scan exists, return None
    so the 20:00 finalizer can run.

    Prefers biometric_logs, then biometric_day_state.last_scan_at.
    """
    if open_sess is None or punch is None or not open_sess.clock_in:
        return None
    try:
        from .biometric.finalization import (
            cutoff_datetime_for_date,
            select_last_nhq_scan_on_day,
        )
        from .biometric.models import BiometricDayState

        cutoff = cutoff_datetime_for_date(punch.punch_date)
        out_log = select_last_nhq_scan_on_day(
            punch.admin_id,
            punch.punch_date,
            after=open_sess.clock_in,
            before=cutoff,
        )
        if out_log is not None and out_log.punch_time is not None:
            if out_log.punch_time > open_sess.clock_in:
                return out_log.punch_time

        day = BiometricDayState.query.filter_by(
            admin_id=punch.admin_id,
            punch_date=punch.punch_date,
        ).first()
        if (
            day
            and day.last_scan_at
            and day.last_scan_at > open_sess.clock_in
            and day.last_scan_at <= cutoff
        ):
            return day.last_scan_at
        return None
    except Exception:
        return None


def _nhq_prefer_last_scan_over_cap(open_sess, punch, cap_at):
    """
    NHQ admin + biometric activity that day: prefer last scan over 10h wall time
    for any open session (including web). Never exceeds cap_at.

    Returns (clock_out_at, used_last_scan: bool).
    """
    if not open_sess or not punch or not cap_at or not open_sess.clock_in:
        return cap_at, False
    try:
        from .biometric.scope import is_nhq_admin, _load_admin

        admin = _load_admin(punch.admin_id)
        if not is_nhq_admin(admin):
            return cap_at, False

        preferred = _nhq_last_scan_out_at_open_session(open_sess, punch)
        if preferred is None:
            return cap_at, False
        if preferred <= open_sess.clock_in:
            return cap_at, False
        # Prefer last scan when it is at or before the 10h cap (earlier OUT).
        if preferred > cap_at:
            return cap_at, False
        return preferred, True
    except Exception:
        return cap_at, False


def _close_overdue_session(open_sess, now=None):
    """Close one open session if it is past the 10h cap. Returns True if closed."""
    now = now or datetime.now()
    should_close, reason, out_at = evaluate_auto_close(open_sess, now)
    if not should_close:
        return False

    punch = Punch.query.get(open_sess.punch_id) if open_sess.punch_id else None
    if punch and ensure_punch_sessions_backfill(punch):
        db.session.flush()

    if _skip_same_day_nhq_biometric_auto_close(open_sess, punch):
        # NHQ biometric same-day: last scan wins over 10h; no later scan → wait for 8 PM.
        nhq_out = _nhq_last_scan_out_at_open_session(open_sess, punch)
        if nhq_out is None:
            return False
        out_at = nhq_out
        reason = NHQ_LAST_SCAN_REASON
    else:
        out_at, used_last = _biometric_preferred_clock_out(open_sess, out_at)
        if used_last:
            reason = BIOMETRIC_LAST_SCAN_REASON
        else:
            # NHQ web (or other) open session with machine scans that day.
            out_at, used_nhq = _nhq_prefer_last_scan_over_cap(open_sess, punch, out_at)
            if used_nhq:
                reason = NHQ_LAST_SCAN_REASON

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
        closed_by="system",
    )
    # Mark biometric day state if present
    try:
        src = (getattr(open_sess, "source", None) or "").strip().lower()
        if punch and (
            src == "biometric" or reason in (NHQ_LAST_SCAN_REASON, BIOMETRIC_LAST_SCAN_REASON)
        ):
            from .biometric.models import BiometricDayState

            day = BiometricDayState.query.filter_by(
                admin_id=punch.admin_id,
                punch_date=punch.punch_date,
            ).first()
            if day:
                day.status = "auto_closed"
    except Exception:
        pass
    try:
        from .attendance_realtime.publisher import queue_attendance_updated

        if punch:
            queue_attendance_updated(
                employee_admin_id=punch.admin_id,
                attendance_date=punch.punch_date,
                punch_session_id=open_sess.id,
                source="system",
                event_time=out_at,
            )
    except Exception:
        pass
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


def repair_overlong_sessions_for_punch(punch):
    """
    Cap closed sessions that exceed 10h from their own clock_in
    (e.g. late auto-close stored midnight). Skips sessions with a valid
    manual extended-hours reason.
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
        max_out = sess.clock_in + timedelta(seconds=SESSION_CAP_SEC)
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
        # Align open biometric Check In with machine first scan that day.
        try:
            from .biometric.attendance_bridge import (
                reconcile_open_biometric_clock_in_for_admin,
            )

            if reconcile_open_biometric_clock_in_for_admin(admin_id):
                changed = True
        except Exception:
            pass
        # Overdue cap close: scheduler (no live GPS) or dashboard client punch-out with GPS.
        if changed:
            db.session.commit()
    except Exception:
        db.session.rollback()
        raise
    return changed


def repair_duplicate_open_sessions(*, lookback_days: int = 7) -> dict:
    """
    Safe cleanup: at most one open PunchSession per punch row.

    Keeps the earliest open session (clock_in, then id). Deletes only later
    open duplicates on the same punch_id. Never touches closed sessions or
    punch rows with a single open session.

    Also re-points biometric_logs / biometric_day_state to the kept session id.

    Returns summary: {punch_rows_fixed, sessions_removed, kept_ids, removed_ids}.
    Caller commits.
    """
    from collections import defaultdict
    from datetime import date as date_cls

    summary = {
        "punch_rows_fixed": 0,
        "sessions_removed": 0,
        "kept_ids": [],
        "removed_ids": [],
    }
    if lookback_days < 0:
        lookback_days = 0
    cutoff = date_cls.today() - timedelta(days=lookback_days)

    open_rows = (
        PunchSession.query.join(Punch, PunchSession.punch_id == Punch.id)
        .filter(
            PunchSession.clock_out.is_(None),
            Punch.punch_date >= cutoff,
        )
        .order_by(PunchSession.clock_in.asc(), PunchSession.id.asc())
        .all()
    )
    by_punch: dict = defaultdict(list)
    for sess in open_rows:
        by_punch[sess.punch_id].append(sess)

    for punch_id, opens in by_punch.items():
        if len(opens) < 2:
            continue
        # Deterministic keep: earliest clock_in, then lowest id
        opens_sorted = sorted(
            opens,
            key=lambda s: (
                s.clock_in or datetime.max,
                s.id or 0,
            ),
        )
        keep = opens_sorted[0]
        remove = opens_sorted[1:]
        remove_ids = [s.id for s in remove if s.id is not None]
        if not remove_ids:
            continue

        try:
            from .biometric.models import BiometricDayState, BiometricLog

            BiometricLog.query.filter(
                BiometricLog.punch_session_id.in_(remove_ids)
            ).update(
                {BiometricLog.punch_session_id: keep.id},
                synchronize_session=False,
            )
            BiometricDayState.query.filter(
                BiometricDayState.punch_session_id.in_(remove_ids)
            ).update(
                {BiometricDayState.punch_session_id: keep.id},
                synchronize_session=False,
            )
        except Exception:
            # Biometric tables may be absent in some test stubs — session delete still OK.
            pass

        for sess in remove:
            db.session.delete(sess)

        punch = Punch.query.get(punch_id)
        if punch:
            recompute_punch_aggregate(punch)

        summary["punch_rows_fixed"] += 1
        summary["sessions_removed"] += len(remove_ids)
        summary["kept_ids"].append(keep.id)
        summary["removed_ids"].extend(remove_ids)

    return summary
