"""
Optional Redis cache for slow-changing company data (Phase 5).

CACHE_REDIS_URL unset, Redis down, or a timeout: every helper is a no-op and the
caller reads the database as before. Entries expire (CACHE_DEFAULT_TIMEOUT, 5 minutes)
and writers call bump() so the next reader misses.
"""
from __future__ import annotations

import json
import logging
import os
from datetime import date
from typing import Optional

from flask import current_app, has_app_context

logger = logging.getLogger(__name__)

NS_PLAN = "plan"
NS_MASTER = "master"
NS_HOLIDAYS = "holidays"
NS_SETTINGS = "settings"

_DISABLED = object()
_client = None
_warned = False


def _timeout():
    try:
        return max(0.05, float(os.getenv("CACHE_REDIS_TIMEOUT", "0.2")))
    except ValueError:
        return 0.2


def _ttl():
    if has_app_context():
        try:
            return int(current_app.config.get("CACHE_DEFAULT_TIMEOUT") or 300)
        except (TypeError, ValueError):
            return 300
    try:
        return int(os.getenv("CACHE_DEFAULT_TIMEOUT", "300"))
    except ValueError:
        return 300


def redis_url():
    if has_app_context():
        return (current_app.config.get("CACHE_REDIS_URL") or "").strip()
    return (os.getenv("CACHE_REDIS_URL") or "").strip()


def _key_prefix():
    if has_app_context():
        return (current_app.config.get("CACHE_KEY_PREFIX") or "hrms").strip() or "hrms"
    return (os.getenv("CACHE_KEY_PREFIX") or "hrms").strip() or "hrms"


def client():
    """Shared Redis client, or None when caching is off / Redis is unreachable."""
    global _client, _warned
    url = redis_url()
    if not url:
        return None
    if _client is _DISABLED:
        return None
    if _client is not None:
        return _client
    try:
        import redis
    except ImportError:
        if not _warned:
            logger.warning("CACHE_REDIS_URL is set but the redis package is not installed")
            _warned = True
        _client = _DISABLED
        return None
    try:
        c = redis.Redis.from_url(url, socket_timeout=_timeout(), socket_connect_timeout=_timeout())
        c.ping()
        _client = c
        return c
    except Exception as exc:
        if not _warned:
            logger.warning("Redis cache unavailable (%s); reading the database instead", exc)
            _warned = True
        _client = _DISABLED
        return None


def reset_client():
    """Drop the cached client (tests)."""
    global _client, _warned
    _client = None
    _warned = False


def _epoch_key(ns, tenant_id):
    return f"{_key_prefix()}:v:{ns}:{int(tenant_id)}"


def _epoch(ns, tenant_id):
    c = client()
    if c is None:
        return "0"
    try:
        raw = c.get(_epoch_key(ns, tenant_id))
    except Exception:
        return "0"
    if raw is None:
        return "0"
    return raw.decode() if isinstance(raw, bytes) else str(raw)


def bump(ns, tenant_id):
    """Invalidate every cached value for this namespace and company."""
    c = client()
    if c is None:
        return
    try:
        c.incr(_epoch_key(ns, tenant_id))
    except Exception as exc:
        logger.debug("cache bump skipped: %s", exc)


def _value_key(ns, tenant_id, name):
    return f"{_key_prefix()}:{ns}:{int(tenant_id)}:{_epoch(ns, tenant_id)}:{name}"


def get_json(ns, tenant_id, name):
    c = client()
    if c is None:
        return None
    try:
        raw = c.get(_value_key(ns, tenant_id, name))
    except Exception:
        return None
    if raw is None:
        return None
    try:
        return json.loads(raw)
    except (TypeError, ValueError):
        return None


def set_json(ns, tenant_id, name, value, ttl=None):
    c = client()
    if c is None:
        return
    try:
        c.setex(_value_key(ns, tenant_id, name), int(ttl or _ttl()), json.dumps(value, default=str))
    except Exception as exc:
        logger.debug("cache set skipped: %s", exc)


def cached_json(ns, tenant_id, name, loader, ttl=None):
    """Return the cached JSON, or load, store and return it."""
    hit = get_json(ns, tenant_id, name)
    if hit is not None:
        return hit
    value = loader()
    set_json(ns, tenant_id, name, value, ttl=ttl)
    return value


def configure_app(app):
    app.config["CACHE_REDIS_URL"] = (os.getenv("CACHE_REDIS_URL") or "").strip()
    try:
        app.config["CACHE_DEFAULT_TIMEOUT"] = int(os.getenv("CACHE_DEFAULT_TIMEOUT", "300"))
    except ValueError:
        app.config["CACHE_DEFAULT_TIMEOUT"] = 300
    app.config["CACHE_KEY_PREFIX"] = (os.getenv("CACHE_KEY_PREFIX") or "hrms").strip() or "hrms"
    app.config["RATE_LIMIT_BACKEND"] = (os.getenv("RATE_LIMIT_BACKEND") or "auto").strip().lower() or "auto"


# ----- payload helpers used by the app -------------------------------------

def _holiday_payload(row):
    return {
        "id": row.id,
        "year": row.year,
        "holiday_name": row.holiday_name,
        "holiday_date": row.holiday_date.isoformat() if row.holiday_date else None,
        "is_optional": bool(row.is_optional),
        "is_active": bool(row.is_active),
    }


def active_master_names(tenant_id, master_type):
    from .master_data_tenancy import master_query
    from .models.master_data import MasterData

    def load():
        rows = (
            master_query(tenant_id).filter_by(master_type=master_type, is_active=True)
            .order_by(MasterData.name.asc())
            .all()
        )
        return [row.name for row in rows]

    return cached_json(NS_MASTER, tenant_id, master_type, load)


def active_holidays_for_year(tenant_id, year):
    from .master_data_tenancy import holiday_query
    from .models.holiday_calendar import HolidayCalendar

    def load():
        rows = (
            holiday_query(tenant_id).filter(
                HolidayCalendar.year == int(year),
                HolidayCalendar.is_active.is_(True),
            ).all()
        )
        return [_holiday_payload(row) for row in rows]

    return cached_json(NS_HOLIDAYS, tenant_id, str(int(year)), load)


def bump_master(tenant_id=None):
    from .tenant_context import get_current_tenant_id

    bump(NS_MASTER, tenant_id if tenant_id is not None else get_current_tenant_id())


def bump_holidays(tenant_id=None):
    from .tenant_context import get_current_tenant_id

    bump(NS_HOLIDAYS, tenant_id if tenant_id is not None else get_current_tenant_id())


def holiday_as_date(value):
    if isinstance(value, date):
        return value
    if not value:
        return None
    try:
        return date.fromisoformat(str(value)[:10])
    except (TypeError, ValueError):
        return None


def holiday_namespace(row):
    from types import SimpleNamespace

    d = holiday_as_date(row.get("holiday_date") if isinstance(row, dict) else getattr(row, "holiday_date", None))
    if d is None:
        return None
    if isinstance(row, dict):
        return SimpleNamespace(
            holiday_date=d,
            holiday_name=row.get("holiday_name"),
            is_optional=bool(row.get("is_optional")),
            is_active=bool(row.get("is_active", True)),
        )
    return row
