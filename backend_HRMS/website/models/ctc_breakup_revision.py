"""Historical CTC breakup snapshots (effective-dated revisions)."""
from __future__ import annotations

from .. import db
from ..datetime_utils import isoformat_api, utc_now


class CTCBreakupRevision(db.Model):
    __tablename__ = "ctc_breakup_revisions"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    admin_id = db.Column(
        db.Integer,
        db.ForeignKey("admins.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    effective_from = db.Column(db.Date, nullable=False, index=True)
    snapshot = db.Column(db.JSON, nullable=False)
    note = db.Column(db.String(255), nullable=True)
    created_by_admin_id = db.Column(db.Integer, nullable=True)
    created_at = db.Column(db.DateTime, default=utc_now, nullable=True)

    admin = db.relationship("Admin", backref="ctc_breakup_revisions")

    def to_dict(self):
        snap = self.snapshot if isinstance(self.snapshot, dict) else {}
        return {
            "id": self.id,
            "admin_id": self.admin_id,
            "effective_from": self.effective_from.isoformat() if self.effective_from else None,
            "snapshot": snap,
            "note": self.note,
            "created_by_admin_id": self.created_by_admin_id,
            "created_at": isoformat_api(self.created_at),
            "gross_salary": snap.get("gross_salary"),
            "annual_ctc_computed": snap.get("annual_ctc_computed"),
        }
