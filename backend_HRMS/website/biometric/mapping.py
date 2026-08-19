"""
Resolve eSSL User ID → Admin.id via exact Admin.emp_id match.

Identity (non-negotiable):
  device_user_id == Admin.emp_id  →  Admin.id  →  PunchSession.admin_id
BiometricEmployeeMap cannot override Admin.emp_id; it only validates consistency.
device_user_id is always an exact string (no int casting).
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any, Optional

from .models import BiometricEmployeeMap

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class MappingResolution:
    """Result of resolving a device PIN to an attendance owner."""

    ok: bool
    admin_id: Optional[int] = None
    emp_id: Optional[str] = None
    mapping_id: Optional[int] = None
    status: Optional[str] = None
    error_message: Optional[str] = None
    admin_name: Optional[str] = None

    def as_audit_dict(self) -> dict[str, Any]:
        return {
            "ok": self.ok,
            "admin_id": self.admin_id,
            "emp_id": self.emp_id,
            "mapping_id": self.mapping_id,
            "status": self.status,
            "error_message": self.error_message,
            "admin_name": self.admin_name,
            "mapping_status": "valid" if self.ok else (self.status or "failed"),
        }


def _norm_device_user_id(device_user_id: Optional[str]) -> str:
    """Preserve exact device value aside from outer whitespace."""
    return (device_user_id or "").strip()


def _norm_emp_id(emp_id: Optional[str]) -> Optional[str]:
    raw = (emp_id or "").strip()
    return raw or None


def find_employee_map(
    device_user_id: str,
    *,
    device_id: Optional[int] = None,
) -> Optional[BiometricEmployeeMap]:
    """
    Locate mapping row. Prefer (device_id, device_user_id), then global
    (device_id IS NULL), then any active row for that exact device_user_id.
    """
    pin = _norm_device_user_id(device_user_id)
    if not pin:
        return None

    base = BiometricEmployeeMap.query.filter_by(device_user_id=pin, is_active=True)
    if device_id is not None:
        specific = base.filter_by(device_id=device_id).first()
        if specific:
            return specific
    global_map = base.filter(BiometricEmployeeMap.device_id.is_(None)).first()
    if global_map:
        return global_map
    return base.first()


def _admin_eligible(admin) -> bool:
    """Reuse HRMS login eligibility (inactive / exited)."""
    try:
        from ..offboarding_service import admin_login_allowed

        return bool(admin_login_allowed(admin))
    except Exception:
        if admin is None:
            return False
        if getattr(admin, "is_active", True) is False:
            return False
        if getattr(admin, "is_exited", False):
            return False
        return True


def _load_admin_model():
    """
    Use Admin only when already registered (create_app / 3C stub).
    Isolated Phase 3B ingest tests do not load Admin_models.
    """
    import sys

    mod = sys.modules.get("website.models.Admin_models")
    if mod is not None and getattr(mod, "Admin", None) is not None:
        return mod.Admin
    return None


def resolve_biometric_employee(
    device_user_id: str,
    *,
    device_id: Optional[int] = None,
) -> MappingResolution:
    """
    Authoritative resolver: eSSL User ID == Admin.emp_id (exact string).

    Mapping rows cannot override Admin.emp_id. If a map exists it must agree:
      device_user_id == map.emp_id == Admin.emp_id
      map.admin_id == Admin.id

    Statuses (no attendance when not ok):
      unknown_employee | invalid_mapping | ambiguous_employee_mapping | employee_inactive
    """
    pin = _norm_device_user_id(device_user_id)
    if not pin:
        return MappingResolution(
            ok=False,
            status="unknown_employee",
            error_message="empty_device_user_id",
        )

    Admin = _load_admin_model()
    if Admin is None:
        return MappingResolution(
            ok=False,
            status="unknown_employee",
            error_message="admin_model_unavailable",
        )

    try:
        matches = Admin.query.filter_by(emp_id=pin).all()
    except Exception:
        logger.exception("BIOMETRIC_ADMIN_LOOKUP_FAILED pin=%s", pin)
        return MappingResolution(
            ok=False,
            status="unknown_employee",
            error_message="admin_lookup_failed",
        )

    if len(matches) == 0:
        return MappingResolution(
            ok=False,
            emp_id=pin,
            status="unknown_employee",
            error_message="no_admin_emp_id_match",
        )
    if len(matches) > 1:
        logger.warning(
            "BIOMETRIC_AMBIGUOUS_EMP_ID emp_id=%s count=%s",
            pin,
            len(matches),
        )
        return MappingResolution(
            ok=False,
            emp_id=pin,
            status="ambiguous_employee_mapping",
            error_message=f"duplicate_admin_emp_id count={len(matches)}",
        )

    admin = matches[0]
    mapping = find_employee_map(pin, device_id=device_id)
    if mapping is not None:
        map_emp = _norm_emp_id(getattr(mapping, "emp_id", None))
        map_pin = _norm_device_user_id(getattr(mapping, "device_user_id", None))
        map_admin_id = getattr(mapping, "admin_id", None)
        admin_emp = _norm_emp_id(getattr(admin, "emp_id", None))
        consistent = (
            map_pin == pin
            and map_emp == pin
            and admin_emp == pin
            and map_admin_id is not None
            and int(map_admin_id) == int(admin.id)
        )
        if not consistent:
            logger.warning(
                "BIOMETRIC_INVALID_MAPPING mapping_id=%s pin=%s map_emp_id=%s "
                "map_admin_id=%s admin_id=%s admin_emp_id=%s",
                mapping.id,
                pin,
                map_emp,
                map_admin_id,
                admin.id,
                admin_emp,
            )
            return MappingResolution(
                ok=False,
                emp_id=pin,
                mapping_id=mapping.id,
                admin_id=int(admin.id),
                status="invalid_mapping",
                error_message="mapping_inconsistent_with_admin_emp_id",
                admin_name=getattr(admin, "first_name", None),
            )

    if not _admin_eligible(admin):
        return MappingResolution(
            ok=False,
            admin_id=int(admin.id),
            emp_id=pin,
            mapping_id=getattr(mapping, "id", None),
            status="employee_inactive",
            error_message="employee_inactive",
            admin_name=getattr(admin, "first_name", None),
        )

    return MappingResolution(
        ok=True,
        admin_id=int(admin.id),
        emp_id=pin,
        mapping_id=getattr(mapping, "id", None),
        admin_name=getattr(admin, "first_name", None),
    )


def resolve_admin_for_device_user(
    device_user_id: str,
    *,
    device_id: Optional[int] = None,
) -> MappingResolution:
    """Backward-compatible alias for resolve_biometric_employee."""
    return resolve_biometric_employee(device_user_id, device_id=device_id)


def describe_mapping(
    device_user_id: str,
    *,
    device_id: Optional[int] = None,
) -> dict[str, Any]:
    """
    Ops/audit helper: device_user_id, emp_id, Admin.id, name, mapping status.
    Does not create attendance.
    """
    pin = _norm_device_user_id(device_user_id)
    mapping = find_employee_map(pin, device_id=device_id) if pin else None
    resolution = resolve_admin_for_device_user(pin, device_id=device_id)
    return {
        "device_id": device_id,
        "device_user_id": pin,
        "mapping_id": getattr(mapping, "id", None),
        "map_admin_id": getattr(mapping, "admin_id", None),
        "map_emp_id": _norm_emp_id(getattr(mapping, "emp_id", None)) if mapping else None,
        "resolved_admin_id": resolution.admin_id,
        "resolved_emp_id": resolution.emp_id,
        "employee_name": resolution.admin_name,
        "mapping_status": resolution.as_audit_dict()["mapping_status"],
        "error_message": resolution.error_message,
    }


def audit_all_mappings(*, include_inactive_maps: bool = False) -> dict[str, Any]:
    """
    Read-only inventory of BiometricEmployeeMap vs Admin.
    Never writes or repairs production data.
    """
    import sys
    from collections import defaultdict

    from .models import BiometricDevice

    _admin_mod = sys.modules.get("website.models.Admin_models")
    if _admin_mod is not None and getattr(_admin_mod, "Admin", None) is not None:
        Admin = _admin_mod.Admin
    else:
        from ..models.Admin_models import Admin

    q = BiometricEmployeeMap.query
    if not include_inactive_maps:
        q = q.filter_by(is_active=True)
    rows = q.order_by(BiometricEmployeeMap.id.asc()).all()

    buckets: dict[str, list[dict[str, Any]]] = {
        "valid": [],
        "missing_emp_id": [],
        "unknown_emp_id": [],
        "admin_mismatch": [],
        "inactive_employee": [],
        "duplicate_device_mapping": [],
    }

    key_counts: dict[tuple, list[int]] = defaultdict(list)
    for m in rows:
        key_counts[(m.device_user_id, m.device_id)].append(m.id)

    duplicate_ids = {
        mid
        for ids in key_counts.values()
        if len(ids) > 1
        for mid in ids
    }

    devices = {d.id: d for d in BiometricDevice.query.all()}

    for m in rows:
        admin = None
        if m.admin_id is not None:
            try:
                admin = Admin.query.get(int(m.admin_id))
            except (TypeError, ValueError):
                admin = None

        map_emp = _norm_emp_id(m.emp_id)
        admin_emp = _norm_emp_id(getattr(admin, "emp_id", None)) if admin else None
        name = None
        if admin is not None:
            parts = [
                getattr(admin, "first_name", None) or "",
                getattr(admin, "last_name", None) or "",
            ]
            name = " ".join(p for p in parts if p).strip() or getattr(admin, "email", None)

        device = devices.get(m.device_id) if m.device_id else None
        rec = {
            "mapping_id": m.id,
            "device_id": m.device_id,
            "device_serial": getattr(device, "serial_number", None),
            "device_user_id": m.device_user_id,
            "map_emp_id": map_emp,
            "map_admin_id": m.admin_id,
            "admin_emp_id": admin_emp,
            "admin_name": name,
            "admin_is_active": getattr(admin, "is_active", None) if admin else None,
            "admin_is_exited": getattr(admin, "is_exited", None) if admin else None,
            "map_is_active": bool(m.is_active),
        }

        category = "valid"
        pin = _norm_device_user_id(m.device_user_id)
        if m.id in duplicate_ids:
            category = "duplicate_device_mapping"
        elif not map_emp:
            category = "missing_emp_id"
        elif pin != map_emp:
            category = "admin_mismatch"
            rec["error_message"] = "device_user_id_ne_emp_id"
        elif admin is None:
            category = "unknown_emp_id"
        elif Admin.query.filter_by(emp_id=map_emp).count() == 0:
            category = "unknown_emp_id"
        elif admin_emp != map_emp or int(admin.id) != int(m.admin_id):
            category = "admin_mismatch"
        else:
            emp_matches = Admin.query.filter_by(emp_id=map_emp).all()
            if len(emp_matches) > 1:
                category = "admin_mismatch"
                rec["error_message"] = "ambiguous_employee_mapping"
            elif emp_matches and emp_matches[0].id != admin.id:
                category = "admin_mismatch"
            elif not _admin_eligible(admin):
                category = "inactive_employee"

        rec["category"] = category
        buckets[category].append(rec)

    devices_out = [
        {
            "id": d.id,
            "serial_number": d.serial_number,
            "name": d.name,
            "is_active": bool(d.is_active),
            "timezone": d.timezone,
            "last_seen_at": d.last_seen_at.isoformat() if d.last_seen_at else None,
            "allowed_ips": d.allowed_ips,
        }
        for d in BiometricDevice.query.order_by(BiometricDevice.id.asc()).all()
    ]

    return {
        "repaired": False,
        "include_inactive_maps": include_inactive_maps,
        "counts": {k: len(v) for k, v in buckets.items()},
        "total_maps": len(rows),
        "devices": devices_out,
        **buckets,
    }
