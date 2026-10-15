"""
Gunicorn settings for production (Phase 5).

Run from backend_HRMS:
  gunicorn -c gunicorn.conf.py wsgi:app

Phase 6 background jobs (optional dedicated worker):
  BACKGROUND_JOBS=1 flask jobs-worker
  (APScheduler also flushes pending jobs every minute when BACKGROUND_JOBS=1)

Tune with env (defaults fit a small 2-vCPU host; raise workers after measuring):
  GUNICORN_BIND, GUNICORN_WORKERS, GUNICORN_THREADS, GUNICORN_TIMEOUT,
  GUNICORN_GRACEFUL_TIMEOUT, GUNICORN_KEEPALIVE, GUNICORN_MAX_REQUESTS,
  GUNICORN_MAX_REQUESTS_JITTER, GUNICORN_LOG_LEVEL
"""
import multiprocessing
import os


def _int(name, default):
    try:
        return int(os.getenv(name, str(default)))
    except ValueError:
        return default


bind = (os.getenv("GUNICORN_BIND") or "0.0.0.0:5000").strip()

# Sync workers: (2 x CPU) + 1 is a common starting point. Cap at 8 so a small
# box is not oversubscribed before Phase-0 capacity numbers are known.
_cpu = multiprocessing.cpu_count() or 1
workers = _int("GUNICORN_WORKERS", min(8, (2 * _cpu) + 1))
threads = _int("GUNICORN_THREADS", 2)
worker_class = (os.getenv("GUNICORN_WORKER_CLASS") or "gthread").strip() or "gthread"

timeout = _int("GUNICORN_TIMEOUT", 120)
graceful_timeout = _int("GUNICORN_GRACEFUL_TIMEOUT", 30)
keepalive = _int("GUNICORN_KEEPALIVE", 5)

# Recycle workers to limit memory growth on long-lived processes.
max_requests = _int("GUNICORN_MAX_REQUESTS", 1000)
max_requests_jitter = _int("GUNICORN_MAX_REQUESTS_JITTER", 100)

accesslog = os.getenv("GUNICORN_ACCESSLOG", "-")
errorlog = os.getenv("GUNICORN_ERRORLOG", "-")
loglevel = (os.getenv("GUNICORN_LOG_LEVEL") or "info").strip() or "info"
capture_output = True
preload_app = False  # keep False: create_app() runs DDL; preload + multi-worker races.

# Forwarded headers when nginx / a load balancer terminates TLS.
forwarded_allow_ips = (os.getenv("GUNICORN_FORWARDED_ALLOW_IPS") or "*").strip() or "*"
