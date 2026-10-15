"""
Phase 6 background jobs: bulk exports, mass emails, recalculations.

BACKGROUND_JOBS unset/off: endpoints ignore async=1 and stay synchronous.
When on, async=1 enqueues a row, returns a job ID, and a worker / scheduler /
in-process kick runs it. Redis (CACHE_REDIS_URL) is an optional fast queue;
without it the DB pending list is enough.
"""
from __future__ import annotations

import json
import logging
import os
import threading
from typing import Any, Callable, Optional

from flask import current_app, has_app_context, request

from . import db
from .datetime_utils import utc_now
from .db_perf import env_flag
from .models.background_job import BackgroundJob

logger = logging.getLogger(__name__)

KIND_NEWS_FEED_EMAIL = "news_feed_email"
KIND_COMPLIANCE_PF_ECR = "compliance_pf_ecr"
KIND_PAYROLL_TDS_RECALC = "payroll_tds_recalc"

STATUS_PENDING = "pending"
STATUS_RUNNING = "running"
STATUS_SUCCEEDED = "succeeded"
STATUS_FAILED = "failed"

_HANDLERS: dict[str, Callable[[BackgroundJob, dict], dict]] = {}
_REDIS_QUEUE_SUFFIX = "jobs:queue"


def jobs_enabled() -> bool:
    if has_app_context():
        return bool(current_app.config.get("BACKGROUND_JOBS"))
    return env_flag("BACKGROUND_JOBS")


def configure_app(app):
    app.config["BACKGROUND_JOBS"] = env_flag("BACKGROUND_JOBS")
    try:
        app.config["BACKGROUND_JOBS_BATCH"] = max(1, int(os.getenv("BACKGROUND_JOBS_BATCH", "20")))
    except ValueError:
        app.config["BACKGROUND_JOBS_BATCH"] = 20


def want_async(req=None) -> bool:
    """True when BACKGROUND_JOBS is on and the caller asked for async=1."""
    if not jobs_enabled():
        return False
    req = req or request
    raw = None
    try:
        raw = req.args.get("async")
    except Exception:
        raw = None
    if raw is None:
        try:
            raw = req.form.get("async")
        except Exception:
            raw = None
    if raw is None:
        try:
            body = req.get_json(silent=True) or {}
            if isinstance(body, dict):
                raw = body.get("async")
        except Exception:
            raw = None
    if raw is None:
        return False
    if isinstance(raw, bool):
        return raw
    return str(raw).strip().lower() in ("1", "true", "yes", "on")


def register_handler(kind: str):
    def decorator(fn: Callable[[BackgroundJob, dict], dict]):
        _HANDLERS[kind] = fn
        return fn

    return decorator


def _loads(raw: Optional[str]) -> dict:
    if not raw:
        return {}
    try:
        data = json.loads(raw)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _dumps(value: Any) -> str:
    return json.dumps(value if value is not None else {}, default=str)


def job_to_dict(job: BackgroundJob, *, include_result: bool = True) -> dict:
    out = {
        "id": job.id,
        "tenant_id": job.tenant_id,
        "kind": job.kind,
        "status": job.status,
        "requested_by_admin_id": job.requested_by_admin_id,
        "created_at": job.created_at.isoformat() + "Z" if job.created_at else None,
        "started_at": job.started_at.isoformat() + "Z" if job.started_at else None,
        "finished_at": job.finished_at.isoformat() + "Z" if job.finished_at else None,
        "error_message": job.error_message,
        "async": True,
    }
    if include_result and job.result_json:
        result = _loads(job.result_json)
        # Keep large CSV out of list/status payloads unless asked via download.
        if "csv" in result and len(str(result.get("csv") or "")) > 4000:
            result = {**result, "csv": None, "has_csv": True}
        out["result"] = result
    elif include_result:
        out["result"] = None
    return out


def _queue_key() -> str:
    from .cache import _key_prefix

    return f"{_key_prefix()}:{_REDIS_QUEUE_SUFFIX}"


def _push_redis(job_id: int) -> None:
    try:
        from .cache import client

        c = client()
        if c is None:
            return
        c.lpush(_queue_key(), str(int(job_id)))
    except Exception as exc:
        logger.debug("jobs redis push skipped: %s", exc)


def _pop_redis(timeout: int = 0) -> Optional[int]:
    try:
        from .cache import client

        c = client()
        if c is None:
            return None
        if timeout and hasattr(c, "brpop"):
            item = c.brpop(_queue_key(), timeout=timeout)
            if not item:
                return None
            raw = item[1] if isinstance(item, (list, tuple)) else item
        else:
            raw = c.rpop(_queue_key()) if hasattr(c, "rpop") else None
            if raw is None:
                return None
        if isinstance(raw, bytes):
            raw = raw.decode()
        return int(raw)
    except Exception as exc:
        logger.debug("jobs redis pop skipped: %s", exc)
        return None


def enqueue(
    kind: str,
    payload: dict,
    *,
    tenant_id: int,
    requested_by_admin_id: Optional[int] = None,
    kick: bool = True,
) -> BackgroundJob:
    job = BackgroundJob(
        tenant_id=int(tenant_id),
        kind=kind,
        status=STATUS_PENDING,
        requested_by_admin_id=requested_by_admin_id,
        payload_json=_dumps(payload or {}),
    )
    db.session.add(job)
    db.session.commit()
    _push_redis(job.id)
    if kick:
        kick_job(job.id)
    return job


def kick_job(job_id: int) -> None:
    """Best-effort in-process run so local/dev does not need a separate worker."""
    if not has_app_context():
        return
    app = current_app._get_current_object()

    def _run():
        with app.app_context():
            try:
                process_job(int(job_id))
            except Exception as exc:
                logger.exception("background job kick failed id=%s: %s", job_id, exc)
                try:
                    db.session.rollback()
                except Exception:
                    pass

    threading.Thread(target=_run, daemon=True, name=f"bg-job-{job_id}").start()


def _claim(job_id: int) -> Optional[BackgroundJob]:
    job = db.session.get(BackgroundJob, int(job_id))
    if job is None or job.status != STATUS_PENDING:
        return None
    job.status = STATUS_RUNNING
    job.started_at = utc_now()
    job.error_message = None
    try:
        db.session.commit()
    except Exception:
        db.session.rollback()
        return None
    return job


def process_job(job_id: int) -> bool:
    """Run one job. Returns True when it finished (success or failure)."""
    job = _claim(int(job_id))
    if job is None:
        return False
    handler = _HANDLERS.get(job.kind)
    payload = _loads(job.payload_json)
    if handler is None:
        job.status = STATUS_FAILED
        job.error_message = f"Unknown job kind: {job.kind}"
        job.finished_at = utc_now()
        db.session.commit()
        return True
    try:
        from .tenant_context import tenant_scope

        with tenant_scope(job.tenant_id):
            result = handler(job, payload) or {}
        job.result_json = _dumps(result)
        job.status = STATUS_SUCCEEDED
        job.finished_at = utc_now()
        db.session.commit()
        return True
    except Exception as exc:
        db.session.rollback()
        job = db.session.get(BackgroundJob, int(job_id))
        if job is not None:
            job.status = STATUS_FAILED
            job.error_message = str(exc)[:2000]
            job.finished_at = utc_now()
            db.session.commit()
        logger.exception("background job %s failed: %s", job_id, exc)
        return True


def process_pending(*, limit: Optional[int] = None) -> int:
    """Drain pending jobs (Redis ids first, then DB). Returns how many finished."""
    if limit is None:
        if has_app_context():
            limit = int(current_app.config.get("BACKGROUND_JOBS_BATCH") or 20)
        else:
            limit = 20
    limit = max(1, int(limit))
    done = 0
    seen = set()
    for _ in range(limit):
        jid = _pop_redis(timeout=0)
        if jid is None:
            break
        if jid in seen:
            continue
        seen.add(jid)
        if process_job(jid):
            done += 1
    if done >= limit:
        return done
    remaining = limit - done
    rows = (
        BackgroundJob.query.filter_by(status=STATUS_PENDING)
        .order_by(BackgroundJob.id.asc())
        .limit(remaining)
        .all()
    )
    for row in rows:
        if row.id in seen:
            continue
        if process_job(row.id):
            done += 1
    return done


def _write_export_file(job: BackgroundJob, filename: str, content: bytes | str) -> str:
    """Write export bytes under the tenant uploads tree; return relative storage path."""
    from .upload_tenancy import tenant_upload_path

    root = current_app.config.get("UPLOADS_ROOT") or current_app.config.get("UPLOAD_FOLDER")
    if not root:
        root = os.path.join(current_app.root_path, "static", "uploads")
    abs_path, rel = tenant_upload_path(root, f"jobs/{job.id}/{filename}", tenant_id=job.tenant_id)
    data = content.encode("utf-8") if isinstance(content, str) else content
    with open(abs_path, "wb") as fh:
        fh.write(data)
    return rel


# ----- handlers -------------------------------------------------------------

@register_handler(KIND_NEWS_FEED_EMAIL)
def _handle_news_feed_email(job: BackgroundJob, payload: dict) -> dict:
    from .email import send_news_feed_announcement_email

    ok, msg, recipient_count = send_news_feed_announcement_email(
        title=payload.get("title"),
        content=payload.get("content"),
        circle=payload.get("circle"),
        emp_type=payload.get("emp_type"),
        attachment_abs_path=payload.get("attachment_abs_path"),
    )
    if not ok:
        raise RuntimeError(msg or "News feed email failed")
    return {
        "ok": True,
        "recipient_count": recipient_count,
        "message": msg,
        "news_feed_id": payload.get("news_feed_id"),
    }


@register_handler(KIND_COMPLIANCE_PF_ECR)
def _handle_compliance_pf_ecr(job: BackgroundJob, payload: dict) -> dict:
    import calendar

    from .compliance_export_service import build_pf_ecr_export

    year = int(payload["year"])
    month_num = int(payload["month_num"])
    circle = (payload.get("circle") or "").strip() or None
    emp_type = (payload.get("emp_type") or "").strip() or None
    built = build_pf_ecr_export(
        year=year,
        month_num=month_num,
        tenant_id=job.tenant_id,
        circle=circle,
        emp_type=emp_type,
    )
    fname = f"pf-ecr-{calendar.month_name[month_num]}-{year}.csv".replace(" ", "-")
    rel = _write_export_file(job, fname, built.get("csv") or "")
    return {
        "ok": True,
        "filename": fname,
        "download_path": rel,
        "row_count": int(built.get("row_count") or 0),
        "year": year,
        "month_num": month_num,
        "month_name": built.get("month_name"),
    }


@register_handler(KIND_PAYROLL_TDS_RECALC)
def _handle_payroll_tds_recalc(job: BackgroundJob, payload: dict) -> dict:
    from . import payroll_tds_service as payroll_tds
    from .models.Admin_models import Admin
    from .tenant_context import tenant_admin_query

    financial_year = (payload.get("financial_year") or "").strip()
    if not financial_year:
        raise ValueError("financial_year is required")
    admin_id = payload.get("admin_id")
    if admin_id not in (None, ""):
        ids = [int(admin_id)]
    else:
        ids = [int(r[0]) for r in tenant_admin_query(job.tenant_id).with_entities(Admin.id).all()]
    updated_rows = 0
    employees = 0
    for aid in ids:
        n = payroll_tds.recalculate_payroll_tds_for_financial_year(int(aid), financial_year)
        if n:
            employees += 1
            updated_rows += int(n)
    db.session.commit()
    return {
        "ok": True,
        "financial_year": financial_year,
        "employees": employees,
        "updated_rows": updated_rows,
        "scoped_admin_id": int(admin_id) if admin_id not in (None, "") else None,
    }
