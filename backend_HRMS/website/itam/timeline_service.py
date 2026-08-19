"""ITAM P2 — asset transition timeline query + CSV export (behind itam_timeline_v1)."""

from __future__ import annotations

import csv
import io
from datetime import datetime
from typing import Any, Optional

from .. import db
from ..models.Admin_models import Admin
from ..models.it_models import ITAssetAssignment, ITAssetTransition
from .actions import ACTION_LABELS
from .flags import is_itam_flag_enabled
from .transition_service import record_transition, serialize_transition


def timeline_enabled(config=None) -> bool:
    return is_itam_flag_enabled("itam_timeline_v1", config)


def _parse_dt(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    raw = str(value).strip()
    try:
        if len(raw) == 10:
            return datetime.strptime(raw, "%Y-%m-%d")
        return datetime.fromisoformat(raw.replace("Z", "+00:00")).replace(tzinfo=None)
    except Exception:
        return None


def query_transitions(
    *,
    asset_unit_id: Optional[int] = None,
    software_license_id: Optional[int] = None,
    inventory_item_id: Optional[int] = None,
    actions: Optional[list[str]] = None,
    q: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    page: int = 1,
    limit: int = 50,
) -> dict[str, Any]:
    """Paginated timeline for a unit / license / catalog item."""
    page = max(1, int(page or 1))
    limit = max(1, min(200, int(limit or 50)))

    query = ITAssetTransition.query
    if asset_unit_id is not None:
        query = query.filter(ITAssetTransition.asset_unit_id == int(asset_unit_id))
    if software_license_id is not None:
        query = query.filter(ITAssetTransition.software_license_id == int(software_license_id))
    if inventory_item_id is not None:
        query = query.filter(ITAssetTransition.inventory_item_id == int(inventory_item_id))

    if actions:
        codes = [str(a).strip().upper() for a in actions if str(a).strip()]
        if codes:
            query = query.filter(ITAssetTransition.action_code.in_(codes))

    needle = (q or "").strip()
    if needle:
        like = f"%{needle}%"
        query = query.filter(
            db.or_(
                ITAssetTransition.remark.ilike(like),
                ITAssetTransition.reason_code.ilike(like),
                ITAssetTransition.action_code.ilike(like),
                ITAssetTransition.transition_code.ilike(like),
            )
        )

    dt_from = _parse_dt(date_from)
    dt_to = _parse_dt(date_to)
    if dt_from:
        query = query.filter(ITAssetTransition.occurred_at >= dt_from)
    if dt_to:
        # inclusive end-of-day if date-only
        if date_to and len(str(date_to).strip()) == 10:
            dt_to = dt_to.replace(hour=23, minute=59, second=59)
        query = query.filter(ITAssetTransition.occurred_at <= dt_to)

    total = query.count()
    rows = (
        query.order_by(ITAssetTransition.occurred_at.desc(), ITAssetTransition.id.desc())
        .offset((page - 1) * limit)
        .limit(limit)
        .all()
    )

    actor_ids = {r.actor_admin_id for r in rows if r.actor_admin_id}
    actors = {}
    if actor_ids:
        for admin in Admin.query.filter(Admin.id.in_(list(actor_ids))).all():
            actors[admin.id] = {
                "id": admin.id,
                "name": (admin.first_name or admin.email or f"Admin #{admin.id}"),
                "empId": admin.emp_id,
                "email": admin.email,
            }

    transitions = []
    for row in rows:
        item = serialize_transition(row)
        item["actionLabel"] = ACTION_LABELS.get(row.action_code, row.action_code)
        item["actor"] = actors.get(row.actor_admin_id)
        transitions.append(item)

    latest = transitions[0] if transitions and page == 1 and not actions and not needle else None
    if latest is None and asset_unit_id and page == 1:
        latest_row = (
            ITAssetTransition.query.filter(ITAssetTransition.asset_unit_id == int(asset_unit_id))
            .order_by(ITAssetTransition.occurred_at.desc(), ITAssetTransition.id.desc())
            .first()
        )
        if latest_row:
            latest = serialize_transition(latest_row)
            latest["actionLabel"] = ACTION_LABELS.get(latest_row.action_code, latest_row.action_code)

    return {
        "transitions": transitions,
        "pagination": {
            "page": page,
            "limit": limit,
            "total": total,
            "totalPages": max(1, (total + limit - 1) // limit) if total else 1,
        },
        "latest": latest,
    }


def latest_by_unit_ids(unit_ids: list[int]) -> dict[int, dict]:
    """Map unit_id -> latest transition summary (one query)."""
    ids = [int(i) for i in unit_ids if i is not None]
    if not ids:
        return {}

    subq = (
        db.session.query(
            ITAssetTransition.asset_unit_id.label("uid"),
            db.func.max(ITAssetTransition.id).label("max_id"),
        )
        .filter(ITAssetTransition.asset_unit_id.in_(ids))
        .group_by(ITAssetTransition.asset_unit_id)
        .subquery()
    )
    rows = (
        db.session.query(ITAssetTransition)
        .join(subq, ITAssetTransition.id == subq.c.max_id)
        .all()
    )
    out = {}
    for row in rows:
        if not row.asset_unit_id:
            continue
        out[int(row.asset_unit_id)] = {
            "actionCode": row.action_code,
            "actionLabel": ACTION_LABELS.get(row.action_code, row.action_code),
            "remark": row.remark,
            "occurredAt": row.occurred_at.isoformat() if row.occurred_at else None,
            "transitionCode": row.transition_code,
        }
    return out


def timeline_to_csv(transitions: list[dict]) -> str:
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(
        [
            "occurred_at",
            "transition_code",
            "action_code",
            "action_label",
            "from_status",
            "to_status",
            "remark",
            "reason_code",
            "condition_grade",
            "actor_name",
            "actor_emp_id",
        ]
    )
    for t in transitions:
        actor = t.get("actor") or {}
        writer.writerow(
            [
                t.get("occurredAt") or "",
                t.get("transitionCode") or "",
                t.get("actionCode") or "",
                t.get("actionLabel") or "",
                t.get("fromStatus") or "",
                t.get("toStatus") or "",
                t.get("remark") or "",
                t.get("reasonCode") or "",
                t.get("conditionGrade") or "",
                actor.get("name") or "",
                actor.get("empId") or "",
            ]
        )
    return buf.getvalue()


def backfill_from_assignments(*, limit: int = 500, config=None) -> dict[str, int]:
    """
    Seed TransitionRecords from ITAssetAssignment history (best-effort).
    Skips assignments already linked via related_json.assignment_id.
    """
    limit = max(1, min(5000, int(limit or 500)))
    assignments = (
        ITAssetAssignment.query.filter(ITAssetAssignment.asset_unit_id.isnot(None))
        .order_by(ITAssetAssignment.id.asc())
        .limit(limit)
        .all()
    )

    # Preload existing backfill markers for scanned units
    unit_ids = {a.asset_unit_id for a in assignments if a.asset_unit_id}
    linked_assignment_ids = set()
    if unit_ids:
        prior_rows = (
            ITAssetTransition.query.filter(ITAssetTransition.asset_unit_id.in_(list(unit_ids)))
            .order_by(ITAssetTransition.id.desc())
            .limit(5000)
            .all()
        )
        for p in prior_rows:
            related = p.related_json if isinstance(p.related_json, dict) else {}
            aid = related.get("assignment_id")
            if aid is not None:
                linked_assignment_ids.add(int(aid))

    created = 0
    skipped = 0
    for asn in assignments:
        if asn.id in linked_assignment_ids:
            skipped += 1
            continue

        action = "CHECKOUT" if (asn.assignment_type or "").lower() in {"assign", ""} else "CHECKIN"
        remark = (asn.notes or "").strip() or (
            f"Backfilled from assignment #{asn.id} ({asn.assignment_type or 'assign'})"
        )
        # Satisfy remark min lengths
        if len(remark) < 10:
            remark = f"{remark} — historical assignment record #{asn.id}"

        try:
            cond = "B" if action == "CHECKIN" else None
            row = record_transition(
                action_code=action,
                remark=remark[:2000],
                reason_code=None,
                condition_grade=cond,
                actor_admin_id=asn.assigned_by_admin_id,
                asset_unit_id=asn.asset_unit_id,
                from_status="available" if action == "CHECKOUT" else "assigned",
                to_status="assigned" if action == "CHECKOUT" else "available",
                from_custody={"type": "NONE"}
                if action == "CHECKOUT"
                else {"type": "EMPLOYEE", "admin_id": asn.assigned_to_admin_id},
                to_custody={"type": "EMPLOYEE", "admin_id": asn.assigned_to_admin_id}
                if action == "CHECKOUT"
                else {"type": "NONE"},
                related={"assignment_id": asn.id, "backfill": True},
                config=config,
                require=True,
            )
            if row and asn.assigned_at:
                row.occurred_at = asn.assigned_at
            created += 1
            linked_assignment_ids.add(asn.id)
        except Exception:
            skipped += 1

    if created:
        db.session.commit()
    return {"created": created, "skipped": skipped, "scanned": len(assignments)}
