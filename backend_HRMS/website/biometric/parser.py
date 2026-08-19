"""ADMS / iClock payload parsers (Phase 3B — no attendance writes)."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import datetime
from typing import List, Optional, Tuple


# Common ATTLOG datetime patterns from eSSL / ZKTeco devices
_DT_PATTERNS = (
    "%Y-%m-%d %H:%M:%S",
    "%Y/%m/%d %H:%M:%S",
    "%Y-%m-%d %H:%M",
    "%Y/%m/%d %H:%M",
    "%d-%m-%Y %H:%M:%S",
    "%d/%m/%Y %H:%M:%S",
)


@dataclass
class ParsedAttLogEvent:
    """One attendance line from an ATTLOG push. State is stored as-is (no IN/OUT mapping)."""

    device_user_id: str
    punch_time: Optional[datetime]
    punch_time_raw: str
    state: Optional[str] = None
    verification_mode: Optional[str] = None
    work_code: Optional[str] = None
    reserved1: Optional[str] = None
    reserved2: Optional[str] = None
    raw_line: str = ""
    parse_error: Optional[str] = None


@dataclass
class CdataRequestMeta:
    """Normalized query/body metadata from an /iclock/cdata call."""

    serial_number: str = ""
    table: str = ""
    stamp: str = ""
    options: str = ""
    push_version: str = ""
    language: str = ""
    raw_query: dict = field(default_factory=dict)
    command: str = ""  # options | attlog | registry | heartbeat | unknown


def _split_fields(line: str) -> List[str]:
    """Split ATTLOG line on tabs or runs of spaces."""
    line = line.strip()
    if not line:
        return []
    if "\t" in line:
        return [p.strip() for p in line.split("\t")]
    # Space-separated with datetime containing a space: PIN + datetime (2 tokens) + rest
    # Prefer tab; for spaces, match: PIN, YYYY-MM-DD HH:MM:SS, then remaining tokens
    m = re.match(
        r"^(\S+)\s+(\d{4}[-/]\d{1,2}[-/]\d{1,2}\s+\d{1,2}:\d{2}(?::\d{2})?)\s*(.*)$",
        line,
    )
    if m:
        pin, dt, rest = m.group(1), m.group(2), m.group(3).strip()
        parts = [pin, dt]
        if rest:
            parts.extend(rest.split())
        return parts
    return line.split()


def parse_device_datetime(raw: str) -> Tuple[Optional[datetime], Optional[str]]:
    """
    Parse device local timestamp as naive IST wall-clock (matches HRMS punch clocks).
    Returns (datetime_or_None, error_message_or_None).
    """
    s = (raw or "").strip()
    if not s:
        return None, "missing_timestamp"
    for fmt in _DT_PATTERNS:
        try:
            dt = datetime.strptime(s, fmt)
            # Device sends local office time; store as naive IST wall-clock
            return dt.replace(tzinfo=None), None
        except ValueError:
            continue
    return None, f"invalid_timestamp:{s[:40]}"


def parse_attlog_line(line: str) -> ParsedAttLogEvent:
    """
    Parse one ATTLOG record.

    Typical layout (field count varies by firmware):
      PIN  DateTime  Status/State  Verify  WorkCode  Reserved...
    """
    raw = (line or "").strip()
    if not raw:
        return ParsedAttLogEvent(
            device_user_id="",
            punch_time=None,
            punch_time_raw="",
            raw_line=raw,
            parse_error="empty_line",
        )

    parts = _split_fields(raw)
    if len(parts) < 2:
        return ParsedAttLogEvent(
            device_user_id=parts[0] if parts else "",
            punch_time=None,
            punch_time_raw="",
            raw_line=raw,
            parse_error="insufficient_fields",
        )

    pin = parts[0]
    dt_raw = parts[1]
    punch_time, dt_err = parse_device_datetime(dt_raw)

    state = parts[2] if len(parts) > 2 else None
    verify = parts[3] if len(parts) > 3 else None
    work = parts[4] if len(parts) > 4 else None
    r1 = parts[5] if len(parts) > 5 else None
    r2 = parts[6] if len(parts) > 6 else None

    err = None
    if not pin:
        err = "missing_user_id"
    elif dt_err and punch_time is None:
        err = dt_err

    return ParsedAttLogEvent(
        device_user_id=str(pin),
        punch_time=punch_time,
        punch_time_raw=dt_raw,
        state=state,
        verification_mode=verify,
        work_code=work,
        reserved1=r1,
        reserved2=r2,
        raw_line=raw,
        parse_error=err,
    )


def parse_attlog_body(body: str) -> List[ParsedAttLogEvent]:
    """Parse multi-line ATTLOG body into events (skips blank lines)."""
    text = (body or "").replace("\r\n", "\n").replace("\r", "\n")
    events: List[ParsedAttLogEvent] = []
    for line in text.split("\n"):
        if not line.strip():
            continue
        events.append(parse_attlog_line(line))
    return events


def extract_cdata_meta(args: dict, form: Optional[dict] = None) -> CdataRequestMeta:
    """Build request meta from query args and optional form fields (case-insensitive keys)."""
    form = form or {}

    def _get(*names: str) -> str:
        lower_map = {str(k).lower(): v for k, v in {**args, **form}.items()}
        for n in names:
            v = lower_map.get(n.lower())
            if v is not None and str(v).strip() != "":
                return str(v).strip()
        return ""

    sn = _get("SN", "sn", "serial_number", "SerialNumber")
    table = _get("table", "Table")
    stamp = _get("Stamp", "stamp", "ATTLOGStamp")
    options = _get("options", "Options")
    push_ver = _get("pushver", "Pushver", "PushVersion")
    language = _get("language", "Language")
    c_cmd = _get("c", "C", "cmd", "Cmd")

    command = "unknown"
    if options.lower() == "all" or c_cmd.lower() in ("registry", "reg", "register"):
        command = "options" if options.lower() == "all" else "registry"
    elif table.upper() in ("ATTLOG", "ATT_LOG", "TRANSACTION"):
        command = "attlog"
    elif table.upper() in ("OPERLOG", "OPLOG"):
        command = "operlog"
    elif not table and not options and sn:
        command = "heartbeat"

    return CdataRequestMeta(
        serial_number=sn,
        table=table,
        stamp=stamp,
        options=options,
        push_version=push_ver,
        language=language,
        raw_query={str(k): str(v) for k, v in args.items()},
        command=command,
    )

