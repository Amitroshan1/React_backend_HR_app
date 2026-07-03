"""Full & Final settlement snapshot on employee exit."""
from __future__ import annotations

from .. import db
from ..datetime_utils import isoformat_api, utc_now


class FnfSettlement(db.Model):
    __tablename__ = "fnf_settlements"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    admin_id = db.Column(
        db.Integer,
        db.ForeignKey("admins.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    separation_date = db.Column(db.Date, nullable=False)
    last_working_day = db.Column(db.Date, nullable=False)
    snapshot = db.Column(db.JSON, nullable=False)
    net_payable = db.Column(db.Float, nullable=False, default=0.0)
    status = db.Column(db.String(20), nullable=False, default="draft")
    note = db.Column(db.Text, nullable=True)
    created_by_admin_id = db.Column(db.Integer, nullable=True)
    created_at = db.Column(db.DateTime, nullable=True, default=utc_now)

    admin = db.relationship("Admin", backref="fnf_settlements")

    def to_dict(self):
        snap = self.snapshot if isinstance(self.snapshot, dict) else {}
        return {
            "id": self.id,
            "admin_id": self.admin_id,
            "separation_date": self.separation_date.isoformat() if self.separation_date else None,
            "last_working_day": self.last_working_day.isoformat() if self.last_working_day else None,
            "snapshot": snap,
            "net_payable": float(self.net_payable or 0),
            "status": self.status,
            "note": self.note,
            "created_by_admin_id": self.created_by_admin_id,
            "created_at": isoformat_api(self.created_at),
        }
