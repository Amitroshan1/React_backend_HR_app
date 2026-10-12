from datetime import datetime
from ..datetime_utils import utc_now

from .. import db


def _default_tenant_id():
    from ..tenant_context import get_current_tenant_id

    return get_current_tenant_id()


class HolidayCalendar(db.Model):
    __tablename__ = "holiday_calendar"

    id = db.Column(db.Integer, primary_key=True)
    tenant_id = db.Column(db.Integer, nullable=True, default=_default_tenant_id, index=True)
    year = db.Column(db.Integer, nullable=False, index=True)
    holiday_name = db.Column(db.String(120), nullable=False)
    holiday_date = db.Column(db.Date, nullable=False, index=True)
    is_optional = db.Column(db.Boolean, nullable=False, default=False)
    is_active = db.Column(db.Boolean, nullable=False, default=True)
    created_at = db.Column(db.DateTime, nullable=False, default=utc_now)
    updated_at = db.Column(
        db.DateTime,
        nullable=False,
        default=utc_now,
        onupdate=utc_now,
    )

    __table_args__ = (
        db.UniqueConstraint("tenant_id", "year", "holiday_name", name="uq_holiday_calendar_tenant_year_name"),
    )
