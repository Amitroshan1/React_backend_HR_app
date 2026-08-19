"""Lightweight outbox for cross-worker SSE delivery (no Redis required)."""

from datetime import datetime

from .. import db


class AttendanceRealtimeEvent(db.Model):
    """Append-only attendance notification outbox (not an attendance source of truth)."""

    __tablename__ = "attendance_realtime_events"

    id = db.Column(db.Integer, primary_key=True)
    # Admin.id of the employee whose attendance changed
    employee_admin_id = db.Column(db.Integer, nullable=False, index=True)
    attendance_date = db.Column(db.Date, nullable=True, index=True)
    punch_session_id = db.Column(db.Integer, nullable=True)
    source = db.Column(db.String(20), nullable=True)  # biometric | web | hr | system
    event_name = db.Column(db.String(64), nullable=False, default="attendance.updated")
    event_time = db.Column(db.DateTime, nullable=False, default=datetime.utcnow, index=True)
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow, index=True)
