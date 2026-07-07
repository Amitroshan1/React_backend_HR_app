"""Circle assignment helpers for attendance exports (uses employee_circle_history)."""
from __future__ import annotations

import calendar
from collections import defaultdict
from datetime import date, timedelta

from sqlalchemy import func, or_

from . import db
from .models.Admin_models import Admin
from .models.employee_circle_history import EmployeeCircleHistory


def _norm_circle(value):
    return (value or "").strip().lower()


def fmt_short_date(d: date) -> str:
    return d.strftime("%d-%b-%Y")


def _fmt_short(d: date) -> str:
    return fmt_short_date(d)


def preload_circle_history(admin_ids):
    """Return {admin_id: [EmployeeCircleHistory rows ordered by effective_from]}."""
    if not admin_ids:
        return {}
    rows = (
        EmployeeCircleHistory.query.filter(EmployeeCircleHistory.admin_id.in_(admin_ids))
        .order_by(EmployeeCircleHistory.admin_id, EmployeeCircleHistory.effective_from.asc())
        .all()
    )
    out = defaultdict(list)
    for r in rows:
        out[r.admin_id].append(r)
    return out


def _current_open_segment_for_circle(history_rows, circle):
    """Active history segment where the employee is assigned to `circle`."""
    circle_n = _norm_circle(circle)
    if not circle_n:
        return None
    for row in reversed(history_rows or []):
        if row.effective_to is not None:
            continue
        if _norm_circle(row.to_circle) == circle_n:
            return row
    return None


def is_transferred_into_circle(admin, circle, history_rows=None):
    """True when the employee joined this circle via transfer (not initial onboarding)."""
    rows = history_rows
    if rows is None:
        rows = (
            EmployeeCircleHistory.query.filter_by(admin_id=admin.id)
            .order_by(EmployeeCircleHistory.effective_from.asc())
            .all()
        )
    segment = _current_open_segment_for_circle(rows, circle)
    if segment is None:
        return False
    return bool((segment.from_circle or "").strip())


def _segment_in_circle_for_month(history_rows, circle, year, month):
    """History segment for this circle overlapping the export month (incl. closed stints)."""
    circle_n = _norm_circle(circle)
    if not circle_n:
        return None
    num_days = calendar.monthrange(year, month)[1]
    month_start = date(year, month, 1)
    month_end = date(year, month, num_days)
    for row in reversed(history_rows or []):
        if _norm_circle(row.to_circle) != circle_n or not row.effective_from:
            continue
        if row.effective_from > month_end:
            continue
        seg_end = row.effective_to or month_end
        if row.effective_to and row.effective_to < month_start:
            continue
        return row
    return None


def circle_stint_start_date(admin, circle, history_rows=None, year=None, month=None):
    """
    When the employee's assignment to this circle began (for list/export ordering).
    Uses open history segment effective_from; for month exports, falls back to the
    stint that overlapped that month; else DOJ for legacy rows without history.
    """
    rows = history_rows
    if rows is None and getattr(admin, "id", None):
        rows = (
            EmployeeCircleHistory.query.filter_by(admin_id=admin.id)
            .order_by(EmployeeCircleHistory.effective_from.asc())
            .all()
        )
    segment = _current_open_segment_for_circle(rows or [], circle)
    if segment and segment.effective_from:
        return segment.effective_from
    if year is not None and month is not None:
        month_segment = _segment_in_circle_for_month(rows or [], circle, year, month)
        if month_segment and month_segment.effective_from:
            return month_segment.effective_from
    return getattr(admin, "doj", None)


def sort_admins_for_hr_circle_search(admins, circle, history_by_admin=None, year=None, month=None):
    """
    HR search / export order for a circle — single timeline by tenure *in this circle*:
    earliest circle start first, newest circle start last.

    - Native hire: circle start = DOJ (or initial history effective_from).
    - Transfer in: circle start = transfer effective date.
    - New hire after a transfer: DOJ is after the transfer, so they appear last.
    """
    history_by_admin = history_by_admin or preload_circle_history([a.id for a in admins])

    def _sort_key(admin):
        rows = history_by_admin.get(admin.id, [])
        stint_start = circle_stint_start_date(
            admin, circle, rows, year=year, month=month
        )
        name = (getattr(admin, "first_name", None) or "").lower()
        admin_id = getattr(admin, "id", None) or 0
        if stint_start is None:
            return (1, date.max, name, admin_id)
        return (0, stint_start, name, admin_id)

    return sorted(admins, key=_sort_key)


def circle_on_date(admin, on_date: date, history_rows=None) -> str:
    """Circle the employee belonged to on a given calendar day."""
    rows = history_rows
    if rows is None:
        rows = (
            EmployeeCircleHistory.query.filter_by(admin_id=admin.id)
            .order_by(EmployeeCircleHistory.effective_from.asc())
            .all()
        )
    for r in reversed(rows):
        if r.effective_from and r.effective_from <= on_date:
            if r.effective_to is None or r.effective_to >= on_date:
                return (r.to_circle or "").strip()
    return (getattr(admin, "circle", None) or "").strip()


def _segments_for_admin(admin, history_rows):
    """List of {circle, start, end} from history or current circle fallback."""
    if history_rows:
        return [
            {
                "circle": (r.to_circle or "").strip(),
                "start": r.effective_from,
                "end": r.effective_to,
            }
            for r in history_rows
            if r.effective_from and (r.to_circle or "").strip()
        ]
    circle = (getattr(admin, "circle", None) or "").strip()
    if not circle:
        return []
    start = getattr(admin, "doj", None) or date(2000, 1, 1)
    return [{"circle": circle, "start": start, "end": None}]


def segments_overlapping_month(admin, year: int, month: int, history_rows=None):
    """Segments active during any day in the month."""
    num_days = calendar.monthrange(year, month)[1]
    month_start = date(year, month, 1)
    month_end = date(year, month, num_days)
    result = []
    for seg in _segments_for_admin(admin, history_rows):
        seg_start = seg["start"]
        seg_end = seg["end"] or month_end
        overlap_start = max(seg_start, month_start)
        overlap_end = min(seg_end, month_end)
        if overlap_start <= overlap_end:
            result.append(
                {
                    "circle": seg["circle"],
                    "start": overlap_start,
                    "end": overlap_end,
                }
            )
    return result


def month_circle_note(admin, year: int, month: int, history_rows=None) -> str:
    """Human-readable circle assignment for the month, e.g. NHQ (01-May-2025 to 22-May-2025); Pune (...)."""
    parts = []
    for seg in segments_overlapping_month(admin, year, month, history_rows):
        if seg["start"] == seg["end"]:
            parts.append(f"{seg['circle']} ({_fmt_short(seg['start'])})")
        else:
            parts.append(f"{seg['circle']} ({_fmt_short(seg['start'])} to {_fmt_short(seg['end'])})")
    return "; ".join(parts)


def had_circle_transfer_in_month(admin, year: int, month: int, history_rows=None) -> bool:
    segs = segments_overlapping_month(admin, year, month, history_rows)
    if len(segs) > 1:
        return True
    if len(segs) == 1:
        num_days = calendar.monthrange(year, month)[1]
        month_start = date(year, month, 1)
        month_end = date(year, month, num_days)
        return segs[0]["start"] > month_start or segs[0]["end"] < month_end
    return False


def any_transfer_in_month_for_admins(admins, year: int, month: int, history_by_admin=None) -> bool:
    history_by_admin = history_by_admin or preload_circle_history([a.id for a in admins])
    return any(
        had_circle_transfer_in_month(a, year, month, history_by_admin.get(a.id))
        for a in admins
    )


def fetch_admins_for_attendance_export(circle: str, emp_type: str, year: int, month: int):
    """
    Employees to include in a circle/month export: current circle match OR
    any history segment with to_circle == circle overlapping that month.
    """
    circle_lower = _norm_circle(circle)
    if not circle_lower or not (emp_type or "").strip():
        return []

    num_days = calendar.monthrange(year, month)[1]
    month_start = date(year, month, 1)
    month_end = date(year, month, num_days)

    active_filter = (
        db.func.coalesce(Admin.is_exited, False) == False,
        db.func.coalesce(Admin.is_active, True) == True,
        Admin.emp_type == emp_type,
    )

    current_ids = {
        a.id
        for a in Admin.query.filter(
            *active_filter,
            func.lower(func.coalesce(Admin.circle, "")) == circle_lower,
        ).all()
    }

    history_id_rows = (
        db.session.query(EmployeeCircleHistory.admin_id)
        .join(Admin, Admin.id == EmployeeCircleHistory.admin_id)
        .filter(
            *active_filter,
            func.lower(EmployeeCircleHistory.to_circle) == circle_lower,
            EmployeeCircleHistory.effective_from <= month_end,
            or_(
                EmployeeCircleHistory.effective_to.is_(None),
                EmployeeCircleHistory.effective_to >= month_start,
            ),
        )
        .distinct()
        .all()
    )
    history_ids = {r[0] for r in history_id_rows}

    all_ids = current_ids | history_ids
    if not all_ids:
        return []

    admins = Admin.query.filter(Admin.id.in_(all_ids)).all()
    return sort_admins_for_hr_circle_search(admins, circle, year=year, month=month)


def _fmt_dt(dt) -> str:
    if not dt:
        return ""
    if hasattr(dt, "strftime"):
        return dt.strftime("%d-%b-%Y %H:%M")
    return str(dt)


def circle_transfer_export_rows(admins, circle, year, month, history_by_admin=None):
    """
    Rows for the Circle Transfers Excel sheet: one line per history segment
    overlapping the export month (plus summary per employee).
    """
    history_by_admin = history_by_admin or preload_circle_history([a.id for a in admins])
    num_days = calendar.monthrange(year, month)[1]
    month_start = date(year, month, 1)
    month_end = date(year, month, num_days)
    filter_circle = _norm_circle(circle)
    rows = []

    for admin in admins:
        history = history_by_admin.get(admin.id, [])
        summary = month_circle_note(admin, year, month, history)
        overlapping = []
        for h in history:
            if not h.effective_from or h.effective_from > month_end:
                continue
            if h.effective_to and h.effective_to < month_start:
                continue
            in_month_start = max(h.effective_from, month_start)
            in_month_end = min(h.effective_to or month_end, month_end)
            to_c = (h.to_circle or "").strip()
            overlapping.append(
                {
                    "emp_id": admin.emp_id or "",
                    "employee_name": admin.first_name or "",
                    "email": admin.email or "",
                    "current_circle": (admin.circle or "").strip(),
                    "month_summary": summary,
                    "from_circle": (h.from_circle or "").strip() or "—",
                    "to_circle": to_c,
                    "effective_from": h.effective_from,
                    "effective_to": h.effective_to,
                    "active_in_month_from": in_month_start,
                    "active_in_month_to": in_month_end,
                    "days_in_month": (in_month_end - in_month_start).days + 1,
                    "in_export_circle": _norm_circle(to_c) == filter_circle,
                    "recorded_by": (h.recorded_by or "").strip(),
                    "recorded_at": h.recorded_at,
                    "notes": (h.notes or "").strip(),
                    "change_type": "Transfer" if (h.from_circle or "").strip() else "Initial assignment",
                }
            )

        if not overlapping:
            rows.append(
                {
                    "emp_id": admin.emp_id or "",
                    "employee_name": admin.first_name or "",
                    "email": admin.email or "",
                    "current_circle": (admin.circle or "").strip(),
                    "month_summary": summary or (admin.circle or ""),
                    "from_circle": "—",
                    "to_circle": (admin.circle or "").strip(),
                    "effective_from": None,
                    "effective_to": None,
                    "active_in_month_from": month_start,
                    "active_in_month_to": month_end,
                    "days_in_month": num_days,
                    "in_export_circle": _norm_circle(admin.circle) == filter_circle,
                    "recorded_by": "",
                    "recorded_at": None,
                    "notes": "No circle history on file; showing current circle for full month.",
                    "change_type": "No history",
                }
            )
            continue

        for item in overlapping:
            rows.append(item)

    return rows
