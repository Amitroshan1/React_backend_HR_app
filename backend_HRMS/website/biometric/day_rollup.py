"""
Incremental HR reporting rollup: biometric_logs → biometric_attendance_day.

Never talks to the device. Never writes Punch / PunchSession.
"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Iterable, List, Optional

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm.attributes import flag_modified

from .. import db
from .models import BiometricAttendanceDay, BiometricLog

logger = logging.getLogger(__name__)

_INVALID_SCAN_STATUSES = frozenset({"failed", "duplicate", "unknown_device"})


def format_scan_ts(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%d %H:%M:%S")


def parse_scan_ts(raw: str) -> Optional[datetime]:
    try:
        return datetime.strptime(str(raw).strip(), "%Y-%m-%d %H:%M:%S")
    except (ValueError, TypeError):
        return None


def is_reportable_log(log: BiometricLog) -> bool:
    if log is None or log.punch_time is None:
        return False
    status = (log.status or "").strip()
    if status in _INVALID_SCAN_STATUSES:
        return False
    pin = (log.device_user_id or "").strip()
    return bool(pin)


def _sorted_unique_keep_dupes(times: Iterable[str]) -> List[str]:
    """Keep duplicate timestamps (distinct log rows) and sort chronologically."""
    return sorted(str(t) for t in times if t)


def upsert_attendance_day_from_log(log: BiometricLog) -> Optional[BiometricAttendanceDay]:
    """Append one valid scan onto the PIN+date read-model row."""
    if not is_reportable_log(log):
        return None

    pin = (log.device_user_id or "").strip()
    day = log.punch_time.date()
    ts = format_scan_ts(log.punch_time)

    row = (
        BiometricAttendanceDay.query.filter_by(
            device_user_id=pin, attendance_date=day
        )
        .with_for_update()
        .first()
    )
    created = False
    if row is None:
        row = BiometricAttendanceDay(
            admin_id=log.admin_id,
            device_user_id=pin,
            attendance_date=day,
            first_scan=log.punch_time,
            last_scan=log.punch_time,
            total_scans=[ts],
        )
        try:
            with db.session.begin_nested():
                db.session.add(row)
                db.session.flush()
            created = True
        except IntegrityError:
            row = (
                BiometricAttendanceDay.query.filter_by(
                    device_user_id=pin, attendance_date=day
                )
                .with_for_update()
                .first()
            )
            if row is None:
                raise

    if not created:
        scans = list(row.total_scans or [])
        scans.append(ts)
        scans = _sorted_unique_keep_dupes(scans)
        row.total_scans = scans
        flag_modified(row, "total_scans")
        parsed = [parse_scan_ts(s) for s in scans]
        parsed = [p for p in parsed if p is not None]
        if parsed:
            row.first_scan = min(parsed)
            row.last_scan = max(parsed)
        if log.admin_id:
            row.admin_id = log.admin_id
        row.updated_at = datetime.utcnow()
    return row


def upsert_attendance_days_for_log_ids(log_ids: list) -> int:
    """Upsert day rows for a batch of biometric_logs ids. Returns rows touched."""
    touched = 0
    for lid in log_ids or []:
        log = db.session.get(BiometricLog, lid)
        if not log:
            continue
        try:
            if upsert_attendance_day_from_log(log) is not None:
                touched += 1
        except Exception:
            logger.exception("BIOMETRIC_DAY_ROLLUP_ERROR log_id=%s", lid)
    return touched


def rebuild_attendance_days_from_logs() -> int:
    """
    Full rebuild from biometric_logs (ops / first deploy).
    Replaces all biometric_attendance_day rows. Does not touch Punch.
    """
    logs = (
        BiometricLog.query.filter(
            BiometricLog.punch_time.isnot(None),
            BiometricLog.status.notin_(_INVALID_SCAN_STATUSES),
        )
        .order_by(BiometricLog.punch_time.asc(), BiometricLog.id.asc())
        .all()
    )

    grouped: dict[tuple, dict] = {}
    for log in logs:
        pin = (log.device_user_id or "").strip()
        if not pin or log.punch_time is None:
            continue
        day = log.punch_time.date()
        key = (pin, day)
        ts = format_scan_ts(log.punch_time)
        bucket = grouped.get(key)
        if bucket is None:
            grouped[key] = {
                "admin_id": log.admin_id,
                "times": [ts],
                "first": log.punch_time,
                "last": log.punch_time,
            }
        else:
            bucket["times"].append(ts)
            if log.punch_time < bucket["first"]:
                bucket["first"] = log.punch_time
            if log.punch_time > bucket["last"]:
                bucket["last"] = log.punch_time
            if log.admin_id:
                bucket["admin_id"] = log.admin_id

    BiometricAttendanceDay.query.delete()
    db.session.flush()

    now = datetime.utcnow()
    count = 0
    for (pin, day), bucket in grouped.items():
        times = _sorted_unique_keep_dupes(bucket["times"])
        db.session.add(
            BiometricAttendanceDay(
                admin_id=bucket["admin_id"],
                device_user_id=pin,
                attendance_date=day,
                first_scan=bucket["first"],
                last_scan=bucket["last"],
                total_scans=times,
                created_at=now,
                updated_at=now,
            )
        )
        count += 1
    db.session.flush()
    logger.info("BIOMETRIC_DAY_ROLLUP_REBUILT rows=%s from_logs=%s", count, len(logs))
    return count
