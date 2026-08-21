"""Device allowlist / registration helpers (Phase 3B)."""

from __future__ import annotations

import ipaddress
import logging
import os
from typing import Optional, Tuple

from datetime import datetime

from .. import db
from ..datetime_utils import utc_now
from .models import BiometricDevice
from .validators import client_ip_from_request, is_valid_serial, normalize_serial

logger = logging.getLogger(__name__)

# ZKTeco TransInterval=1 min + ErrorDelay=60s; allow a couple of missed heartbeats.
DEFAULT_ONLINE_TIMEOUT_SECONDS = 180


def _env_allowed_serials() -> set[str]:
    raw = (os.getenv("BIOMETRIC_ALLOWED_SERIALS") or "").strip()
    if not raw:
        return set()
    return {normalize_serial(p) for p in raw.split(",") if normalize_serial(p)}


def _ip_allowed(device: BiometricDevice, client_ip: str) -> bool:
    allowed = (device.allowed_ips or "").strip()
    if not allowed:
        return True
    if not client_ip:
        return False
    try:
        addr = ipaddress.ip_address(client_ip)
    except ValueError:
        return False
    for part in allowed.split(","):
        token = part.strip()
        if not token:
            continue
        try:
            if "/" in token:
                if addr in ipaddress.ip_network(token, strict=False):
                    return True
            elif addr == ipaddress.ip_address(token):
                return True
        except ValueError:
            continue
    return False


def get_active_device(serial_number: str) -> Optional[BiometricDevice]:
    sn = normalize_serial(serial_number)
    if not sn:
        return None
    return BiometricDevice.query.filter_by(serial_number=sn, is_active=True).first()


def resolve_device(
    serial_number: str,
    *,
    client_ip: str = "",
) -> Tuple[Optional[BiometricDevice], Optional[str]]:
    """
    Resolve a registered active device.
    Returns (device, error_code).
    error_code: invalid_serial | unknown_device | inactive | ip_denied
    """
    if not is_valid_serial(serial_number):
        return None, "invalid_serial"

    sn = normalize_serial(serial_number)
    device = BiometricDevice.query.filter_by(serial_number=sn).first()

    # Optional env allowlist: if set, SN must appear there even if DB row exists
    env_sns = _env_allowed_serials()
    if env_sns and sn not in env_sns:
        logger.warning("BIOMETRIC_UNKNOWN_DEVICE sn=%s reason=env_allowlist", sn)
        return None, "unknown_device"

    if not device:
        logger.warning("BIOMETRIC_UNKNOWN_DEVICE sn=%s", sn)
        return None, "unknown_device"

    if not device.is_active:
        return None, "inactive"

    require_ip = (os.getenv("BIOMETRIC_REQUIRE_IP_ALLOWLIST") or "").strip().lower() in (
        "1",
        "true",
        "yes",
        "on",
    )
    if (require_ip or (device.allowed_ips or "").strip()) and not _ip_allowed(device, client_ip):
        logger.warning(
            "BIOMETRIC_UNKNOWN_DEVICE sn=%s reason=ip_denied ip=%s", sn, client_ip
        )
        return None, "ip_denied"

    return device, None


def device_online_timeout_seconds() -> int:
    """Seconds without last_seen_at after which the device is Offline."""
    raw = None
    try:
        from flask import current_app, has_app_context

        if has_app_context():
            raw = current_app.config.get("BIOMETRIC_DEVICE_ONLINE_TIMEOUT_SECONDS")
    except Exception:
        raw = None
    if raw is None:
        raw = os.getenv("BIOMETRIC_DEVICE_ONLINE_TIMEOUT_SECONDS") or DEFAULT_ONLINE_TIMEOUT_SECONDS
    try:
        return max(30, int(raw))
    except (TypeError, ValueError):
        return DEFAULT_ONLINE_TIMEOUT_SECONDS


def is_device_online(device: Optional[BiometricDevice], *, now: Optional[datetime] = None) -> bool:
    """Online iff last_seen_at is within the timeout. Never uses last_data_push_at."""
    if device is None or device.last_seen_at is None:
        return False
    now = now or utc_now()
    seen = device.last_seen_at
    try:
        delta = (now - seen).total_seconds()
    except TypeError:
        return False
    return delta <= device_online_timeout_seconds()


def touch_device_seen(device: BiometricDevice) -> None:
    """Update last_seen_at (caller commits). Heartbeat / any valid ADMS contact."""
    now = utc_now()
    device.last_seen_at = now
    device.updated_at = now


def touch_device_data_push(device: BiometricDevice) -> None:
    """ATTLOG stored in biometric_logs: communication + last attendance received."""
    now = utc_now()
    device.last_seen_at = now
    device.last_data_push_at = now
    device.updated_at = now


def build_options_response(serial_number: str) -> str:
    """
    Protocol text returned for GET options=all / registry handshake.
    Compatible with common ZKTeco / eSSL ADMS clients.
    """
    sn = normalize_serial(serial_number)
    lines = [
        f"GET OPTION FROM: {sn}",
        "ATTLOGStamp=0",
        "OPERLOGStamp=0",
        "ATTPHOTOStamp=0",
        "ErrorDelay=60",
        "Delay=30",
        "TransTimes=00:00;14:00",
        "TransInterval=1",
        "TransFlag=TransData AttLog\tOpLog\tAttPhoto",
        "TimeZone=5.5",
        "Realtime=1",
        "Encrypt=0",
    ]
    return "\n".join(lines) + "\n"
