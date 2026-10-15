"""Rate limiter for abuse / OTP bombing protection.

With RATE_LIMIT_BACKEND=redis (or auto and CACHE_REDIS_URL set) every gunicorn worker
shares one Redis counter. If Redis is down, or the backend is memory, this process
keeps the original in-memory buckets.
"""
from __future__ import annotations

import logging
import threading
import time
from collections import defaultdict, deque
from typing import Deque, Dict, Tuple

from flask import current_app, has_app_context, jsonify, request

logger = logging.getLogger(__name__)

_lock = threading.Lock()
_buckets: Dict[str, Deque[float]] = defaultdict(deque)
_redis_failed = False


def client_ip() -> str:
    forwarded = (request.headers.get("X-Forwarded-For") or "").split(",")[0].strip()
    if forwarded:
        return forwarded
    return (request.remote_addr or "unknown").strip() or "unknown"


def _backend() -> str:
    if has_app_context():
        raw = (current_app.config.get("RATE_LIMIT_BACKEND") or "auto").strip().lower()
    else:
        raw = "auto"
    if raw in ("redis", "memory"):
        return raw
    from .cache import redis_url

    return "redis" if redis_url() else "memory"


def _prune(q: Deque[float], window_seconds: float, now: float) -> None:
    cutoff = now - window_seconds
    while q and q[0] < cutoff:
        q.popleft()


def _hit_memory(key: str, *, limit: int, window_seconds: int) -> Tuple[bool, int]:
    now = time.monotonic()
    with _lock:
        q = _buckets[key]
        _prune(q, float(window_seconds), now)
        if len(q) >= limit:
            retry = max(1, int(window_seconds - (now - q[0])) + 1)
            return False, retry
        q.append(now)
        return True, 0


def _hit_redis(key: str, *, limit: int, window_seconds: int) -> Tuple[bool, int] | None:
    """(allowed, retry) or None when Redis cannot be used for this hit."""
    from .cache import client, _key_prefix

    c = client()
    if c is None:
        return None
    redis_key = f"{_key_prefix()}:rl:{key}"
    try:
        n = c.incr(redis_key)
        if n == 1:
            c.expire(redis_key, window_seconds)
        ttl = int(c.ttl(redis_key) or window_seconds)
        if n > limit:
            return False, max(1, ttl)
        return True, 0
    except Exception as exc:
        global _redis_failed
        if not _redis_failed:
            logger.warning("Redis rate limit unavailable (%s); using in-memory limiter", exc)
            _redis_failed = True
        return None


def hit(key: str, *, limit: int, window_seconds: int) -> Tuple[bool, int]:
    """
    Record one hit. Returns (allowed, retry_after_seconds).
    If not allowed, the hit is not stored (memory backend) / already stored (Redis INCR).
    """
    if limit <= 0 or window_seconds <= 0:
        return True, 0
    if _backend() == "redis":
        result = _hit_redis(key, limit=limit, window_seconds=window_seconds)
        if result is not None:
            return result
    return _hit_memory(key, limit=limit, window_seconds=window_seconds)


def enforce(key: str, *, limit: int, window_seconds: int, message: str | None = None):
    """Return a Flask (json, status) tuple when limited, else None."""
    allowed, retry = hit(key, limit=limit, window_seconds=window_seconds)
    if allowed:
        return None
    body = {
        "success": False,
        "message": message or "Too many requests. Please try again later.",
        "retry_after": retry,
    }
    return jsonify(body), 429
