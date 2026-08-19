"""
Publish attendance.updated after successful DB commit.

Never raises into attendance flows. Never creates/modifies Punch data.
"""

from __future__ import annotations

import logging
from datetime import date, datetime
from typing import Any, Optional

from sqlalchemy import event
from sqlalchemy.orm import Session, sessionmaker

from ..datetime_utils import IST
from .hub import hub
from .models import AttendanceRealtimeEvent

logger = logging.getLogger(__name__)

_SESSION_KEY = "attendance_realtime_pending"


def _website_db():
    """Always resolve the live Flask-SQLAlchemy instance (test-safe)."""
    from .. import db

    return db


def queue_attendance_updated(
    *,
    employee_admin_id: int,
    attendance_date: Optional[date] = None,
    punch_session_id: Optional[int] = None,
    source: Optional[str] = None,
    event_time: Optional[datetime] = None,
) -> None:
    """
    Queue an event to publish after the current DB transaction commits.
    Safe to call inside biometric/web attendance transactions.
    """
    db = _website_db()
    try:
        emp_id = int(employee_admin_id)
    except (TypeError, ValueError):
        return

    payload = {
        "employee_admin_id": emp_id,
        "attendance_date": attendance_date,
        "punch_session_id": punch_session_id,
        "source": (source or "").strip().lower() or None,
        "event_time": event_time or datetime.now(IST).replace(tzinfo=None),
    }
    try:
        pending = db.session.info.setdefault(_SESSION_KEY, [])
        pending.append(payload)
    except Exception:
        try:
            _persist_and_fanout(payload)
        except Exception:
            logger.exception("ATTENDANCE_SSE_PUBLISH_FAILED immediate")


def publish_attendance_updated_now(**kwargs) -> None:
    """Publish immediately (caller already committed). Never raises."""
    try:
        emp = kwargs.get("employee_admin_id")
        if emp is None:
            return
        payload = {
            "employee_admin_id": int(emp),
            "attendance_date": kwargs.get("attendance_date"),
            "punch_session_id": kwargs.get("punch_session_id"),
            "source": (kwargs.get("source") or "").strip().lower() or None,
            "event_time": kwargs.get("event_time")
            or datetime.now(IST).replace(tzinfo=None),
        }
        _persist_and_fanout(payload)
    except Exception:
        logger.exception("ATTENDANCE_SSE_PUBLISH_FAILED now")


def _engine_bind(preferred_session: Optional[Session] = None):
    """Resolve a DB bind that matches the active app (multi-app test safe)."""
    from flask import has_app_context

    db = _website_db()

    if preferred_session is not None:
        try:
            bind = preferred_session.get_bind()
            if bind is not None:
                return bind
        except Exception:
            pass

    if has_app_context():
        try:
            engines = getattr(db, "engines", None)
            if engines:
                return engines[None] if None in engines else next(iter(engines.values()))
            return db.engine
        except Exception:
            pass

    try:
        bind = db.session.get_bind()
        if bind is not None:
            return bind
    except Exception:
        pass

    return db.engine


def _persist_and_fanout(
    payload: dict, *, preferred_session: Optional[Session] = None
) -> None:
    """Write outbox on a fresh Session so after_commit hooks stay safe."""
    bind = _engine_bind(preferred_session)
    SessionLocal = sessionmaker(bind=bind)
    s = SessionLocal()
    row_id = None
    event_body = None
    try:
        row = AttendanceRealtimeEvent(
            employee_admin_id=payload["employee_admin_id"],
            attendance_date=payload.get("attendance_date"),
            punch_session_id=payload.get("punch_session_id"),
            source=payload.get("source"),
            event_name="attendance.updated",
            event_time=payload.get("event_time") or datetime.utcnow(),
        )
        s.add(row)
        s.commit()
        row_id = row.id
        event_body = _to_public_event(row)
    except Exception:
        s.rollback()
        raise
    finally:
        s.close()

    if event_body is not None:
        hub.publish_local(event_body)
    logger.info(
        "ATTENDANCE_SSE_PUBLISHED id=%s employee_id=%s source=%s",
        row_id,
        payload.get("employee_admin_id"),
        payload.get("source"),
    )


def _to_public_event(row: AttendanceRealtimeEvent) -> dict[str, Any]:
    et = row.event_time or row.created_at or datetime.utcnow()
    if et.tzinfo is None:
        event_time_iso = et.strftime("%Y-%m-%dT%H:%M:%S") + "+05:30"
    else:
        event_time_iso = et.astimezone(IST).isoformat()

    return {
        "id": row.id,
        "event": "attendance.updated",
        "employee_id": row.employee_admin_id,
        "attendance_date": row.attendance_date.isoformat()
        if row.attendance_date
        else None,
        "punch_session_id": row.punch_session_id,
        "source": row.source,
        "event_time": event_time_iso,
    }


def fetch_outbox_since(after_id: int, *, limit: int = 50) -> list[dict[str, Any]]:
    """Cross-worker catch-up (indexed id scan)."""
    rows = (
        AttendanceRealtimeEvent.query.filter(AttendanceRealtimeEvent.id > int(after_id or 0))
        .order_by(AttendanceRealtimeEvent.id.asc())
        .limit(limit)
        .all()
    )
    return [_to_public_event(r) for r in rows]


def latest_outbox_id() -> int:
    row = (
        AttendanceRealtimeEvent.query.order_by(AttendanceRealtimeEvent.id.desc())
        .limit(1)
        .first()
    )
    return int(row.id) if row else 0


def _after_commit(session: Session) -> None:
    pending = session.info.pop(_SESSION_KEY, None) or []
    if not pending:
        return
    for payload in pending:
        try:
            _persist_and_fanout(payload, preferred_session=session)
        except Exception:
            logger.exception("ATTENDANCE_SSE_PUBLISH_FAILED after_commit")


def _after_rollback(session: Session) -> None:
    session.info.pop(_SESSION_KEY, None)


def register_session_hooks() -> None:
    if getattr(register_session_hooks, "_done", False):
        return
    event.listen(Session, "after_commit", _after_commit)
    event.listen(Session, "after_rollback", _after_rollback)
    register_session_hooks._done = True  # type: ignore[attr-defined]


register_session_hooks()
