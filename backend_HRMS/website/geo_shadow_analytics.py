"""
Shadow / rollout comparison analytics.

Reads geo_engine_comparisons only — does not alter punch or existing audit metrics.
"""
from __future__ import annotations

import csv
import io
from datetime import datetime
from typing import Any, Optional

from sqlalchemy import case, func

from . import db
from .geo_analytics_service import _pct, resolve_date_range
from .geo_fence_config import get_geo_fence_config
from .geo_mode_orchestrator import get_engine_mode
from .models.Admin_models import Admin
from .models.geo_engine_comparison import GeoEngineComparison


def _q(start: datetime, end: datetime):
    return GeoEngineComparison.query.filter(
        GeoEngineComparison.created_at >= start,
        GeoEngineComparison.created_at <= end,
    )


def build_comparison_summary(start: datetime, end: datetime) -> dict[str, Any]:
    q = _q(start, end)
    total = q.count()
    if total == 0:
        return {
            "total_compared": 0,
            "decision_match_pct": 0.0,
            "policy_match_pct": 0.0,
            "reason_match_pct": 0.0,
            "decision_difference_pct": 0.0,
            "legacy_counts": {},
            "v2_counts": {},
            "avg_confidence": None,
            "avg_execution_legacy_ms": None,
            "avg_execution_v2_ms": None,
            "p95_legacy_ms": None,
            "p95_v2_ms": None,
            "p99_legacy_ms": None,
            "p99_v2_ms": None,
            "v2_error_rate_pct": 0.0,
            "daily_trend": [],
            "weekly_trend": [],
            "period": {"from": start.isoformat(), "to": end.isoformat()},
        }

    decision_matches = q.filter(GeoEngineComparison.decision_match.is_(True)).count()
    policy_matches = q.filter(GeoEngineComparison.policy_match.is_(True)).count()
    reason_matches = q.filter(GeoEngineComparison.reason_match.is_(True)).count()
    v2_fail = q.filter(GeoEngineComparison.comparison_status == "v2_failed").count()

    avgs = (
        db.session.query(
            func.avg(GeoEngineComparison.v2_confidence),
            func.avg(GeoEngineComparison.execution_time_legacy_ms),
            func.avg(GeoEngineComparison.execution_time_v2_ms),
        )
        .filter(
            GeoEngineComparison.created_at >= start,
            GeoEngineComparison.created_at <= end,
        )
        .one()
    )

    legacy_rows = (
        db.session.query(GeoEngineComparison.legacy_decision, func.count(GeoEngineComparison.id))
        .filter(
            GeoEngineComparison.created_at >= start,
            GeoEngineComparison.created_at <= end,
        )
        .group_by(GeoEngineComparison.legacy_decision)
        .all()
    )
    v2_rows = (
        db.session.query(GeoEngineComparison.v2_decision, func.count(GeoEngineComparison.id))
        .filter(
            GeoEngineComparison.created_at >= start,
            GeoEngineComparison.created_at <= end,
        )
        .group_by(GeoEngineComparison.v2_decision)
        .all()
    )

    # Percentiles via ordered list sample (cap for safety)
    legacy_times = [
        float(x)
        for (x,) in db.session.query(GeoEngineComparison.execution_time_legacy_ms)
        .filter(
            GeoEngineComparison.created_at >= start,
            GeoEngineComparison.created_at <= end,
            GeoEngineComparison.execution_time_legacy_ms.isnot(None),
        )
        .order_by(GeoEngineComparison.execution_time_legacy_ms)
        .limit(20000)
        .all()
    ]
    v2_times = [
        float(x)
        for (x,) in db.session.query(GeoEngineComparison.execution_time_v2_ms)
        .filter(
            GeoEngineComparison.created_at >= start,
            GeoEngineComparison.created_at <= end,
            GeoEngineComparison.execution_time_v2_ms.isnot(None),
        )
        .order_by(GeoEngineComparison.execution_time_v2_ms)
        .limit(20000)
        .all()
    ]

    def _pctile(arr, p):
        if not arr:
            return None
        idx = min(len(arr) - 1, max(0, int(round((p / 100.0) * (len(arr) - 1)))))
        return round(arr[idx], 2)

    daily = (
        db.session.query(
            func.date(GeoEngineComparison.created_at),
            func.count(GeoEngineComparison.id),
            func.sum(case((GeoEngineComparison.decision_match.is_(True), 1), else_=0)),
        )
        .filter(
            GeoEngineComparison.created_at >= start,
            GeoEngineComparison.created_at <= end,
        )
        .group_by(func.date(GeoEngineComparison.created_at))
        .order_by(func.date(GeoEngineComparison.created_at))
        .all()
    )

    return {
        "total_compared": total,
        "decision_match_pct": _pct(decision_matches, total),
        "policy_match_pct": _pct(policy_matches, total),
        "reason_match_pct": _pct(reason_matches, total),
        "decision_difference_pct": _pct(total - decision_matches, total),
        "legacy_counts": {(k or "UNKNOWN"): int(v) for k, v in legacy_rows},
        "v2_counts": {(k or "UNKNOWN"): int(v) for k, v in v2_rows},
        "avg_confidence": round(float(avgs[0]), 2) if avgs[0] is not None else None,
        "avg_execution_legacy_ms": round(float(avgs[1]), 2) if avgs[1] is not None else None,
        "avg_execution_v2_ms": round(float(avgs[2]), 2) if avgs[2] is not None else None,
        "p95_legacy_ms": _pctile(legacy_times, 95),
        "p95_v2_ms": _pctile(v2_times, 95),
        "p99_legacy_ms": _pctile(legacy_times, 99),
        "p99_v2_ms": _pctile(v2_times, 99),
        "v2_error_rate_pct": _pct(v2_fail, total),
        "daily_trend": [
            {
                "day": str(d),
                "total": int(t),
                "match_pct": _pct(int(m or 0), int(t or 1)),
            }
            for d, t, m in daily
        ],
        "period": {"from": start.isoformat(), "to": end.isoformat()},
    }


def search_disagreements(args: dict[str, Any], page: int = 1, page_size: int = 50) -> dict[str, Any]:
    start, end = resolve_date_range(
        args.get("preset"),
        args.get("from") or args.get("date_from"),
        args.get("to") or args.get("date_to"),
    )
    page = max(1, int(page or 1))
    page_size = min(200, max(1, int(page_size or 50)))
    q = _q(start, end)

    only_diff = str(args.get("only_diff", "1")).lower() not in {"0", "false", "no"}
    if only_diff:
        q = q.filter(GeoEngineComparison.decision_match.is_(False))

    if args.get("difference_category"):
        q = q.filter(GeoEngineComparison.difference_category == args["difference_category"])
    if args.get("office"):
        q = q.filter(GeoEngineComparison.office_name.ilike(f"%{args['office']}%"))
    if args.get("attempt_id"):
        q = q.filter(GeoEngineComparison.attempt_id == str(args["attempt_id"]).strip())
    if args.get("emp_id"):
        q = q.join(Admin, Admin.id == GeoEngineComparison.admin_id).filter(
            Admin.emp_id == str(args["emp_id"]).strip()
        )
    if args.get("device"):
        q = q.filter(GeoEngineComparison.device_type == args["device"])
    if args.get("browser"):
        q = q.filter(GeoEngineComparison.browser.ilike(f"%{args['browser']}%"))

    total = q.count()
    rows = (
        q.order_by(GeoEngineComparison.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    admin_ids = {r.admin_id for r in rows if r.admin_id}
    admins = {a.id: a for a in Admin.query.filter(Admin.id.in_(admin_ids)).all()} if admin_ids else {}

    out = []
    for r in rows:
        a = admins.get(r.admin_id)
        out.append({
            "attempt_id": r.attempt_id,
            "timestamp": r.created_at.isoformat() + "Z" if r.created_at else None,
            "admin_id": r.admin_id,
            "emp_id": a.emp_id if a else None,
            "employee_name": (a.first_name if a else None) or (a.email if a else None),
            "office_id": r.office_id,
            "office_name": r.office_name,
            "legacy_decision": r.legacy_decision,
            "v2_decision": r.v2_decision,
            "legacy_policy": r.legacy_policy,
            "v2_policy": r.v2_policy,
            "legacy_distance_m": r.legacy_distance_m,
            "v2_distance_m": r.v2_distance_m,
            "v2_confidence": r.v2_confidence,
            "accuracy_m": r.accuracy_m,
            "browser": r.browser,
            "device_type": r.device_type,
            "difference_category": r.difference_category,
            "comparison_status": r.comparison_status,
            "execution_time_legacy_ms": r.execution_time_legacy_ms,
            "execution_time_v2_ms": r.execution_time_v2_ms,
        })
    return {"total": total, "page": page, "page_size": page_size, "rows": out}


def export_disagreements_csv(args: dict[str, Any], limit: int = 10000) -> str:
    data = search_disagreements({**args, "only_diff": args.get("only_diff", "1")}, page=1, page_size=min(limit, 20000))
    # re-query with larger page by temporarily looping
    args2 = dict(args)
    start, end = resolve_date_range(args.get("preset"), args.get("from"), args.get("to"))
    q = _q(start, end)
    if str(args.get("only_diff", "1")).lower() not in {"0", "false", "no"}:
        q = q.filter(GeoEngineComparison.decision_match.is_(False))
    rows = q.order_by(GeoEngineComparison.created_at.desc()).limit(min(limit, 50000)).all()
    admin_ids = {r.admin_id for r in rows if r.admin_id}
    admins = {a.id: a for a in Admin.query.filter(Admin.id.in_(admin_ids)).all()} if admin_ids else {}
    buf = io.StringIO()
    fields = [
        "attempt_id", "timestamp", "emp_id", "employee_name", "office_name",
        "legacy_decision", "v2_decision", "legacy_policy", "v2_policy",
        "legacy_distance_m", "v2_distance_m", "v2_confidence", "accuracy_m",
        "browser", "device_type", "difference_category", "comparison_status",
    ]
    w = csv.DictWriter(buf, fieldnames=fields, extrasaction="ignore")
    w.writeheader()
    for r in rows:
        a = admins.get(r.admin_id)
        w.writerow({
            "attempt_id": r.attempt_id,
            "timestamp": r.created_at.isoformat() + "Z" if r.created_at else None,
            "emp_id": a.emp_id if a else None,
            "employee_name": (a.first_name if a else None),
            "office_name": r.office_name,
            "legacy_decision": r.legacy_decision,
            "v2_decision": r.v2_decision,
            "legacy_policy": r.legacy_policy,
            "v2_policy": r.v2_policy,
            "legacy_distance_m": r.legacy_distance_m,
            "v2_distance_m": r.v2_distance_m,
            "v2_confidence": r.v2_confidence,
            "accuracy_m": r.accuracy_m,
            "browser": r.browser,
            "device_type": r.device_type,
            "difference_category": r.difference_category,
            "comparison_status": r.comparison_status,
        })
    return buf.getvalue()


def build_office_comparison(start: datetime, end: datetime) -> dict[str, Any]:
    rows = (
        db.session.query(
            func.coalesce(GeoEngineComparison.office_name, "Unknown").label("office"),
            func.count(GeoEngineComparison.id).label("total"),
            func.sum(case((GeoEngineComparison.decision_match.is_(True), 1), else_=0)).label("matches"),
            func.avg(GeoEngineComparison.v2_confidence).label("avg_conf"),
            func.avg(GeoEngineComparison.accuracy_m).label("avg_acc"),
            func.sum(case((GeoEngineComparison.legacy_decision == "OUTSIDE", 1), else_=0)).label("leg_out"),
            func.sum(case((GeoEngineComparison.v2_decision == "OUTSIDE", 1), else_=0)).label("v2_out"),
        )
        .filter(
            GeoEngineComparison.created_at >= start,
            GeoEngineComparison.created_at <= end,
        )
        .group_by(func.coalesce(GeoEngineComparison.office_name, "Unknown"))
        .order_by(func.count(GeoEngineComparison.id).desc())
        .limit(100)
        .all()
    )
    out = []
    for r in rows:
        total = int(r.total or 0)
        match_pct = _pct(int(r.matches or 0), total)
        leg_out = _pct(int(r.leg_out or 0), total)
        v2_out = _pct(int(r.v2_out or 0), total)
        diff = abs(leg_out - v2_out)
        out.append({
            "office": r.office,
            "total": total,
            "decision_match_pct": match_pct,
            "avg_confidence": round(float(r.avg_conf), 2) if r.avg_conf is not None else None,
            "avg_accuracy_m": round(float(r.avg_acc), 2) if r.avg_acc is not None else None,
            "legacy_outside_pct": leg_out,
            "v2_outside_pct": v2_out,
            "largest_difference_pct": round(diff, 2),
            "needs_review": match_pct < 85 or diff >= 10,
        })
    out.sort(key=lambda x: x["decision_match_pct"])
    return {"offices": out, "attention": [o for o in out if o["needs_review"]]}


def build_rollout_status(start: datetime, end: datetime) -> dict[str, Any]:
    mode = get_engine_mode()
    summary = build_comparison_summary(start, end)
    cats = (
        db.session.query(
            GeoEngineComparison.difference_category,
            func.count(GeoEngineComparison.id),
        )
        .filter(
            GeoEngineComparison.created_at >= start,
            GeoEngineComparison.created_at <= end,
            GeoEngineComparison.difference_category.isnot(None),
        )
        .group_by(GeoEngineComparison.difference_category)
        .order_by(func.count(GeoEngineComparison.id).desc())
        .limit(15)
        .all()
    )
    top_diffs = [{"category": c or "UNKNOWN", "count": int(n)} for c, n in cats]

    total = summary["total_compared"]
    match = summary["decision_match_pct"]
    policy = summary["policy_match_pct"]
    err = summary["v2_error_rate_pct"]

    # Readiness heuristic
    if total < 100:
        readiness = "NOT READY"
        recommendation = "Collect at least ~100 shadow comparisons before judging readiness."
    elif err >= 5:
        readiness = "NOT READY"
        recommendation = "V2 error rate is elevated — investigate GEO_ENGINE_FAILURE / timeouts first."
    elif match >= 97 and policy >= 97 and err < 1:
        readiness = "READY FOR FULL ROLLOUT"
        recommendation = "Set GEO_ENGINE_MODE=V2. Keep GEO_V2_FALLBACK_ON_ERROR=true initially."
    elif match >= 90 and policy >= 90 and err < 3:
        readiness = "READY FOR PILOT"
        recommendation = "Pilot V2 for one office or department, then expand."
    else:
        readiness = "NOT READY"
        recommendation = "Review disagreement categories and office comparison before switching."

    # False outside reduction signal
    leg_out = summary["legacy_counts"].get("OUTSIDE", 0)
    v2_out = summary["v2_counts"].get("OUTSIDE", 0)
    leg_ls = summary["legacy_counts"].get("NO_GPS", 0) + summary["legacy_counts"].get("LOW_SIGNAL", 0)
    v2_ls = summary["v2_counts"].get("LOW_SIGNAL", 0) + summary["v2_counts"].get("NO_GPS", 0)

    return {
        "current_engine_mode": mode,
        "config": {
            "GEO_ENGINE_MODE": mode,
            "GEO_V2_FALLBACK_ON_ERROR": bool(get_geo_fence_config().get("GEO_V2_FALLBACK_ON_ERROR", True)),
        },
        "total_shadow_comparisons": total,
        "decision_match_pct": match,
        "policy_match_pct": policy,
        "v2_error_rate_pct": err,
        "top_difference_categories": top_diffs,
        "readiness": readiness,
        "recommendation": recommendation,
        "signals": {
            "legacy_outside_count": leg_out,
            "v2_outside_count": v2_out,
            "v2_reducing_outside": v2_out < leg_out if total else None,
            "legacy_weak_gps_count": leg_ls,
            "v2_weak_gps_count": v2_ls,
            "v2_improving_low_signal_handling": None if not total else (v2_ls != leg_ls),
        },
        "summary": summary,
        "period": {"from": start.isoformat(), "to": end.isoformat()},
    }
