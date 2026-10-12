"""
Scheduled jobs per tenant (shared-DB multi-tenancy, rollout step 9).

The scheduler runs each daily job once per accessible tenant inside
``tenant_scope`` so tenant helpers, plan checks and company mailboxes resolve to
that tenant. Job functions take ``tenant_id=None``: None keeps the old
all-tenants behaviour for CLI commands.
"""
from __future__ import annotations

from typing import Callable, Optional

from sqlalchemy import true

from .tenant_context import (
    BLOCKED_TENANT_STATUSES,
    DEFAULT_TENANT_ID,
    admin_tenant_clause,
    tenant_admin_ids,
    tenant_scope,
)


def job_tenant_ids() -> list[int]:
    """Tenants the daily jobs run for: the default tenant plus every active one."""
    ids = {DEFAULT_TENANT_ID}
    try:
        from .models.tenant import Tenant

        for tid, status in Tenant.query.with_entities(Tenant.id, Tenant.status).all():
            if (status or "active").strip().lower() not in BLOCKED_TENANT_STATUSES:
                ids.add(int(tid))
    except Exception:
        pass
    return sorted(ids)


def admin_scope(tenant_id: Optional[int]):
    """Condition on Admin rows for one tenant; no condition when tenant_id is None."""
    return true() if tenant_id is None else admin_tenant_clause(tenant_id)


def admin_id_scope(column, tenant_id: Optional[int]):
    """Condition on an admin_id column for one tenant; no condition when tenant_id is None."""
    return true() if tenant_id is None else column.in_(tenant_admin_ids(tenant_id))


def run_in_each_tenant_scope(job: Callable[[int], object]) -> dict:
    """``{tenant_id: job(tenant_id)}`` for every job tenant inside its scope; the caller commits."""
    results = {}
    for tid in job_tenant_ids():
        with tenant_scope(tid):
            results[tid] = job(tid)
    return results


def merge_tenant_summaries(results: dict) -> dict:
    """One job summary from per-tenant summaries: numbers add up, other values keep the first."""
    merged: dict = {}
    for summary in results.values():
        for key, value in (summary or {}).items():
            if isinstance(value, (int, float)) and not isinstance(value, bool):
                merged[key] = merged.get(key, 0) + value
            else:
                merged.setdefault(key, value)
    return merged


def run_for_each_tenant(job: Callable[[int], object], *, logger=None, label: str = "job") -> dict:
    """
    Call ``job(tenant_id)`` for every job tenant inside its ``tenant_scope`` and
    commit per tenant, so one company's failure never blocks another's run.
    Returns ``{tenant_id: result}`` (``{"error": ...}`` for a failed tenant).
    """
    from . import db

    results = {}
    for tid in job_tenant_ids():
        try:
            with tenant_scope(tid):
                results[tid] = job(tid)
                db.session.commit()
        except Exception as e:
            db.session.rollback()
            if logger is not None:
                logger.exception("scheduler: %s failed for tenant %s: %s", label, tid, e)
            results[tid] = {"error": str(e)}
    return results
