"""
Smart reprocess for biometric mapping failures.

Retries logs that failed employee mapping after HR fixes emp_id / map rows.
Never invents attendance for PINs that still have no Admin to map to.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from .. import db
from ..datetime_utils import IST
from .models import BiometricDevice, BiometricLog

logger = logging.getLogger(__name__)

# Mapping outcomes that may succeed after emp_id / map fixes.
REPROCESSABLE_STATUSES = frozenset(
    {
        "unknown_employee",
        "invalid_mapping",
        "ambiguous_employee_mapping",
        "employee_inactive",
    }
)

# Stop retrying forever for ghost PINs with no HRMS employee.
UNMAPPED_PERMANENT_STATUS = "unmapped_permanent"

DEFAULT_MAX_ATTEMPTS = 7
DEFAULT_LOOKBACK_DAYS = 30


def reprocess_one_mapping_log(
    log: BiometricLog,
    *,
    max_attempts: int = DEFAULT_MAX_ATTEMPTS,
    dry_run: bool = False,
) -> Dict[str, Any]:
    """
    Reset one mapping-failure log to received and run the attendance bridge again.

    Returns a result dict with keys: log_id, previous_status, status, outcome, attempts.
    """
    from .attendance_bridge import process_biometric_log
    from .day_rollup import upsert_attendance_day_from_log

    prev = (log.status or "").strip()
    attempts = int(getattr(log, "reprocess_attempts", 0) or 0)
    result: Dict[str, Any] = {
        "log_id": log.id,
        "device_user_id": log.device_user_id,
        "previous_status": prev,
        "attempts_before": attempts,
        "status": prev,
        "outcome": None,
        "punch_session_id": log.punch_session_id,
    }

    if prev not in REPROCESSABLE_STATUSES:
        result["outcome"] = "skipped_not_reprocessable"
        return result

    if attempts >= max_attempts:
        if not dry_run and prev != UNMAPPED_PERMANENT_STATUS:
            log.status = UNMAPPED_PERMANENT_STATUS
            log.error_message = (
                f"unmapped_after_{attempts}_reprocess_attempts"
            )[:500]
            try:
                upsert_attendance_day_from_log(log)
            except Exception:
                logger.exception("BIOMETRIC_REPROCESS_ROLLUP_FAILED log_id=%s", log.id)
        result["status"] = UNMAPPED_PERMANENT_STATUS
        result["outcome"] = "exhausted"
        return result

    if dry_run:
        result["outcome"] = "would_reprocess"
        return result

    device = None
    sn = (log.device_serial_number or "").strip()
    if sn:
        device = BiometricDevice.query.filter_by(serial_number=sn).first()

    log.status = "received"
    log.error_message = None
    log.admin_id = None
    log.punch_session_id = None
    log.reprocess_attempts = attempts + 1
    log.last_reprocess_at = datetime.utcnow()
    db.session.flush()

    try:
        new_status = process_biometric_log(log, device=device)
    except Exception:
        db.session.rollback()
        # Reload best-effort; mark attempt consumed.
        log = BiometricLog.query.get(result["log_id"])
        if log is not None:
            log.status = prev
            log.reprocess_attempts = attempts + 1
            log.last_reprocess_at = datetime.utcnow()
            log.error_message = "reprocess_bridge_exception"[:500]
            db.session.commit()
        result["outcome"] = "error"
        result["status"] = prev
        logger.exception("BIOMETRIC_REPROCESS_ERROR log_id=%s", result["log_id"])
        return result

    new_status = (new_status or log.status or "").strip()
    result["status"] = new_status
    result["punch_session_id"] = log.punch_session_id
    result["attempts_after"] = int(log.reprocess_attempts or 0)

    if new_status in ("processed", "ignored", "ignored_open_web_session", "ignored_day_closed", "ignored_open_session"):
        result["outcome"] = "resolved"
    elif new_status in REPROCESSABLE_STATUSES:
        if int(log.reprocess_attempts or 0) >= max_attempts:
            log.status = UNMAPPED_PERMANENT_STATUS
            log.error_message = (
                f"unmapped_after_{log.reprocess_attempts}_reprocess_attempts"
            )[:500]
            result["status"] = UNMAPPED_PERMANENT_STATUS
            result["outcome"] = "exhausted"
        else:
            result["outcome"] = "still_unmapped"
    else:
        result["outcome"] = "resolved_other"

    try:
        upsert_attendance_day_from_log(log)
    except Exception:
        logger.exception("BIOMETRIC_REPROCESS_ROLLUP_FAILED log_id=%s", log.id)

    logger.info(
        "BIOMETRIC_REPROCESS log_id=%s pin=%s prev=%s new=%s outcome=%s attempts=%s",
        log.id,
        log.device_user_id,
        prev,
        result["status"],
        result["outcome"],
        log.reprocess_attempts,
    )
    return result


def reprocess_mapping_failure_logs(
    *,
    lookback_days: int = DEFAULT_LOOKBACK_DAYS,
    max_attempts: int = DEFAULT_MAX_ATTEMPTS,
    limit: int = 500,
    dry_run: bool = False,
    now_ist: Optional[datetime] = None,
) -> Dict[str, Any]:
    """
    Batch-reprocess recent mapping-failure logs.

    Ghost PINs that never map are marked unmapped_permanent after max_attempts
    and are not retried again.
    """
    now = now_ist or datetime.now(IST).replace(tzinfo=None)
    since = now - timedelta(days=max(1, int(lookback_days)))

    rows: List[BiometricLog] = (
        BiometricLog.query.filter(
            BiometricLog.status.in_(list(REPROCESSABLE_STATUSES)),
            BiometricLog.punch_time.isnot(None),
            BiometricLog.punch_time >= since,
        )
        .order_by(BiometricLog.id.asc())
        .limit(max(1, int(limit)))
        .all()
    )

    summary: Dict[str, Any] = {
        "run_at": now.isoformat(),
        "lookback_days": lookback_days,
        "max_attempts": max_attempts,
        "candidate_count": len(rows),
        "resolved_count": 0,
        "still_unmapped_count": 0,
        "exhausted_count": 0,
        "skipped_count": 0,
        "error_count": 0,
        "results": [],
    }

    for log in rows:
        try:
            res = reprocess_one_mapping_log(
                log, max_attempts=max_attempts, dry_run=dry_run
            )
            if not dry_run:
                db.session.commit()
            summary["results"].append(res)
            outcome = res.get("outcome")
            if outcome in ("resolved", "resolved_other"):
                summary["resolved_count"] += 1
            elif outcome == "still_unmapped":
                summary["still_unmapped_count"] += 1
            elif outcome == "exhausted":
                summary["exhausted_count"] += 1
            elif outcome == "error":
                summary["error_count"] += 1
            else:
                summary["skipped_count"] += 1
        except Exception:
            db.session.rollback()
            summary["error_count"] += 1
            logger.exception("BIOMETRIC_REPROCESS_BATCH_ERROR log_id=%s", getattr(log, "id", None))

    return summary
