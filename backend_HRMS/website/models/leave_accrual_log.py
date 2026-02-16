from datetime import datetime
from .. import db


class LeaveAccrualLog(db.Model):
    __tablename__ = "leave_accrual_log"

    id = db.Column(db.Integer, primary_key=True)
    admin_id = db.Column(
        db.Integer,
        db.ForeignKey("admins.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    event_key = db.Column(db.String(100), nullable=False)
    run_date = db.Column(db.Date, nullable=False, index=True)
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)

    __table_args__ = (
        db.UniqueConstraint("admin_id", "event_key", name="uq_leave_accrual_admin_event"),
    )
