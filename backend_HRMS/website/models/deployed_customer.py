"""Vendor registry: companies deployed on separate server/DB (master instance only)."""
from datetime import datetime, date

from .. import db


PLAN_ORDER = ("basic", "essential", "enterprise")
PLAN_LABELS = {
    "basic": "Basic",
    "essential": "Essential",
    "enterprise": "Enterprise",
}


class DeployedCustomer(db.Model):
    __tablename__ = "deployed_customers"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    company_name = db.Column(db.String(200), nullable=False)
    plan = db.Column(db.String(32), nullable=False, default="essential")
    app_url = db.Column(db.String(500), nullable=True)
    database_name = db.Column(db.String(120), nullable=True)
    contact_email = db.Column(db.String(200), nullable=True)
    notes = db.Column(db.Text, nullable=True)
    status = db.Column(db.String(32), nullable=False, default="active")
    go_live_date = db.Column(db.Date, nullable=True)
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    updated_at = db.Column(
        db.DateTime,
        nullable=False,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
    )

    def plan_label(self):
        return PLAN_LABELS.get((self.plan or "").lower(), self.plan or "—")

    def upgrade_options(self):
        key = (self.plan or "basic").lower()
        if key not in PLAN_ORDER:
            return list(PLAN_ORDER)
        idx = PLAN_ORDER.index(key)
        return list(PLAN_ORDER[idx + 1 :])

    def to_dict(self):
        return {
            "id": self.id,
            "company_name": self.company_name,
            "plan": (self.plan or "").lower(),
            "plan_label": self.plan_label(),
            "app_url": self.app_url or "",
            "database_name": self.database_name or "",
            "contact_email": self.contact_email or "",
            "notes": self.notes or "",
            "status": self.status or "active",
            "go_live_date": self.go_live_date.isoformat() if self.go_live_date else None,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
            "can_upgrade_to": [
                {"id": p, "label": PLAN_LABELS[p]} for p in self.upgrade_options()
            ],
        }
