"""Lightweight in-process rate limiter for abuse / OTP bombing protection.

Works per gunicorn worker (not a distributed store). Pair with nginx limits in production.
"""
from __future__ import annotations

import threading
import time
from collections import defaultdict, deque
from typing import Deque, Dict, Tuple

from flask import jsonify, request

_lock = threading.Lock()
_buckets: Dict[str, Deque[float]] = defaultdict(deque)


def client_ip() -> str:
    forwarded = (request.headers.get("X-Forwarded-For") or "").split(",")[0].strip()
    if forwarded:
        return forwarded
    return (request.remote_addr or "unknown").strip() or "unknown"


def _prune(q: Deque[float], window_seconds: float, now: float) -> None:
    cutoff = now - window_seconds
    while q and q[0] < cutoff:
        q.popleft()


def hit(key: str, *, limit: int, window_seconds: int) -> Tuple[bool, int]:
    """
    Record one hit. Returns (allowed, retry_after_seconds).
    If not allowed, the hit is not stored.
    """
    if limit <= 0 or window_seconds <= 0:
        return True, 0
    now = time.monotonic()
    with _lock:
        q = _buckets[key]
        _prune(q, float(window_seconds), now)
        if len(q) >= limit:
            retry = max(1, int(window_seconds - (now - q[0])) + 1)
            return False, retry
        q.append(now)
        return True, 0


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
