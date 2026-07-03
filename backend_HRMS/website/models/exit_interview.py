"""Exit interview responses from separating / exited employees."""
from __future__ import annotations

from .. import db
from ..datetime_utils import isoformat_api, utc_now


class ExitInterview(db.Model):
    __tablename__ = "exit_interviews"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    admin_id = db.Column(
        db.Integer,
        db.ForeignKey("admins.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
        index=True,
    )
    overall_rating = db.Column(db.Integer, nullable=True)
    would_recommend = db.Column(db.Boolean, nullable=True)
    reason_for_leaving = db.Column(db.Text, nullable=True)
    feedback = db.Column(db.Text, nullable=True)
    submitted_at = db.Column(db.DateTime, nullable=True)
    hr_interview_completed = db.Column(db.Boolean, nullable=False, default=False, server_default="0")
    hr_interview_date = db.Column(db.Date, nullable=True)
    hr_notes = db.Column(db.Text, nullable=True)
    hr_completed_by = db.Column(db.String(120), nullable=True)
    created_at = db.Column(db.DateTime, nullable=False, default=utc_now)
    updated_at = db.Column(db.DateTime, nullable=True, onupdate=utc_now)

    admin = db.relationship("Admin", backref=db.backref("exit_interview", uselist=False))

    def to_dict(self):
        return {
            "id": self.id,
            "admin_id": self.admin_id,
            "overall_rating": self.overall_rating,
            "would_recommend": self.would_recommend,
            "reason_for_leaving": self.reason_for_leaving,
            "feedback": self.feedback,
            "submitted_at": isoformat_api(self.submitted_at),
            "hr_interview_completed": bool(self.hr_interview_completed),
            "hr_interview_date": self.hr_interview_date.isoformat() if self.hr_interview_date else None,
            "hr_notes": self.hr_notes,
            "hr_completed_by": self.hr_completed_by,
        }
