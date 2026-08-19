"""SSE endpoint: GET /api/attendance/events"""

from __future__ import annotations

import json
import logging
import queue
import time
from typing import Optional, Tuple

from flask import Response, jsonify, request, stream_with_context
from flask_jwt_extended import decode_token, get_jwt_identity, verify_jwt_in_request

from ..models.Admin_models import Admin
from . import attendance_realtime_bp
from .authz import resolve_allowed_employee_ids, viewer_may_see_employee
from .hub import hub
from .publisher import fetch_outbox_since, latest_outbox_id

logger = logging.getLogger(__name__)

HEARTBEAT_SEC = 15
OUTBOX_POLL_SEC = 2.0


def _authenticate_viewer() -> Tuple[Optional[Admin], Optional[Response]]:
    """
    Resolve viewer from Authorization header or access_token query
    (EventSource cannot set headers).
    """
    admin = None
    try:
        verify_jwt_in_request(optional=True, locations=["headers"])
        raw = get_jwt_identity()
        if raw is not None:
            admin = Admin.query.get(int(raw))
    except Exception:
        admin = None

    if admin is None:
        token = (
            request.args.get("access_token")
            or request.args.get("token")
            or ""
        ).strip()
        if not token:
            return None, Response("Unauthorized\n", status=401, mimetype="text/plain")
        try:
            decoded = decode_token(token)
            raw = decoded.get("sub")
            admin = Admin.query.get(int(raw)) if raw is not None else None
        except Exception:
            return None, Response("Unauthorized\n", status=401, mimetype="text/plain")

    if not admin:
        return None, Response("Unauthorized\n", status=401, mimetype="text/plain")
    return admin, None


@attendance_realtime_bp.route("/events", methods=["GET"])
def attendance_events_sse():
    """
    Server-Sent Events stream of attendance.updated notifications.

    Auth: Bearer JWT header OR ?access_token= (for EventSource).
    Does not accept employee_id as an authorization grant.
    """
    viewer, err = _authenticate_viewer()
    if err is not None:
        return err

    allowed = resolve_allowed_employee_ids(viewer)
    sub = hub.subscribe(viewer.id, allowed)
    cursor = latest_outbox_id()

    @stream_with_context
    def generate():
        nonlocal cursor
        try:
            yield f": connected viewer={viewer.id}\n\n"
            last_hb = time.monotonic()
            last_outbox = time.monotonic()

            while True:
                try:
                    ev = sub.q.get(timeout=0.5)
                    if viewer_may_see_employee(viewer, ev.get("employee_id")):
                        yield _format_sse(ev)
                        if ev.get("id"):
                            cursor = max(cursor, int(ev["id"]))
                except queue.Empty:
                    pass

                now = time.monotonic()

                if now - last_outbox >= OUTBOX_POLL_SEC:
                    last_outbox = now
                    try:
                        for ev in fetch_outbox_since(cursor, limit=50):
                            eid = ev.get("employee_id")
                            if not viewer_may_see_employee(viewer, eid):
                                if ev.get("id"):
                                    cursor = max(cursor, int(ev["id"]))
                                continue
                            yield _format_sse(ev)
                            if ev.get("id"):
                                cursor = max(cursor, int(ev["id"]))
                    except Exception:
                        logger.exception("ATTENDANCE_SSE_OUTBOX_POLL_ERROR")

                if now - last_hb >= HEARTBEAT_SEC:
                    last_hb = now
                    yield ": keepalive\n\n"
        except GeneratorExit:
            pass
        finally:
            hub.unsubscribe(sub)

    headers = {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
    }
    return Response(generate(), headers=headers)


def _format_sse(ev: dict) -> str:
    eid = ev.get("id")
    data = json.dumps(ev, separators=(",", ":"), default=str)
    parts = []
    if eid is not None:
        parts.append(f"id: {eid}")
    parts.append("event: attendance.updated")
    parts.append(f"data: {data}")
    parts.append("")
    parts.append("")
    return "\n".join(parts)


@attendance_realtime_bp.route("/health", methods=["GET"])
def attendance_realtime_health():
    return jsonify({
        "success": True,
        "module": "attendance_realtime",
        "phase": "3D",
        "subscribers_this_worker": hub.subscriber_count(),
    }), 200
