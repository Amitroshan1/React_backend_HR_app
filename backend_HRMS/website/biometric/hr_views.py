"""
HR Biometric Attendance reporting (read-only).

Sits alongside the working ingestion pipeline:

    biometric_logs
        -> incremental upsert biometric_attendance_day
        -> HR reporting API (this module)
        -> HR Biometric Attendance UI

This module is a READ/REPORTING layer over biometric_attendance_day
(incrementally upserted from biometric_logs). It never writes to
biometric_logs, never creates Punch/PunchSession, and never talks to the device.

Scan classification (uses actual BiometricLog fields, no new status system):

  A. Valid employee scan  -> punch_time NOT NULL, status NOT invalid, admin_id NOT NULL
  B. Unmapped scan        -> punch_time NOT NULL, status NOT invalid, admin_id IS NULL
  C. Invalid/protocol     -> punch_time IS NULL, or status in {failed, duplicate, unknown_device}

OPLOG / operational records never reach biometric_logs as attendance (handled in
service.py operlog branch), so they are naturally excluded.
"""

from __future__ import annotations

import calendar
from datetime import date, datetime
from functools import wraps
from typing import List, Optional, Tuple

from flask import Blueprint, jsonify, request
from flask_jwt_extended import get_jwt, jwt_required

from .. import db
from ..datetime_utils import isoformat_api
from ..models.Admin_models import Admin
from .device_manager import (
    device_online_timeout_seconds,
    is_device_online,
)
from .models import BiometricAttendanceDay, BiometricDevice, BiometricLog
from .day_rollup import rebuild_attendance_days_from_logs

biometric_hr_bp = Blueprint("biometric_hr", __name__)

# Statuses that are NOT a real employee/unmapped scan for reporting purposes.
# - failed: malformed / invalid timestamp / bad user id (service.py)
# - duplicate: already ingested, not a new scan (service.py)
# - unknown_device: device rejected (device_manager.py)
_INVALID_SCAN_STATUSES = frozenset({"failed", "duplicate", "unknown_device"})

DEFAULT_PER_PAGE = 25
MAX_PER_PAGE = 200


def hr_required(fn):
    """HR authorization — mirrors Human_resource.hr_required exactly."""

    @wraps(fn)
    def wrapper(*args, **kwargs):
        from ..plan_features import can_access_hr_operations

        if not can_access_hr_operations(get_jwt()):
            return jsonify({"success": False, "message": "HR access required"}), 403
        return fn(*args, **kwargs)

    return wrapper


def _parse_date(value: Optional[str]) -> Optional[date]:
    if not value:
        return None
    try:
        return datetime.strptime(value.strip(), "%Y-%m-%d").date()
    except (ValueError, TypeError):
        return None


def _parse_month(value: Optional[str]) -> Optional[Tuple[int, int]]:
    if not value:
        return None
    try:
        year, month = (int(x) for x in value.strip().split("-"))
        if 1 <= month <= 12:
            return year, month
    except (ValueError, TypeError):
        return None
    return None


def _resolve_date_range(args) -> Tuple[Optional[date], Optional[date]]:
    """Return (start, end) inclusive from month | date | start+end. Never both."""
    month = _parse_month(args.get("month"))
    if month:
        year, mon = month
        last = calendar.monthrange(year, mon)[1]
        return date(year, mon, 1), date(year, mon, last)

    single = _parse_date(args.get("date"))
    if single:
        return single, single

    start = _parse_date(args.get("start"))
    end = _parse_date(args.get("end"))
    if start or end:
        return start, end

    return None, None


def _base_scan_filter():
    """Candidate scans: valid punch_time and not an invalid/protocol status."""
    return (
        BiometricLog.punch_time.isnot(None),
        BiometricLog.status.notin_(_INVALID_SCAN_STATUSES),
    )


def _apply_common_filters(query, args, start, end):
    """Date/device filters for raw biometric_logs (export/detail). DB only."""
    if start:
        query = query.filter(BiometricLog.punch_time >= datetime.combine(start, datetime.min.time()))
    if end:
        query = query.filter(BiometricLog.punch_time <= datetime.combine(end, datetime.max.time()))
    device_sn = (args.get("device_sn") or "").strip()
    if device_sn:
        query = query.filter(BiometricLog.device_serial_number == device_sn)
    return query


def _ensure_day_read_model():
    """If the read model is empty but logs exist, rebuild once (DB only)."""
    if BiometricAttendanceDay.query.first() is not None:
        return
    if BiometricLog.query.filter(BiometricLog.punch_time.isnot(None)).first() is None:
        return
    rebuild_attendance_days_from_logs()
    db.session.commit()


def _scan_count(row: BiometricAttendanceDay) -> int:
    scans = row.total_scans
    if isinstance(scans, list):
        return len(scans)
    return 0


def _fmt_dt(dt) -> Optional[str]:
    return dt.strftime("%Y-%m-%d %H:%M:%S") if dt else None


def _pin_dates_for_device(device_sn: str, start, end):
    """DB-only helper: (device_user_id, date) pairs that have logs on this device."""
    q = BiometricLog.query.filter(
        *_base_scan_filter(),
        BiometricLog.device_serial_number == device_sn,
    )
    if start:
        q = q.filter(BiometricLog.punch_time >= datetime.combine(start, datetime.min.time()))
    if end:
        q = q.filter(BiometricLog.punch_time <= datetime.combine(end, datetime.max.time()))
    pairs = set()
    for log in q.with_entities(BiometricLog.device_user_id, BiometricLog.punch_time).all():
        pin, pt = log
        if pin and pt:
            pairs.add(((pin or "").strip(), pt.date()))
    return pairs


def _base_day_query(args, start, end):
    q = BiometricAttendanceDay.query
    if start:
        q = q.filter(BiometricAttendanceDay.attendance_date >= start)
    if end:
        q = q.filter(BiometricAttendanceDay.attendance_date <= end)
    device_sn = (args.get("device_sn") or "").strip()
    if device_sn:
        pairs = _pin_dates_for_device(device_sn, start, end)
        if not pairs:
            return q.filter(db.false())
        from sqlalchemy import or_, tuple_

        dialect = db.engine.dialect.name
        if dialect == "sqlite":
            conds = [
                db.and_(
                    BiometricAttendanceDay.device_user_id == pin,
                    BiometricAttendanceDay.attendance_date == day,
                )
                for pin, day in pairs
            ]
            q = q.filter(or_(*conds)) if conds else q.filter(db.false())
        else:
            q = q.filter(
                tuple_(
                    BiometricAttendanceDay.device_user_id,
                    BiometricAttendanceDay.attendance_date,
                ).in_(list(pairs))
            )
    return q


def _serialize_day_row(row: BiometricAttendanceDay, admin: Optional[Admin]) -> dict:
    mapped = row.admin_id is not None
    scans = row.total_scans if isinstance(row.total_scans, list) else []
    return {
        "admin_id": row.admin_id,
        "emp_id": admin.emp_id if admin else None,
        "employee_name": admin.first_name if admin else None,
        "emp_type": admin.emp_type if admin else None,
        "circle": admin.circle if admin else None,
        "device_user_id": row.device_user_id,
        "date": row.attendance_date.isoformat() if row.attendance_date else None,
        "first_scan": _fmt_dt(row.first_scan),
        "last_scan": _fmt_dt(row.last_scan),
        "scan_count": _scan_count(row),
        "total_scans": scans,
        "mapped": mapped,
    }


def _summary_rows(args, start, end):
    """Daily summary from biometric_attendance_day (mapped + unmapped)."""
    q = _base_day_query(args, start, end)

    emp_id = (args.get("emp_id") or "").strip()
    emp_type = (args.get("emp_type") or "").strip()
    circle = (args.get("circle") or "").strip()
    admin_id = (args.get("admin_id") or "").strip()
    needs_admin_join = bool(emp_type or circle or emp_id)

    if admin_id:
        try:
            q = q.filter(BiometricAttendanceDay.admin_id == int(admin_id))
        except (ValueError, TypeError):
            pass

    if needs_admin_join:
        q = q.outerjoin(Admin, Admin.id == BiometricAttendanceDay.admin_id)
        if emp_id:
            q = q.filter(
                db.or_(
                    Admin.emp_id == emp_id,
                    BiometricAttendanceDay.admin_id.is_(None),
                )
            )
        if emp_type:
            q = q.filter(Admin.emp_type == emp_type)
        if circle:
            q = q.filter(Admin.circle == circle)

    rows = q.all()
    admin_ids = {r.admin_id for r in rows if r.admin_id}
    admins = {}
    if admin_ids:
        for a in Admin.query.filter(Admin.id.in_(admin_ids)).all():
            admins[a.id] = a

    out = []
    for r in rows:
        a = admins.get(r.admin_id) if r.admin_id else None
        # Preserve prior emp_id filter: mapped rows must match; unmapped still listed
        # unless emp_type/circle required a join that already excluded them.
        if emp_id and r.admin_id is not None and (not a or a.emp_id != emp_id):
            continue
        out.append(_serialize_day_row(r, a))
    return out


def _paginate(items: List[dict], page: int, per_page: int):
    total = len(items)
    total_pages = (total + per_page - 1) // per_page if per_page else 0
    start = (page - 1) * per_page
    rows = items[start : start + per_page]
    return rows, total, page, per_page, total_pages


@biometric_hr_bp.route("/summary", methods=["GET"])
@jwt_required()
@hr_required
def biometric_summary():
    """Daily biometric scan summary (mapped employees + unmapped PINs), paginated."""
    args = request.args
    start, end = _resolve_date_range(args)

    try:
        page = max(1, int(args.get("page", 1)))
    except (ValueError, TypeError):
        page = 1
    try:
        per_page = min(MAX_PER_PAGE, max(1, int(args.get("per_page", DEFAULT_PER_PAGE))))
    except (ValueError, TypeError):
        per_page = DEFAULT_PER_PAGE

    _ensure_day_read_model()
    combined = _summary_rows(args, start, end)
    combined.sort(key=lambda r: (r["date"] or "", r["employee_name"] or r["device_user_id"] or ""), reverse=True)

    rows, total, page, per_page, total_pages = _paginate(combined, page, per_page)

    return jsonify(
        {
            "success": True,
            "rows": rows,
            "total": total,
            "page": page,
            "per_page": per_page,
            "total_pages": total_pages,
        }
    ), 200


def _serialize_scan(log: BiometricLog) -> dict:
    return {
        "id": log.id,
        "punch_time": log.punch_time.strftime("%Y-%m-%d %H:%M:%S") if log.punch_time else None,
        "device_serial_number": log.device_serial_number,
        "device_user_id": log.device_user_id,
        "verification_mode": log.verification_mode,
        "status": log.status,
        "admin_id": log.admin_id,
        "mapped": log.admin_id is not None,
    }


@biometric_hr_bp.route("/employee/<int:admin_id>/day/<date_str>", methods=["GET"])
@jwt_required()
@hr_required
def biometric_employee_day(admin_id: int, date_str: str):
    """All raw biometric scans for one mapped employee on one calendar day."""
    day = _parse_date(date_str)
    if not day:
        return jsonify({"success": False, "message": "Invalid date. Use YYYY-MM-DD"}), 400

    admin = Admin.query.get(admin_id)
    if not admin:
        return jsonify({"success": False, "message": "Employee not found"}), 404

    logs = (
        BiometricLog.query.filter(
            BiometricLog.admin_id == admin_id,
            BiometricLog.punch_time >= datetime.combine(day, datetime.min.time()),
            BiometricLog.punch_time <= datetime.combine(day, datetime.max.time()),
            BiometricLog.punch_time.isnot(None),
            BiometricLog.status.notin_(_INVALID_SCAN_STATUSES),
        )
        .order_by(BiometricLog.punch_time.asc(), BiometricLog.id.asc())
        .all()
    )

    return jsonify(
        {
            "success": True,
            "admin_id": admin_id,
            "emp_id": admin.emp_id,
            "employee_name": admin.first_name,
            "date": day.isoformat(),
            "scans": [_serialize_scan(l) for l in logs],
        }
    ), 200


@biometric_hr_bp.route("/unmapped/<device_user_id>/day/<date_str>", methods=["GET"])
@jwt_required()
@hr_required
def biometric_unmapped_day(device_user_id: str, date_str: str):
    """All raw biometric scans for an unmapped device PIN on one calendar day."""
    day = _parse_date(date_str)
    if not day:
        return jsonify({"success": False, "message": "Invalid date. Use YYYY-MM-DD"}), 400

    logs = (
        BiometricLog.query.filter(
            BiometricLog.admin_id.is_(None),
            BiometricLog.device_user_id == device_user_id,
            BiometricLog.punch_time >= datetime.combine(day, datetime.min.time()),
            BiometricLog.punch_time <= datetime.combine(day, datetime.max.time()),
            BiometricLog.punch_time.isnot(None),
            BiometricLog.status.notin_(_INVALID_SCAN_STATUSES),
        )
        .order_by(BiometricLog.punch_time.asc(), BiometricLog.id.asc())
        .all()
    )

    return jsonify(
        {
            "success": True,
            "admin_id": None,
            "emp_id": None,
            "employee_name": None,
            "device_user_id": device_user_id,
            "date": day.isoformat(),
            "scans": [_serialize_scan(l) for l in logs],
        }
    ), 200


@biometric_hr_bp.route("/devices", methods=["GET"])
@jwt_required()
@hr_required
def biometric_devices():
    """Registered devices + Online/Offline from last_seen_at (DB only; no device I/O)."""
    timeout = device_online_timeout_seconds()
    devices = BiometricDevice.query.order_by(BiometricDevice.serial_number.asc()).all()
    payload = []
    for d in devices:
        payload.append(
            {
                "id": d.id,
                "serial_number": d.serial_number,
                "name": d.name,
                "is_active": d.is_active,
                "last_seen_at": isoformat_api(d.last_seen_at),
                "last_data_push_at": isoformat_api(getattr(d, "last_data_push_at", None)),
                "online": is_device_online(d),
                "status": "Online" if is_device_online(d) else "Offline",
            }
        )
    return jsonify(
        {
            "success": True,
            "online_timeout_seconds": timeout,
            "devices": payload,
        }
    ), 200


@biometric_hr_bp.route("/export", methods=["GET"])
@jwt_required()
@hr_required
def biometric_export():
    """Excel export of the filtered biometric summary + all raw scans."""
    from ..utility import send_excel_file

    args = request.args
    start, end = _resolve_date_range(args)

    _ensure_day_read_model()
    combined = _summary_rows(args, start, end)
    combined.sort(key=lambda r: (r["date"] or "", r["employee_name"] or r["device_user_id"] or ""))

    # Raw scans for the same filter set (mapped + unmapped).
    raw_q = BiometricLog.query.filter(*_base_scan_filter())
    raw_q = _apply_common_filters(raw_q, args, start, end)
    emp_id = (args.get("emp_id") or "").strip()
    emp_type = (args.get("emp_type") or "").strip()
    circle = (args.get("circle") or "").strip()
    admin_id = (args.get("admin_id") or "").strip()
    if emp_id or emp_type or circle or admin_id:
        raw_q = raw_q.outerjoin(Admin, Admin.id == BiometricLog.admin_id)
        if emp_id:
            raw_q = raw_q.filter(Admin.emp_id == emp_id)
        if emp_type:
            raw_q = raw_q.filter(Admin.emp_type == emp_type)
        if circle:
            raw_q = raw_q.filter(Admin.circle == circle)
        if admin_id:
            try:
                raw_q = raw_q.filter(BiometricLog.admin_id == int(admin_id))
            except (ValueError, TypeError):
                pass
    raw_logs = raw_q.order_by(BiometricLog.punch_time.asc(), BiometricLog.id.asc()).all()

    admin_ids = {l.admin_id for l in raw_logs if l.admin_id}
    admins = {}
    if admin_ids:
        for a in Admin.query.filter(Admin.id.in_(admin_ids)).all():
            admins[a.id] = a

    import io

    from openpyxl import Workbook

    summary_rows = []
    for r in combined:
        summary_rows.append(
            [
                r["employee_name"] or "Unmapped",
                r["emp_id"] or (r["device_user_id"] or ""),
                r["date"],
                r["first_scan"],
                r["last_scan"],
                r["scan_count"],
                "Mapped" if r["mapped"] else "Unmapped",
            ]
        )

    raw_rows = []
    for l in raw_logs:
        a = admins.get(l.admin_id)
        raw_rows.append(
            [
                a.first_name if a else "Unmapped",
                a.emp_id if a else (l.device_user_id or ""),
                l.punch_time.date().isoformat() if l.punch_time else None,
                l.punch_time.strftime("%Y-%m-%d %H:%M:%S") if l.punch_time else None,
                l.device_serial_number,
                l.device_user_id,
                l.verification_mode,
                l.status,
            ]
        )

    wb = Workbook()
    ws_summary = wb.active
    ws_summary.title = "Summary"
    ws_summary.append(
        ["Employee", "Employee ID", "Date", "First Scan", "Last Scan", "Total Scans", "Status"]
    )
    for row in summary_rows:
        ws_summary.append(row)

    ws_raw = wb.create_sheet("Raw Scans")
    ws_raw.append(
        [
            "Employee",
            "Employee ID",
            "Date",
            "Punch Time",
            "Device Serial",
            "Device User ID",
            "Verification Mode",
            "Status",
        ]
    )
    for row in raw_rows:
        ws_raw.append(row)

    output = io.BytesIO()
    wb.save(output)

    return send_excel_file(
        output,
        download_name="Biometric_Attendance.xlsx",
        mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )
