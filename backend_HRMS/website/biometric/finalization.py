"""
NHQ biometric day finalization at 20:00 IST.

Day-shift / calendar-day employees only — no per-employee shift model exists.
Uses punch_time from biometric_logs (not created_at, not last_scan_at alone).
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

# How many prior calendar days catch-up considers (missed 20:00 job / restart).
CATCHUP_LOOKBACK_DAYS = 7

FINALIZE_HOUR = 20
FINALIZE_MINUTE = 0


def cutoff_datetime_for_date(punch_date: date) -> datetime:
    """Naive IST wall-clock for 20:00:00 on the attendance date."""
    return datetime.combine(punch_date, time(FINALIZE_HOUR, FINALIZE_MINUTE, 0))


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

    cutoff = cutoff_datetime_for_date(punch_date)
    from .scope import nhq_biometric_serials

    nhq_serials = list(nhq_biometric_serials())
    if not nhq_serials:
        return None

    rows = (
        BiometricLog.query.filter(
            BiometricLog.admin_id == admin_id,
            BiometricLog.status == "processed",
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
        if pt <= clock_in:
            continue
        if pt > cutoff:
            continue
        candidates.append(row)

    if not candidates:
        return None
    return max(candidates, key=lambda r: (r.punch_time, r.id or 0))


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


def try_finalize_stale_nhq_session(open_sess, punch) -> bool:
    """
    Close a cross-day stale NHQ biometric session using that day's 20:00 cutoff.
    Returns True if finalized.
    """
    if not is_nhq_biometric_open_session(open_sess, punch):
        return False
    punch_date = getattr(punch, "punch_date", None)
    if punch_date is None:
        return False
    res = finalize_biometric_day(punch.admin_id, punch_date)
    return bool(res.get("finalized"))
