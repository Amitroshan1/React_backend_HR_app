"""HR -> IT request to assign assets to a newly approved employee."""
from __future__ import annotations

from .. import db
from ..datetime_utils import utc_now


class AssetAssignmentRequest(db.Model):
    __tablename__ = "asset_assignment_requests"
    __table_args__ = (db.Index("ix_asset_assign_tenant_created", "tenant_id", "created_at"),)

    id = db.Column(db.Integer, primary_key=True)
    tenant_id = db.Column(db.Integer, nullable=False, index=True)
    signup_request_id = db.Column(db.Integer, nullable=True, unique=True, index=True)
    employee_admin_id = db.Column(db.Integer, db.ForeignKey("admins.id"), nullable=True, index=True)

    employee_name = db.Column(db.String(150), nullable=False)
    employee_email = db.Column(db.String(160), nullable=True)
    emp_id = db.Column(db.String(20), nullable=True)
    designation = db.Column(db.String(150), nullable=True)
    department = db.Column(db.String(150), nullable=True)
    circle = db.Column(db.String(120), nullable=True)
    doj = db.Column(db.String(20), nullable=True)

    requested_by_admin_id = db.Column(db.Integer, db.ForeignKey("admins.id"), nullable=True)
    requested_by_name = db.Column(db.String(150), nullable=True)
    requested_by_email = db.Column(db.String(160), nullable=True)
    details = db.Column(db.Text, nullable=True)

    status = db.Column(db.String(20), nullable=False, default="Pending", index=True)
    assigned_assets = db.Column(db.Text, nullable=True)
    it_remarks = db.Column(db.Text, nullable=True)
    responded_by_admin_id = db.Column(db.Integer, db.ForeignKey("admins.id"), nullable=True)
    responded_by_name = db.Column(db.String(150), nullable=True)
    responded_by_email = db.Column(db.String(160), nullable=True)
    responded_at = db.Column(db.DateTime, nullable=True)
    created_at = db.Column(db.DateTime, nullable=False, default=utc_now)
