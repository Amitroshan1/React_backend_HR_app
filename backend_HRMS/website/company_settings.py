"""
Per-company settings storage for the JSON-style policies (``leave``, ``tds``, ``ctc``).

Each company's saved values live in ``company_settings`` (one JSON document per
namespace). A company that never saved gets the module defaults; the default tenant
additionally keeps reading its legacy ``website/data/<namespace>_settings.json`` file,
so an existing single-company install behaves exactly as before until it saves.

Callers keep working without an app / database (unit tests that load a settings module
on its own): ``available()`` is False and the settings module uses its file only.
"""
from __future__ import annotations

import json
from typing import Optional

from .tenant_context import DEFAULT_TENANT_ID, get_current_tenant_id

_CACHE_ATTR = "_company_settings_cache"


def available() -> bool:
    """True inside a real Flask app context (the settings table can be used)."""
    try:
        from flask import has_app_context

        return has_app_context() is True
    except Exception:
        return False


def settings_tenant_id(tenant_id: Optional[int] = None) -> int:
    tid = tenant_id if tenant_id not in (None, "") else get_current_tenant_id()
    return int(tid) if tid is not None else DEFAULT_TENANT_ID


def _cache() -> dict:
    from flask import g

    cache = getattr(g, _CACHE_ATTR, None)
    if cache is None:
        cache = {}
        setattr(g, _CACHE_ATTR, cache)
    return cache


def stored_settings(namespace: str, tenant_id: int) -> Optional[dict]:
    """The company's saved document, or None when it never saved (or the table is unavailable)."""
    key = (namespace, int(tenant_id))
    cache = _cache()
    if key in cache:
        return cache[key]
    data = None
    try:
        from .cache import NS_SETTINGS, cached_json
        from .models.company_setting import CompanySetting

        def load():
            row = CompanySetting.query.filter_by(tenant_id=int(tenant_id), namespace=namespace).first()
            if row is None:
                return {"saved": False, "data": None}
            try:
                parsed = json.loads(row.data or "{}")
            except (TypeError, ValueError):
                parsed = {}
            return {"saved": True, "data": parsed if isinstance(parsed, dict) else {}}

        wrapped = cached_json(NS_SETTINGS, int(tenant_id), namespace, load)
        if isinstance(wrapped, dict) and wrapped.get("saved"):
            data = wrapped.get("data") if isinstance(wrapped.get("data"), dict) else {}
        else:
            data = None
    except Exception:
        data = None
    cache[key] = data
    return data


def save_settings(namespace: str, tenant_id: int, data: dict, *, admin_id: Optional[int] = None) -> None:
    """Insert or replace the company's document and commit."""
    from . import db
    from .models.company_setting import CompanySetting

    row = CompanySetting.query.filter_by(tenant_id=int(tenant_id), namespace=namespace).first()
    if row is None:
        row = CompanySetting(tenant_id=int(tenant_id), namespace=namespace)
        db.session.add(row)
    row.data = json.dumps(data, sort_keys=True)
    row.updated_by_admin_id = admin_id
    db.session.commit()
    _cache()[(namespace, int(tenant_id))] = dict(data)
    from .cache import NS_SETTINGS, bump

    bump(NS_SETTINGS, int(tenant_id))


def company_name(tenant_id: int) -> str:
    """The company's registered name ('' when unknown)."""
    try:
        from . import db
        from .models.tenant import Tenant

        row = db.session.get(Tenant, int(tenant_id))
        return (row.name or "").strip() if row else ""
    except Exception:
        return ""
