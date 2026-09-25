"""Vendor registry: companies deployed on separate server/DB (master instance only).

Phase 1 control plane — Super Admin registers a company, selects a plan, and
tracks lifecycle status. Each row is a future siloed HRMS instance (own DB).
Provisioning automation is Phase 2; this module is the registry only.
"""
from __future__ import annotations

import re

from .. import db
from ..datetime_utils import isoformat_api, utc_now


PLAN_ORDER = ("basic", "essential", "enterprise")
PLAN_LABELS = {
    "basic": "Basic",
    "essential": "Essential",
    "enterprise": "Enterprise",
}

# Lifecycle for silo multi-tenant onboarding (Phase 1 registry).
STATUS_ORDER = ("provisioning", "active", "suspended", "cancelled")
STATUS_LABELS = {
    "provisioning": "Provisioning",
    "active": "Active",
    "suspended": "Suspended",
    "cancelled": "Cancelled",
}

# Allowed status transitions (from → frozenset of to).
STATUS_TRANSITIONS = {
    "provisioning": frozenset({"active", "suspended", "cancelled"}),
    "active": frozenset({"suspended", "cancelled"}),
    "suspended": frozenset({"active", "cancelled", "provisioning"}),
    "cancelled": frozenset({"provisioning"}),
}


def normalize_plan(value) -> str | None:
    plan = (value or "").strip().lower()
    return plan if plan in PLAN_ORDER else None


def normalize_status(value) -> str | None:
    status = (value or "").strip().lower()
    return status if status in STATUS_ORDER else None


def slugify_company(name: str, *, max_len: int = 48) -> str:
    """Stable URL/DB slug from company name (e.g. 'Acme Corp' → 'acme_corp')."""
    raw = (name or "").strip().lower()
    raw = raw.replace("&", " and ")
    raw = re.sub(r"[^a-z0-9]+", "_", raw)
    raw = re.sub(r"_+", "_", raw).strip("_")
    if not raw:
        raw = "company"
    return raw[:max_len]


def suggest_database_name(company_name: str = "", slug: str | None = None) -> str:
    """Suggested MySQL database name: hrms_<slug>."""
    base = (slug or "").strip().lower() or slugify_company(company_name)
    base = re.sub(r"[^a-z0-9_]", "_", base)
    base = re.sub(r"_+", "_", base).strip("_") or "company"
    name = f"hrms_{base}"
    return name[:64]


def status_can_transition(current: str, new_status: str) -> bool:
    cur = normalize_status(current) or "provisioning"
    nxt = normalize_status(new_status)
    if not nxt:
        return False
    if nxt == cur:
        return True
    return nxt in STATUS_TRANSITIONS.get(cur, frozenset())


class DeployedCustomer(db.Model):
    __tablename__ = "deployed_customers"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    company_name = db.Column(db.String(200), nullable=False)
    # Short id for subdomain / DB naming (unique on vendor master).
    slug = db.Column(db.String(64), nullable=True, unique=True, index=True)
    plan = db.Column(db.String(32), nullable=False, default="essential")
    app_url = db.Column(db.String(500), nullable=True)
    database_name = db.Column(db.String(120), nullable=True)
    contact_email = db.Column(db.String(200), nullable=True)
    notes = db.Column(db.Text, nullable=True)
    # provisioning | active | suspended | cancelled
    status = db.Column(db.String(32), nullable=False, default="provisioning")
    go_live_date = db.Column(db.Date, nullable=True)
    created_at = db.Column(db.DateTime, nullable=False, default=utc_now)
    updated_at = db.Column(
        db.DateTime,
        nullable=False,
        default=utc_now,
        onupdate=utc_now,
    )

    def plan_label(self):
        return PLAN_LABELS.get((self.plan or "").lower(), self.plan or "—")

    def status_label(self):
        key = (self.status or "").lower()
        return STATUS_LABELS.get(key, self.status or "—")

    def upgrade_options(self):
        key = (self.plan or "basic").lower()
        if key not in PLAN_ORDER:
            return list(PLAN_ORDER)
        idx = PLAN_ORDER.index(key)
        return list(PLAN_ORDER[idx + 1 :])

    def allowed_next_statuses(self):
        cur = normalize_status(self.status) or "provisioning"
        nxt = sorted(STATUS_TRANSITIONS.get(cur, frozenset()))
        return [{"id": s, "label": STATUS_LABELS[s]} for s in nxt]

    def to_dict(self):
        status = normalize_status(self.status) or (self.status or "provisioning")
        return {
            "id": self.id,
            "company_name": self.company_name,
            "slug": self.slug or "",
            "plan": (self.plan or "").lower(),
            "plan_label": self.plan_label(),
            "app_url": self.app_url or "",
            "database_name": self.database_name or "",
            "contact_email": self.contact_email or "",
            "notes": self.notes or "",
            "status": status,
            "status_label": self.status_label(),
            "go_live_date": self.go_live_date.isoformat() if self.go_live_date else None,
            "created_at": isoformat_api(self.created_at),
            "updated_at": isoformat_api(self.updated_at),
            "can_upgrade_to": [
                {"id": p, "label": PLAN_LABELS[p]} for p in self.upgrade_options()
            ],
            "allowed_next_statuses": self.allowed_next_statuses(),
        }
