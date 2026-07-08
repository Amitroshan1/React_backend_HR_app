"""HR policy document management and employee acknowledgments."""
from __future__ import annotations

from datetime import date

from sqlalchemy import or_

from . import db
from .datetime_utils import utc_now
from .models.Admin_models import Admin
from .models.hr_policy import HRPolicyDocument, PolicyAcknowledgment


def _enabled_filters():
    return (
        or_(Admin.is_exited == False, Admin.is_exited.is_(None)),
        or_(Admin.is_active == True, Admin.is_active.is_(None)),
    )


def _policy_applies_to_admin(policy: HRPolicyDocument, admin: Admin) -> bool:
    if not policy.is_active:
        return False
    if policy.effective_from and policy.effective_from > date.today():
        return False
    if policy.circle and (policy.circle or "").strip().lower() != (admin.circle or "").strip().lower():
        return False
    if policy.emp_type and (policy.emp_type or "").strip().lower() != (admin.emp_type or "").strip().lower():
        return False
    return True


def list_policies_for_hr() -> list[dict]:
    rows = HRPolicyDocument.query.order_by(HRPolicyDocument.created_at.desc()).all()
    out = []
    for row in rows:
        ack_count = PolicyAcknowledgment.query.filter_by(policy_id=row.id).count()
        out.append(row.to_dict(ack_count=ack_count))
    return out


def create_policy(data: dict, *, created_by: str) -> HRPolicyDocument:
    eff = None
    if data.get("effective_from"):
        eff = date.fromisoformat(str(data["effective_from"])[:10])
    row = HRPolicyDocument(
        title=str(data.get("title") or "").strip(),
        version=str(data.get("version") or "1.0").strip(),
        circle=(data.get("circle") or None) or None,
        emp_type=(data.get("emp_type") or None) or None,
        content_html=(data.get("content_html") or "").strip() or None,
        file_path=(data.get("file_path") or "").strip() or None,
        effective_from=eff,
        requires_acknowledgment=bool(data.get("requires_acknowledgment", True)),
        is_active=bool(data.get("is_active", True)),
        created_by=created_by,
    )
    if not row.title:
        raise ValueError("title is required")
    db.session.add(row)
    db.session.commit()
    return row


def update_policy(policy_id: int, data: dict) -> HRPolicyDocument:
    row = HRPolicyDocument.query.get(policy_id)
    if not row:
        raise ValueError("Policy not found")
    if "title" in data:
        row.title = str(data.get("title") or "").strip()
    if "version" in data:
        row.version = str(data.get("version") or row.version).strip()
    if "circle" in data:
        row.circle = (data.get("circle") or None) or None
    if "emp_type" in data:
        row.emp_type = (data.get("emp_type") or None) or None
    if "content_html" in data:
        row.content_html = (data.get("content_html") or "").strip() or None
    if "effective_from" in data:
        raw = data.get("effective_from")
        row.effective_from = date.fromisoformat(str(raw)[:10]) if raw else None
    if "requires_acknowledgment" in data:
        row.requires_acknowledgment = bool(data.get("requires_acknowledgment"))
    if "is_active" in data:
        row.is_active = bool(data.get("is_active"))
    db.session.commit()
    return row


def pending_policies_for_admin(admin: Admin) -> list[dict]:
    if not admin:
        return []
    acked_ids = {
        a.policy_id
        for a in PolicyAcknowledgment.query.filter_by(admin_id=admin.id).all()
    }
    policies = HRPolicyDocument.query.filter(HRPolicyDocument.is_active.is_(True)).all()
    pending = []
    for p in policies:
        if not p.requires_acknowledgment:
            continue
        if not _policy_applies_to_admin(p, admin):
            continue
        if p.id in acked_ids:
            continue
        pending.append(p.to_dict())
    return pending


def save_policy_file(policy_id: int, *, rel_path: str) -> HRPolicyDocument:
    row = HRPolicyDocument.query.get(policy_id)
    if not row:
        raise ValueError("Policy not found")
    row.file_path = rel_path
    db.session.commit()
    return row


def acknowledge_policy(admin: Admin, policy_id: int) -> PolicyAcknowledgment:
    policy = HRPolicyDocument.query.get(policy_id)
    if not policy or not policy.is_active:
        raise ValueError("Policy not found")
    if not _policy_applies_to_admin(policy, admin):
        raise ValueError("This policy does not apply to you")
    existing = PolicyAcknowledgment.query.filter_by(policy_id=policy_id, admin_id=admin.id).first()
    if existing:
        return existing
    row = PolicyAcknowledgment(policy_id=policy_id, admin_id=admin.id, acknowledged_at=utc_now())
    db.session.add(row)
    db.session.commit()
    return row


def policy_ack_stats(policy_id: int) -> dict:
    policy = HRPolicyDocument.query.get(policy_id)
    if not policy:
        raise ValueError("Policy not found")
    applicable = [
        a for a in Admin.query.filter(*_enabled_filters()).all() if _policy_applies_to_admin(policy, a)
    ]
    acked = PolicyAcknowledgment.query.filter_by(policy_id=policy_id).count()
    return {
        "applicable_count": len(applicable),
        "ack_count": acked,
        "pending_count": max(0, len(applicable) - acked),
    }
