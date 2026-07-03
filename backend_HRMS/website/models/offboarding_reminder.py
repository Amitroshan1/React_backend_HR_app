"""Dedup log for offboarding reminder emails (LWD, NOC SLA)."""
from .. import db
from ..datetime_utils import utc_now


class OffboardingReminderLog(db.Model):
    __tablename__ = "offboarding_reminder_logs"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    reminder_key = db.Column(db.String(128), unique=True, nullable=False, index=True)
    sent_at = db.Column(db.DateTime, nullable=False, default=utc_now)
