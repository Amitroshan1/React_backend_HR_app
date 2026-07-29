"""Shadow-mode comparison records (Legacy vs V2) — validation only, never affects punch."""
from datetime import datetime

from .. import db


class GeoEngineComparison(db.Model):
    __tablename__ = "geo_engine_comparisons"

    id = db.Column(db.Integer, primary_key=True)
    attempt_id = db.Column(db.String(64), nullable=False, index=True)
    admin_id = db.Column(
        db.Integer, db.ForeignKey("admins.id", ondelete="SET NULL"), nullable=True, index=True
    )
    office_id = db.Column(db.Integer, nullable=True, index=True)
    office_name = db.Column(db.String(120), nullable=True)

    legacy_zone = db.Column(db.String(30), nullable=True)
    legacy_requires_reason = db.Column(db.Boolean, nullable=True)
    legacy_distance_m = db.Column(db.Float, nullable=True)
    legacy_decision = db.Column(db.String(30), nullable=True)
    legacy_policy = db.Column(db.String(30), nullable=True)

    v2_decision = db.Column(db.String(30), nullable=True)
    v2_policy = db.Column(db.String(30), nullable=True)
    v2_confidence = db.Column(db.Float, nullable=True)
    v2_distance_m = db.Column(db.Float, nullable=True)

    decision_match = db.Column(db.Boolean, nullable=False, default=False, server_default="0")
    reason_match = db.Column(db.Boolean, nullable=False, default=False, server_default="0")
    policy_match = db.Column(db.Boolean, nullable=False, default=False, server_default="0")
    difference_category = db.Column(db.String(80), nullable=True, index=True)

    execution_time_legacy_ms = db.Column(db.Float, nullable=True)
    execution_time_v2_ms = db.Column(db.Float, nullable=True)

    accuracy_m = db.Column(db.Float, nullable=True)
    browser = db.Column(db.String(80), nullable=True)
    device_type = db.Column(db.String(20), nullable=True)
    direction = db.Column(db.String(10), nullable=True)

    comparison_status = db.Column(db.String(30), nullable=False, default="ok")  # ok|v2_failed|store_failed
    error_note = db.Column(db.String(200), nullable=True)

    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow, index=True)

    def to_dict(self):
        return {c.name: getattr(self, c.name) for c in self.__table__.columns}
