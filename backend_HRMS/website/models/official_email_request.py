"""HR -> IT request to generate an official email for a new joinee."""
from __future__ import annotations

from .. import db
from ..datetime_utils import utc_now


class OfficialEmailRequest(db.Model):
    __tablename__ = "official_email_requests"
    __table_args__ = (db.Index("ix_official_email_tenant_created", "tenant_id", "created_at"),)

    id = db.Column(db.Integer, primary_key=True)
    tenant_id = db.Column(db.Integer, nullable=False, index=True)
    requested_by_admin_id = db.Column(db.Integer, db.ForeignKey("admins.id"), nullable=True, index=True)
    requested_by_name = db.Column(db.String(150), nullable=True)
    requested_by_email = db.Column(db.String(160), nullable=True)

    candidate_name = db.Column(db.String(150), nullable=False)
    designation = db.Column(db.String(150), nullable=True)
    department = db.Column(db.String(150), nullable=True)
    circle = db.Column(db.String(120), nullable=True)
    preferred_prefix = db.Column(db.String(120), nullable=True)
    details = db.Column(db.Text, nullable=False)

    status = db.Column(db.String(20), nullable=False, default="Pending", index=True)
    generated_email = db.Column(db.String(160), nullable=True)
    it_remarks = db.Column(db.Text, nullable=True)
    responded_by_admin_id = db.Column(db.Integer, db.ForeignKey("admins.id"), nullable=True)
    responded_by_name = db.Column(db.String(150), nullable=True)
    responded_by_email = db.Column(db.String(160), nullable=True)
    responded_at = db.Column(db.DateTime, nullable=True)
    created_at = db.Column(db.DateTime, nullable=False, default=utc_now)
