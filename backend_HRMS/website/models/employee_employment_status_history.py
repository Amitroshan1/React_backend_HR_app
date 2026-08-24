from ..datetime_utils import utc_now
from .. import db


class EmployeeEmploymentStatusHistory(db.Model):
    """Audit trail for employment status and probation-term changes."""

    __tablename__ = "employee_employment_status_history"

    id = db.Column(db.Integer, primary_key=True)
    admin_id = db.Column(
        db.Integer,
        db.ForeignKey("admins.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    from_status = db.Column(db.String(20), nullable=True)
    to_status = db.Column(db.String(20), nullable=False, index=True)
    effective_from = db.Column(db.Date, nullable=False, index=True)
    probation_start_date = db.Column(db.Date, nullable=True)
    probation_end_date = db.Column(db.Date, nullable=True)
    probation_duration_months = db.Column(db.Integer, nullable=True)
    changed_by = db.Column(db.String(120), nullable=True)
    notes = db.Column(db.String(500), nullable=True)
    created_at = db.Column(db.DateTime, nullable=False, default=utc_now, index=True)

    admin = db.relationship(
        "Admin",
        backref=db.backref("employment_status_history", lazy="dynamic"),
    )
