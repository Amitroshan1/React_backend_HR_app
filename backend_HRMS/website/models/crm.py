"""Sales CRM for the team that sells this HRMS. Scoped per tenant."""
from __future__ import annotations

from .. import db
from ..datetime_utils import isoformat_api, utc_now

CRM_STAGES = (
    "new",
    "contacted",
    "qualified",
    "demo",
    "proposal",
    "negotiation",
    "won",
    "lost",
)
CRM_STAGE_LABELS = {
    "new": "New",
    "contacted": "Contacted",
    "qualified": "Qualified",
    "demo": "Demo",
    "proposal": "Proposal",
    "negotiation": "Negotiation",
    "won": "Won",
    "lost": "Lost",
}
CRM_OPEN_STAGES = tuple(stage for stage in CRM_STAGES if stage not in {"won", "lost"})
CRM_PLANS = ("basic", "essential", "enterprise")
CRM_PLAN_LABELS = {
    "basic": "Basic",
    "essential": "Essential",
    "enterprise": "Enterprise",
}
CRM_SOURCES = ("website", "referral", "outbound", "event", "other")
CRM_SOURCE_LABELS = {
    "website": "Website",
    "referral": "Referral",
    "outbound": "Outbound",
    "event": "Event",
    "other": "Other",
}
CRM_ACTIVITY_KINDS = ("call", "meeting", "task", "note")


def _default_tenant_id():
    from ..tenant_context import get_current_tenant_id

    return get_current_tenant_id()


class CrmDeal(db.Model):
    __tablename__ = "crm_deals"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    tenant_id = db.Column(db.Integer, nullable=False, default=_default_tenant_id, index=True)
    company_name = db.Column(db.String(200), nullable=False)
    contact_name = db.Column(db.String(150), nullable=True)
    email = db.Column(db.String(200), nullable=True)
    phone = db.Column(db.String(30), nullable=True)
    stage = db.Column(db.String(32), nullable=False, default="new", index=True)
    plan = db.Column(db.String(32), nullable=True)
    amount = db.Column(db.Numeric(12, 2), nullable=False, default=0)
    expected_close = db.Column(db.Date, nullable=True)
    source = db.Column(db.String(32), nullable=True)
    owner_admin_id = db.Column(db.Integer, nullable=True, index=True)
    notes = db.Column(db.Text, nullable=True)
    lost_reason = db.Column(db.String(200), nullable=True)
    created_at = db.Column(db.DateTime, nullable=False, default=utc_now)
    updated_at = db.Column(db.DateTime, nullable=False, default=utc_now, onupdate=utc_now)

    activities = db.relationship(
        "CrmActivity",
        backref="deal",
        lazy="dynamic",
        cascade="all, delete-orphan",
    )

    def to_dict(self):
        amount = float(self.amount or 0)
        return {
            "id": self.id,
            "company_name": self.company_name or "",
            "contact_name": self.contact_name or "",
            "email": self.email or "",
            "phone": self.phone or "",
            "stage": self.stage or "new",
            "stage_label": CRM_STAGE_LABELS.get(self.stage or "", self.stage or ""),
            "plan": (self.plan or "").lower(),
            "plan_label": CRM_PLAN_LABELS.get((self.plan or "").lower(), self.plan or ""),
            "amount": amount,
            "expected_close": self.expected_close.isoformat() if self.expected_close else None,
            "source": self.source or "",
            "source_label": CRM_SOURCE_LABELS.get(self.source or "", self.source or ""),
            "owner_admin_id": self.owner_admin_id,
            "notes": self.notes or "",
            "lost_reason": self.lost_reason or "",
            "created_at": isoformat_api(self.created_at),
            "updated_at": isoformat_api(self.updated_at),
        }


class CrmActivity(db.Model):
    __tablename__ = "crm_activities"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    tenant_id = db.Column(db.Integer, nullable=False, default=_default_tenant_id, index=True)
    deal_id = db.Column(db.Integer, db.ForeignKey("crm_deals.id"), nullable=False, index=True)
    kind = db.Column(db.String(20), nullable=False, default="task")
    summary = db.Column(db.String(300), nullable=False)
    due_on = db.Column(db.Date, nullable=True)
    done = db.Column(db.Boolean, nullable=False, default=False)
    created_by = db.Column(db.Integer, nullable=True)
    created_at = db.Column(db.DateTime, nullable=False, default=utc_now)

    def to_dict(self):
        return {
            "id": self.id,
            "deal_id": self.deal_id,
            "kind": self.kind or "task",
            "summary": self.summary or "",
            "due_on": self.due_on.isoformat() if self.due_on else None,
            "done": bool(self.done),
            "created_at": isoformat_api(self.created_at),
        }
