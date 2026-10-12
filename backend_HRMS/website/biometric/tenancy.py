"""
Tenant scoping for biometric devices, logs and the HR read model.

- A device belongs to one tenant (``biometric_devices.tenant_id``; NULL = default tenant).
- A log belongs to its device's tenant (by serial); logs from unregistered serials
  stay with the default tenant.
- ``biometric_attendance_day`` rows carry the tenant of the device that produced them.
- Device PINs only match employees of the device's tenant.
"""
from __future__ import annotations

from typing import Optional

from sqlalchemy import or_, select

from .. import db
from ..tenant_context import DEFAULT_TENANT_ID, get_current_tenant_id, tenant_column_clause
from .models import BiometricAttendanceDay, BiometricDevice, BiometricLog


def _tid(tenant_id: Optional[int]) -> int:
    tid = tenant_id if tenant_id is not None else get_current_tenant_id()
    return int(tid) if tid is not None else DEFAULT_TENANT_ID


def device_tenant_id(device) -> int:
    tid = getattr(device, "tenant_id", None) if device is not None else None
    return int(tid) if tid is not None else DEFAULT_TENANT_ID


def tenant_for_device_id(device_id) -> int:
    if device_id is None:
        return DEFAULT_TENANT_ID
    tid = (
        db.session.query(BiometricDevice.tenant_id)
        .filter(BiometricDevice.id == int(device_id))
        .scalar()
    )
    return int(tid) if tid is not None else DEFAULT_TENANT_ID


def tenant_for_serial(serial_number: Optional[str]) -> int:
    sn = (serial_number or "").strip()
    if not sn:
        return DEFAULT_TENANT_ID
    tid = (
        db.session.query(BiometricDevice.tenant_id)
        .filter(BiometricDevice.serial_number == sn)
        .scalar()
    )
    return int(tid) if tid is not None else DEFAULT_TENANT_ID


def tenant_by_serial() -> dict[str, int]:
    """{serial_number: tenant_id} for every registered device."""
    rows = db.session.query(BiometricDevice.serial_number, BiometricDevice.tenant_id).all()
    return {
        sn: int(tid) if tid is not None else DEFAULT_TENANT_ID
        for sn, tid in rows
        if sn
    }


def admin_tenant_clause(admin_model, tenant_id: Optional[int]):
    """Admin filter for one tenant, or None when the model has no tenant column (isolated tests)."""
    column = getattr(admin_model, "tenant_id", None)
    if column is None:
        return None
    return tenant_column_clause(column, _tid(tenant_id))


def device_tenant_clause(tenant_id: Optional[int] = None):
    return tenant_column_clause(BiometricDevice.tenant_id, _tid(tenant_id))


def log_tenant_clause(tenant_id: Optional[int] = None):
    tid = _tid(tenant_id)
    own = BiometricLog.device_serial_number.in_(
        select(BiometricDevice.serial_number).where(device_tenant_clause(tid))
    )
    if tid != DEFAULT_TENANT_ID:
        return own
    unregistered = BiometricLog.device_serial_number.notin_(select(BiometricDevice.serial_number))
    return or_(own, unregistered)


def day_tenant_clause(tenant_id: Optional[int] = None):
    return tenant_column_clause(BiometricAttendanceDay.tenant_id, _tid(tenant_id))
