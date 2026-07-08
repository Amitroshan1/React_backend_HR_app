"""Post-probation and increment salary revision queue for Accounts."""
from __future__ import annotations

from .. import db
from ..datetime_utils import isoformat_api, utc_now


class SalaryRevisionRequest(db.Model):
    __tablename__ = "salary_revision_requests"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    admin_id = db.Column(
        db.Integer,
        db.ForeignKey("admins.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    probation_review_id = db.Column(
        db.Integer,
        db.ForeignKey("probation_reviews.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    increment_cycle_id = db.Column(
        db.Integer,
        db.ForeignKey("increment_cycles.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    revision_type = db.Column(db.String(20), nullable=False, default="probation", index=True)
    status = db.Column(db.String(20), nullable=False, default="pending", index=True)
    proposed_annual_ctc = db.Column(db.Float, nullable=True)
    effective_from = db.Column(db.Date, nullable=True)
    notes = db.Column(db.Text, nullable=True)
    manager_notes = db.Column(db.Text, nullable=True)
    manager_proposed_at = db.Column(db.DateTime, nullable=True)
    manager_proposed_by_admin_id = db.Column(db.Integer, nullable=True)
    hr_approved_at = db.Column(db.DateTime, nullable=True)
    hr_approved_by_admin_id = db.Column(db.Integer, nullable=True)
    created_at = db.Column(db.DateTime, nullable=False, default=utc_now)
    completed_at = db.Column(db.DateTime, nullable=True)
    completed_by_admin_id = db.Column(db.Integer, nullable=True)

    admin = db.relationship("Admin", backref="salary_revision_requests")

    def to_dict(self):
        admin = self.admin
        return {
            "id": self.id,
            "admin_id": self.admin_id,
            "probation_review_id": self.probation_review_id,
            "increment_cycle_id": self.increment_cycle_id,
            "revision_type": self.revision_type or "probation",
            "status": self.status,
            "proposed_annual_ctc": float(self.proposed_annual_ctc) if self.proposed_annual_ctc is not None else None,
            "effective_from": self.effective_from.isoformat() if self.effective_from else None,
            "notes": self.notes,
            "manager_notes": self.manager_notes,
            "manager_proposed_at": isoformat_api(self.manager_proposed_at),
            "manager_proposed_by_admin_id": self.manager_proposed_by_admin_id,
            "hr_approved_at": isoformat_api(self.hr_approved_at),
            "hr_approved_by_admin_id": self.hr_approved_by_admin_id,
            "created_at": isoformat_api(self.created_at),
            "completed_at": isoformat_api(self.completed_at),
            "completed_by_admin_id": self.completed_by_admin_id,
            "employee_name": (admin.first_name if admin else None) or None,
            "emp_id": admin.emp_id if admin else None,
            "email": admin.email if admin else None,
            "circle": admin.circle if admin else None,
            "emp_type": admin.emp_type if admin else None,
        }
