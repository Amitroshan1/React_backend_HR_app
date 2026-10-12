"""
Per-tenant master data: departments / circles (``MasterData``), the holiday calendar
and HR policies. ``tenant_id=None`` means the caller's JWT tenant (default tenant
outside a request); attendance/leave maths for one employee must pass that
employee's tenant.
"""
from __future__ import annotations

from typing import Optional

from .tenant_context import DEFAULT_TENANT_ID, tenant_column_clause, tenant_id_for_admin


def master_query(tenant_id: Optional[int] = None):
    from .models.master_data import MasterData

    return MasterData.query.filter(tenant_column_clause(MasterData.tenant_id, tenant_id))


def holiday_query(tenant_id: Optional[int] = None):
    from .models.holiday_calendar import HolidayCalendar

    return HolidayCalendar.query.filter(tenant_column_clause(HolidayCalendar.tenant_id, tenant_id))


def policy_query(tenant_id: Optional[int] = None):
    from .models.hr_policy import HRPolicyDocument

    return HRPolicyDocument.query.filter(tenant_column_clause(HRPolicyDocument.tenant_id, tenant_id))


def location_query(tenant_id: Optional[int] = None):
    """Office locations (punch geofence) of one company."""
    from .models.attendance import Location

    return Location.query.filter(tenant_column_clause(Location.tenant_id, tenant_id))


def tenant_for_admin_id(admin_id) -> int:
    """Tenant of an employee by id (default tenant when unknown)."""
    try:
        from . import db
        from .models.Admin_models import Admin

        return tenant_id_for_admin(db.session.get(Admin, int(admin_id)))
    except (TypeError, ValueError):
        return DEFAULT_TENANT_ID
