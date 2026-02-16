from datetime import datetime

from .. import db


class HolidayCalendar(db.Model):
    __tablename__ = "holiday_calendar"

    id = db.Column(db.Integer, primary_key=True)
    year = db.Column(db.Integer, nullable=False, index=True)
    holiday_name = db.Column(db.String(120), nullable=False)
    holiday_date = db.Column(db.Date, nullable=False, index=True)
    is_optional = db.Column(db.Boolean, nullable=False, default=False)
    is_active = db.Column(db.Boolean, nullable=False, default=True)
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    updated_at = db.Column(
        db.DateTime,
        nullable=False,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
    )

    __table_args__ = (
        db.UniqueConstraint("year", "holiday_name", name="uq_holiday_calendar_year_name"),
    )
