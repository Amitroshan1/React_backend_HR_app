"""
NHQ biometric attendance scope (device serial + Admin.circle).

Both must match for 8 PM finalization, 10h auto-close skip, and day-closure rules.
Configure NHQ device serials via BIOMETRIC_NHQ_SERIALS (comma-separated) or
Flask config BIOMETRIC_NHQ_SERIALS.
"""

from __future__ import annotations

import os
from typing import Optional, Set

from ..manager_utils import circles_equivalent
from .validators import normalize_serial

# Fallback when env/config unset (current NHQ AiFace ERIS production device).
_DEFAULT_NHQ_SERIALS = ("NES1254800218",)


def _serials_from_csv(raw: str) -> Set[str]:
    out: Set[str] = set()
    for part in (raw or "").split(","):
        sn = normalize_serial(part)
        if sn:
            out.add(sn)
    return out


def nhq_biometric_serials() -> Set[str]:
    """Registered serial numbers subject to NHQ 8 PM finalization policy."""
    try:
        from flask import current_app, has_app_context

        if has_app_context():
            cfg = current_app.config.get("BIOMETRIC_NHQ_SERIALS")
            if cfg is not None:
                if isinstance(cfg, (list, tuple, set)):
                    return {normalize_serial(str(x)) for x in cfg if normalize_serial(str(x))}
                parsed = _serials_from_csv(str(cfg))
                if parsed:
                    return parsed
    except Exception:
        pass

    env = (os.getenv("BIOMETRIC_NHQ_SERIALS") or "").strip()
    if env:
        parsed = _serials_from_csv(env)
        if parsed:
            return parsed

    return {normalize_serial(s) for s in _DEFAULT_NHQ_SERIALS if normalize_serial(s)}


def is_nhq_biometric_device_serial(serial_number: Optional[str]) -> bool:
    sn = normalize_serial(serial_number)
    if not sn:
        return False
    return sn in nhq_biometric_serials()


def is_nhq_admin(admin) -> bool:
    if admin is None:
        return False
    return circles_equivalent(getattr(admin, "circle", None), "NHQ")


def is_nhq_biometric_scope(admin, device_serial_number: Optional[str]) -> bool:
    """True when both employee circle and device serial are NHQ-scoped."""
    return is_nhq_admin(admin) and is_nhq_biometric_device_serial(device_serial_number)


def _load_admin(admin_id: int):
    import sys

    mod = sys.modules.get("website.models.Admin_models")
    if mod is not None and getattr(mod, "Admin", None) is not None:
        return mod.Admin.query.get(int(admin_id))
    try:
        from ..models.Admin_models import Admin

        return Admin.query.get(int(admin_id))
    except Exception:
        return None


def _session_has_nhq_device_activity(open_sess, punch) -> bool:
    """True if processed logs tie this session/day to an NHQ biometric device."""
    from .models import BiometricLog

    if open_sess is not None and getattr(open_sess, "id", None):
        row = (
            BiometricLog.query.filter(
                BiometricLog.punch_session_id == open_sess.id,
                BiometricLog.status == "processed",
            )
            .order_by(BiometricLog.id.desc())
            .first()
        )
        if row and is_nhq_biometric_device_serial(row.device_serial_number):
            return True

    if punch is None or not getattr(punch, "admin_id", None):
        return False
    punch_date = getattr(punch, "punch_date", None)
    if punch_date is None:
        return False

    for serial in nhq_biometric_serials():
        row = (
            BiometricLog.query.filter(
                BiometricLog.admin_id == punch.admin_id,
                BiometricLog.status == "processed",
                BiometricLog.device_serial_number == serial,
            )
            .filter(BiometricLog.punch_time.isnot(None))
            .first()
        )
        if row and row.punch_time and row.punch_time.date() == punch_date:
            return True
    return False


def is_nhq_biometric_open_session(open_sess, punch=None) -> bool:
    """
    Open PunchSession under NHQ biometric policy (source=biometric, NHQ admin,
    activity from NHQ device serial).
    """
    if open_sess is None or open_sess.clock_out is not None:
        return False
    src = (getattr(open_sess, "source", None) or "").strip().lower()
    if src != "biometric":
        return False

    if punch is None and open_sess.punch_id:
        from ..models.attendance import Punch

        punch = Punch.query.get(open_sess.punch_id)
    if punch is None:
        return False

    admin = _load_admin(punch.admin_id)
    if not is_nhq_admin(admin):
        return False
    return _session_has_nhq_device_activity(open_sess, punch)
