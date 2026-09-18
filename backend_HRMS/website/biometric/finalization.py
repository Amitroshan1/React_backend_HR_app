"""
NHQ biometric day sync: OUT tracks latest device scan.

Primary scheduler path (option A): every few seconds between 18:00–21:00 IST,
close open NHQ biometric sessions / bump closed OUT to the latest NHQ scan.

Legacy helpers (finalize at 20:00 cutoff, late-scan after 20:00) remain for
CLI / stale cross-day catch-up and existing unit tests.

Day-shift / calendar-day employees only — no per-employee shift model exists.
Uses punch_time from biometric_logs (not created_at alone).
"""

from __future__ import annotations

import logging
from datetime import date, datetime, time, timedelta
from typing import Any, Dict, List, Optional

from .. import db
from ..datetime_utils import IST
from ..models.attendance import Punch, PunchSession
from ..punch_aggregate import recompute_punch_aggregate
from ..punch_auto_close import AUTO_PUNCH_NO_LIVE_GPS, close_punch_session
from .models import BiometricDayState, BiometricLog
from .scope import is_nhq_admin, is_nhq_biometric_device_serial, is_nhq_biometric_open_session

logger = logging.getLogger(__name__)

# How many prior calendar days catch-up considers (missed sync window / restart).
CATCHUP_LOOKBACK_DAYS = 7

# Continuous last-scan sync window (inclusive start, exclusive end) — Asia/Kolkata.
SYNC_WINDOW_START = time(18, 0, 0)
SYNC_WINDOW_END = time(21, 0, 0)

# Legacy cutoffs kept for CLI finalize / extend helpers and tests.
FINALIZE_HOUR = 20
FINALIZE_MINUTE = 0
LATE_SCAN_HOUR = 22
LATE_SCAN_MINUTE = 0


def in_nhq_last_scan_sync_window(now_ist: Optional[datetime] = None) -> bool:
    """True when IST wall clock is in [18:00, 21:00)."""
    now = now_ist or datetime.now(IST).replace(tzinfo=None)
    return SYNC_WINDOW_START <= now.time() < SYNC_WINDOW_END


def cutoff_datetime_for_date(punch_date: date) -> datetime:
    """Naive IST wall-clock for 20:00:00 on the attendance date."""
    return datetime.combine(punch_date, time(FINALIZE_HOUR, FINALIZE_MINUTE, 0))


def select_last_nhq_scan_on_day(
    admin_id: int,
    punch_date: date,
    *,
    after: datetime,
    before: Optional[datetime] = None,
    include_ignored_day_closed: bool = False,
) -> Optional[BiometricLog]:
    """
    Latest NHQ-device scan on punch_date with after < punch_time <= before.
    Tie-break: highest biometric_logs.id.

    When include_ignored_day_closed is True, also counts scans stored after the
    20:00 finalizer (status ignored_day_closed) for the 22:00 extend job.
    """
    from .scope import nhq_biometric_serials

    nhq_serials = list(nhq_biometric_serials())
    if not nhq_serials or after is None:
        return None

    statuses = ["processed"]
    if include_ignored_day_closed:
        statuses.append("ignored_day_closed")

    rows = (
        BiometricLog.query.filter(
            BiometricLog.admin_id == admin_id,
            BiometricLog.status.in_(statuses),
            BiometricLog.punch_time.isnot(None),
            BiometricLog.device_serial_number.in_(nhq_serials),
        )
        .all()
    )

    candidates: List[BiometricLog] = []
    for row in rows:
        pt = row.punch_time
        if pt is None or pt.date() != punch_date:
            continue
        if pt <= after:
            continue
        if before is not None and pt > before:
            continue
        candidates.append(row)

    if not candidates:
        return None
    return max(candidates, key=lambda r: (r.punch_time, r.id or 0))


def select_final_out_log(
    *,
    admin_id: int,
    punch_date: date,
    clock_in: datetime,
) -> Optional[BiometricLog]:
    """
    Latest valid processed scan from NHQ device(s) with:
      punch_time.date() == punch_date
      clock_in < punch_time <= 20:00:00 IST
    Tie-break: highest biometric_logs.id.
    """
    if clock_in is None:
        return None

    return select_last_nhq_scan_on_day(
        admin_id,
        punch_date,
        after=clock_in,
        before=cutoff_datetime_for_date(punch_date),
    )


def _open_nhq_biometric_sessions_for_date(punch_date: date) -> List[PunchSession]:
    """Open biometric sessions on punch_date eligible for NHQ finalization."""
    sessions = (
        PunchSession.query.join(Punch, PunchSession.punch_id == Punch.id)
        .filter(
            Punch.punch_date == punch_date,
            PunchSession.clock_out.is_(None),
        )
        .order_by(PunchSession.id.asc())
        .all()
    )
    out: List[PunchSession] = []
    for sess in sessions:
        punch = sess.punch
        if punch and is_nhq_biometric_open_session(sess, punch):
            out.append(sess)
    return out


def finalize_biometric_day(
    admin_id: int,
    punch_date: date,
    *,
    dry_run: bool = False,
) -> Dict[str, Any]:
    """
    Finalize one NHQ employee/day if an open NHQ biometric session exists.
    Idempotent: skips closed sessions and already-finalized day state.
    """
    result: Dict[str, Any] = {
        "admin_id": admin_id,
        "punch_date": punch_date.isoformat(),
        "finalized": False,
        "skipped": None,
        "out_log_id": None,
        "clock_out": None,
    }

    admin_mod = None
    try:
        from ..models.Admin_models import Admin as AdminMod

        admin_mod = AdminMod
    except Exception:
        pass
    if admin_mod is not None:
        admin = admin_mod.query.get(int(admin_id))
        if not is_nhq_admin(admin):
            result["skipped"] = "not_nhq_admin"
            return result

    punch = (
        Punch.query.filter_by(admin_id=admin_id, punch_date=punch_date)
        .with_for_update()
        .first()
    )
    if punch is None:
        result["skipped"] = "no_punch"
        return result

    open_sess = (
        PunchSession.query.filter(
            PunchSession.punch_id == punch.id,
            PunchSession.clock_out.is_(None),
        )
        .with_for_update()
        .order_by(PunchSession.clock_in.desc())
        .first()
    )
    if open_sess is None:
        result["skipped"] = "no_open_session"
        return result

    day_state = (
        BiometricDayState.query.filter_by(
            admin_id=admin_id, punch_date=punch_date
        )
        .with_for_update()
        .first()
    )
    if day_state is not None and (day_state.status or "").strip() == "finalized":
        result["skipped"] = "already_finalized"
        return result

    if not is_nhq_biometric_open_session(open_sess, punch):
        result["skipped"] = "not_nhq_biometric_session"
        return result

    out_log = select_final_out_log(
        admin_id=admin_id,
        punch_date=punch_date,
        clock_in=open_sess.clock_in,
    )
    if out_log is None:
        result["skipped"] = "no_later_scan"
        return result

    out_time = out_log.punch_time
    if dry_run:
        result["finalized"] = True
        result["out_log_id"] = out_log.id
        result["clock_out"] = out_time.isoformat() if out_time else None
        result["dry_run"] = True
        return result

    close_punch_session(
        open_sess,
        punch,
        is_auto=False,
        location_status_out=AUTO_PUNCH_NO_LIVE_GPS,
        clock_out_at=out_time,
        closed_by="biometric",
    )
    open_sess.auto_punched_out = False

    if day_state is None:
        day_state = BiometricDayState(
            admin_id=admin_id,
            punch_date=punch_date,
            punch_session_id=open_sess.id,
            first_scan_at=open_sess.clock_in,
            last_scan_at=out_time,
            status="finalized",
        )
        db.session.add(day_state)
    else:
        day_state.punch_session_id = open_sess.id
        if out_time and (day_state.last_scan_at is None or out_time > day_state.last_scan_at):
            day_state.last_scan_at = out_time
        day_state.status = "finalized"

    recompute_punch_aggregate(punch)

    try:
        from ..attendance_realtime.publisher import queue_attendance_updated

        queue_attendance_updated(
            employee_admin_id=admin_id,
            attendance_date=punch_date,
            punch_session_id=open_sess.id,
            source="biometric",
            event_time=out_time,
        )
    except Exception:
        logger.exception("ATTENDANCE_SSE_QUEUE_FAILED finalize")

    result["finalized"] = True
    result["out_log_id"] = out_log.id
    result["clock_out"] = out_time.isoformat() if out_time else None
    logger.info(
        "BIOMETRIC_DAY_FINALIZED admin_id=%s date=%s session_id=%s out_log_id=%s out=%s",
        admin_id,
        punch_date,
        open_sess.id,
        out_log.id,
        out_time.isoformat() if out_time else None,
    )
    return result


def _dates_for_finalization_run(
    *,
    for_date: Optional[date] = None,
    now_ist: Optional[datetime] = None,
    include_catchup: bool = True,
) -> List[date]:
    now = now_ist or datetime.now(IST).replace(tzinfo=None)
    today = now.date()
    dates: List[date] = []

    if for_date is not None:
        if for_date > today:
            return []
        if for_date == today and now.time() < time(FINALIZE_HOUR, FINALIZE_MINUTE, 0):
            return []
        return [for_date]

    if now.time() >= time(FINALIZE_HOUR, FINALIZE_MINUTE, 0):
        dates.append(today)

    if include_catchup:
        for offset in range(1, CATCHUP_LOOKBACK_DAYS + 1):
            dates.append(today - timedelta(days=offset))

    return dates


def finalize_all_nhq_biometric_days(
    *,
    for_date: Optional[date] = None,
    include_catchup: bool = True,
    dry_run: bool = False,
) -> Dict[str, Any]:
    """
    Batch finalization for NHQ biometric open sessions.
    Catch-up uses each day's 20:00 IST cutoff (not current time).
    """
    now_ist = datetime.now(IST).replace(tzinfo=None)
    dates = _dates_for_finalization_run(
        for_date=for_date,
        now_ist=now_ist,
        include_catchup=include_catchup,
    )

    summary: Dict[str, Any] = {
        "run_at": now_ist.isoformat(),
        "dates": [d.isoformat() for d in dates],
        "catchup_lookback_days": CATCHUP_LOOKBACK_DAYS,
        "finalized_count": 0,
        "skipped_count": 0,
        "error_count": 0,
        "results": [],
    }

    seen: set[tuple[int, date]] = set()
    for punch_date in dates:
        sessions = _open_nhq_biometric_sessions_for_date(punch_date)
        for sess in sessions:
            punch = sess.punch
            if not punch:
                continue
            key = (punch.admin_id, punch_date)
            if key in seen:
                continue
            seen.add(key)
            try:
                res = finalize_biometric_day(
                    punch.admin_id,
                    punch_date,
                    dry_run=dry_run,
                )
                if not dry_run:
                    db.session.commit()
                summary["results"].append(res)
                if res.get("finalized"):
                    summary["finalized_count"] += 1
                else:
                    summary["skipped_count"] += 1
            except Exception:
                db.session.rollback()
                summary["error_count"] += 1
                logger.exception(
                    "BIOMETRIC_FINALIZE_ERROR admin_id=%s date=%s",
                    punch.admin_id,
                    punch_date,
                )

    return summary


def _dates_for_late_scan_run(
    *,
    for_date: Optional[date] = None,
    now_ist: Optional[datetime] = None,
    include_catchup: bool = True,
) -> List[date]:
    """Attendance dates eligible for the 22:00 late-scan punch-out extension."""
    now = now_ist or datetime.now(IST).replace(tzinfo=None)
    today = now.date()
    dates: List[date] = []

    if for_date is not None:
        if for_date > today:
            return []
        if for_date == today and now.time() < time(LATE_SCAN_HOUR, LATE_SCAN_MINUTE, 0):
            return []
        return [for_date]

    if now.time() >= time(LATE_SCAN_HOUR, LATE_SCAN_MINUTE, 0):
        dates.append(today)

    if include_catchup:
        for offset in range(1, CATCHUP_LOOKBACK_DAYS + 1):
            dates.append(today - timedelta(days=offset))

    return dates


def extend_nhq_biometric_day(
    admin_id: int,
    punch_date: date,
    *,
    dry_run: bool = False,
) -> Dict[str, Any]:
    """
    After 20:00 finalization, move punch-out forward when a later NHQ scan exists
    (e.g. employee worked past 8 PM). Does not reopen sessions or overwrite web punch-out.
    """
    result: Dict[str, Any] = {
        "admin_id": admin_id,
        "punch_date": punch_date.isoformat(),
        "extended": False,
        "skipped": None,
        "clock_out": None,
        "out_log_id": None,
    }

    from .scope import _load_admin

    admin = _load_admin(admin_id)
    if not is_nhq_admin(admin):
        result["skipped"] = "not_nhq_admin"
        return result

    punch = Punch.query.filter_by(admin_id=admin_id, punch_date=punch_date).first()
    if punch is None:
        result["skipped"] = "no_punch"
        return result

    open_sess = (
        PunchSession.query.filter(
            PunchSession.punch_id == punch.id,
            PunchSession.clock_out.is_(None),
        )
        .first()
    )
    if open_sess is not None:
        result["skipped"] = "open_session"
        return result

    sessions = (
        PunchSession.query.filter_by(punch_id=punch.id)
        .order_by(PunchSession.clock_in.desc())
        .all()
    )
    target = None
    for sess in sessions:
        src = (getattr(sess, "source", None) or "").strip().lower()
        if src == "biometric" and sess.clock_out is not None:
            target = sess
            break
    if target is None:
        result["skipped"] = "no_closed_biometric_session"
        return result

    closed_by = (getattr(target, "closed_by", None) or "").strip().lower()
    # NHQ biometric last scan has priority over a prior web punch-out.
    # (Still skip if already up to date below.)

    cutoff = cutoff_datetime_for_date(punch_date)
    late_log = select_last_nhq_scan_on_day(
        admin_id,
        punch_date,
        after=cutoff,
        include_ignored_day_closed=True,
    )
    if late_log is None or late_log.punch_time is None:
        result["skipped"] = "no_late_scan"
        return result

    late_time = late_log.punch_time
    if target.clock_out is not None and late_time <= target.clock_out:
        result["skipped"] = "already_up_to_date"
        return result

    if dry_run:
        result["extended"] = True
        result["out_log_id"] = late_log.id
        result["clock_out"] = late_time.isoformat()
        result["dry_run"] = True
        result["overrode_web"] = closed_by == "web"
        return result

    target.clock_out = late_time
    target.auto_punched_out = False
    try:
        target.closed_by = "biometric"
    except Exception:
        pass
    if closed_by == "web":
        try:
            target.extended_hours_reason = (
                "NHQ biometric last scan overrides web punch-out"
            )
        except Exception:
            pass

    day_state = BiometricDayState.query.filter_by(
        admin_id=admin_id,
        punch_date=punch_date,
    ).first()
    if day_state is not None:
        if day_state.last_scan_at is None or late_time > day_state.last_scan_at:
            day_state.last_scan_at = late_time
        if (day_state.status or "").strip() != "finalized":
            day_state.status = "finalized"

    recompute_punch_aggregate(punch)

    try:
        from ..attendance_realtime.publisher import queue_attendance_updated

        queue_attendance_updated(
            employee_admin_id=admin_id,
            attendance_date=punch_date,
            punch_session_id=target.id,
            source="biometric",
            event_time=late_time,
        )
    except Exception:
        logger.exception("ATTENDANCE_SSE_QUEUE_FAILED late_scan_extend")

    result["extended"] = True
    result["out_log_id"] = late_log.id
    result["clock_out"] = late_time.isoformat()
    logger.info(
        "BIOMETRIC_LATE_SCAN_EXTENDED admin_id=%s date=%s session_id=%s out=%s log_id=%s",
        admin_id,
        punch_date,
        target.id,
        late_time.isoformat(),
        late_log.id,
    )
    return result


def extend_all_nhq_biometric_days(
    *,
    for_date: Optional[date] = None,
    include_catchup: bool = True,
    dry_run: bool = False,
) -> Dict[str, Any]:
    """22:00 IST batch: extend punch-out for NHQ employees with scans after 20:00."""
    now_ist = datetime.now(IST).replace(tzinfo=None)
    dates = _dates_for_late_scan_run(
        for_date=for_date,
        now_ist=now_ist,
        include_catchup=include_catchup,
    )

    summary: Dict[str, Any] = {
        "run_at": now_ist.isoformat(),
        "dates": [d.isoformat() for d in dates],
        "extended_count": 0,
        "skipped_count": 0,
        "error_count": 0,
        "results": [],
    }

    seen: set[tuple[int, date]] = set()
    for punch_date in dates:
        punches = Punch.query.filter_by(punch_date=punch_date).all()
        for punch in punches:
            key = (punch.admin_id, punch_date)
            if key in seen:
                continue
            seen.add(key)
            try:
                res = extend_nhq_biometric_day(
                    punch.admin_id,
                    punch_date,
                    dry_run=dry_run,
                )
                if not dry_run:
                    db.session.commit()
                summary["results"].append(res)
                if res.get("extended"):
                    summary["extended_count"] += 1
                else:
                    summary["skipped_count"] += 1
            except Exception:
                db.session.rollback()
                summary["error_count"] += 1
                logger.exception(
                    "BIOMETRIC_LATE_SCAN_ERROR admin_id=%s date=%s",
                    punch.admin_id,
                    punch_date,
                )

    return summary


def _dates_for_last_scan_sync_run(
    *,
    for_date: Optional[date] = None,
    now_ist: Optional[datetime] = None,
    include_catchup: bool = True,
    force: bool = False,
) -> List[date]:
    """
    Dates for continuous last-scan sync.
    Today is included only inside the 18:00–21:00 window (unless force/for_date).
    """
    now = now_ist or datetime.now(IST).replace(tzinfo=None)
    today = now.date()
    dates: List[date] = []

    if for_date is not None:
        if for_date > today:
            return []
        return [for_date]

    if force or in_nhq_last_scan_sync_window(now):
        dates.append(today)

    if include_catchup and (force or in_nhq_last_scan_sync_window(now)):
        for offset in range(1, CATCHUP_LOOKBACK_DAYS + 1):
            dates.append(today - timedelta(days=offset))

    return dates


def _apply_last_scan_out(
    *,
    target: PunchSession,
    punch: Punch,
    admin_id: int,
    punch_date: date,
    out_time: datetime,
    out_log_id: Optional[int],
    closed_by_was: str,
) -> None:
    """Set/bump clock_out to out_time and mark day finalized."""
    was_open = target.clock_out is None
    if was_open:
        close_punch_session(
            target,
            punch,
            is_auto=False,
            location_status_out=AUTO_PUNCH_NO_LIVE_GPS,
            clock_out_at=out_time,
            closed_by="biometric",
        )
        target.auto_punched_out = False
    else:
        target.clock_out = out_time
        target.auto_punched_out = False
        try:
            target.closed_by = "biometric"
        except Exception:
            pass
        if closed_by_was == "web":
            try:
                target.extended_hours_reason = (
                    "NHQ biometric last scan overrides web punch-out"
                )
            except Exception:
                pass

    day_state = BiometricDayState.query.filter_by(
        admin_id=admin_id,
        punch_date=punch_date,
    ).first()
    if day_state is None:
        day_state = BiometricDayState(
            admin_id=admin_id,
            punch_date=punch_date,
            punch_session_id=target.id,
            first_scan_at=target.clock_in,
            last_scan_at=out_time,
            status="finalized",
        )
        db.session.add(day_state)
    else:
        day_state.punch_session_id = target.id
        if out_time and (
            day_state.last_scan_at is None or out_time > day_state.last_scan_at
        ):
            day_state.last_scan_at = out_time
        day_state.status = "finalized"

    recompute_punch_aggregate(punch)

    try:
        from ..attendance_realtime.publisher import queue_attendance_updated

        queue_attendance_updated(
            employee_admin_id=admin_id,
            attendance_date=punch_date,
            punch_session_id=target.id,
            source="biometric",
            event_time=out_time,
        )
    except Exception:
        logger.exception("ATTENDANCE_SSE_QUEUE_FAILED last_scan_sync")

    logger.info(
        "BIOMETRIC_LAST_SCAN_SYNC admin_id=%s date=%s session_id=%s out=%s "
        "log_id=%s was_open=%s",
        admin_id,
        punch_date,
        target.id,
        out_time.isoformat() if out_time else None,
        out_log_id,
        was_open,
    )


def sync_nhq_biometric_last_scan_day(
    admin_id: int,
    punch_date: date,
    *,
    dry_run: bool = False,
    allow_single_scan_out: bool = False,
) -> Dict[str, Any]:
    """
    Option A single-day sync: OUT = latest NHQ scan after clock_in (no 20:00 cap).

    - Open NHQ biometric session → close at last later scan
    - If allow_single_scan_out and no later scan → close at the only scan (clock_in)
    - Closed biometric session → bump OUT when a later scan exists
    """
    result: Dict[str, Any] = {
        "admin_id": admin_id,
        "punch_date": punch_date.isoformat(),
        "synced": False,
        "action": None,
        "skipped": None,
        "clock_out": None,
        "out_log_id": None,
    }

    from .scope import _load_admin

    admin = _load_admin(admin_id)
    if not is_nhq_admin(admin):
        result["skipped"] = "not_nhq_admin"
        return result

    punch = (
        Punch.query.filter_by(admin_id=admin_id, punch_date=punch_date)
        .with_for_update()
        .first()
    )
    if punch is None:
        result["skipped"] = "no_punch"
        return result

    open_sess = (
        PunchSession.query.filter(
            PunchSession.punch_id == punch.id,
            PunchSession.clock_out.is_(None),
        )
        .with_for_update()
        .order_by(PunchSession.clock_in.desc())
        .first()
    )

    if open_sess is not None:
        if not is_nhq_biometric_open_session(open_sess, punch):
            result["skipped"] = "not_nhq_biometric_session"
            return result
        out_log = select_last_nhq_scan_on_day(
            admin_id,
            punch_date,
            after=open_sess.clock_in,
            before=None,
            include_ignored_day_closed=True,
        )
        out_time = None
        out_log_id = None
        action = "close"
        if out_log is not None and out_log.punch_time is not None:
            out_time = out_log.punch_time
            out_log_id = out_log.id
        elif allow_single_scan_out and open_sess.clock_in is not None:
            # Fix #1: only one machine scan that day → OUT at that scan (no fabricated hours).
            out_time = open_sess.clock_in
            day_state = BiometricDayState.query.filter_by(
                admin_id=admin_id, punch_date=punch_date
            ).first()
            if (
                day_state is not None
                and day_state.last_scan_at is not None
                and day_state.last_scan_at >= open_sess.clock_in
            ):
                out_time = day_state.last_scan_at
            action = "close_single_scan"
            from .scope import nhq_biometric_serials

            nhq_serials = list(nhq_biometric_serials())
            exact = (
                BiometricLog.query.filter(
                    BiometricLog.admin_id == admin_id,
                    BiometricLog.status == "processed",
                    BiometricLog.punch_time == open_sess.clock_in,
                    BiometricLog.device_serial_number.in_(nhq_serials),
                )
                .order_by(BiometricLog.id.desc())
                .first()
            )
            if exact is not None:
                out_log_id = exact.id
        else:
            result["skipped"] = "no_later_scan"
            return result

        if dry_run:
            result["synced"] = True
            result["action"] = action
            result["out_log_id"] = out_log_id
            result["clock_out"] = out_time.isoformat() if out_time else None
            result["dry_run"] = True
            return result
        _apply_last_scan_out(
            target=open_sess,
            punch=punch,
            admin_id=admin_id,
            punch_date=punch_date,
            out_time=out_time,
            out_log_id=out_log_id,
            closed_by_was="",
        )
        result["synced"] = True
        result["action"] = action
        result["out_log_id"] = out_log_id
        result["clock_out"] = out_time.isoformat() if out_time else None
        return result

    # Closed biometric session — bump OUT to latest scan if newer.
    sessions = (
        PunchSession.query.filter_by(punch_id=punch.id)
        .order_by(PunchSession.clock_in.desc())
        .all()
    )
    target = None
    for sess in sessions:
        src = (getattr(sess, "source", None) or "").strip().lower()
        if src == "biometric" and sess.clock_out is not None:
            target = sess
            break
    if target is None or not target.clock_in:
        result["skipped"] = "no_closed_biometric_session"
        return result

    closed_by = (getattr(target, "closed_by", None) or "").strip().lower()
    out_log = select_last_nhq_scan_on_day(
        admin_id,
        punch_date,
        after=target.clock_in,
        before=None,
        include_ignored_day_closed=True,
    )
    if out_log is None or out_log.punch_time is None:
        result["skipped"] = "no_later_scan"
        return result
    out_time = out_log.punch_time
    if target.clock_out is not None and out_time <= target.clock_out:
        result["skipped"] = "already_up_to_date"
        return result

    if dry_run:
        result["synced"] = True
        result["action"] = "bump"
        result["out_log_id"] = out_log.id
        result["clock_out"] = out_time.isoformat()
        result["dry_run"] = True
        result["overrode_web"] = closed_by == "web"
        return result

    _apply_last_scan_out(
        target=target,
        punch=punch,
        admin_id=admin_id,
        punch_date=punch_date,
        out_time=out_time,
        out_log_id=out_log.id,
        closed_by_was=closed_by,
    )
    result["synced"] = True
    result["action"] = "bump"
    result["out_log_id"] = out_log.id
    result["clock_out"] = out_time.isoformat()
    result["overrode_web"] = closed_by == "web"
    return result


def sync_all_nhq_biometric_last_scans(
    *,
    for_date: Optional[date] = None,
    include_catchup: bool = True,
    dry_run: bool = False,
    force: bool = False,
    allow_single_scan_out: bool = False,
    now_ist: Optional[datetime] = None,
) -> Dict[str, Any]:
    """
    Batch last-scan sync for the 18:00–21:00 IST window (option A).

    Outside the window returns quickly unless force=True or for_date is set.
    Catch-up jobs should pass force=True and allow_single_scan_out=True so
    single-scan days still get an OUT (fix #1 + #2).
    """
    now = now_ist or datetime.now(IST).replace(tzinfo=None)
    summary: Dict[str, Any] = {
        "run_at": now.isoformat(),
        "in_window": in_nhq_last_scan_sync_window(now),
        "allow_single_scan_out": allow_single_scan_out,
        "dates": [],
        "synced_count": 0,
        "skipped_count": 0,
        "error_count": 0,
        "results": [],
        "skipped": None,
    }

    if for_date is None and not force and not in_nhq_last_scan_sync_window(now):
        summary["skipped"] = "outside_sync_window"
        return summary

    dates = _dates_for_last_scan_sync_run(
        for_date=for_date,
        now_ist=now,
        include_catchup=include_catchup,
        force=force or for_date is not None,
    )
    summary["dates"] = [d.isoformat() for d in dates]
    if not dates:
        summary["skipped"] = "no_dates"
        return summary

    seen: set[tuple[int, date]] = set()
    for punch_date in dates:
        # Open NHQ biometric sessions first.
        for sess in _open_nhq_biometric_sessions_for_date(punch_date):
            punch = sess.punch
            if not punch:
                continue
            key = (punch.admin_id, punch_date)
            if key in seen:
                continue
            seen.add(key)
            try:
                res = sync_nhq_biometric_last_scan_day(
                    punch.admin_id,
                    punch_date,
                    dry_run=dry_run,
                    allow_single_scan_out=allow_single_scan_out,
                )
                if not dry_run:
                    db.session.commit()
                summary["results"].append(res)
                if res.get("synced"):
                    summary["synced_count"] += 1
                else:
                    summary["skipped_count"] += 1
            except Exception:
                db.session.rollback()
                summary["error_count"] += 1
                logger.exception(
                    "BIOMETRIC_LAST_SCAN_SYNC_ERROR admin_id=%s date=%s",
                    punch.admin_id,
                    punch_date,
                )

        # Closed biometric days that may need an OUT bump.
        punches = Punch.query.filter_by(punch_date=punch_date).all()
        for punch in punches:
            key = (punch.admin_id, punch_date)
            if key in seen:
                continue
            seen.add(key)
            try:
                res = sync_nhq_biometric_last_scan_day(
                    punch.admin_id,
                    punch_date,
                    dry_run=dry_run,
                    allow_single_scan_out=allow_single_scan_out,
                )
                if not dry_run:
                    db.session.commit()
                summary["results"].append(res)
                if res.get("synced"):
                    summary["synced_count"] += 1
                else:
                    summary["skipped_count"] += 1
            except Exception:
                db.session.rollback()
                summary["error_count"] += 1
                logger.exception(
                    "BIOMETRIC_LAST_SCAN_SYNC_ERROR admin_id=%s date=%s",
                    punch.admin_id,
                    punch_date,
                )

    return summary


def try_finalize_stale_nhq_session(open_sess, punch) -> bool:
    """
    Close a cross-day stale NHQ biometric session using last-scan sync.
    Returns True if synced/closed.
    """
    if not is_nhq_biometric_open_session(open_sess, punch):
        return False
    punch_date = getattr(punch, "punch_date", None)
    if punch_date is None:
        return False
    # Prefer continuous sync; allow single-scan OUT for stale prior days.
    res = sync_nhq_biometric_last_scan_day(
        punch.admin_id,
        punch_date,
        allow_single_scan_out=True,
    )
    if res.get("synced"):
        return True
    res = finalize_biometric_day(punch.admin_id, punch_date)
    return bool(res.get("finalized"))
