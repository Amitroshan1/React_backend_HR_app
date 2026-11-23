"""Who viewed compensation (Phase 3). Amounts are not stored."""
from __future__ import annotations

from .. import db
from ..datetime_utils import isoformat_api, utc_now


class CompensationViewLog(db.Model):
    __tablename__ = "compensation_view_logs"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    viewer_admin_id = db.Column(db.Integer, nullable=False, index=True)
    target_admin_id = db.Column(db.Integer, nullable=False, index=True)
    resource = db.Column(db.String(80), nullable=False)
    visibility = db.Column(db.String(16), nullable=False)
    created_at = db.Column(db.DateTime, nullable=False, default=utc_now)

    def to_dict(self):
        return {
            "id": self.id,
            "viewer_admin_id": self.viewer_admin_id,
            "target_admin_id": self.target_admin_id,
            "resource": self.resource,
            "visibility": self.visibility,
            "created_at": isoformat_api(self.created_at),
        }
