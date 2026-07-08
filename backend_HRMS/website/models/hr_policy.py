"""HR policy documents and employee acknowledgments."""
from __future__ import annotations

from .. import db
from ..datetime_utils import isoformat_api, utc_now


class HRPolicyDocument(db.Model):
    __tablename__ = "hr_policy_documents"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    title = db.Column(db.String(200), nullable=False)
    version = db.Column(db.String(40), nullable=False, default="1.0")
    circle = db.Column(db.String(80), nullable=True, index=True)
    emp_type = db.Column(db.String(80), nullable=True, index=True)
    content_html = db.Column(db.Text, nullable=True)
    file_path = db.Column(db.String(500), nullable=True)
    effective_from = db.Column(db.Date, nullable=True)
    requires_acknowledgment = db.Column(db.Boolean, nullable=False, default=True, server_default="1")
    is_active = db.Column(db.Boolean, nullable=False, default=True, server_default="1")
    created_by = db.Column(db.String(120), nullable=True)
    created_at = db.Column(db.DateTime, nullable=False, default=utc_now)

    acknowledgments = db.relationship(
        "PolicyAcknowledgment",
        backref="policy",
        lazy=True,
        cascade="all, delete-orphan",
    )

    def to_dict(self, *, ack_count: int = 0, pending_count: int = 0):
        return {
            "id": self.id,
            "title": self.title,
            "version": self.version,
            "circle": self.circle,
            "emp_type": self.emp_type,
            "content_html": self.content_html,
            "file_path": self.file_path,
            "effective_from": self.effective_from.isoformat() if self.effective_from else None,
            "requires_acknowledgment": bool(self.requires_acknowledgment),
            "is_active": bool(self.is_active),
            "created_by": self.created_by,
            "created_at": isoformat_api(self.created_at),
            "ack_count": ack_count,
            "pending_count": pending_count,
        }


class PolicyAcknowledgment(db.Model):
    __tablename__ = "policy_acknowledgments"
    __table_args__ = (
        db.UniqueConstraint("policy_id", "admin_id", name="uq_policy_ack_policy_admin"),
    )

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    policy_id = db.Column(
        db.Integer,
        db.ForeignKey("hr_policy_documents.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    admin_id = db.Column(
        db.Integer,
        db.ForeignKey("admins.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    acknowledged_at = db.Column(db.DateTime, nullable=False, default=utc_now)

    employee = db.relationship("Admin", backref="policy_acknowledgments")

    def to_dict(self):
        return {
            "id": self.id,
            "policy_id": self.policy_id,
            "admin_id": self.admin_id,
            "acknowledged_at": isoformat_api(self.acknowledged_at),
        }
