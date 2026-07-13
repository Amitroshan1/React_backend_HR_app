from .. import db
from flask_login import UserMixin
from datetime import datetime, date, timedelta


class Punch(db.Model, UserMixin):
    __tablename__ = "punch"

    id = db.Column(db.Integer, primary_key=True)

    admin_id = db.Column(db.Integer, db.ForeignKey('admins.id'), nullable=False)
    punch_date = db.Column(db.Date, nullable=False)

    # ✅ Store full datetime
    punch_in = db.Column(db.DateTime, nullable=True)
    punch_out = db.Column(db.DateTime, nullable=True)
    today_work = db.Column(db.String(20), nullable=True)  # "HH:MM:SS" format — sum of closed sessions

    lat = db.Column(db.Float, nullable=True)
    lon = db.Column(db.Float, nullable=True)

    # Deferred so SELECTs work even if DB table doesn't have this column yet
    location_status = db.deferred(db.Column(db.String(30), nullable=True))

    admin = db.relationship('Admin', back_populates='punch_records')
    sessions = db.relationship(
        "PunchSession",
        back_populates="punch",
        cascade="all, delete-orphan",
        order_by="PunchSession.clock_in",
    )

    def to_dict(self):
        return {c.name: getattr(self, c.name) for c in self.__table__.columns}


class PunchSession(db.Model):
    """One in→out segment per day (Punch). Second+ punch-in same day requires repeat_reason."""

    __tablename__ = "punch_sessions"

    id = db.Column(db.Integer, primary_key=True)
    punch_id = db.Column(db.Integer, db.ForeignKey("punch.id", ondelete="CASCADE"), nullable=False)
    clock_in = db.Column(db.DateTime, nullable=False)
    clock_out = db.Column(db.DateTime, nullable=True)
    repeat_reason = db.Column(db.String(500), nullable=True)
    extended_hours_reason = db.Column(db.String(500), nullable=True)
    auto_punched_out = db.Column(db.Boolean, nullable=False, default=False, server_default="0")
    is_wfh = db.Column(db.Boolean, nullable=False, default=False)
    lat = db.Column(db.Float, nullable=True)
    lon = db.Column(db.Float, nullable=True)
    # Legacy: last-written geo (mirrors in while open, out after punch-out). Prefer _in/_out.
    location_status = db.Column(db.String(30), nullable=True)
    location_status_in = db.Column(db.String(30), nullable=True)
    location_status_out = db.Column(db.String(30), nullable=True)

    punch = db.relationship("Punch", back_populates="sessions")


class Location(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    latitude = db.Column(db.Float, nullable=False)
    longitude = db.Column(db.Float, nullable=False)
    radius = db.Column(db.Float, default=100)



class CompOffGain(db.Model):
    """One row = 1 comp-off earned (e.g. by working on Sunday). Valid 30 days from gain_date."""
    __tablename__ = "comp_off_gains"

    id = db.Column(db.Integer, primary_key=True)
    admin_id = db.Column(db.Integer, db.ForeignKey("admins.id", ondelete="CASCADE"), nullable=False)
    gain_date = db.Column(db.Date, nullable=False)  # date when comp was earned (e.g. Sunday worked)
    expiry_date = db.Column(db.Date, nullable=False)  # gain_date + 30 days
    used = db.Column(db.Float, default=0.0, nullable=False)  # 0 = full comp available, 1 = fully used
    reminder_sent_at = db.Column(db.DateTime, nullable=True)  # when 7-day expiry reminder was sent
    # Unique when set (Sunday punch job). NULL for manual/restore rows so multiples are allowed.
    dedupe_key = db.Column(db.String(64), nullable=True, unique=True)
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.now)

    admin = db.relationship("Admin", back_populates="comp_off_gains")


class LeaveBalance(db.Model):
    __tablename__ = 'leave_balances'

    id = db.Column(db.Integer, primary_key=True)

    # One-to-One with Admin
    admin_id = db.Column(
        db.Integer,
        db.ForeignKey('admins.id', ondelete="CASCADE"),
        nullable=False
    )

    # Remaining balances (what's left to use)
    privilege_leave_balance = db.Column(db.Float, nullable=False)
    casual_leave_balance = db.Column(db.Float, nullable=False)
    compensatory_leave_balance = db.Column(db.Float, nullable=False)

    # Total entitlements (fixed total granted)
    total_privilege_leave = db.Column(db.Float, nullable=False, default=0.0, server_default="0")
    total_casual_leave = db.Column(db.Float, nullable=False, default=0.0, server_default="0")
    total_compensatory_leave = db.Column(db.Float, nullable=False, default=0.0, server_default="0")

    # Used amounts (how much has been used from total)
    used_privilege_leave = db.Column(db.Float, nullable=False, default=0.0, server_default="0")
    used_casual_leave = db.Column(db.Float, nullable=False, default=0.0, server_default="0")
    used_comp_leave = db.Column(db.Float, nullable=False, default=0.0, server_default="0")

    last_updated = db.Column(db.Date, nullable=True)

    # Relationship
    admin = db.relationship('Admin', back_populates='leave_balance')

    # -------------------------
    # Business logic
    # -------------------------
    def restore_leave(self, leave_type, days):
        if leave_type == 'Privilege Leave':
            self.privilege_leave_balance += days
        elif leave_type == 'Casual Leave':
            self.casual_leave_balance += days
        elif leave_type == 'Half Day Leave':
            self.casual_leave_balance += 0.5

    def to_dict(self):
        return {c.name: getattr(self, c.name) for c in self.__table__.columns}


    

class LeaveApplication(db.Model):
    __tablename__ = 'leave_applications'

    id = db.Column(db.Integer, primary_key=True)
    admin_id = db.Column(db.Integer, db.ForeignKey('admins.id'), nullable=False)
    leave_type = db.Column(db.String(50), nullable=False)
    reason = db.Column(db.String(255), nullable=False)  
    start_date = db.Column(db.Date, nullable=False)
    end_date = db.Column(db.Date, nullable=False)  
    status = db.Column(db.String(20), nullable=False, default='Pending')
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.now)
    deducted_days = db.Column(db.Float, default=0.0)
    extra_days=db.Column(db.Float, default=0.0)
    # Sandwich leave split:
    # - requested_deducted_days: paid days deducted from the requested leave_type (working days)
    # - sandwich_pl_days: paid sandwich days deducted from PL
    requested_deducted_days = db.Column(db.Float, default=0.0)
    sandwich_pl_days = db.Column(db.Float, default=0.0)
    pending_reminder_sent_at = db.Column(db.DateTime, nullable=True)
    applied_by_admin_id = db.Column(db.Integer, db.ForeignKey('admins.id'), nullable=True)
    applied_on_behalf = db.Column(db.Boolean, nullable=False, default=False)

    admin = db.relationship('Admin', foreign_keys=[admin_id], back_populates='leave_applications')
    applied_by = db.relationship('Admin', foreign_keys=[applied_by_admin_id], back_populates='leaves_applied_on_behalf')


    def to_dict(self):
        return {c.name: getattr(self, c.name) for c in self.__table__.columns}




class WorkFromHomeApplication(db.Model):
    __tablename__ = 'work_from_home_applications'

    id = db.Column(db.Integer, primary_key=True)
    admin_id = db.Column(db.Integer, db.ForeignKey('admins.id'), nullable=False)

    start_date = db.Column(db.Date, nullable=False)
    end_date = db.Column(db.Date, nullable=False)
    reason = db.Column(db.String(255), nullable=False)
    status = db.Column(db.String(20), nullable=False, default='Pending')

    created_at = db.Column(db.DateTime, nullable=False, default=datetime.now)

    admin = db.relationship('Admin', back_populates='work_from_home_applications')


class AttendanceRegularization(db.Model):
    """Employee requests HR to regularize past absence into approved leave."""
    __tablename__ = 'attendance_regularizations'

    id = db.Column(db.Integer, primary_key=True)
    admin_id = db.Column(db.Integer, db.ForeignKey('admins.id'), nullable=False)
    leave_type = db.Column(db.String(50), nullable=False)
    start_date = db.Column(db.Date, nullable=False)
    end_date = db.Column(db.Date, nullable=False)
    reason = db.Column(db.String(500), nullable=False)
    status = db.Column(db.String(20), nullable=False, default='Pending')
    hr_comment = db.Column(db.String(500), nullable=True)
    leave_application_id = db.Column(db.Integer, db.ForeignKey('leave_applications.id'), nullable=True)
    reviewed_by_admin_id = db.Column(db.Integer, db.ForeignKey('admins.id'), nullable=True)
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.now)
    reviewed_at = db.Column(db.DateTime, nullable=True)

    admin = db.relationship('Admin', foreign_keys=[admin_id], back_populates='attendance_regularizations')
    reviewed_by = db.relationship('Admin', foreign_keys=[reviewed_by_admin_id])
    leave_application = db.relationship('LeaveApplication', foreign_keys=[leave_application_id])
   