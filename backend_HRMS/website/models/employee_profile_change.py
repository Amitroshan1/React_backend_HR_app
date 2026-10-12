"""HR requests to change department, circle, designation, or employment status."""
from __future__ import annotations

from .. import db
from ..datetime_utils import utc_now


class EmployeeProfileChangeRequest(db.Model):
    __tablename__ = "employee_profile_change_requests"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    tenant_id = db.Column(db.Integer, nullable=False, index=True)
    employee_admin_id = db.Column(db.Integer, db.ForeignKey("admins.id"), nullable=True, index=True)
    request_type = db.Column(db.String(20), nullable=False, default="profile_change", index=True)
    status = db.Column(db.String(20), nullable=False, default="pending", index=True)
    changes = db.Column(db.Text, nullable=False, default="{}")
    signup_payload = db.Column(db.Text, nullable=True)
    requested_by_admin_id = db.Column(db.Integer, nullable=True)
    requested_by_name = db.Column(db.String(150), nullable=True)
    requested_by_email = db.Column(db.String(120), nullable=True)
    decided_by_admin_id = db.Column(db.Integer, nullable=True)
    decided_by_name = db.Column(db.String(150), nullable=True)
    decided_by_email = db.Column(db.String(120), nullable=True)
    decision_note = db.Column(db.String(500), nullable=True)
    created_at = db.Column(db.DateTime, nullable=False, default=utc_now, index=True)
    decided_at = db.Column(db.DateTime, nullable=True)

    employee = db.relationship(
        "Admin",
        foreign_keys=[employee_admin_id],
        backref=db.backref("profile_change_requests", lazy="dynamic"),
    )
