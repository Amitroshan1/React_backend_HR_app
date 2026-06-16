"""Probation review: 6-month reminder to manager, manager feedback, HR decision."""
from ..datetime_utils import utc_now
from .. import db


class ProbationReview(db.Model):
    __tablename__ = "probation_reviews"
    __table_args__ = (
        db.UniqueConstraint(
            "admin_id",
            "probation_end_date",
            name="uq_probation_reviews_admin_probation_end",
        ),
    )

    id = db.Column(db.Integer, primary_key=True)
    admin_id = db.Column(
        db.Integer,
        db.ForeignKey("admins.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    probation_end_date = db.Column(db.Date, nullable=False, index=True)
    status = db.Column(db.String(30), nullable=True, index=True)
    reminder_sent_at = db.Column(db.DateTime, nullable=True)
    followup_reminder_sent_at = db.Column(db.DateTime, nullable=True)
    overdue_escalation_sent_at = db.Column(db.DateTime, nullable=True)
    reviewed_at = db.Column(db.DateTime, nullable=True)
    reviewed_by_admin_id = db.Column(
        db.Integer,
        db.ForeignKey("admins.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    feedback = db.Column(db.Text, nullable=True)
    rating = db.Column(db.String(20), nullable=True)
    manager_recommendation = db.Column(db.String(30), nullable=True)
    hr_notified_at = db.Column(db.DateTime, nullable=True)
    hr_decision = db.Column(db.String(20), nullable=True)
    hr_decided_at = db.Column(db.DateTime, nullable=True)
    hr_decided_by_admin_id = db.Column(
        db.Integer,
        db.ForeignKey("admins.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    extended_until = db.Column(db.Date, nullable=True)
    hr_notes = db.Column(db.Text, nullable=True)
    created_at = db.Column(db.DateTime, nullable=False, default=utc_now)
    updated_at = db.Column(db.DateTime, nullable=False, default=utc_now, onupdate=utc_now)

    admin = db.relationship("Admin", foreign_keys=[admin_id], backref="probation_reviews")
    reviewed_by = db.relationship("Admin", foreign_keys=[reviewed_by_admin_id])
    hr_decided_by = db.relationship("Admin", foreign_keys=[hr_decided_by_admin_id])
