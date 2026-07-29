"""Geo-fencing V2 punch-attempt audit / analytics telemetry."""
from datetime import datetime

from .. import db


class GeoPunchAttempt(db.Model):
    """
    One row per punch location acquisition / decision (success or fail).
    Used for Geo Analytics and threshold tuning — additive; does not replace PunchSession.
    """

    __tablename__ = "geo_punch_attempts"

    id = db.Column(db.Integer, primary_key=True)
    attempt_id = db.Column(db.String(64), nullable=False, unique=True, index=True)
    admin_id = db.Column(
        db.Integer, db.ForeignKey("admins.id", ondelete="SET NULL"), nullable=True, index=True
    )
    punch_session_id = db.Column(
        db.Integer, db.ForeignKey("punch_sessions.id", ondelete="SET NULL"), nullable=True, index=True
    )

    direction = db.Column(db.String(10), nullable=False)  # in | out

    latitude = db.Column(db.Float, nullable=True)
    longitude = db.Column(db.Float, nullable=True)
    accuracy_m = db.Column(db.Float, nullable=True)
    distance_m = db.Column(db.Float, nullable=True)

    office_id = db.Column(db.Integer, db.ForeignKey("location.id", ondelete="SET NULL"), nullable=True)
    office_name = db.Column(db.String(120), nullable=True)
    radius_m = db.Column(db.Float, nullable=True)
    grace_m = db.Column(db.Float, nullable=True)

    confidence_score = db.Column(db.Float, nullable=True)
    geo_decision = db.Column(db.String(30), nullable=True)  # INSIDE|UNCERTAIN|OUTSIDE|LOW_SIGNAL|NO_GPS|...
    spatial_class = db.Column(db.String(20), nullable=True)  # CONTAINED|INTERSECTS|DISJOINT
    policy_action = db.Column(db.String(30), nullable=True)  # ALLOW|ALLOW_FLAGGED|REQUIRE_REASON|DENY

    network_match = db.Column(db.Boolean, nullable=False, default=False, server_default="0")
    device_type = db.Column(db.String(20), nullable=True)  # mobile|desktop
    browser = db.Column(db.String(80), nullable=True)
    operating_system = db.Column(db.String(80), nullable=True)
    user_agent = db.Column(db.String(512), nullable=True)

    sample_count = db.Column(db.Integer, nullable=True)
    spread_m = db.Column(db.Float, nullable=True)
    retry_count = db.Column(db.Integer, nullable=True)
    acquisition_ms = db.Column(db.Integer, nullable=True)

    client_ip = db.Column(db.String(64), nullable=True)
    flag_reason = db.Column(db.String(80), nullable=True)
    error_code = db.Column(db.String(60), nullable=True)

    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow, index=True)

    def to_dict(self):
        return {c.name: getattr(self, c.name) for c in self.__table__.columns}
