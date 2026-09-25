"""
Shared-DB multi-tenancy helpers (Phase 1 foundation).

Tenant id comes from the JWT claim set at login. Never trust a client-supplied
tenant_id for authorization.
"""
from __future__ import annotations

from typing import Optional

DEFAULT_TENANT_ID = 1


def get_current_tenant_id(*, default: Optional[int] = DEFAULT_TENANT_ID) -> Optional[int]:
    """Return tenant_id from JWT claims, or default."""
    try:
        from flask_jwt_extended import get_jwt

        claims = get_jwt() or {}
        raw = claims.get("tenant_id")
        if raw is None or raw == "":
            return default
        return int(raw)
    except Exception:
        return default


def tenant_id_for_admin(admin) -> int:
    """Resolve tenant for an Admin row (login / token issue)."""
    if admin is None:
        return DEFAULT_TENANT_ID
    tid = getattr(admin, "tenant_id", None)
    try:
        if tid is not None:
            return int(tid)
    except (TypeError, ValueError):
        pass
    return DEFAULT_TENANT_ID


def require_same_tenant(resource_tenant_id, *, claims_tenant_id=None) -> bool:
    """True if resource belongs to the caller's tenant."""
    caller = claims_tenant_id
    if caller is None:
        caller = get_current_tenant_id()
    if caller is None or resource_tenant_id is None:
        return False
    try:
        return int(caller) == int(resource_tenant_id)
    except (TypeError, ValueError):
        return False
