"""Shared-DB SaaS: company/tenant registry (one row per customer in the same DB)."""
from __future__ import annotations

import re

from .. import db
from ..datetime_utils import isoformat_api, utc_now

TENANT_PLANS = ("basic", "essential", "enterprise")
TENANT_PLAN_LABELS = {
    "basic": "Basic",
    "essential": "Essential",
    "enterprise": "Enterprise",
}
TENANT_STATUSES = ("active", "suspended", "cancelled", "provisioning")
TENANT_STATUS_LABELS = {
    "active": "Active",
    "suspended": "Suspended",
    "cancelled": "Cancelled",
    "provisioning": "Provisioning",
}


def normalize_tenant_plan(value) -> str | None:
    plan = (value or "").strip().lower()
    return plan if plan in TENANT_PLANS else None


def normalize_tenant_status(value) -> str | None:
    status = (value or "").strip().lower()
    return status if status in TENANT_STATUSES else None


def slugify_tenant(name: str, *, max_len: int = 48) -> str:
    raw = (name or "").strip().lower()
    raw = raw.replace("&", " and ")
    raw = re.sub(r"[^a-z0-9]+", "_", raw)
    raw = re.sub(r"_+", "_", raw).strip("_")
    if not raw:
        raw = "company"
    return raw[:max_len]


class Tenant(db.Model):
    """One customer organization in the shared HRMS database."""

    __tablename__ = "tenants"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    name = db.Column(db.String(200), nullable=False)
    slug = db.Column(db.String(64), nullable=False, unique=True, index=True)
    plan = db.Column(db.String(32), nullable=False, default="essential")
    status = db.Column(db.String(32), nullable=False, default="active")
    contact_email = db.Column(db.String(200), nullable=True)
    notes = db.Column(db.Text, nullable=True)
    created_at = db.Column(db.DateTime, nullable=False, default=utc_now)
    updated_at = db.Column(
        db.DateTime,
        nullable=False,
        default=utc_now,
        onupdate=utc_now,
    )

    def plan_label(self) -> str:
        return TENANT_PLAN_LABELS.get((self.plan or "").lower(), self.plan or "—")

    def status_label(self) -> str:
        return TENANT_STATUS_LABELS.get((self.status or "").lower(), self.status or "—")

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "slug": self.slug,
            "plan": (self.plan or "essential").lower(),
            "plan_label": self.plan_label(),
            "status": (self.status or "active").lower(),
            "status_label": self.status_label(),
            "contact_email": self.contact_email or "",
            "notes": self.notes or "",
            "created_at": isoformat_api(self.created_at),
            "updated_at": isoformat_api(self.updated_at),
        }
