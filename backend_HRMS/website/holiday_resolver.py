"""Company holiday calendar + circle overlay (extras and not_observe skips)."""
from __future__ import annotations

from datetime import date, timedelta

from .master_data_tenancy import holiday_circle_norm


def merge_company_and_overlay(company_rows, overlay_rows):
    """Company list + overlay extras − skipped names (case-insensitive).

    Overlay row with not_observe skips the company holiday of the same name.
    Overlay row without not_observe replaces that name (date / optional flag)
    or adds a circle-only extra.
    """
    overlay = list(overlay_rows or [])
    skip = {
        str(row.get("holiday_name") or "").strip().lower()
        for row in overlay
        if row.get("not_observe")
    }
    replace = {}
    for row in overlay:
        key = str(row.get("holiday_name") or "").strip().lower()
        if not key or row.get("not_observe"):
            continue
        replace[key] = row

    out = []
    seen = set()
    for row in company_rows or []:
        key = str(row.get("holiday_name") or "").strip().lower()
        if not key or key in skip:
            continue
        if key in replace:
            merged = dict(row)
            merged.update(replace[key])
            merged["not_observe"] = False
            merged["source"] = "override"
            out.append(merged)
        else:
            item = dict(row)
            item["not_observe"] = False
            item["source"] = "company"
            item["id"] = None
            out.append(item)
        seen.add(key)

    for row in overlay:
        key = str(row.get("holiday_name") or "").strip().lower()
        if not key or key in seen:
            continue
        item = dict(row)
        item["source"] = "skip" if row.get("not_observe") else "extra"
        out.append(item)
        seen.add(key)
    return out


def overlay_holidays_for_year(tenant_id, year, circle):
    from .cache import cached_json, NS_HOLIDAYS, _holiday_payload
    from .master_data_tenancy import holiday_query, holiday_scope_clause
    from .models.holiday_calendar import HolidayCalendar

    name = holiday_circle_norm(circle)
    if not name:
        return []

    def load():
        rows = (
            holiday_query(tenant_id)
            .filter(
                HolidayCalendar.year == int(year),
                HolidayCalendar.is_active.is_(True),
                holiday_scope_clause(name),
            )
            .all()
        )
        return [_holiday_payload(row) for row in rows]

    return cached_json(NS_HOLIDAYS, tenant_id, f"{int(year)}:c:{name.lower()}", load)


def resolved_holidays_for_year(tenant_id, year, circle=None):
    from .cache import active_holidays_for_year

    company = active_holidays_for_year(tenant_id, year)
    name = holiday_circle_norm(circle)
    if not name:
        out = []
        for row in company:
            item = dict(row)
            item["not_observe"] = False
            item["source"] = "company"
            out.append(item)
        return out
    return merge_company_and_overlay(company, overlay_holidays_for_year(tenant_id, year, name))


def observed_holidays_for_year(tenant_id, year, circle=None):
    return [row for row in resolved_holidays_for_year(tenant_id, year, circle) if not row.get("not_observe")]


def holiday_map_for_admin_span(admin, start_date: date, end_date: date):
    """date -> holiday namespace for each day using the employee's circle that day."""
    from .cache import holiday_as_date, holiday_namespace
    from .circle_transfer_utils import circle_on_date
    from .master_data_tenancy import tenant_for_admin_id
    from .models.employee_circle_history import EmployeeCircleHistory

    if not admin or end_date < start_date:
        return {}

    tid = tenant_for_admin_id(admin.id)
    history = (
        EmployeeCircleHistory.query.filter_by(admin_id=admin.id)
        .order_by(EmployeeCircleHistory.effective_from.asc())
        .all()
    )
    by_circle_year = {}

    def payloads(on_day: date):
        circ = circle_on_date(admin, on_day, history)
        key = (on_day.year, holiday_circle_norm(circ).lower())
        if key not in by_circle_year:
            by_circle_year[key] = {
                holiday_as_date(row.get("holiday_date")): row
                for row in observed_holidays_for_year(tid, on_day.year, circ)
            }
        return by_circle_year[key]

    holiday_map = {}
    cur = start_date
    while cur <= end_date:
        row = payloads(cur).get(cur)
        if row:
            h = holiday_namespace(row)
            if h is not None:
                holiday_map[cur] = h
        cur += timedelta(days=1)
    return holiday_map
