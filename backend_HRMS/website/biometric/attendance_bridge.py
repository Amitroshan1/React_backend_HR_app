"""
Biometric → PunchSession bridge (Phase 3C).

Translates stored biometric_logs into existing attendance using:
  - device_user_id exact match to Admin.emp_id → Admin.id
  - BiometricEmployeeMap as consistency check (cannot override Admin.emp_id)
  - open_punch_session_for_admin / Punch / PunchSession
  - recompute_punch_aggregate
  - is_on_leave (same as web)

Does NOT call auth.punch_in / auth.punch_out.
Does NOT apply geo-fence.
Does NOT interpret device state as IN/OUT.
Does NOT close sessions on subsequent scans (OUT via web, 20:00 NHQ finalizer,
or 10h auto-close for non-NHQ). Same-day reconnect bursts never open a second
session; cross-day stale opens are closed before a new IN.
"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Optional

from sqlalchemy.exc import IntegrityError

from .. import db
from .mapping import resolve_admin_for_device_user
from .models import (
    BiometricDayState,
    BiometricDevice,
    BiometricLog,
)

logger = logging.getLogger(__name__)

SOURCE_BIOMETRIC = "biometric"
SOURCE_WEB = "web"
MAX_SESSIONS_PER_DAY = 8

# Terminal statuses — do not re-process
_DONE_STATUSES = frozenset(
    {
        "processed",
        "ignored_open_web_session",
        "ignored_open_session",
        "unknown_employee",
        "invalid_mapping",
        "ambiguous_employee_mapping",
        "employee_inactive",
        "duplicate",
        "failed",
        "ignored",
        "ignored_day_closed",
        "unknown_device",
        "unmapped_permanent",
    }
)


def resolve_admin_id(
    device_user_id: str,
    *,
    device_id: Optional[int] = None,
) -> Optional[int]:
    """
    Map eSSL User ID → Admin.id via exact Admin.emp_id match.
    Returns None when unknown/invalid/inactive (see resolve_biometric_employee).
    """
    result = resolve_admin_for_device_user(device_user_id, device_id=device_id)
    return result.admin_id if result.ok else None


def _session_source(sess) -> str:
    raw = (getattr(sess, "source", None) or "").strip().lower()
    return raw or SOURCE_WEB


def _is_web_session(sess) -> bool:
    return _session_source(sess) == SOURCE_WEB


def _is_biometric_session(sess) -> bool:
    return _session_source(sess) == SOURCE_BIOMETRIC


def _looks_like_biometric_session(sess) -> bool:
    """
    True when session is biometric by source, or by device location markers.

    Covers reconnect/race rows where source failed to persist but
    location_status*_in was set to biometric_device at open.
    """
    if _is_biometric_session(sess):
        return True
    for attr in ("location_status_in", "location_status"):
        loc = (getattr(sess, attr, None) or "").strip().lower()
        if loc == "biometric_device":
            return True
    return False


def _earliest_machine_scan_at(admin_id: int, punch_date) -> Optional[datetime]:
    """
    Earliest device punch_time for this employee on the attendance calendar day.

    Includes ignored / not-applied logs that still carry a real machine time so
    Check In follows the machine first scan, not only the first applied scan.
    """
    if not admin_id or punch_date is None:
        return None
    start = datetime.combine(punch_date, datetime.min.time())
    end = datetime.combine(punch_date, datetime.max.time())
    row = (
        BiometricLog.query.filter(
            BiometricLog.admin_id == admin_id,
            BiometricLog.punch_time.isnot(None),
            BiometricLog.punch_time >= start,
            BiometricLog.punch_time <= end,
        )
        .order_by(BiometricLog.punch_time.asc(), BiometricLog.id.asc())
        .first()
    )
    return row.punch_time if row else None


def _reconcile_clock_in_to_earliest_scan(
    open_sess,
    admin_id: int,
    punch_date,
    *,
    candidate: Optional[datetime] = None,
) -> bool:
    """
    Force open-session clock_in to the earliest machine scan that day.

    Returns True when clock_in was moved earlier.
    """
    if open_sess is None or getattr(open_sess, "clock_out", None) is not None:
        return False

    earliest = _earliest_machine_scan_at(admin_id, punch_date)
    if candidate is not None:
        earliest = candidate if earliest is None else min(earliest, candidate)
    if earliest is None:
        return False

    prev = open_sess.clock_in
    if prev is not None and earliest >= prev:
        return False

    open_sess.clock_in = earliest
    punch = getattr(open_sess, "punch", None)
    if punch is None and open_sess.punch_id:
        from ..models.attendance import Punch

        punch = Punch.query.get(open_sess.punch_id)
    if punch is not None:
        from ..punch_aggregate import recompute_punch_aggregate

        recompute_punch_aggregate(punch)
    _upsert_day_state(
        admin_id=admin_id,
        punch_date=punch_date,
        punch_session_id=open_sess.id,
        scan_at=earliest,
    )
    logger.info(
        "BIOMETRIC_CLOCK_IN_EARLIEST_SCAN admin_id=%s session_id=%s prev_in=%s "
        "new_in=%s",
        admin_id,
        getattr(open_sess, "id", None),
        prev.isoformat() if prev else None,
        earliest.isoformat(),
    )
    return True


def reconcile_open_biometric_clock_in_for_admin(admin_id: int) -> bool:
    """
    Dashboard / repair hook: rewind open biometric clock_in to machine first scan.
    """
    if not admin_id:
        return False
    from ..punch_aggregate import open_punch_session_for_admin

    open_sess = open_punch_session_for_admin(admin_id)
    if open_sess is None or not _looks_like_biometric_session(open_sess):
        return False
    punch_date = _session_punch_date(open_sess)
    if punch_date is None and open_sess.clock_in:
        punch_date = open_sess.clock_in.date()
    if punch_date is None:
        return False
    return _reconcile_clock_in_to_earliest_scan(open_sess, admin_id, punch_date)


def _open_biometric_session_for_day(admin_id: int, punch_date):
    """
    Open PunchSession scoped to admin + calendar punch_date only.

    Does not replace open_punch_session_for_admin (web / night-shift global behavior).
    """
    from ..models.attendance import Punch, PunchSession

    return (
        PunchSession.query.join(Punch, PunchSession.punch_id == Punch.id)
        .filter(
            Punch.admin_id == admin_id,
            Punch.punch_date == punch_date,
            PunchSession.clock_out.is_(None),
        )
        .order_by(PunchSession.clock_in.desc())
        .first()
    )


def _session_punch_date(sess) -> Optional[object]:
    punch = getattr(sess, "punch", None)
    if punch is not None and getattr(punch, "punch_date", None):
        return punch.punch_date
    clock_in = getattr(sess, "clock_in", None)
    if clock_in:
        return clock_in.date()
    return None


def _ignore_open_web_session(log: BiometricLog, open_sess, *, detail: Optional[str] = None) -> str:
    log.status = "ignored_open_web_session"
    log.punch_session_id = getattr(open_sess, "id", None)
    log.error_message = (detail or None)
    if log.error_message:
        log.error_message = str(log.error_message)[:500]
    logger.info(
        "BIOMETRIC_IGNORED_OPEN_WEB admin_id=%s session_id=%s log_id=%s detail=%s",
        log.admin_id,
        getattr(open_sess, "id", None),
        log.id,
        detail,
    )
    return log.status


def _nhq_scope_for_log(
    admin_id: int,
    log: BiometricLog,
    *,
    device_serial: Optional[str] = None,
) -> bool:
    from .scope import is_nhq_biometric_scope, _load_admin

    admin = _load_admin(admin_id)
    serial = device_serial or getattr(log, "device_serial_number", None)
    return is_nhq_biometric_scope(admin, serial)


def _supersede_same_day_open_web(
    *,
    log: BiometricLog,
    admin_id: int,
    punch_date,
    punch_time: datetime,
    open_sess,
    device_serial: Optional[str] = None,
) -> Optional[str]:
    """
    Fix #5: convert same-day open web session into biometric IN (all circles).

    clock_in becomes the earlier of web IN and this scan (Fix #6 earliest presence).
    Returns a terminal log status when converted; None if not applicable.
    """
    if open_sess is None or open_sess.clock_out is not None:
        return None
    if _looks_like_biometric_session(open_sess):
        return None

    sess_date = _session_punch_date(open_sess)
    clock_day = open_sess.clock_in.date() if open_sess.clock_in else None
    same_day = (sess_date == punch_date) or (clock_day == punch_date)
    if not same_day:
        return None

    from ..punch_aggregate import recompute_punch_aggregate

    prev_in = open_sess.clock_in
    if prev_in is not None and punch_time is not None:
        open_sess.clock_in = min(prev_in, punch_time)
    else:
        open_sess.clock_in = punch_time
    try:
        open_sess.source = SOURCE_BIOMETRIC
    except Exception:
        pass
    open_sess.is_wfh = False
    open_sess.lat = None
    open_sess.lon = None
    open_sess.location_status = "biometric_device"
    open_sess.location_status_in = "biometric_device"
    open_sess.location_status_out = None
    nhq = _nhq_scope_for_log(admin_id, log, device_serial=device_serial)
    open_sess.repeat_reason = (
        "nhq_biometric_overrides_web" if nhq else "biometric_overrides_web"
    )
    try:
        open_sess.extended_hours_reason = None
    except Exception:
        pass

    punch = getattr(open_sess, "punch", None)
    if punch is None and open_sess.punch_id:
        from ..models.attendance import Punch

        punch = Punch.query.get(open_sess.punch_id)

    # Prefer machine first scan that day over web IN / this scan alone.
    _reconcile_clock_in_to_earliest_scan(
        open_sess, admin_id, punch_date, candidate=punch_time
    )

    _upsert_day_state(
        admin_id=admin_id,
        punch_date=punch_date,
        punch_session_id=open_sess.id,
        scan_at=punch_time,
    )
    # Ensure day-state first_scan reflects earliest IN after possible rewind.
    if open_sess.clock_in is not None:
        _upsert_day_state(
            admin_id=admin_id,
            punch_date=punch_date,
            punch_session_id=open_sess.id,
            scan_at=open_sess.clock_in,
        )
    if punch is not None:
        recompute_punch_aggregate(punch)

    log.status = "processed"
    log.punch_session_id = open_sess.id
    log.error_message = None
    logger.info(
        "BIOMETRIC_OVERRIDES_WEB_OPEN admin_id=%s session_id=%s prev_web_in=%s "
        "bio_in=%s log_id=%s nhq=%s",
        admin_id,
        open_sess.id,
        prev_in.isoformat() if prev_in else None,
        open_sess.clock_in.isoformat() if open_sess.clock_in else None,
        log.id,
        nhq,
    )
    try:
        from ..attendance_realtime.publisher import queue_attendance_updated

        queue_attendance_updated(
            employee_admin_id=admin_id,
            attendance_date=punch_date,
            punch_session_id=open_sess.id,
            source="biometric",
            event_time=punch_time,
        )
    except Exception:
        logger.exception("ATTENDANCE_SSE_QUEUE_FAILED override_web_in")
    return log.status


# Back-compat alias for older imports / tests.
_supersede_same_day_open_web_for_nhq = _supersede_same_day_open_web


def _apply_nhq_scan_to_closed_biometric_out(
    *,
    log: BiometricLog,
    admin_id: int,
    punch_date,
    punch_time: datetime,
    device_serial: Optional[str] = None,
) -> Optional[str]:
    """
    NHQ hard priority: after web (or system) closed a biometric session, a later
    machine scan still updates punch-out to the last scan (does not open a new IN).
    """
    if not _nhq_scope_for_log(admin_id, log, device_serial=device_serial):
        return None

    from ..models.attendance import Punch, PunchSession
    from ..punch_aggregate import recompute_punch_aggregate

    punch = Punch.query.filter_by(admin_id=admin_id, punch_date=punch_date).first()
    if punch is None:
        return None

    closed_bio = (
        PunchSession.query.filter(
            PunchSession.punch_id == punch.id,
            PunchSession.clock_out.isnot(None),
        )
        .order_by(PunchSession.clock_in.desc())
        .all()
    )
    target = next((s for s in closed_bio if _looks_like_biometric_session(s)), None)
    if target is None or not target.clock_in:
        return None
    if punch_time <= target.clock_in:
        return None

    # Always move OUT forward to last scan (overrides web-closed OUT).
    if target.clock_out is not None and punch_time <= target.clock_out:
        # Still record activity on day state / log for idempotent later finalizers.
        _upsert_day_state(
            admin_id=admin_id,
            punch_date=punch_date,
            punch_session_id=target.id,
            scan_at=punch_time,
        )
        log.status = "processed"
        log.punch_session_id = target.id
        log.error_message = "activity_after_out"
        return log.status

    prev_out = target.clock_out
    target.clock_out = punch_time
    target.auto_punched_out = False
    try:
        target.closed_by = "biometric"
    except Exception:
        pass
    try:
        target.extended_hours_reason = "NHQ biometric last scan overrides prior punch-out"
    except Exception:
        pass

    state = BiometricDayState.query.filter_by(
        admin_id=admin_id, punch_date=punch_date
    ).first()
    if state is None:
        state = BiometricDayState(
            admin_id=admin_id,
            punch_date=punch_date,
            punch_session_id=target.id,
            first_scan_at=target.clock_in,
            last_scan_at=punch_time,
            status="open",
        )
        db.session.add(state)
    else:
        state.punch_session_id = target.id
        if state.first_scan_at is None or target.clock_in < state.first_scan_at:
            state.first_scan_at = target.clock_in
        if state.last_scan_at is None or punch_time > state.last_scan_at:
            state.last_scan_at = punch_time

    recompute_punch_aggregate(punch)
    log.status = "processed"
    log.punch_session_id = target.id
    log.error_message = None
    logger.info(
        "BIOMETRIC_OVERRIDES_WEB_OUT admin_id=%s session_id=%s prev_out=%s "
        "new_out=%s log_id=%s",
        admin_id,
        target.id,
        prev_out.isoformat() if prev_out else None,
        punch_time.isoformat(),
        log.id,
    )
    try:
        from ..attendance_realtime.publisher import queue_attendance_updated

        queue_attendance_updated(
            employee_admin_id=admin_id,
            attendance_date=punch_date,
            punch_session_id=target.id,
            source="biometric",
            event_time=punch_time,
        )
    except Exception:
        logger.exception("ATTENDANCE_SSE_QUEUE_FAILED nhq_override_out")
    return log.status


def _ignore_open_prior_session(log: BiometricLog, open_sess, *, detail: str) -> str:
    """Hard guard: never open a second session while another remains open."""
    log.status = "ignored_open_session"
    log.punch_session_id = getattr(open_sess, "id", None)
    log.error_message = (detail or "open_session_blocks_new_in")[:500]
    logger.info(
        "BIOMETRIC_IGNORED_OPEN_SESSION admin_id=%s session_id=%s log_id=%s detail=%s",
        log.admin_id,
        getattr(open_sess, "id", None),
        log.id,
        detail,
    )
    return log.status


def _force_close_stale_open_session(open_sess, *, punch_time: datetime) -> bool:
    """
    Last-resort close for a prior-day open biometric session so a new calendar
    day can open IN without leaving two concurrent open sessions.

    Prefer day-state last_scan_at, else NHQ 20:00 cutoff, else clock_in.
    """
    if open_sess is None or open_sess.clock_out is not None:
        return False
    from ..models.attendance import Punch
    from ..punch_auto_close import AUTO_PUNCH_NO_LIVE_GPS, close_punch_session

    punch = getattr(open_sess, "punch", None)
    if punch is None and open_sess.punch_id:
        punch = Punch.query.get(open_sess.punch_id)
    if punch is None or not open_sess.clock_in:
        return False

    out_at = None
    day = BiometricDayState.query.filter_by(
        admin_id=punch.admin_id,
        punch_date=punch.punch_date,
    ).first()
    if day and day.last_scan_at and day.last_scan_at > open_sess.clock_in:
        out_at = day.last_scan_at
    if out_at is None:
        try:
            from .finalization import cutoff_datetime_for_date

            cut = cutoff_datetime_for_date(punch.punch_date)
            if cut > open_sess.clock_in:
                out_at = cut
        except Exception:
            out_at = None
    if out_at is None:
        out_at = open_sess.clock_in

    close_punch_session(
        open_sess,
        punch,
        is_auto=True,
        location_status_out=AUTO_PUNCH_NO_LIVE_GPS,
        clock_out_at=out_at,
        closed_by="system",
        extended_hours_reason="Stale biometric session closed before new-day punch-in",
    )
    db.session.flush()
    logger.info(
        "BIOMETRIC_STALE_SESSION_FORCE_CLOSED session_id=%s admin_id=%s out=%s "
        "triggered_by=%s",
        open_sess.id,
        punch.admin_id,
        out_at.isoformat() if out_at else None,
        punch_time.isoformat(),
    )
    return open_sess.clock_out is not None


def _handle_existing_open_session(
    *,
    log: BiometricLog,
    admin_id: int,
    punch_date,
    punch_time: datetime,
    device_serial: Optional[str] = None,
) -> Optional[str]:
    """
    Enforce at most one open PunchSession per employee.

    Returns a terminal log status when the scan was fully handled
    (subsequent activity, ignored, etc). Returns None only when it is
    safe to open a new biometric IN (no open session remains).

    Fix #5: same-day open web is always superseded by biometric (all circles).
    Cross-day open web is force-closed so a new biometric IN can proceed.
    """
    from ..punch_aggregate import open_punch_session_for_admin

    global_open = open_punch_session_for_admin(admin_id)
    day_open = _open_biometric_session_for_day(admin_id, punch_date)
    open_sess = global_open or day_open
    if open_sess is None:
        return None

    # Prefer the same-calendar-day open row when both exist (reconnect burst).
    if (
        day_open is not None
        and global_open is not None
        and getattr(day_open, "id", None) != getattr(global_open, "id", None)
    ):
        open_sess = day_open

    if not _looks_like_biometric_session(open_sess):
        overridden = _supersede_same_day_open_web(
            log=log,
            admin_id=admin_id,
            punch_date=punch_date,
            punch_time=punch_time,
            open_sess=open_sess,
            device_serial=device_serial,
        )
        if overridden is not None:
            return overridden
        # Cross-day open web: close it, then allow new biometric IN.
        closed = _force_close_stale_open_session(open_sess, punch_time=punch_time)
        db.session.flush()
        if closed or open_sess.clock_out is not None:
            still_open = open_punch_session_for_admin(admin_id)
            if still_open is None:
                return None
            if _looks_like_biometric_session(still_open):
                open_sess = still_open
            else:
                return _ignore_open_web_session(
                    log,
                    still_open,
                    detail=f"open_session_source={_session_source(still_open)}",
                )
        else:
            return _ignore_open_web_session(
                log,
                open_sess,
                detail=f"open_session_source={_session_source(open_sess)}",
            )

    sess_date = _session_punch_date(open_sess)
    clock_day = open_sess.clock_in.date() if open_sess.clock_in else None
    same_day = (sess_date == punch_date) or (clock_day == punch_date)

    if same_day:
        return _process_subsequent_biometric_scan(
            log=log,
            admin_id=admin_id,
            punch_date=punch_date,
            punch_time=punch_time,
            open_sess=open_sess,
        )

    closed = _maybe_close_stale_biometric_session(open_sess, now=punch_time)
    db.session.flush()
    if open_sess.clock_out is None:
        closed = _force_close_stale_open_session(open_sess, punch_time=punch_time)
    if not closed and open_sess.clock_out is None:
        # Should be unreachable; refuse second open rather than corrupt attendance.
        return _ignore_open_prior_session(
            log,
            open_sess,
            detail=f"open_prior_day_session date={sess_date}",
        )

    # Prior day closed — ensure nothing else is still open before new IN.
    still_open = open_punch_session_for_admin(admin_id)
    if still_open is not None:
        still_date = _session_punch_date(still_open)
        still_clock_day = still_open.clock_in.date() if still_open.clock_in else None
        if still_date == punch_date or still_clock_day == punch_date:
            return _process_subsequent_biometric_scan(
                log=log,
                admin_id=admin_id,
                punch_date=punch_date,
                punch_time=punch_time,
                open_sess=still_open,
            )
        return _ignore_open_prior_session(
            log,
            still_open,
            detail=f"open_session_remains date={still_date}",
        )
    return None


def _maybe_close_stale_biometric_session(open_sess, *, now: Optional[datetime] = None) -> bool:
    """
    Close a cross-day stale biometric session.

    NHQ biometric: finalize using that day's 20:00 IST cutoff (catch-up safe).
    Other biometric: existing 10h cap when overdue.
    """
    if open_sess is None or not _looks_like_biometric_session(open_sess):
        return False

    now = now or datetime.now()
    punch = getattr(open_sess, "punch", None)
    if punch is None and open_sess.punch_id:
        from ..models.attendance import Punch

        punch = Punch.query.get(open_sess.punch_id)

    from .finalization import try_finalize_stale_nhq_session

    if punch and try_finalize_stale_nhq_session(open_sess, punch):
        logger.info(
            "BIOMETRIC_STALE_SESSION_FINALIZED session_id=%s admin_id=%s",
            open_sess.id,
            getattr(punch, "admin_id", None),
        )
        db.session.flush()
        return True

    from ..punch_auto_close import _close_overdue_session, evaluate_auto_close

    should_close, _, _ = evaluate_auto_close(open_sess, now)
    if not should_close:
        return False
    closed = _close_overdue_session(open_sess, now=now)
    if closed:
        logger.info(
            "BIOMETRIC_STALE_SESSION_AUTO_CLOSED session_id=%s admin_id=%s",
            open_sess.id,
            getattr(getattr(open_sess, "punch", None), "admin_id", None),
        )
    return closed


def _nhq_day_blocks_new_session(
    admin_id: int,
    punch_date,
    device_serial: Optional[str],
) -> bool:
    """
    NHQ biometric: do not open a new session after day finalized or biometric OUT closed.
    """
    from .scope import is_nhq_biometric_scope, _load_admin

    admin = _load_admin(admin_id)
    if not is_nhq_biometric_scope(admin, device_serial):
        return False

    state = BiometricDayState.query.filter_by(
        admin_id=admin_id, punch_date=punch_date
    ).first()
    if state is not None and (state.status or "").strip() == "finalized":
        return True

    from ..models.attendance import Punch, PunchSession

    punch = Punch.query.filter_by(admin_id=admin_id, punch_date=punch_date).first()
    if punch is None:
        return False
    closed_bio = (
        PunchSession.query.filter(
            PunchSession.punch_id == punch.id,
            PunchSession.clock_out.isnot(None),
        )
        .all()
    )
    return any(_is_biometric_session(s) for s in closed_bio)


def _ignore_nhq_closed_day_scan(
    log: BiometricLog,
    *,
    admin_id: int,
    reason: str,
    punch_session_id: Optional[int] = None,
) -> str:
    log.admin_id = admin_id
    log.status = "ignored_day_closed"
    log.error_message = reason[:500]
    log.punch_session_id = punch_session_id
    logger.info(
        "BIOMETRIC_IGNORED_DAY_CLOSED admin_id=%s log_id=%s reason=%s",
        admin_id,
        log.id,
        reason,
    )
    return log.status


def _process_subsequent_biometric_scan(
    *,
    log: BiometricLog,
    admin_id: int,
    punch_date,
    punch_time: datetime,
    open_sess,
) -> str:
    """Same-calendar-day subsequent scan: update day state; rewind IN if earlier (Fix #6)."""
    state = BiometricDayState.query.filter_by(
        admin_id=admin_id, punch_date=punch_date
    ).first()
    if state is not None and (state.status or "").strip() == "finalized":
        # NHQ: still allow last-scan OUT bump on the closed biometric session.
        overridden = _apply_nhq_scan_to_closed_biometric_out(
            log=log,
            admin_id=admin_id,
            punch_date=punch_date,
            punch_time=punch_time,
            device_serial=getattr(log, "device_serial_number", None),
        )
        if overridden is not None:
            return overridden
        return _ignore_nhq_closed_day_scan(
            log,
            admin_id=admin_id,
            reason="day_finalized",
            punch_session_id=getattr(open_sess, "id", None),
        )

    day_key = punch_date
    rewound = _reconcile_clock_in_to_earliest_scan(
        open_sess, admin_id, punch_date, candidate=punch_time
    )

    _upsert_day_state(
        admin_id=admin_id,
        punch_date=day_key,
        punch_session_id=open_sess.id,
        scan_at=punch_time,
    )
    log.status = "processed"
    log.punch_session_id = open_sess.id
    log.error_message = "clock_in_rewound" if rewound else None
    logger.info(
        "BIOMETRIC_SCAN_ACTIVITY admin_id=%s session_id=%s last_scan=%s "
        "rewound=%s log_id=%s",
        admin_id,
        open_sess.id,
        punch_time.isoformat(),
        rewound,
        log.id,
    )
    try:
        from ..attendance_realtime.publisher import queue_attendance_updated

        queue_attendance_updated(
            employee_admin_id=admin_id,
            attendance_date=day_key,
            punch_session_id=open_sess.id,
            source="biometric",
            event_time=punch_time,
        )
    except Exception:
        logger.exception("ATTENDANCE_SSE_QUEUE_FAILED subsequent")
    return log.status

def _get_or_create_punch(admin_id: int, punch_date):
    from ..models.attendance import Punch

    punch = (
        Punch.query.filter_by(admin_id=admin_id, punch_date=punch_date)
        .with_for_update()
        .first()
    )
    if punch:
        return punch
    punch = Punch(admin_id=admin_id, punch_date=punch_date)
    try:
        with db.session.begin_nested():
            db.session.add(punch)
            db.session.flush()
    except IntegrityError:
        punch = (
            Punch.query.filter_by(admin_id=admin_id, punch_date=punch_date)
            .with_for_update()
            .first()
        )
        if not punch:
            raise
    return punch


def _upsert_day_state(
    *,
    admin_id: int,
    punch_date,
    punch_session_id: int,
    scan_at: datetime,
) -> BiometricDayState:
    scan_date = scan_at.date() if scan_at else None
    if scan_date is not None and punch_date != scan_date:
        logger.warning(
            "BIOMETRIC_DAY_STATE_DATE_MISMATCH admin_id=%s punch_date=%s scan_date=%s",
            admin_id,
            punch_date,
            scan_date,
        )
        punch_date = scan_date

    state = (
        BiometricDayState.query.filter_by(admin_id=admin_id, punch_date=punch_date)
        .with_for_update()
        .first()
    )
    if state is None:
        state = BiometricDayState(
            admin_id=admin_id,
            punch_date=punch_date,
            punch_session_id=punch_session_id,
            first_scan_at=scan_at,
            last_scan_at=scan_at,
            status="open",
        )
        try:
            with db.session.begin_nested():
                db.session.add(state)
                db.session.flush()
        except IntegrityError:
            state = (
                BiometricDayState.query.filter_by(
                    admin_id=admin_id, punch_date=punch_date
                )
                .with_for_update()
                .first()
            )
            if state is None:
                raise
    if (state.status or "").strip() == "finalized":
        return state
    if scan_at < state.first_scan_at:
        state.first_scan_at = scan_at
    if scan_at > state.last_scan_at:
        state.last_scan_at = scan_at
    state.punch_session_id = punch_session_id
    return state


def process_biometric_log(
    log: BiometricLog,
    *,
    device: Optional[BiometricDevice] = None,
) -> str:
    """
    Process one biometric_logs row into attendance (or mark ignored/unknown).

    Returns final status string.
    Caller owns the surrounding transaction/commit.
    """
    if not log or not log.id:
        return "failed"

    if (log.status or "").strip() in _DONE_STATUSES:
        return log.status

    if log.status != "received":
        return log.status

    pin = (log.device_user_id or "").strip()
    punch_time = log.punch_time
    if not pin or punch_time is None:
        log.status = "failed"
        log.error_message = (log.error_message or "missing_pin_or_time")[:500]
        return log.status

    device_id = device.id if device is not None else None
    if device_id is None and log.device_serial_number:
        dev = BiometricDevice.query.filter_by(
            serial_number=log.device_serial_number
        ).first()
        device_id = dev.id if dev else None

    resolution = resolve_admin_for_device_user(pin, device_id=device_id)
    if not resolution.ok:
        log.status = resolution.status or "unknown_employee"
        log.admin_id = resolution.admin_id
        log.punch_session_id = None
        log.error_message = (resolution.error_message or resolution.status or "")[:500]
        logger.info(
            "BIOMETRIC_MAPPING_REJECTED pin=%s sn=%s log_id=%s status=%s err=%s",
            pin,
            log.device_serial_number,
            log.id,
            log.status,
            log.error_message,
        )
        return log.status

    admin_id = resolution.admin_id
    assert admin_id is not None

    from ..models.attendance import PunchSession
    from ..punch_aggregate import recompute_punch_aggregate
    from ..utility import is_on_leave

    log.admin_id = admin_id
    punch_date = punch_time.date()
    device_serial = log.device_serial_number or (
        getattr(device, "serial_number", None) if device else None
    )

    if _nhq_day_blocks_new_session(admin_id, punch_date, device_serial):
        overridden = _apply_nhq_scan_to_closed_biometric_out(
            log=log,
            admin_id=admin_id,
            punch_date=punch_date,
            punch_time=punch_time,
            device_serial=device_serial,
        )
        if overridden is not None:
            return overridden
        return _ignore_nhq_closed_day_scan(
            log, admin_id=admin_id, reason="day_closed"
        )

    # Same leave gate as web punch-in (full-day blocks; half-day allowed)
    if is_on_leave(admin_id, punch_date):
        log.status = "ignored"
        log.error_message = "on_leave"
        logger.info(
            "BIOMETRIC_IGNORED_LEAVE admin_id=%s date=%s log_id=%s",
            admin_id,
            punch_date,
            log.id,
        )
        return log.status

    # Fast path: attach to / respect any existing open session (no new IN).
    handled = _handle_existing_open_session(
        log=log,
        admin_id=admin_id,
        punch_date=punch_date,
        punch_time=punch_time,
        device_serial=device_serial,
    )
    if handled is not None:
        return handled

    # Serialize creates on the punch row (reconnect bursts / multi-worker).
    punch = _get_or_create_punch(admin_id, punch_date)

    # Re-check under punch lock: another worker may have opened IN first.
    handled = _handle_existing_open_session(
        log=log,
        admin_id=admin_id,
        punch_date=punch_date,
        punch_time=punch_time,
        device_serial=device_serial,
    )
    if handled is not None:
        return handled

    closed_count = (
        PunchSession.query.filter(
            PunchSession.punch_id == punch.id,
            PunchSession.clock_out.isnot(None),
        ).count()
    )
    if closed_count >= MAX_SESSIONS_PER_DAY:
        log.status = "failed"
        log.error_message = "max_sessions_per_day"
        return log.status

    # Prefer earliest machine scan that day (covers earlier ignored/not-applied rows).
    clock_in_at = punch_time
    earliest = _earliest_machine_scan_at(admin_id, punch_date)
    if earliest is not None:
        clock_in_at = min(earliest, punch_time)

    sess = PunchSession(
        punch_id=punch.id,
        clock_in=clock_in_at,
        clock_out=None,
        repeat_reason="biometric" if closed_count > 0 else None,
        is_wfh=False,
        lat=None,
        lon=None,
        location_status="biometric_device",
        location_status_in="biometric_device",
        location_status_out=None,
    )
    try:
        sess.source = SOURCE_BIOMETRIC
    except Exception:
        logger.exception(
            "BIOMETRIC_SOURCE_SET_FAILED admin_id=%s punch_id=%s log_id=%s",
            admin_id,
            punch.id,
            log.id,
        )

    db.session.add(sess)
    db.session.flush()

    # Final hard guard: if another open row appeared (reconnect burst), keep the
    # earliest IN and treat this scan as subsequent activity on that row.
    from ..models.attendance import Punch

    other_open = (
        PunchSession.query.join(Punch, PunchSession.punch_id == Punch.id)
        .filter(
            Punch.admin_id == admin_id,
            PunchSession.clock_out.is_(None),
            PunchSession.id != sess.id,
        )
        .order_by(PunchSession.clock_in.asc())
        .first()
    )
    if other_open is not None:
        db.session.delete(sess)
        db.session.flush()
        logger.warning(
            "BIOMETRIC_DUPLICATE_OPEN_PREVENTED admin_id=%s kept_session=%s "
            "discarded_clock_in=%s log_id=%s",
            admin_id,
            other_open.id,
            punch_time.isoformat(),
            log.id,
        )
        return _process_subsequent_biometric_scan(
            log=log,
            admin_id=admin_id,
            punch_date=punch_date,
            punch_time=punch_time,
            open_sess=other_open,
        )

    _upsert_day_state(
        admin_id=admin_id,
        punch_date=punch_date,
        punch_session_id=sess.id,
        scan_at=clock_in_at,
    )
    recompute_punch_aggregate(punch)

    log.status = "processed"
    log.punch_session_id = sess.id
    log.error_message = (
        "clock_in_from_earlier_scan" if clock_in_at < punch_time else None
    )
    logger.info(
        "BIOMETRIC_SESSION_OPENED admin_id=%s session_id=%s clock_in=%s "
        "scan_at=%s log_id=%s",
        admin_id,
        sess.id,
        clock_in_at.isoformat(),
        punch_time.isoformat(),
        log.id,
    )
    try:
        from ..attendance_realtime.publisher import queue_attendance_updated

        queue_attendance_updated(
            employee_admin_id=admin_id,
            attendance_date=punch_date,
            punch_session_id=sess.id,
            source="biometric",
            event_time=punch_time,
        )
    except Exception:
        logger.exception("ATTENDANCE_SSE_QUEUE_FAILED open")
    return log.status


def process_received_logs_for_device(
    *,
    device: BiometricDevice,
    log_ids: list,
) -> None:
    """Process a batch of newly stored log ids (same transaction as ingest)."""
    for lid in log_ids:
        row = db.session.get(BiometricLog, lid)
        if not row:
            continue
        try:
            process_biometric_log(row, device=device)
        except Exception:
            logger.exception(
                "BIOMETRIC_BRIDGE_ERROR log_id=%s sn=%s",
                lid,
                getattr(device, "serial_number", None),
            )
            if row.status == "received":
                row.status = "failed"
                row.error_message = "bridge_exception"
        try:
            from .day_rollup import upsert_attendance_day_from_log

            upsert_attendance_day_from_log(row)
        except Exception:
            logger.exception(
                "BIOMETRIC_DAY_ROLLUP_ERROR log_id=%s sn=%s",
                lid,
                getattr(device, "serial_number", None),
            )
