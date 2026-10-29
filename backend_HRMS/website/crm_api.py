"""Sales CRM API. Deals belong to the signed-in company (tenant)."""
from datetime import date

from flask import Blueprint, jsonify, request
from flask_jwt_extended import get_jwt, get_jwt_identity, jwt_required
from . import db
from .models.crm import (
    CRM_ACTIVITY_KINDS,
    CRM_OPEN_STAGES,
    CRM_PLAN_LABELS,
    CRM_PLANS,
    CRM_SOURCE_LABELS,
    CRM_SOURCES,
    CRM_STAGE_LABELS,
    CRM_STAGES,
    CrmActivity,
    CrmDeal,
)
from .tenant_context import get_current_tenant_id

crm_bp = Blueprint("crm", __name__)

ADMIN_EMP_TYPES = {"admin", "administrator", "administration"}


def _admin_required(fn):
    from functools import wraps
    from .plan_features import is_platform_super_admin

    @wraps(fn)
    def wrapper(*args, **kwargs):
        claims = get_jwt() or {}
        if not is_platform_super_admin(claims):
            return jsonify({
                "success": False,
                "message": "CRM is available only to the application Super Admin.",
            }), 403
        return fn(*args, **kwargs)

    return wrapper


def _owner_id():
    try:
        return int(get_jwt_identity())
    except (TypeError, ValueError):
        return None


def _parse_date(value):
    raw = (value or "").strip()
    if not raw:
        return None
    try:
        return date.fromisoformat(raw[:10])
    except ValueError:
        return None


def _money(value):
    try:
        amount = round(float(value or 0), 2)
    except (TypeError, ValueError):
        return None
    if amount < 0:
        return None
    return amount


def _deal_query():
    return CrmDeal.query.filter(CrmDeal.tenant_id == get_current_tenant_id())


def _meta():
    return {
        "stages": [{"id": key, "label": CRM_STAGE_LABELS[key]} for key in CRM_STAGES],
        "plans": [{"id": key, "label": CRM_PLAN_LABELS[key]} for key in CRM_PLANS],
        "sources": [{"id": key, "label": CRM_SOURCE_LABELS[key]} for key in CRM_SOURCES],
        "activity_kinds": list(CRM_ACTIVITY_KINDS),
    }


@crm_bp.route("/deals", methods=["GET"])
@jwt_required()
@_admin_required
def list_deals():
    rows = _deal_query().order_by(CrmDeal.updated_at.desc(), CrmDeal.id.desc()).all()
    return jsonify({"success": True, "deals": [row.to_dict() for row in rows], **_meta()}), 200


@crm_bp.route("/deals", methods=["POST"])
@jwt_required()
@_admin_required
def create_deal():
    data = request.get_json(silent=True) or {}
    company = (data.get("company_name") or "").strip()
    if not company:
        return jsonify({"success": False, "message": "Company name is required"}), 400
    stage = (data.get("stage") or "new").strip().lower()
    if stage not in CRM_STAGES:
        return jsonify({"success": False, "message": "Unknown stage"}), 400
    plan = (data.get("plan") or "").strip().lower() or None
    if plan and plan not in CRM_PLANS:
        return jsonify({"success": False, "message": "Unknown plan"}), 400
    source = (data.get("source") or "").strip().lower() or None
    if source and source not in CRM_SOURCES:
        return jsonify({"success": False, "message": "Unknown source"}), 400
    amount = _money(data.get("amount"))
    if amount is None:
        return jsonify({"success": False, "message": "Amount must be zero or more"}), 400
    deal = CrmDeal(
        tenant_id=get_current_tenant_id(),
        company_name=company[:200],
        contact_name=(data.get("contact_name") or "").strip()[:150] or None,
        email=(data.get("email") or "").strip()[:200] or None,
        phone=(data.get("phone") or "").strip()[:30] or None,
        stage=stage,
        plan=plan,
        amount=amount,
        expected_close=_parse_date(data.get("expected_close")),
        source=source,
        owner_admin_id=_owner_id(),
        notes=(data.get("notes") or "").strip() or None,
        lost_reason=(data.get("lost_reason") or "").strip()[:200] or None,
    )
    db.session.add(deal)
    db.session.flush()
    follow_up = (data.get("follow_up") or "").strip()
    if follow_up:
        db.session.add(CrmActivity(
            tenant_id=deal.tenant_id,
            deal_id=deal.id,
            kind="task",
            summary=follow_up[:300],
            due_on=_parse_date(data.get("follow_up_on")) or date.today(),
            done=False,
            created_by=_owner_id(),
        ))
    db.session.commit()
    return jsonify({"success": True, "deal": deal.to_dict()}), 201


@crm_bp.route("/deals/<int:deal_id>", methods=["PATCH"])
@jwt_required()
@_admin_required
def update_deal(deal_id):
    deal = _deal_query().filter(CrmDeal.id == deal_id).first()
    if deal is None:
        return jsonify({"success": False, "message": "Deal not found"}), 404
    data = request.get_json(silent=True) or {}
    if "stage" in data:
        stage = (data.get("stage") or "").strip().lower()
        if stage not in CRM_STAGES:
            return jsonify({"success": False, "message": "Unknown stage"}), 400
        deal.stage = stage
    if "amount" in data:
        amount = _money(data.get("amount"))
        if amount is None:
            return jsonify({"success": False, "message": "Amount must be zero or more"}), 400
        deal.amount = amount
    if "plan" in data:
        plan = (data.get("plan") or "").strip().lower() or None
        if plan and plan not in CRM_PLANS:
            return jsonify({"success": False, "message": "Unknown plan"}), 400
        deal.plan = plan
    if "expected_close" in data:
        deal.expected_close = _parse_date(data.get("expected_close"))
    if "lost_reason" in data:
        deal.lost_reason = (data.get("lost_reason") or "").strip()[:200] or None
    if "notes" in data:
        deal.notes = (data.get("notes") or "").strip() or None
    db.session.commit()
    return jsonify({"success": True, "deal": deal.to_dict()}), 200


@crm_bp.route("/deals/<int:deal_id>/activities", methods=["POST"])
@jwt_required()
@_admin_required
def add_activity(deal_id):
    deal = _deal_query().filter(CrmDeal.id == deal_id).first()
    if deal is None:
        return jsonify({"success": False, "message": "Deal not found"}), 404
    data = request.get_json(silent=True) or {}
    summary = (data.get("summary") or "").strip()
    if not summary:
        return jsonify({"success": False, "message": "Follow-up note is required"}), 400
    kind = (data.get("kind") or "task").strip().lower()
    if kind not in CRM_ACTIVITY_KINDS:
        return jsonify({"success": False, "message": "Unknown activity type"}), 400
    row = CrmActivity(
        tenant_id=deal.tenant_id,
        deal_id=deal.id,
        kind=kind,
        summary=summary[:300],
        due_on=_parse_date(data.get("due_on")),
        done=False,
        created_by=_owner_id(),
    )
    db.session.add(row)
    db.session.commit()
    return jsonify({"success": True, "activity": row.to_dict()}), 201


@crm_bp.route("/activities/<int:activity_id>", methods=["PATCH"])
@jwt_required()
@_admin_required
def update_activity(activity_id):
    row = CrmActivity.query.filter(
        CrmActivity.id == activity_id,
        CrmActivity.tenant_id == get_current_tenant_id(),
    ).first()
    if row is None:
        return jsonify({"success": False, "message": "Follow-up not found"}), 404
    data = request.get_json(silent=True) or {}
    if "done" in data:
        row.done = bool(data.get("done"))
    db.session.commit()
    return jsonify({"success": True, "activity": row.to_dict()}), 200


@crm_bp.route("/dashboard", methods=["GET"])
@jwt_required()
@_admin_required
def dashboard():
    tenant_id = get_current_tenant_id()
    deals = _deal_query().all()
    open_deals = [row for row in deals if row.stage in CRM_OPEN_STAGES]
    won = [row for row in deals if row.stage == "won"]
    lost = [row for row in deals if row.stage == "lost"]
    stages = []
    for key in CRM_STAGES:
        matched = [row for row in deals if row.stage == key]
        stages.append({
            "id": key,
            "label": CRM_STAGE_LABELS[key],
            "count": len(matched),
            "value": float(sum(row.amount or 0 for row in matched)),
        })
    plans = []
    for key in CRM_PLANS:
        matched = [row for row in open_deals if (row.plan or "") == key]
        plans.append({
            "id": key,
            "label": CRM_PLAN_LABELS[key],
            "count": len(matched),
            "value": float(sum(row.amount or 0 for row in matched)),
        })
    created_by_month = {}
    for row in deals:
        created = row.created_at
        if not created:
            continue
        key = f"{created.year:04d}-{created.month:02d}"
        created_by_month[key] = created_by_month.get(key, 0) + 1
    followups = (
        CrmActivity.query.filter(
            CrmActivity.tenant_id == tenant_id,
            CrmActivity.done.is_(False),
        )
        .order_by(CrmActivity.due_on.asc(), CrmActivity.id.asc())
        .limit(8)
        .all()
    )
    names = {row.id: row.company_name for row in deals}
    return jsonify({
        **_meta(),
        "success": True,
        "kpis": {
            "open_deals": len(open_deals),
            "pipeline_value": float(sum(row.amount or 0 for row in open_deals)),
            "won_value": float(sum(row.amount or 0 for row in won)),
            "lost_deals": len(lost),
            "due_followups": CrmActivity.query.filter(
                CrmActivity.tenant_id == tenant_id,
                CrmActivity.done.is_(False),
            ).count(),
        },
        "stages": stages,
        "plans": plans,
        "created_by_month": created_by_month,
        "followups": [
            {**row.to_dict(), "company_name": names.get(row.deal_id, "")}
            for row in followups
        ],
        "deals": [row.to_dict() for row in sorted(deals, key=lambda item: item.updated_at or item.created_at, reverse=True)[:12]],
    }), 200
