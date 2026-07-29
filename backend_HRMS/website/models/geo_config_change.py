"""Versioned geo-fence configuration overrides (Admin tuning without code deploys)."""
from datetime import datetime

from .. import db


class GeoConfigOverride(db.Model):
    """Current effective override for one geo config key (applied into Flask app.config)."""

    __tablename__ = "geo_config_overrides"

    id = db.Column(db.Integer, primary_key=True)
    config_key = db.Column(db.String(80), nullable=False, unique=True, index=True)
    config_value = db.Column(db.Text, nullable=False)  # JSON-encoded scalar
    updated_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    updated_by_admin_id = db.Column(
        db.Integer, db.ForeignKey("admins.id", ondelete="SET NULL"), nullable=True
    )


class GeoConfigChange(db.Model):
    """Immutable audit trail for every config edit."""

    __tablename__ = "geo_config_changes"

    id = db.Column(db.Integer, primary_key=True)
    version = db.Column(db.Integer, nullable=False, index=True)
    config_key = db.Column(db.String(80), nullable=False, index=True)
    old_value = db.Column(db.Text, nullable=True)
    new_value = db.Column(db.Text, nullable=False)
    reason = db.Column(db.String(500), nullable=False)
    changed_by_admin_id = db.Column(
        db.Integer, db.ForeignKey("admins.id", ondelete="SET NULL"), nullable=True, index=True
    )
    changed_by_email = db.Column(db.String(120), nullable=True)
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow, index=True)

    def to_dict(self):
        return {
            "id": self.id,
            "version": self.version,
            "config_key": self.config_key,
            "old_value": self.old_value,
            "new_value": self.new_value,
            "reason": self.reason,
            "changed_by_admin_id": self.changed_by_admin_id,
            "changed_by_email": self.changed_by_email,
            "created_at": self.created_at.isoformat() + "Z" if self.created_at else None,
        }
