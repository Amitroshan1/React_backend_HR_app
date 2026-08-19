"""ADMS / iclock HTTP endpoints.

Phase 3C: GET/POST /iclock/cdata → biometric_logs → attendance bridge → PunchSession.
"""

from __future__ import annotations

import logging

from flask import Response, current_app, jsonify, request

from . import biometric_bp
from .service import process_cdata_request
from .validators import client_ip_from_request

logger = logging.getLogger(__name__)


def _dev_request_log() -> None:
    """Structured request diagnostics (no secrets)."""
    if not current_app.debug and not current_app.config.get("BIOMETRIC_DEBUG_LOG"):
        return
    safe_headers = {
        k: v
        for k, v in request.headers.items()
        if k.lower()
        not in ("authorization", "cookie", "x-api-key", "proxy-authorization")
    }
    body_preview = ""
    try:
        raw = request.get_data(cache=True, as_text=True) or ""
        body_preview = raw[:2000]
    except Exception:
        body_preview = "<unreadable>"
    sn = (
        request.args.get("SN")
        or request.args.get("sn")
        or (request.form.get("SN") if request.form else None)
        or ""
    )
    logger.info(
        "BIOMETRIC_CDATA method=%s sn=%s args=%s headers=%s body=%s",
        request.method,
        sn,
        dict(request.args),
        safe_headers,
        body_preview,
    )


@biometric_bp.route("/health", methods=["GET"])
def biometric_health():
    """Liveness for ops."""
    return jsonify({
        "success": True,
        "module": "biometric",
        "phase": "3C",
        "message": (
            "ADMS ingest + attendance bridge enabled. "
            "Real-time UI uses /api/attendance/events (Phase 3D)."
        ),
    }), 200


def _iclock_cdata_response():
    """
    Shared ADMS handler for /iclock/cdata and /iclock/cdata.aspx.
    Single code path: device validation → parser → ATTLOG/OPERLOG dispatch → bridge.
    """
    try:
        _dev_request_log()
        body = ""
        if request.method == "POST":
            body = request.get_data(as_text=True) or ""
            if not body and request.form:
                for key in ("data", "Data", "ATTLOG", "records"):
                    if key in request.form and request.form.get(key):
                        body = request.form.get(key) or ""
                        break

        form_dict = {}
        try:
            form_dict = request.form.to_dict(flat=True) if request.form else {}
        except Exception:
            form_dict = {}

        result = process_cdata_request(
            method=request.method,
            args=request.args.to_dict(flat=True),
            form=form_dict,
            body=body,
            client_ip=client_ip_from_request(request),
        )
        return Response(
            result.response_body,
            status=result.http_status,
            mimetype="text/plain",
        )
    except Exception:
        logger.exception("BIOMETRIC_PROTOCOL_ERROR path=%s", request.path)
        return Response("OK\n", status=200, mimetype="text/plain")


@biometric_bp.route("/cdata", methods=["GET", "POST"])
@biometric_bp.route("/cdata.aspx", methods=["GET", "POST"])
def iclock_cdata():
    """
    eSSL / ZKTeco ADMS data exchange.

    Ingests biometric_logs, then Phase 3C bridge may open/update PunchSession
    via punch_aggregate (never auth.punch_in/out; no geo for device scans).

    /cdata.aspx is an alias for devices that append the ASP.NET-style suffix.
    """
    return _iclock_cdata_response()
