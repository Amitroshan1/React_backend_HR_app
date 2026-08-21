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
Does NOT close sessions on subsequent scans (OUT via web, 20:00 NHQ finalizer, or 10h auto-close for non-NHQ).
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
        "unknown_employee",
        "invalid_mapping",
        "ambiguous_employee_mapping",
        "employee_inactive",
        "duplicate",
        "failed",
        "ignored",
        "ignored_day_closed",
        "unknown_device",
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


def _open_biometric_session_for_day(admin_id: int, punch_date):
    """
    Open biometric PunchSession scoped to admin + calendar punch_date only.

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


def _maybe_close_stale_biometric_session(open_sess, *, now: Optional[datetime] = None) -> bool:
    """
    Close a cross-day stale biometric session.

    NHQ biometric: finalize using that day's 20:00 IST cutoff (catch-up safe).
    Other biometric: existing 10h cap when overdue.
    """
    if open_sess is None or not _is_biometric_session(open_sess):
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
    """Same-calendar-day subsequent scan: update day state only."""
    state = BiometricDayState.query.filter_by(
        admin_id=admin_id, punch_date=punch_date
    ).first()
    if state is not None and (state.status or "").strip() == "finalized":
        return _ignore_nhq_closed_day_scan(
            log,
            admin_id=admin_id,
            reason="day_finalized",
            punch_session_id=getattr(open_sess, "id", None),
        )

    day_key = punch_date
    _upsert_day_state(
        admin_id=admin_id,
        punch_date=day_key,
        punch_session_id=open_sess.id,
        scan_at=punch_time,
    )
    log.status = "processed"
    log.punch_session_id = open_sess.id
    log.error_message = None
    logger.info(
        "BIOMETRIC_SCAN_ACTIVITY admin_id=%s session_id=%s last_scan=%s log_id=%s",
        admin_id,
        open_sess.id,
        punch_time.isoformat(),
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
    from ..punch_aggregate import (
        open_punch_session_for_admin,
        recompute_punch_aggregate,
    )
    from ..utility import is_on_leave

    log.admin_id = admin_id
    punch_date = punch_time.date()
    device_serial = log.device_serial_number or (
        getattr(device, "serial_number", None) if device else None
    )

    if _nhq_day_blocks_new_session(admin_id, punch_date, device_serial):
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

    global_open = open_punch_session_for_admin(admin_id)

    if global_open is not None and _is_web_session(global_open):
        log.status = "ignored_open_web_session"
        log.punch_session_id = global_open.id
        log.error_message = None
        logger.info(
            "BIOMETRIC_IGNORED_OPEN_WEB admin_id=%s session_id=%s log_id=%s",
            admin_id,
            global_open.id,
            log.id,
        )
        return log.status

    bio_sess = _open_biometric_session_for_day(admin_id, punch_date)
    if bio_sess is not None and _is_biometric_session(bio_sess):
        sess_date = _session_punch_date(bio_sess)
        if sess_date == punch_date:
            return _process_subsequent_biometric_scan(
                log=log,
                admin_id=admin_id,
                punch_date=punch_date,
                punch_time=punch_time,
                open_sess=bio_sess,
            )

    if global_open is not None and _is_biometric_session(global_open):
        stale_date = _session_punch_date(global_open)
        if stale_date is not None and stale_date != punch_date:
            _maybe_close_stale_biometric_session(global_open, now=punch_time)
            db.session.flush()
        elif stale_date == punch_date:
            return _process_subsequent_biometric_scan(
                log=log,
                admin_id=admin_id,
                punch_date=punch_date,
                punch_time=punch_time,
                open_sess=global_open,
            )

    if global_open is not None and not _is_biometric_session(global_open):
        log.status = "ignored_open_web_session"
        log.punch_session_id = global_open.id
        log.error_message = f"open_session_source={_session_source(global_open)}"
        return log.status

    # No open session for this scan date → first biometric scan = IN
    punch = _get_or_create_punch(admin_id, punch_date)

    bio_sess = _open_biometric_session_for_day(admin_id, punch_date)
    if bio_sess is not None and _is_biometric_session(bio_sess):
        return _process_subsequent_biometric_scan(
            log=log,
            admin_id=admin_id,
            punch_date=punch_date,
            punch_time=punch_time,
            open_sess=bio_sess,
        )

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

    sess = PunchSession(
        punch_id=punch.id,
        clock_in=punch_time,
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
        pass

    db.session.add(sess)
    db.session.flush()

    _upsert_day_state(
        admin_id=admin_id,
        punch_date=punch_date,
        punch_session_id=sess.id,
        scan_at=punch_time,
    )
    recompute_punch_aggregate(punch)

    log.status = "processed"
    log.punch_session_id = sess.id
    log.error_message = None
    logger.info(
        "BIOMETRIC_SESSION_OPENED admin_id=%s session_id=%s clock_in=%s log_id=%s",
        admin_id,
        sess.id,
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
