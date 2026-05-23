from datetime import datetime

from .. import db


class EmployeeCircleHistory(db.Model):
    """Tracks employee circle transfers with business effective date vs system record date."""

    __tablename__ = "employee_circle_history"

    id = db.Column(db.Integer, primary_key=True)
    admin_id = db.Column(db.Integer, db.ForeignKey("admins.id"), nullable=False, index=True)
    from_circle = db.Column(db.String(50), nullable=True)
    to_circle = db.Column(db.String(50), nullable=False)
    effective_from = db.Column(db.Date, nullable=False, index=True)
    effective_to = db.Column(db.Date, nullable=True)
    notes = db.Column(db.String(500), nullable=True)
    recorded_by = db.Column(db.String(120), nullable=True)
    recorded_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow, index=True)

    admin = db.relationship("Admin", backref=db.backref("circle_history", lazy="dynamic"))
