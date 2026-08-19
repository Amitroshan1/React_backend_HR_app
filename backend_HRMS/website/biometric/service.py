"""Phase 3B+3C: ADMS /iclock/cdata ingest → biometric_logs → attendance bridge."""

from __future__ import annotations

import hashlib
import logging
from dataclasses import dataclass, field
from typing import List, Optional, Tuple

from sqlalchemy.exc import IntegrityError

from .. import db
from .device_manager import (
    build_options_response,
    resolve_device,
    touch_device_seen,
)
from .models import BiometricLog
from .parser import (
    ParsedAttLogEvent,
    extract_cdata_meta,
    parse_attlog_body,
)
from .validators import (
    is_valid_device_user_id,
    normalize_serial,
    validate_punch_time_basic,
)

logger = logging.getLogger(__name__)


@dataclass
class IngestResult:
    """Outcome of one /iclock/cdata handling pass."""

    response_body: str
    http_status: int = 200
    stored: int = 0
    duplicates: int = 0
    failed: int = 0
    command: str = ""
    device_sn: str = ""
    notes: List[str] = field(default_factory=list)


def make_idempotency_key(
    serial_number: str,
    event: ParsedAttLogEvent,
) -> str:
    """
    Deterministic key from strongest available device fields.
    Does not use only timestamp — includes PIN, state, verify, work code.
    """
    sn = normalize_serial(serial_number)
    pin = (event.device_user_id or "").strip()
    dt = (event.punch_time_raw or "").strip()
    if event.punch_time is not None:
        dt = event.punch_time.strftime("%Y-%m-%d %H:%M:%S")
    state = (event.state or "").strip()
    verify = (event.verification_mode or "").strip()
    work = (event.work_code or "").strip()
    r1 = (event.reserved1 or "").strip()
    r2 = (event.reserved2 or "").strip()
    material = f"{sn}|{pin}|{dt}|{state}|{verify}|{work}|{r1}|{r2}"
    return hashlib.sha256(material.encode("utf-8")).hexdigest()


def _add_log_row(row: BiometricLog) -> bool:
    """Insert with SAVEPOINT so a duplicate does not wipe the batch. True if inserted."""
    try:
        with db.session.begin_nested():
            db.session.add(row)
        return True
    except IntegrityError:
        return False


def _store_event(
    *,
    serial_number: str,
    event: ParsedAttLogEvent,
    full_raw_payload: str,
) -> Tuple[str, Optional[int]]:
    """
    Insert one biometric_logs row.

    Returns (status, log_id_or_None) where status is:
      received | duplicate | failed
    Attendance writes happen later via attendance_bridge for received rows.
    """
    sn = normalize_serial(serial_number)

    if event.parse_error and event.parse_error in (
        "empty_line",
        "insufficient_fields",
        "missing_user_id",
    ):
        logger.info(
            "BIOMETRIC_INVALID_PAYLOAD sn=%s error=%s",
            sn,
            event.parse_error,
        )
        return "failed", None

    if not is_valid_device_user_id(event.device_user_id):
        logger.info("BIOMETRIC_INVALID_PAYLOAD sn=%s error=bad_user_id", sn)
        return "failed", None

    ok_ts, ts_err = validate_punch_time_basic(event.punch_time)
    if not ok_ts:
        logger.info(
            "BIOMETRIC_INVALID_PAYLOAD sn=%s pin=%s error=%s",
            sn,
            event.device_user_id,
            ts_err or event.parse_error,
        )
        key = hashlib.sha256(
            f"{sn}|failed|{event.raw_line}".encode("utf-8")
        ).hexdigest()
        if BiometricLog.query.filter_by(idempotency_key=key).first():
            return "duplicate", None
        row = BiometricLog(
            device_serial_number=sn,
            device_user_id=event.device_user_id or None,
            punch_time=event.punch_time,
            verification_mode=event.verification_mode,
            raw_payload=event.raw_line or full_raw_payload,
            status="failed",
            error_message=(ts_err or event.parse_error or "invalid_payload")[:500],
            idempotency_key=key,
            punch_session_id=None,
            admin_id=None,
        )
        if not _add_log_row(row):
            return "duplicate", None
        return "failed", getattr(row, "id", None)

    key = make_idempotency_key(sn, event)
    existing = BiometricLog.query.filter_by(idempotency_key=key).first()
    if existing:
        logger.info(
            "BIOMETRIC_LOG_DUPLICATE sn=%s pin=%s key=%s",
            sn,
            event.device_user_id,
            key[:16],
        )
        return "duplicate", None

    # Preserve device state without schema change / IN-OUT mapping:
    # "state=<s>;verify=<v>" when state present, else plain verify code.
    verify_store = event.verification_mode
    if event.state is not None and str(event.state) != "":
        v = event.verification_mode or ""
        verify_store = f"state={event.state};verify={v}"

    row = BiometricLog(
        device_serial_number=sn,
        device_user_id=event.device_user_id,
        punch_time=event.punch_time,
        verification_mode=verify_store,
        raw_payload=event.raw_line or full_raw_payload,
        status="received",
        error_message=None,
        idempotency_key=key,
        punch_session_id=None,
        admin_id=None,
    )
    if not _add_log_row(row):
        logger.info(
            "BIOMETRIC_LOG_DUPLICATE sn=%s pin=%s key=%s race=1",
            sn,
            event.device_user_id,
            key[:16],
        )
        return "duplicate", None

    logger.info(
        "BIOMETRIC_LOG_STORED sn=%s pin=%s punch_time=%s status=received",
        sn,
        event.device_user_id,
        event.punch_time.isoformat() if event.punch_time else None,
    )
    return "received", getattr(row, "id", None)


def handle_attlog_ingest(
    *,
    serial_number: str,
    body: str,
    client_ip: str = "",
) -> IngestResult:
    """Parse ATTLOG body, store biometric_logs only, return ADMS OK response."""
    device, err = resolve_device(serial_number, client_ip=client_ip)
    if err or device is None:
        logger.warning(
            "BIOMETRIC_UNKNOWN_DEVICE sn=%s reason=%s",
            normalize_serial(serial_number),
            err or "unknown",
        )
        # Protocol-compatible soft OK so device does not flood; no attendance
        return IngestResult(
            response_body="OK\n",
            http_status=200,
            command="attlog",
            device_sn=normalize_serial(serial_number),
            notes=[f"rejected:{err or 'unknown_device'}"],
        )

    touch_device_seen(device)
    logger.info(
        "BIOMETRIC_LOG_RECEIVED sn=%s bytes=%s",
        device.serial_number,
        len(body or ""),
    )

    events = parse_attlog_body(body or "")
    if not events:
        # Empty ATTLOG push — acknowledge so device clears buffer
        db.session.commit()
        return IngestResult(
            response_body="OK\n",
            http_status=200,
            command="attlog",
            device_sn=device.serial_number,
            notes=["empty_body"],
        )

    stored = duplicates = failed = 0
    received_ids: List[int] = []
    for ev in events:
        status, log_id = _store_event(
            serial_number=device.serial_number,
            event=ev,
            full_raw_payload=body or "",
        )
        if status == "received":
            stored += 1
            if log_id:
                received_ids.append(log_id)
        elif status == "duplicate":
            duplicates += 1
        else:
            failed += 1

    # Phase 3C: map received logs → PunchSession via bridge (same transaction)
    if received_ids:
        from .attendance_bridge import process_received_logs_for_device

        process_received_logs_for_device(device=device, log_ids=received_ids)

    try:
        db.session.commit()
    except Exception:
        db.session.rollback()
        logger.exception("BIOMETRIC_PROTOCOL_ERROR sn=%s stage=commit", device.serial_number)
        return IngestResult(
            response_body="OK\n",
            http_status=200,
            command="attlog",
            device_sn=device.serial_number,
            notes=["commit_failed"],
            failed=len(events),
        )

    # ZKTeco/eSSL: OK or OK:<count> after successful ATTLOG receive
    count = stored + duplicates
    body_out = f"OK:{count}\n" if count else "OK\n"
    return IngestResult(
        response_body=body_out,
        http_status=200,
        stored=stored,
        duplicates=duplicates,
        failed=failed,
        command="attlog",
        device_sn=device.serial_number,
    )


def handle_options_or_registry(
    *,
    serial_number: str,
    client_ip: str = "",
    command: str = "options",
) -> IngestResult:
    device, err = resolve_device(serial_number, client_ip=client_ip)
    if err or device is None:
        logger.warning(
            "BIOMETRIC_UNKNOWN_DEVICE sn=%s command=%s reason=%s",
            normalize_serial(serial_number),
            command,
            err or "unknown",
        )
        return IngestResult(
            response_body="OK\n",
            http_status=200,
            command=command,
            device_sn=normalize_serial(serial_number),
            notes=[f"rejected:{err or 'unknown_device'}"],
        )

    touch_device_seen(device)
    db.session.commit()
    logger.info(
        "BIOMETRIC_DEVICE_REGISTER sn=%s command=%s",
        device.serial_number,
        command,
    )
    return IngestResult(
        response_body=build_options_response(device.serial_number),
        http_status=200,
        command=command,
        device_sn=device.serial_number,
    )


def handle_heartbeat(
    *,
    serial_number: str,
    client_ip: str = "",
) -> IngestResult:
    device, err = resolve_device(serial_number, client_ip=client_ip)
    if err or device is None:
        logger.warning(
            "BIOMETRIC_UNKNOWN_DEVICE sn=%s command=heartbeat reason=%s",
            normalize_serial(serial_number),
            err or "unknown",
        )
        return IngestResult(
            response_body="OK\n",
            http_status=200,
            command="heartbeat",
            device_sn=normalize_serial(serial_number),
            notes=[f"rejected:{err or 'unknown_device'}"],
        )
    touch_device_seen(device)
    db.session.commit()
    return IngestResult(
        response_body="OK\n",
        http_status=200,
        command="heartbeat",
        device_sn=device.serial_number,
    )


def process_cdata_request(
    *,
    method: str,
    args: dict,
    form: Optional[dict],
    body: str,
    client_ip: str = "",
) -> IngestResult:
    """
    Main ADMS entry: ingest → biometric_logs → (Phase 3C) attendance bridge.
    Bridge uses punch_aggregate helpers; does not call auth.punch_in/out.
    """
    meta = extract_cdata_meta(args, form)
    sn = meta.serial_number

    if not sn:
        logger.info("BIOMETRIC_INVALID_PAYLOAD error=missing_serial method=%s", method)
        # Still return OK-ish plain text; avoid JSON
        return IngestResult(
            response_body="OK\n",
            http_status=200,
            command="unknown",
            notes=["missing_serial"],
        )

    # POST with ATTLOG table or body that looks like attlog lines
    table_u = (meta.table or "").upper()
    if method.upper() == "POST" and (
        meta.command == "attlog"
        or table_u in ("ATTLOG", "ATT_LOG", "TRANSACTION")
        or (body and body.strip() and "\t" in body)
        or (body and body.strip() and _looks_like_attlog(body))
    ):
        return handle_attlog_ingest(
            serial_number=sn,
            body=body or "",
            client_ip=client_ip,
        )

    if meta.command in ("options", "registry"):
        return handle_options_or_registry(
            serial_number=sn,
            client_ip=client_ip,
            command=meta.command,
        )

    if meta.command == "operlog":
        # Acknowledge operlog without attendance; do not parse into punches
        device, err = resolve_device(sn, client_ip=client_ip)
        if device:
            touch_device_seen(device)
            db.session.commit()
        return IngestResult(
            response_body="OK\n",
            http_status=200,
            command="operlog",
            device_sn=normalize_serial(sn),
            notes=["operlog_ack"],
        )

    if meta.command == "heartbeat" or method.upper() == "GET":
        return handle_heartbeat(serial_number=sn, client_ip=client_ip)

    logger.info(
        "BIOMETRIC_PROTOCOL_ERROR sn=%s command=%s method=%s",
        sn,
        meta.command,
        method,
    )
    return IngestResult(
        response_body="OK\n",
        http_status=200,
        command=meta.command or "unknown",
        device_sn=normalize_serial(sn),
        notes=["unknown_command_acked"],
    )


def _looks_like_attlog(body: str) -> bool:
    first = (body or "").strip().splitlines()[0] if (body or "").strip() else ""
    if not first:
        return False
    # PIN + datetime pattern
    from .parser import parse_attlog_line

    ev = parse_attlog_line(first)
    return bool(ev.device_user_id) and (
        ev.punch_time is not None or bool(ev.punch_time_raw)
    )
