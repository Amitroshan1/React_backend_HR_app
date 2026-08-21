"""Biometric device / mapping / raw log models (additive; do not alter Punch)."""

from datetime import datetime

from .. import db


class BiometricDevice(db.Model):
    """Registered eSSL / ADMS device. Unregistered serials are rejected."""

    __tablename__ = "biometric_devices"

    id = db.Column(db.Integer, primary_key=True)
    serial_number = db.Column(db.String(64), unique=True, nullable=False, index=True)
    name = db.Column(db.String(120), nullable=True)
    # Comma-separated IPs or CIDR-like strings; empty/null = no IP restriction
    allowed_ips = db.Column(db.String(500), nullable=True)
    is_active = db.Column(db.Boolean, nullable=False, default=True, server_default="1")
    timezone = db.Column(db.String(64), nullable=False, default="Asia/Kolkata", server_default="Asia/Kolkata")
    last_seen_at = db.Column(db.DateTime, nullable=True)
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    updated_at = db.Column(
        db.DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow
    )


class BiometricEmployeeMap(db.Model):
    """
    Consistency record for eSSL User ID == Admin.emp_id (not an override).

    Valid mapping invariant:
      device_user_id == emp_id == Admin.emp_id
      admin_id == Admin.id
    PunchSession uses Admin.id (never emp_id as attendance FK).
    device_user_id is an exact string (preserve leading zeros).
    """

    __tablename__ = "biometric_employee_map"

    id = db.Column(db.Integer, primary_key=True)
    device_user_id = db.Column(db.String(64), nullable=False, index=True)
    # Authoritative attendance owner (Admin.id)
    admin_id = db.Column(db.Integer, db.ForeignKey("admins.id", ondelete="CASCADE"), nullable=False)
    # HR/business identifier; must match Admin.emp_id for admin_id
    emp_id = db.Column(db.String(10), nullable=True, index=True)
    device_id = db.Column(
        db.Integer, db.ForeignKey("biometric_devices.id", ondelete="SET NULL"), nullable=True
    )
    is_active = db.Column(db.Boolean, nullable=False, default=True, server_default="1")
    notes = db.Column(db.String(255), nullable=True)
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    updated_at = db.Column(
        db.DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow
    )

    __table_args__ = (
        db.UniqueConstraint("device_user_id", "device_id", name="uq_bio_map_user_device"),
    )


class BiometricLog(db.Model):
    """Immutable-ish raw ADMS event store (written before attendance processing)."""

    __tablename__ = "biometric_logs"

    id = db.Column(db.Integer, primary_key=True)
    device_serial_number = db.Column(db.String(64), nullable=False, index=True)
    device_user_id = db.Column(db.String(64), nullable=True, index=True)
    punch_time = db.Column(db.DateTime, nullable=True, index=True)
    verification_mode = db.Column(db.String(64), nullable=True)
    raw_payload = db.Column(db.Text, nullable=True)
    status = db.Column(db.String(64), nullable=False, default="received", index=True)
    # received | processed | ignored | ignored_open_web_session | duplicate | failed
    # | unknown_employee | unknown_device | invalid_mapping | ambiguous_employee_mapping
    # | employee_inactive
    error_message = db.Column(db.String(500), nullable=True)
    idempotency_key = db.Column(db.String(128), unique=True, nullable=False, index=True)
    punch_session_id = db.Column(db.Integer, nullable=True)
    admin_id = db.Column(db.Integer, nullable=True, index=True)
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow, index=True)


class BiometricDayState(db.Model):
    """
    Tracks first/last biometric scan for an admin on a calendar day (Asia/Kolkata).

    Does not replace PunchSession. Used so subsequent scans update last_scan_at
    without creating extra sessions; day finalization sets OUT = last_scan_at.
    """

    __tablename__ = "biometric_day_state"

    id = db.Column(db.Integer, primary_key=True)
    admin_id = db.Column(db.Integer, db.ForeignKey("admins.id", ondelete="CASCADE"), nullable=False)
    punch_date = db.Column(db.Date, nullable=False, index=True)
    punch_session_id = db.Column(db.Integer, nullable=True)
    first_scan_at = db.Column(db.DateTime, nullable=False)
    last_scan_at = db.Column(db.DateTime, nullable=False)
    status = db.Column(db.String(32), nullable=False, default="open")
    # open | finalized | auto_closed
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    updated_at = db.Column(
        db.DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow
    )

    __table_args__ = (
        db.UniqueConstraint("admin_id", "punch_date", name="uq_bio_day_admin_date"),
    )


class BiometricAttendanceDay(db.Model):
    """
    HR reporting read model: one row per device PIN + calendar day.

    Incrementally upserted from biometric_logs. Not Punch/PunchSession.
    total_scans stores every valid punch_time (JSON array of 'YYYY-MM-DD HH:MM:SS').
    """

    __tablename__ = "biometric_attendance_day"

    id = db.Column(db.Integer, primary_key=True)
    admin_id = db.Column(db.Integer, nullable=True, index=True)
    device_user_id = db.Column(db.String(64), nullable=False, index=True)
    attendance_date = db.Column(db.Date, nullable=False, index=True)
    first_scan = db.Column(db.DateTime, nullable=True)
    last_scan = db.Column(db.DateTime, nullable=True)
    total_scans = db.Column(db.JSON, nullable=False, default=lambda: [])
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    updated_at = db.Column(
        db.DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow
    )

    __table_args__ = (
        db.UniqueConstraint(
            "device_user_id", "attendance_date", name="uq_bio_att_day_pin_date"
        ),
        db.Index("ix_bio_att_day_admin_date", "admin_id", "attendance_date"),
        db.Index("ix_bio_att_day_date", "attendance_date"),
    )
