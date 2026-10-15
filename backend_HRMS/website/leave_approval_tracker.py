"""Leave and work-from-home that L1 has approved: still waiting on L2, or fully approved."""
from __future__ import annotations

import calendar
from datetime import date

from sqlalchemy.orm import contains_eager

from . import db
from .datetime_utils import isoformat_api
from .leave_two_step import STATUS_APPROVED, STATUS_L1
from .manager_utils import resolve_manager_contact_for_employee
from .models.Admin_models import Admin
from .models.attendance import LeaveApplication, WorkFromHomeApplication
from .tenant_context import admin_tenant_clause

STAGE_STATUSES = {
    "all": (STATUS_L1, STATUS_APPROVED),
    "l2_pending": (STATUS_L1,),
    "approved": (STATUS_APPROVED,),
}
ROW_LIMIT = 1000


def month_bounds(value: str | None):
    """'YYYY-MM' -> (first day, last day). Empty -> None. Bad input raises ValueError."""
    text = (value or "").strip()
    if not text:
        return None
    try:
        year, month = (int(part) for part in text.split("-", 1))
        last = calendar.monthrange(year, month)[1]
        return date(year, month, 1), date(year, month, last)
    except (TypeError, ValueError) as exc:
        raise ValueError("month must look like YYYY-MM") from exc


class _Lookup:
    """Caches manager contacts and approver names for one request."""

    def __init__(self):
        self._contacts = {}
        self._names = {}

    def contact(self, employee):
        if employee is None:
            return None
        if employee.id not in self._contacts:
            self._contacts[employee.id] = resolve_manager_contact_for_employee(employee)
        return self._contacts[employee.id]

    def name(self, admin_id):
        if not admin_id:
            return None
        if admin_id not in self._names:
            person = db.session.get(Admin, admin_id)
            self._names[admin_id] = (
                (getattr(person, "first_name", None) or getattr(person, "email", None)) if person else None
            )
        return self._names[admin_id]


def approval_levels(row, contact, names: _Lookup) -> tuple[dict, dict, str]:
    """Return (l1, l2, stage) for a row that L1 has already approved."""
    l1_id = getattr(contact, "l1_admin_id", None) if contact else None
    l2_id = getattr(contact, "l2_admin_id", None) if contact else None
    distinct_l2 = bool(l2_id and l2_id != l1_id)
    l1 = {"name": names.name(l1_id), "status": "Approved"}
    l2 = {"name": names.name(l2_id) if distinct_l2 else None, "status": "Approved"}

    if row.status == STATUS_L1:
        l2["status"] = "Pending"
        return l1, l2, "l2_pending"

    if getattr(row, "applied_on_behalf", False):
        l1["status"] = "Applied by HR"
        l2["status"] = "Applied by HR"
    elif not distinct_l2:
        l2["status"] = "Not required"
    return l1, l2, "approved"


def _base_query(model, statuses, bounds, emp_type, circle):
    query = model.query.join(Admin, model.admin_id == Admin.id).options(contains_eager(model.admin)).filter(
        admin_tenant_clause(),
        model.status.in_(statuses),
    )
    if bounds:
        start, end = bounds
        query = query.filter(model.start_date <= end, model.end_date >= start)
    if emp_type:
        query = query.filter(Admin.emp_type == emp_type)
    if circle:
        query = query.filter(Admin.circle == circle)
    return query.order_by(model.start_date.desc(), model.id.desc()).limit(ROW_LIMIT)


def _serialize(row, kind, names: _Lookup) -> dict:
    employee = row.admin
    l1, l2, stage = approval_levels(row, names.contact(employee), names)
    days = (row.end_date - row.start_date).days + 1 if row.start_date and row.end_date else None
    paid = getattr(row, "deducted_days", None)
    lwp = getattr(row, "extra_days", None)
    return {
        "id": row.id,
        "row_key": f"{kind}-{row.id}",
        "request_type": kind,
        "employee_name": getattr(employee, "first_name", None),
        "emp_id": getattr(employee, "emp_id", None),
        "emp_type": getattr(employee, "emp_type", None),
        "circle": getattr(employee, "circle", None),
        "leave_type": row.leave_type if kind == "leave" else "Work From Home",
        "reason": row.reason,
        "start_date": row.start_date.isoformat() if row.start_date else None,
        "end_date": row.end_date.isoformat() if row.end_date else None,
        "days": days,
        "paid_days": float(paid) if paid is not None and kind == "leave" else None,
        "lwp_days": float(lwp) if lwp is not None and kind == "leave" else None,
        "status": row.status,
        "stage": stage,
        "l1": l1,
        "l2": l2,
        "applied_at": isoformat_api(row.created_at),
        "final_approved_at": isoformat_api(getattr(row, "final_approved_at", None)),
    }


def tracker_rows(*, month=None, emp_type="", circle="", request_type="all", stage="all") -> dict:
    statuses = STAGE_STATUSES.get(stage)
    if statuses is None:
        raise ValueError("stage must be all, l2_pending, or approved")
    if request_type not in ("all", "leave", "wfh"):
        raise ValueError("request_type must be all, leave, or wfh")
    bounds = month_bounds(month)
    names = _Lookup()
    rows = []
    if request_type in ("all", "leave"):
        rows.extend(
            _serialize(row, "leave", names)
            for row in _base_query(LeaveApplication, statuses, bounds, emp_type, circle).all()
        )
    if request_type in ("all", "wfh"):
        rows.extend(
            _serialize(row, "wfh", names)
            for row in _base_query(WorkFromHomeApplication, statuses, bounds, emp_type, circle).all()
        )
    rows.sort(key=lambda item: (item["start_date"] or "", item["id"]), reverse=True)
    summary = {
        "total": len(rows),
        "l2_pending": sum(1 for item in rows if item["stage"] == "l2_pending"),
        "approved": sum(1 for item in rows if item["stage"] == "approved"),
        "leave": sum(1 for item in rows if item["request_type"] == "leave"),
        "wfh": sum(1 for item in rows if item["request_type"] == "wfh"),
    }
    return {"rows": rows, "summary": summary}
