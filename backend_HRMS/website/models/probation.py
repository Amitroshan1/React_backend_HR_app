"""Probation review: 6-month reminder to manager, manager feedback, HR notification."""
from datetime import datetime
from .. import db


class ProbationReview(db.Model):
    __tablename__ = "probation_reviews"

    id = db.Column(db.Integer, primary_key=True)
    admin_id = db.Column(
        db.Integer,
        db.ForeignKey("admins.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    probation_end_date = db.Column(db.Date, nullable=False, index=True)
    reminder_sent_at = db.Column(db.DateTime, nullable=True)
    reviewed_at = db.Column(db.DateTime, nullable=True)
    reviewed_by_admin_id = db.Column(
        db.Integer,
        db.ForeignKey("admins.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    feedback = db.Column(db.Text, nullable=True)
    rating = db.Column(db.String(20), nullable=True)
    hr_notified_at = db.Column(db.DateTime, nullable=True)
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    admin = db.relationship("Admin", foreign_keys=[admin_id], backref="probation_reviews")
    reviewed_by = db.relationship("Admin", foreign_keys=[reviewed_by_admin_id])
