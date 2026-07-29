"""
Geo Analytics / Monitoring service.

Reads geo_punch_attempts (+ Admin joins). No punch-flow or engine logic duplication.
"""
from __future__ import annotations

import csv
import io
import json
import logging
from datetime import datetime, date, timedelta
from typing import Any, Optional

from flask import current_app, has_app_context
from sqlalchemy import and_, case, func, or_

from . import db
from .geo_fence_config import CONFIG_DOCS, DEFAULTS, get_geo_fence_config
from .models.Admin_models import Admin
from .models.attendance import Location
from .models.geo_config_change import GeoConfigChange, GeoConfigOverride
from .models.geo_punch_attempt import GeoPunchAttempt

logger = logging.getLogger(__name__)

EDITABLE_KEYS = frozenset(DEFAULTS.keys())

DECISION_KEYS = ("INSIDE", "UNCERTAIN", "OUTSIDE", "LOW_SIGNAL", "NO_GPS", "NO_OFFICE")
POLICY_KEYS = ("ALLOW", "ALLOW_FLAGGED", "REQUIRE_REASON", "DENY")


def _parse_date(value: Any, *, end: bool = False) -> Optional[datetime]:
    if value is None or str(value).strip() == "":
        return None
    if isinstance(value, datetime):
        return value
    if isinstance(value, date):
        if end:
            return datetime.combine(value, datetime.max.time()).replace(microsecond=0)
        return datetime.combine(value, datetime.min.time())
    s = str(value).strip()
    try:
        if len(s) >= 10 and s[4] == "-":
            d = datetime.strptime(s[:10], "%Y-%m-%d")
            if end:
                return d.replace(hour=23, minute=59, second=59)
            return d
    except ValueError:
        return None
    return None


def resolve_date_range(
    preset: Optional[str] = None,
    date_from: Any = None,
    date_to: Any = None,
) -> tuple[datetime, datetime]:
    """Return inclusive [start, end] datetimes (UTC-naive, matching audit created_at)."""
    now = datetime.utcnow()
    today = now.date()
    preset = (preset or "").strip().lower()

    start = _parse_date(date_from)
    end = _parse_date(date_to, end=True)

    if start and end:
        return start, end
    if preset == "weekly":
        start_d = today - timedelta(days=6)
        return datetime.combine(start_d, datetime.min.time()), now
    if preset == "monthly":
        start_d = today - timedelta(days=29)
        return datetime.combine(start_d, datetime.min.time()), now
    if preset == "daily" or (not start and not end):
        return datetime.combine(today, datetime.min.time()), now
    if start and not end:
        return start, now
    if end and not start:
        return end.replace(hour=0, minute=0, second=0), end
    return datetime.combine(today, datetime.min.time()), now


def _base_query(start: datetime, end: datetime):
    return GeoPunchAttempt.query.filter(
        GeoPunchAttempt.created_at >= start,
        GeoPunchAttempt.created_at <= end,
    )


def _pct(part: int, total: int) -> float:
    if not total:
        return 0.0
    return round(100.0 * part / total, 2)


def _avg(values) -> Optional[float]:
    nums = [float(v) for v in values if v is not None]
    if not nums:
        return None
    return round(sum(nums) / len(nums), 2)


def build_summary(start: datetime, end: datetime) -> dict[str, Any]:
    q = _base_query(start, end)
    total = q.count()
    if total == 0:
        return {
            "total_punches": 0,
            "period": {"from": start.isoformat(), "to": end.isoformat()},
            "decisions": {k: {"count": 0, "pct": 0.0} for k in DECISION_KEYS},
            "policies": {k: {"count": 0, "pct": 0.0} for k in POLICY_KEYS},
            "averages": {
                "accuracy_m": None,
                "confidence": None,
                "acquisition_ms": None,
                "retry_count": None,
            },
        }

    decision_rows = (
        db.session.query(GeoPunchAttempt.geo_decision, func.count(GeoPunchAttempt.id))
        .filter(GeoPunchAttempt.created_at >= start, GeoPunchAttempt.created_at <= end)
        .group_by(GeoPunchAttempt.geo_decision)
        .all()
    )
    decision_map = {(d or "UNKNOWN"): c for d, c in decision_rows}
    # Map NO_OFFICE_CONFIG / NO_OFFICE variants
    if "NO_OFFICE_CONFIG" in decision_map:
        decision_map["NO_OFFICE"] = decision_map.get("NO_OFFICE", 0) + decision_map.pop("NO_OFFICE_CONFIG")

    policy_rows = (
        db.session.query(GeoPunchAttempt.policy_action, func.count(GeoPunchAttempt.id))
        .filter(GeoPunchAttempt.created_at >= start, GeoPunchAttempt.created_at <= end)
        .group_by(GeoPunchAttempt.policy_action)
        .all()
    )
    policy_map = {(p or "UNKNOWN"): c for p, c in policy_rows}

    avgs = (
        db.session.query(
            func.avg(GeoPunchAttempt.accuracy_m),
            func.avg(GeoPunchAttempt.confidence_score),
            func.avg(GeoPunchAttempt.acquisition_ms),
            func.avg(GeoPunchAttempt.retry_count),
        )
        .filter(GeoPunchAttempt.created_at >= start, GeoPunchAttempt.created_at <= end)
        .one()
    )

    decisions = {
        k: {"count": int(decision_map.get(k, 0)), "pct": _pct(int(decision_map.get(k, 0)), total)}
        for k in DECISION_KEYS
    }
    policies = {
        k: {"count": int(policy_map.get(k, 0)), "pct": _pct(int(policy_map.get(k, 0)), total)}
        for k in POLICY_KEYS
    }

    return {
        "total_punches": total,
        "period": {"from": start.isoformat(), "to": end.isoformat()},
        "decisions": decisions,
        "policies": policies,
        "averages": {
            "accuracy_m": round(float(avgs[0]), 2) if avgs[0] is not None else None,
            "confidence": round(float(avgs[1]), 2) if avgs[1] is not None else None,
            "acquisition_ms": round(float(avgs[2]), 2) if avgs[2] is not None else None,
            "retry_count": round(float(avgs[3]), 2) if avgs[3] is not None else None,
        },
    }


def _breakdown_label_column(dimension: str):
    dim = (dimension or "office").lower()
    if dim == "office":
        return func.coalesce(GeoPunchAttempt.office_name, "Unknown office"), "office"
    if dim in ("department", "emp_type"):
        return func.coalesce(Admin.emp_type, "Unknown"), "department"
    if dim == "circle":
        return func.coalesce(Admin.circle, "Unknown"), "circle"
    if dim == "browser":
        return func.coalesce(GeoPunchAttempt.browser, "Unknown"), "browser"
    if dim in ("os", "operating_system"):
        return func.coalesce(GeoPunchAttempt.operating_system, "Unknown"), "operating_system"
    if dim in ("device", "device_type"):
        return func.coalesce(GeoPunchAttempt.device_type, "Unknown"), "device_type"
    if dim == "network":
        return case(
            (GeoPunchAttempt.network_match.is_(True), "Network match"),
            else_="No network match",
        ), "network_match"
    return func.coalesce(GeoPunchAttempt.office_name, "Unknown office"), "office"


def build_breakdown(start: datetime, end: datetime, dimension: str) -> dict[str, Any]:
    label_col, dim_key = _breakdown_label_column(dimension)
    needs_admin = dim_key in ("department", "circle")

    q = db.session.query(
        label_col.label("label"),
        func.count(GeoPunchAttempt.id).label("total"),
        func.avg(GeoPunchAttempt.accuracy_m).label("avg_accuracy"),
        func.avg(GeoPunchAttempt.confidence_score).label("avg_confidence"),
        func.avg(GeoPunchAttempt.acquisition_ms).label("avg_acquisition_ms"),
        func.avg(GeoPunchAttempt.retry_count).label("avg_retry"),
        func.sum(case((GeoPunchAttempt.geo_decision == "INSIDE", 1), else_=0)).label("inside"),
        func.sum(case((GeoPunchAttempt.geo_decision == "OUTSIDE", 1), else_=0)).label("outside"),
        func.sum(case((GeoPunchAttempt.geo_decision == "LOW_SIGNAL", 1), else_=0)).label("low_signal"),
        func.sum(case((GeoPunchAttempt.geo_decision == "NO_GPS", 1), else_=0)).label("no_gps"),
        func.sum(case((GeoPunchAttempt.geo_decision == "UNCERTAIN", 1), else_=0)).label("uncertain"),
        func.sum(
            case((GeoPunchAttempt.policy_action == "REQUIRE_REASON", 1), else_=0)
        ).label("require_reason"),
        func.sum(case((GeoPunchAttempt.network_match.is_(True), 1), else_=0)).label("net_match"),
    ).filter(GeoPunchAttempt.created_at >= start, GeoPunchAttempt.created_at <= end)

    if needs_admin:
        q = q.outerjoin(Admin, Admin.id == GeoPunchAttempt.admin_id)

    rows = q.group_by(label_col).order_by(func.count(GeoPunchAttempt.id).desc()).limit(100).all()

    items = []
    for r in rows:
        total = int(r.total or 0)
        items.append({
            "label": r.label,
            "total": total,
            "avg_accuracy_m": round(float(r.avg_accuracy), 2) if r.avg_accuracy is not None else None,
            "avg_confidence": round(float(r.avg_confidence), 2) if r.avg_confidence is not None else None,
            "avg_acquisition_ms": round(float(r.avg_acquisition_ms), 2) if r.avg_acquisition_ms is not None else None,
            "avg_retry_count": round(float(r.avg_retry), 2) if r.avg_retry is not None else None,
            "inside_pct": _pct(int(r.inside or 0), total),
            "outside_pct": _pct(int(r.outside or 0), total),
            "low_signal_pct": _pct(int(r.low_signal or 0), total),
            "no_gps_pct": _pct(int(r.no_gps or 0), total),
            "uncertain_pct": _pct(int(r.uncertain or 0), total),
            "require_reason_pct": _pct(int(r.require_reason or 0), total),
            "network_match_pct": _pct(int(r.net_match or 0), total),
        })

    return {"dimension": dim_key, "rows": items}


def build_office_health(start: datetime, end: datetime) -> dict[str, Any]:
    data = build_breakdown(start, end, "office")
    rows = data["rows"]
    # Rank by GPS quality: lower accuracy + higher confidence + lower outside/low_signal
    for r in rows:
        acc = r["avg_accuracy_m"] if r["avg_accuracy_m"] is not None else 999
        conf = r["avg_confidence"] if r["avg_confidence"] is not None else 0
        quality = conf - (acc / 10.0) - r["outside_pct"] - r["low_signal_pct"]
        r["quality_score"] = round(quality, 2)
        r["needs_attention"] = (
            r["outside_pct"] >= 25
            or r["low_signal_pct"] >= 20
            or (r["avg_accuracy_m"] is not None and r["avg_accuracy_m"] > 100)
            or (r["avg_confidence"] is not None and r["avg_confidence"] < 50)
        )
        # Top failure reasons from error_code / geo_decision for this office
        label = r["label"]
        reason_q = (
            db.session.query(
                func.coalesce(GeoPunchAttempt.error_code, GeoPunchAttempt.geo_decision, "UNKNOWN"),
                func.count(GeoPunchAttempt.id),
            )
            .filter(
                GeoPunchAttempt.created_at >= start,
                GeoPunchAttempt.created_at <= end,
                or_(
                    GeoPunchAttempt.office_name == label,
                    and_(label == "Unknown office", GeoPunchAttempt.office_name.is_(None)),
                ),
                GeoPunchAttempt.geo_decision.in_(["OUTSIDE", "LOW_SIGNAL", "NO_GPS"]),
            )
            .group_by(func.coalesce(GeoPunchAttempt.error_code, GeoPunchAttempt.geo_decision, "UNKNOWN"))
            .order_by(func.count(GeoPunchAttempt.id).desc())
            .limit(5)
            .all()
        )
        r["top_failure_reasons"] = [{"reason": a, "count": int(b)} for a, b in reason_q]

    rows.sort(key=lambda x: x["quality_score"], reverse=True)
    for i, r in enumerate(rows):
        r["rank"] = i + 1
    return {"offices": rows, "attention": [r for r in rows if r["needs_attention"]]}


def build_browser_health(start: datetime, end: datetime) -> dict[str, Any]:
    data = build_breakdown(start, end, "browser")
    # Enrich with OS-aware labels already in browser field when available
    rows = data["rows"]
    for r in rows:
        total = r["total"] or 1
        success = 100.0 - r["no_gps_pct"]  # punches that got a decision with GPS
        r["punch_success_rate_pct"] = round(success, 2)
        r["low_signal_frequency_pct"] = r["low_signal_pct"]
    return {"browsers": rows}


def _audit_filters(args: dict[str, Any]):
    start, end = resolve_date_range(
        args.get("preset"),
        args.get("from") or args.get("date_from"),
        args.get("to") or args.get("date_to"),
    )
    q = _base_query(start, end)

    if args.get("employee_id") or args.get("admin_id"):
        try:
            q = q.filter(GeoPunchAttempt.admin_id == int(args.get("employee_id") or args.get("admin_id")))
        except (TypeError, ValueError):
            pass
    if args.get("emp_id"):
        q = q.join(Admin, Admin.id == GeoPunchAttempt.admin_id).filter(
            Admin.emp_id == str(args.get("emp_id")).strip()
        )
    if args.get("office_id"):
        try:
            q = q.filter(GeoPunchAttempt.office_id == int(args["office_id"]))
        except (TypeError, ValueError):
            pass
    if args.get("office"):
        q = q.filter(GeoPunchAttempt.office_name.ilike(f"%{args['office']}%"))
    if args.get("decision") or args.get("geo_decision"):
        q = q.filter(GeoPunchAttempt.geo_decision == (args.get("decision") or args.get("geo_decision")))
    if args.get("policy_action"):
        q = q.filter(GeoPunchAttempt.policy_action == args["policy_action"])
    if args.get("attempt_id"):
        q = q.filter(GeoPunchAttempt.attempt_id == str(args["attempt_id"]).strip())
    if args.get("device") or args.get("device_type"):
        q = q.filter(GeoPunchAttempt.device_type == (args.get("device") or args.get("device_type")))
    if args.get("browser"):
        q = q.filter(GeoPunchAttempt.browser.ilike(f"%{args['browser']}%"))
    if args.get("network_match") in ("1", "true", "True", True):
        q = q.filter(GeoPunchAttempt.network_match.is_(True))
    if args.get("network_match") in ("0", "false", "False", False):
        q = q.filter(GeoPunchAttempt.network_match.is_(False))
    return q, start, end


def _attempt_row_dict(row: GeoPunchAttempt, admin: Optional[Admin] = None) -> dict[str, Any]:
    d = {
        "id": row.id,
        "attempt_id": row.attempt_id,
        "timestamp": row.created_at.isoformat() + "Z" if row.created_at else None,
        "admin_id": row.admin_id,
        "employee_name": None,
        "emp_id": None,
        "department": None,
        "circle": None,
        "direction": row.direction,
        "latitude": row.latitude,
        "longitude": row.longitude,
        "accuracy_m": row.accuracy_m,
        "confidence": row.confidence_score,
        "distance_m": row.distance_m,
        "office_id": row.office_id,
        "office_name": row.office_name,
        "radius_m": row.radius_m,
        "grace_m": row.grace_m,
        "geo_decision": row.geo_decision,
        "spatial_class": row.spatial_class,
        "policy_action": row.policy_action,
        "device_type": row.device_type,
        "browser": row.browser,
        "operating_system": row.operating_system,
        "sample_count": row.sample_count,
        "spread_m": row.spread_m,
        "acquisition_ms": row.acquisition_ms,
        "retry_count": row.retry_count,
        "network_match": bool(row.network_match),
        "flag_reason": row.flag_reason,
        "error_code": row.error_code,
        "punch_session_id": row.punch_session_id,
    }
    if admin:
        d["employee_name"] = " ".join(
            x for x in [admin.first_name, getattr(admin, "last_name", None)] if x
        ) or admin.user_name or admin.email
        d["emp_id"] = admin.emp_id
        d["department"] = admin.emp_type
        d["circle"] = admin.circle
    return d


def search_audit(args: dict[str, Any], page: int = 1, page_size: int = 50) -> dict[str, Any]:
    page = max(1, int(page or 1))
    page_size = min(200, max(1, int(page_size or 50)))
    q, start, end = _audit_filters(args)
    total = q.count()
    rows = (
        q.order_by(GeoPunchAttempt.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    admin_ids = {r.admin_id for r in rows if r.admin_id}
    admins = {}
    if admin_ids:
        for a in Admin.query.filter(Admin.id.in_(admin_ids)).all():
            admins[a.id] = a
    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "period": {"from": start.isoformat(), "to": end.isoformat()},
        "rows": [_attempt_row_dict(r, admins.get(r.admin_id)) for r in rows],
    }


def export_audit_csv(args: dict[str, Any], limit: int = 10000) -> str:
    q, _, _ = _audit_filters(args)
    rows = q.order_by(GeoPunchAttempt.created_at.desc()).limit(min(limit, 50000)).all()
    admin_ids = {r.admin_id for r in rows if r.admin_id}
    admins = {a.id: a for a in Admin.query.filter(Admin.id.in_(admin_ids)).all()} if admin_ids else {}

    buf = io.StringIO()
    fields = [
        "attempt_id", "timestamp", "emp_id", "employee_name", "department", "circle",
        "direction", "latitude", "longitude", "accuracy_m", "confidence", "distance_m",
        "office_name", "radius_m", "grace_m", "geo_decision", "policy_action",
        "device_type", "browser", "operating_system", "sample_count", "spread_m",
        "acquisition_ms", "retry_count", "network_match", "flag_reason", "error_code",
    ]
    writer = csv.DictWriter(buf, fieldnames=fields, extrasaction="ignore")
    writer.writeheader()
    for r in rows:
        writer.writerow(_attempt_row_dict(r, admins.get(r.admin_id)))
    return buf.getvalue()


def explain_attempt(attempt_id: str) -> Optional[dict[str, Any]]:
    row = GeoPunchAttempt.query.filter_by(attempt_id=str(attempt_id).strip()).first()
    if not row:
        return None
    admin = Admin.query.get(row.admin_id) if row.admin_id else None
    cfg = get_geo_fence_config()
    office = Location.query.get(row.office_id) if row.office_id else None

    distance = row.distance_m
    radius = row.radius_m
    grace = row.grace_m
    pipeline = [
        {
            "step": 1,
            "name": "Measurement",
            "detail": {
                "latitude": row.latitude,
                "longitude": row.longitude,
                "accuracy_m": row.accuracy_m,
                "sample_count": row.sample_count,
                "spread_m": row.spread_m,
                "acquisition_ms": row.acquisition_ms,
                "retry_count": row.retry_count,
                "device_type": row.device_type,
                "network_match": bool(row.network_match),
            },
        },
        {
            "step": 2,
            "name": "Office match",
            "detail": {
                "office_id": row.office_id,
                "office_name": row.office_name,
                "radius_m": radius,
                "grace_m": grace,
                "office_coords": (
                    {"lat": office.latitude, "lon": office.longitude} if office else None
                ),
            },
        },
        {
            "step": 3,
            "name": "Distance calculation",
            "detail": {
                "distance_m": distance,
                "formula": "haversine(employee, office)",
                "within_radius": (
                    distance is not None and radius is not None and distance <= radius
                ),
                "within_radius_plus_grace": (
                    distance is not None
                    and radius is not None
                    and grace is not None
                    and distance <= (radius + grace)
                ),
            },
        },
        {
            "step": 4,
            "name": "Spatial classification",
            "detail": {
                "spatial_class": row.spatial_class,
                "rules": "CONTAINED | INTERSECTS | DISJOINT using accuracy circle vs fence",
            },
        },
        {
            "step": 5,
            "name": "Confidence",
            "detail": {
                "confidence_score": row.confidence_score,
                "weights": {
                    k: cfg.get(k)
                    for k in (
                        "GPS_ACCURACY_WEIGHT",
                        "GPS_CONSISTENCY_WEIGHT",
                        "SAMPLE_COUNT_WEIGHT",
                        "FRESHNESS_WEIGHT",
                        "DEVICE_WEIGHT",
                        "NETWORK_WEIGHT",
                    )
                },
                "note": "Network is a booster only — never grants INSIDE alone",
            },
        },
        {
            "step": 6,
            "name": "Geo decision",
            "detail": {
                "geo_decision": row.geo_decision,
                "thresholds": {
                    "INSIDE_CONFIDENCE": cfg.get("INSIDE_CONFIDENCE"),
                    "OUTSIDE_CONFIDENCE": cfg.get("OUTSIDE_CONFIDENCE"),
                    "ACC_MAX_MOBILE": cfg.get("ACC_MAX_MOBILE"),
                    "ACC_MAX_DESKTOP": cfg.get("ACC_MAX_DESKTOP"),
                },
            },
        },
        {
            "step": 7,
            "name": "Policy action",
            "detail": {
                "policy_action": row.policy_action,
                "flag_reason": row.flag_reason,
                "error_code": row.error_code,
            },
        },
    ]

    return {
        "attempt": _attempt_row_dict(row, admin),
        "pipeline": pipeline,
        "config_snapshot": {k: cfg.get(k) for k in sorted(DEFAULTS.keys())},
        "final_result": {
            "geo_decision": row.geo_decision,
            "policy_action": row.policy_action,
            "confidence": row.confidence_score,
            "distance_m": row.distance_m,
        },
    }


def build_monitoring(start: datetime, end: datetime) -> dict[str, Any]:
    total = _base_query(start, end).count()
    avgs = (
        db.session.query(
            func.avg(GeoPunchAttempt.acquisition_ms),
            func.avg(GeoPunchAttempt.retry_count),
        )
        .filter(GeoPunchAttempt.created_at >= start, GeoPunchAttempt.created_at <= end)
        .one()
    )
    timeout_n = (
        _base_query(start, end)
        .filter(
            or_(
                GeoPunchAttempt.error_code == "TIMEOUT",
                GeoPunchAttempt.geo_decision == "NO_GPS",
            )
        )
        .count()
    )
    perm_n = (
        _base_query(start, end)
        .filter(GeoPunchAttempt.error_code == "PERMISSION_DENIED")
        .count()
    )
    err_n = (
        _base_query(start, end)
        .filter(GeoPunchAttempt.error_code.isnot(None))
        .count()
    )

    # Hourly / daily volume (dialect-safe via extract)
    from sqlalchemy import extract

    hourly_rows = (
        db.session.query(
            extract("year", GeoPunchAttempt.created_at).label("y"),
            extract("month", GeoPunchAttempt.created_at).label("m"),
            extract("day", GeoPunchAttempt.created_at).label("d"),
            extract("hour", GeoPunchAttempt.created_at).label("h"),
            func.count(GeoPunchAttempt.id),
        )
        .filter(GeoPunchAttempt.created_at >= start, GeoPunchAttempt.created_at <= end)
        .group_by(
            extract("year", GeoPunchAttempt.created_at),
            extract("month", GeoPunchAttempt.created_at),
            extract("day", GeoPunchAttempt.created_at),
            extract("hour", GeoPunchAttempt.created_at),
        )
        .order_by(
            extract("year", GeoPunchAttempt.created_at),
            extract("month", GeoPunchAttempt.created_at),
            extract("day", GeoPunchAttempt.created_at),
            extract("hour", GeoPunchAttempt.created_at),
        )
        .limit(168)
        .all()
    )
    hourly = [
        {
            "hour": f"{int(y):04d}-{int(m):02d}-{int(d):02d} {int(h):02d}:00",
            "count": int(c),
        }
        for y, m, d, h, c in hourly_rows
    ]

    daily_rows = (
        db.session.query(
            func.date(GeoPunchAttempt.created_at),
            func.count(GeoPunchAttempt.id),
        )
        .filter(GeoPunchAttempt.created_at >= start, GeoPunchAttempt.created_at <= end)
        .group_by(func.date(GeoPunchAttempt.created_at))
        .order_by(func.date(GeoPunchAttempt.created_at))
        .all()
    )

    offices = Location.query.count()

    return {
        "daily_punch_volume": total,
        "avg_acquisition_ms": round(float(avgs[0]), 2) if avgs[0] is not None else None,
        "avg_retry_count": round(float(avgs[1]), 2) if avgs[1] is not None else None,
        "error_rate_pct": _pct(err_n, total),
        "gps_timeout_rate_pct": _pct(timeout_n, total),
        "permission_denied_rate_pct": _pct(perm_n, total),
        "offices_configured": offices,
        "no_office_configured": offices == 0,
        "hourly_volume": hourly,
        "daily_volume": [{"day": str(d), "count": int(c)} for d, c in daily_rows],
        "notes": {
            "api_latency": "Instrument at reverse-proxy / APM in production",
            "engine_execution_time": "Not stored per-attempt yet — add timing in Step 3+ if needed",
            "audit_insert_time": "Independent session write; failures logged non-fatally",
            "location_check_latency": "Same validation path as punch; use APM",
            "database_latency": "Use DB monitoring (CloudWatch / RDS)",
        },
    }


def build_alerts(start: datetime, end: datetime) -> dict[str, Any]:
    """Computed alert conditions — design only for delivery; no notification bus yet."""
    summary = build_summary(start, end)
    office = build_office_health(start, end)
    mon = build_monitoring(start, end)
    alerts = []

    if mon["no_office_configured"]:
        alerts.append({
            "severity": "critical",
            "code": "NO_OFFICE_CONFIGURED",
            "title": "No office configured",
            "message": "Location table is empty — all punches may be NO_OFFICE / flagged.",
        })

    ls = summary["decisions"].get("LOW_SIGNAL", {}).get("pct", 0)
    if ls >= 20:
        alerts.append({
            "severity": "high",
            "code": "LOW_SIGNAL_SPIKE",
            "title": "LOW_SIGNAL above threshold",
            "message": f"LOW_SIGNAL is {ls}% of attempts (threshold 20%).",
            "value": ls,
        })

    conf = summary["averages"].get("confidence")
    if conf is not None and conf < 55:
        alerts.append({
            "severity": "medium",
            "code": "LOW_AVG_CONFIDENCE",
            "title": "Average confidence falling",
            "message": f"Average confidence is {conf} (threshold 55).",
            "value": conf,
        })

    if mon["gps_timeout_rate_pct"] >= 15:
        alerts.append({
            "severity": "high",
            "code": "GPS_TIMEOUT_SPIKE",
            "title": "GPS timeout spike",
            "message": f"Timeout/NO_GPS rate is {mon['gps_timeout_rate_pct']}%.",
            "value": mon["gps_timeout_rate_pct"],
        })

    for o in office.get("attention", [])[:10]:
        alerts.append({
            "severity": "medium",
            "code": "OFFICE_GPS_DEGRADED",
            "title": f"Office GPS quality drop: {o['label']}",
            "message": (
                f"Outside {o['outside_pct']}% · Low signal {o['low_signal_pct']}% · "
                f"Avg accuracy {o['avg_accuracy_m']} m"
            ),
            "office": o["label"],
        })

    # Recent config changes in period
    cfg_changes = (
        GeoConfigChange.query.filter(
            GeoConfigChange.created_at >= start,
            GeoConfigChange.created_at <= end,
        )
        .order_by(GeoConfigChange.created_at.desc())
        .limit(20)
        .all()
    )
    for ch in cfg_changes:
        alerts.append({
            "severity": "info",
            "code": "CONFIG_CHANGED",
            "title": f"Config changed: {ch.config_key}",
            "message": f"{ch.old_value} → {ch.new_value} ({ch.reason})",
            "changed_by": ch.changed_by_email,
            "at": ch.created_at.isoformat() + "Z" if ch.created_at else None,
        })

    engine_err = (
        _base_query(start, end)
        .filter(GeoPunchAttempt.error_code == "GEO_ENGINE_FAILURE")
        .count()
    )
    if engine_err:
        alerts.append({
            "severity": "critical",
            "code": "GEO_ENGINE_EXCEPTIONS",
            "title": "Geo engine exceptions",
            "message": f"{engine_err} attempt(s) recorded GEO_ENGINE_FAILURE.",
            "value": engine_err,
        })

    return {"alerts": alerts, "count": len(alerts)}


def build_recommendations(start: datetime, end: datetime) -> dict[str, Any]:
    office = build_office_health(start, end)
    browser = build_browser_health(start, end)
    summary = build_summary(start, end)
    cfg = get_geo_fence_config()
    recs = []

    for o in office.get("offices", []):
        if o["outside_pct"] >= 30 and o["avg_accuracy_m"] and o["avg_accuracy_m"] < 60:
            recs.append({
                "type": "office_radius",
                "priority": "high",
                "title": f"Consider increasing radius for {o['label']}",
                "evidence": f"Outside {o['outside_pct']}% with good avg accuracy {o['avg_accuracy_m']} m — fence may be tight.",
                "suggestion": "Review office pin / increase radius 20–50 m after site survey.",
            })
        if o["low_signal_pct"] >= 25:
            recs.append({
                "type": "office_gps",
                "priority": "medium",
                "title": f"Poor indoor GPS at {o['label']}",
                "evidence": f"LOW_SIGNAL {o['low_signal_pct']}% · avg accuracy {o['avg_accuracy_m']} m",
                "suggestion": "Expect more UNCERTAIN/ALLOW_FLAGGED; do not rely on network alone.",
            })

    for b in browser.get("browsers", []):
        label = (b["label"] or "").lower()
        if "safari" in label and (b["avg_acquisition_ms"] or 0) > 8000:
            recs.append({
                "type": "browser_timeout",
                "priority": "medium",
                "title": "Safari users need larger GPS timeout",
                "evidence": f"{b['label']}: avg acquisition {b['avg_acquisition_ms']} ms",
                "suggestion": f"Consider raising GPS_TIMEOUT_MS / GPS_TOTAL_TIMEOUT_MS (now {cfg.get('GPS_TIMEOUT_MS')}/{cfg.get('GPS_TOTAL_TIMEOUT_MS')}).",
            })
        if "android" in label or (b.get("avg_retry_count") or 0) < 1.2 and b["avg_accuracy_m"] and b["avg_accuracy_m"] < 40:
            if "chrome" in label and (b.get("avg_retry_count") or 0) >= 2:
                recs.append({
                    "type": "android_retries",
                    "priority": "low",
                    "title": "Android Chrome could reduce retries",
                    "evidence": f"{b['label']}: avg retries {b['avg_retry_count']}, accuracy {b['avg_accuracy_m']} m",
                    "suggestion": "Early-stop already helps; MAX_GPS_ATTEMPTS can stay at 5.",
                })

    grace = float(cfg.get("DEFAULT_OFFICE_GRACE_M") or 25)
    if grace > 40 and summary["decisions"].get("INSIDE", {}).get("pct", 0) > 90:
        recs.append({
            "type": "grace",
            "priority": "low",
            "title": "Grace value may be larger than needed",
            "evidence": f"DEFAULT_OFFICE_GRACE_M={grace}, INSIDE {summary['decisions']['INSIDE']['pct']}%",
            "suggestion": "If fraud review is a concern, consider lowering office-specific grace after sampling.",
        })

    inside_th = int(cfg.get("INSIDE_CONFIDENCE") or 70)
    unc = summary["decisions"].get("UNCERTAIN", {}).get("pct", 0)
    if unc >= 25 and inside_th >= 70:
        recs.append({
            "type": "confidence",
            "priority": "medium",
            "title": "Confidence threshold may be too strict",
            "evidence": f"UNCERTAIN {unc}% with INSIDE_CONFIDENCE={inside_th}",
            "suggestion": "Review UNCERTAIN samples before lowering threshold (e.g. 65).",
        })

    return {"recommendations": recs, "count": len(recs)}


def build_security(start: datetime, end: datetime) -> dict[str, Any]:
    """Investigation signals only — never auto-punish."""
    # Repeated OUTSIDE by employee
    outside_repeat = (
        db.session.query(
            GeoPunchAttempt.admin_id,
            func.count(GeoPunchAttempt.id).label("n"),
        )
        .filter(
            GeoPunchAttempt.created_at >= start,
            GeoPunchAttempt.created_at <= end,
            GeoPunchAttempt.geo_decision == "OUTSIDE",
        )
        .group_by(GeoPunchAttempt.admin_id)
        .having(func.count(GeoPunchAttempt.id) >= 5)
        .order_by(func.count(GeoPunchAttempt.id).desc())
        .limit(50)
        .all()
    )
    admin_ids = [a for a, _ in outside_repeat if a]
    admins = {a.id: a for a in Admin.query.filter(Admin.id.in_(admin_ids)).all()} if admin_ids else {}

    repeated_outside = []
    for aid, n in outside_repeat:
        a = admins.get(aid)
        repeated_outside.append({
            "admin_id": aid,
            "emp_id": a.emp_id if a else None,
            "name": (a.first_name if a else None) or (a.email if a else None),
            "outside_count": int(n),
        })

    low_signal_repeat = (
        db.session.query(GeoPunchAttempt.admin_id, func.count(GeoPunchAttempt.id))
        .filter(
            GeoPunchAttempt.created_at >= start,
            GeoPunchAttempt.created_at <= end,
            GeoPunchAttempt.geo_decision == "LOW_SIGNAL",
        )
        .group_by(GeoPunchAttempt.admin_id)
        .having(func.count(GeoPunchAttempt.id) >= 5)
        .order_by(func.count(GeoPunchAttempt.id).desc())
        .limit(50)
        .all()
    )

    reason_heavy = (
        db.session.query(GeoPunchAttempt.admin_id, func.count(GeoPunchAttempt.id))
        .filter(
            GeoPunchAttempt.created_at >= start,
            GeoPunchAttempt.created_at <= end,
            GeoPunchAttempt.policy_action == "REQUIRE_REASON",
        )
        .group_by(GeoPunchAttempt.admin_id)
        .having(func.count(GeoPunchAttempt.id) >= 5)
        .order_by(func.count(GeoPunchAttempt.id).desc())
        .limit(50)
        .all()
    )

    # Suspicious GPS jumps: consecutive attempts same employee with huge distance change
    # Approximate via large distance_m swings is hard without consecutive join — flag large distance with INSIDE claim rare.
    jumps = (
        GeoPunchAttempt.query.filter(
            GeoPunchAttempt.created_at >= start,
            GeoPunchAttempt.created_at <= end,
            GeoPunchAttempt.distance_m.isnot(None),
            GeoPunchAttempt.distance_m > 5000,
            GeoPunchAttempt.accuracy_m.isnot(None),
            GeoPunchAttempt.accuracy_m < 50,
        )
        .order_by(GeoPunchAttempt.created_at.desc())
        .limit(50)
        .all()
    )

    network_outside = (
        _base_query(start, end)
        .filter(
            GeoPunchAttempt.network_match.is_(True),
            GeoPunchAttempt.geo_decision.in_(["OUTSIDE", "NO_GPS", "LOW_SIGNAL"]),
        )
        .count()
    )

    return {
        "disclaimer": "Investigation only. Do not automatically punish employees.",
        "repeated_outside": repeated_outside,
        "repeated_low_signal": [
            {"admin_id": a, "count": int(n)} for a, n in low_signal_repeat
        ],
        "repeated_require_reason": [
            {"admin_id": a, "count": int(n)} for a, n in reason_heavy
        ],
        "suspicious_gps_jumps": [
            {
                "attempt_id": r.attempt_id,
                "admin_id": r.admin_id,
                "distance_m": r.distance_m,
                "accuracy_m": r.accuracy_m,
                "geo_decision": r.geo_decision,
                "timestamp": r.created_at.isoformat() + "Z" if r.created_at else None,
            }
            for r in jumps
        ],
        "network_match_but_weak_geo": network_outside,
        "potential_spoof_patterns": {
            "precise_far_from_office": len(jumps),
            "note": "High precision + very large distance may indicate mock location — review manually.",
        },
    }


# ----- Config management -----

def _json_dump(v: Any) -> str:
    return json.dumps(v)


def _json_load(s: str) -> Any:
    try:
        return json.loads(s)
    except Exception:
        return s


def load_overrides_into_app_config(app=None) -> int:
    """Apply DB overrides into Flask config. Returns count applied."""
    try:
        rows = GeoConfigOverride.query.all()
    except Exception:
        logger.exception("geo config overrides load failed")
        return 0
    target = app.config if app is not None else (current_app.config if has_app_context() else None)
    if target is None:
        return 0
    n = 0
    for row in rows:
        if row.config_key not in EDITABLE_KEYS:
            continue
        target[row.config_key] = _json_load(row.config_value)
        n += 1
    return n


def get_config_for_admin() -> dict[str, Any]:
    cfg = get_geo_fence_config()
    overrides = {r.config_key: _json_load(r.config_value) for r in GeoConfigOverride.query.all()}
    items = []
    for key in sorted(DEFAULTS.keys()):
        items.append({
            "key": key,
            "value": cfg.get(key),
            "default": DEFAULTS[key],
            "overridden": key in overrides,
            "doc": CONFIG_DOCS.get(key, ""),
            "editable": key in EDITABLE_KEYS,
        })
    return {"items": items, "docs": CONFIG_DOCS}


def apply_config_updates(
    updates: dict[str, Any],
    *,
    reason: str,
    admin_id: Optional[int],
    admin_email: Optional[str],
) -> dict[str, Any]:
    reason = (reason or "").strip()
    if len(reason) < 5:
        raise ValueError("Change reason is required (at least 5 characters).")
    if not updates:
        raise ValueError("No configuration updates provided.")

    max_ver = db.session.query(func.max(GeoConfigChange.version)).scalar() or 0
    version = int(max_ver) + 1
    changed = []
    current = get_geo_fence_config()

    for key, raw in updates.items():
        if key not in EDITABLE_KEYS:
            raise ValueError(f"Key not editable: {key}")
        old = current.get(key, DEFAULTS.get(key))
        # coerce type from default
        default = DEFAULTS[key]
        if isinstance(default, bool):
            new_val = str(raw).strip().lower() in {"1", "true", "yes", "on"} if not isinstance(raw, bool) else bool(raw)
        elif isinstance(default, int) and not isinstance(default, bool):
            new_val = int(raw)
        elif isinstance(default, float):
            new_val = float(raw)
        else:
            new_val = raw

        if new_val == old:
            continue

        row = GeoConfigOverride.query.filter_by(config_key=key).first()
        if not row:
            row = GeoConfigOverride(config_key=key, config_value=_json_dump(new_val))
            db.session.add(row)
        else:
            row.config_value = _json_dump(new_val)
        row.updated_at = datetime.utcnow()
        row.updated_by_admin_id = admin_id

        db.session.add(
            GeoConfigChange(
                version=version,
                config_key=key,
                old_value=_json_dump(old),
                new_value=_json_dump(new_val),
                reason=reason[:500],
                changed_by_admin_id=admin_id,
                changed_by_email=(admin_email or "")[:120] or None,
                created_at=datetime.utcnow(),
            )
        )
        if has_app_context():
            current_app.config[key] = new_val
        changed.append({"key": key, "old": old, "new": new_val})

    if not changed:
        return {"version": version, "changed": [], "message": "No values differed from current config."}

    db.session.commit()
    return {"version": version, "changed": changed, "message": f"Applied {len(changed)} change(s)."}


def config_history(limit: int = 100) -> list[dict[str, Any]]:
    rows = (
        GeoConfigChange.query.order_by(GeoConfigChange.created_at.desc())
        .limit(min(limit, 500))
        .all()
    )
    return [r.to_dict() for r in rows]
