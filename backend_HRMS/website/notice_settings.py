"""Per-company notice period: default days plus optional circle overrides."""
from __future__ import annotations

from typing import Optional

_NAMESPACE = "notice"
_DEFAULT_DAYS = 30


def _company_store():
    try:
        from . import company_settings
    except Exception:
        return None
    return company_settings if company_settings.available() else None


def load_notice_settings(tenant_id: Optional[int] = None) -> dict:
    store = _company_store()
    default_days = _DEFAULT_DAYS
    by_circle = {}
    if store is not None:
        saved = store.stored_settings(_NAMESPACE, store.settings_tenant_id(tenant_id)) or {}
        raw = saved.get("by_circle") if isinstance(saved.get("by_circle"), dict) else {}
        for name, days in raw.items():
            key = str(name or "").strip()
            if not key:
                continue
            try:
                by_circle[key] = max(1, min(365, int(days)))
            except (TypeError, ValueError):
                continue
    return {"default_days": default_days, "by_circle": by_circle}


def _norm_circle(value) -> str:
    return " ".join(str(value or "").strip().split()).casefold()


def save_notice_settings(updates: dict, tenant_id: Optional[int] = None, *, admin_id=None) -> dict:
    current = load_notice_settings(tenant_id)
    if "by_circle" in updates:
        raw = updates.get("by_circle") if isinstance(updates.get("by_circle"), dict) else {}
        next_map = {}
        for name, days in raw.items():
            key = str(name or "").strip()
            if not key:
                continue
            try:
                next_map[key] = max(1, min(365, int(days)))
            except (TypeError, ValueError) as exc:
                raise ValueError(f"Notice days for {key} must be a whole number") from exc
        current["by_circle"] = next_map
    current["default_days"] = _DEFAULT_DAYS
    store = _company_store()
    if store is None:
        raise RuntimeError("Notice settings can only be saved inside the app")
    store.save_settings(_NAMESPACE, store.settings_tenant_id(tenant_id), current, admin_id=admin_id)
    return current


def circle_employee_counts(tenant_id: Optional[int] = None) -> dict:
    """How many Admin rows in this tenant sit in each circle (no other tenant)."""
    from .tenant_context import tenant_admin_query

    counts = {}
    for admin in tenant_admin_query(tenant_id).all():
        raw = str(getattr(admin, "circle", None) or "").strip()
        if not raw:
            continue
        counts[_norm_circle(raw)] = counts.get(_norm_circle(raw), 0) + 1
        counts[raw] = counts.get(_norm_circle(raw), 0)
    return counts


def notice_period_days_for(admin=None, circle: Optional[str] = None, tenant_id: Optional[int] = None) -> int:
    if tenant_id is None and admin is not None:
        from .tenant_context import tenant_id_for_admin

        tenant_id = tenant_id_for_admin(admin)
    settings = load_notice_settings(tenant_id)
    needle = _norm_circle(circle if circle is not None else getattr(admin, "circle", None))
    if needle:
        for name, days in (settings.get("by_circle") or {}).items():
            if _norm_circle(name) == needle:
                return int(days)
    return int(settings.get("default_days") or _DEFAULT_DAYS)
