"""Hold HR leave and WFH changes until an Admin approves them.

HR's change is checked in full when it is sent, stored on an
``EmployeeProfileChangeRequest`` row, and applied only when an Admin approves it.
"""
from __future__ import annotations

import json
from datetime import date, datetime
from zoneinfo import ZoneInfo

from flask import current_app

from . import db
from .models.Admin_models import Admin
from .models.attendance import LeaveApplication, WorkFromHomeApplication
from .models.employee_profile_change import EmployeeProfileChangeRequest
from .tenant_context import admin_id_in_tenant, tenant_id_for_admin, tenant_scope

LEAVE_UPDATE = "leave_update"
WFH_UPDATE = "wfh_update"
LEAVE_ON_BEHALF = "leave_on_behalf"
LEAVE_REQUEST_TYPES = (LEAVE_UPDATE, WFH_UPDATE, LEAVE_ON_BEHALF)

SENT_MESSAGE = "Sent to Admin for approval. Nothing changes until an Admin approves it."
STALE_MESSAGE = (
    "This request was changed after HR sent it for approval. "
    "Reject this one and ask HR to send it again."
)

LEAVE_KEYS = ("leave_type", "status", "start_date", "end_date", "reason")
WFH_KEYS = ("status", "start_date", "end_date", "reason")
FIELD_LABELS = {
    "leave_type": "Leave type",
    "status": "Status",
    "start_date": "From",
    "end_date": "To",
    "reason": "Reason",
}


def ist_today() -> date:
    return datetime.now(ZoneInfo("Asia/Kolkata")).date()


def _clean(value) -> str:
    return ("" if value is None else str(value)).strip()


def _iso(value) -> str:
    return value.isoformat() if value else ""


def _payload(row) -> dict:
    try:
        parsed = json.loads(row.signup_payload or "{}")
    except (TypeError, ValueError):
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _pretty_date(value) -> str:
    text = _clean(value)[:10]
    if not text:
        return "—"
    try:
        return date.fromisoformat(text).strftime("%d %b %Y")
    except ValueError:
        return text


def _shown(key: str, value) -> str:
    if key in ("start_date", "end_date"):
        return _pretty_date(value)
    return _clean(value) or "—"


def _leave_snapshot(leave_obj) -> dict:
    return {
        "leave_type": _clean(leave_obj.leave_type),
        "status": _clean(leave_obj.status) or "Pending",
        "start_date": _iso(leave_obj.start_date),
        "end_date": _iso(leave_obj.end_date),
        "reason": _clean(leave_obj.reason),
    }


def _wfh_snapshot(wfh_obj) -> dict:
    return {
        "status": _clean(wfh_obj.status) or "Pending",
        "start_date": _iso(wfh_obj.start_date),
        "end_date": _iso(wfh_obj.end_date),
        "reason": _clean(wfh_obj.reason),
    }


def _changed_keys(snapshot: dict, values: dict, keys) -> list[str]:
    return [key for key in keys if _clean(snapshot.get(key)) != _clean(values.get(key))]


def _pending_rows(tenant_id: int, request_type: str):
    return EmployeeProfileChangeRequest.query.filter_by(
        tenant_id=int(tenant_id),
        request_type=request_type,
        status="pending",
    ).all()


def _pending_for_target(tenant_id: int, request_type: str, target_id: int):
    for row in _pending_rows(tenant_id, request_type):
        if int(_payload(row).get("target_id") or 0) == int(target_id):
            return row
    return None


def _overlapping_on_behalf(tenant_id: int, admin_id: int, start: str, end: str):
    for row in _pending_rows(tenant_id, LEAVE_ON_BEHALF):
        values = _payload(row).get("values") or {}
        if int(values.get("admin_id") or 0) != int(admin_id):
            continue
        if _clean(values.get("start_date")) <= end and start <= _clean(values.get("end_date")):
            return row
    return None


def _stage(employee, request_type: str, payload: dict):
    from .employee_profile_change_service import stage_action_request

    row = stage_action_request(employee, request_type, {}, payload)
    try:
        db.session.commit()
    except Exception:
        db.session.rollback()
        current_app.logger.exception("Could not save %s request for Admin approval", request_type)
        return {"success": False, "message": "Could not send this change for Admin approval."}, 500
    return {
        "success": True,
        "pending_approval": True,
        "request_id": row.id,
        "message": SENT_MESSAGE,
    }, 200


def stage_leave_on_behalf(payload: dict):
    """Check HR's leave for an employee and hold it for Admin approval."""
    from .Human_resource import _hr_create_leave_on_behalf

    today = ist_today()
    body, code = _hr_create_leave_on_behalf(payload, today_ist=today, dry_run=True)
    if not body.get("success"):
        return body, code
    values = body["values"]
    employee = db.session.get(Admin, int(values["admin_id"]))
    if employee is None:
        return {"success": False, "message": "Employee not found"}, 404
    if _overlapping_on_behalf(
        tenant_id_for_admin(employee), employee.id, values["start_date"], values["end_date"]
    ):
        return {
            "success": False,
            "message": "A leave for these dates is already waiting for Admin approval for this employee.",
        }, 409
    return _stage(employee, LEAVE_ON_BEHALF, {
        "requested_on": today.isoformat(),
        "values": values,
        "preview": {
            "deducted_days": (body.get("preview") or {}).get("deducted_days"),
            "extra_days": (body.get("preview") or {}).get("extra_days"),
        },
    })


def stage_leave_update(leave_id: int, payload: dict):
    """Check HR's edit to a leave and hold it for Admin approval."""
    from .Human_resource import _hr_update_leave

    leave_obj = db.session.get(LeaveApplication, leave_id)
    if not leave_obj or not admin_id_in_tenant(leave_obj.admin_id):
        return {"success": False, "message": "Leave request not found"}, 404
    employee = leave_obj.admin
    if employee is None:
        return {"success": False, "message": "Employee not found for this leave request"}, 404
    tenant_id = tenant_id_for_admin(employee)
    if _pending_for_target(tenant_id, LEAVE_UPDATE, leave_id):
        return {"success": False, "message": "An edit to this leave is already waiting for Admin approval."}, 409

    snapshot = _leave_snapshot(leave_obj)
    before_days = {
        "deducted_days": float(leave_obj.deducted_days or 0),
        "extra_days": float(leave_obj.extra_days or 0),
    }
    today = ist_today()
    body, code = _hr_update_leave(leave_id, payload, today_ist=today, dry_run=True)
    if not body.get("success"):
        return body, code
    values = body["values"]
    if not _changed_keys(snapshot, values, LEAVE_KEYS):
        return {"success": False, "message": "Nothing to change. Edit at least one field first."}, 400

    employee = db.session.get(Admin, int(body["admin_id"]))
    return _stage(employee, LEAVE_UPDATE, {
        "target_id": int(leave_id),
        "requested_on": today.isoformat(),
        "snapshot": snapshot,
        "values": values,
        "before_days": before_days,
        "preview": body.get("preview") or {},
    })


def stage_wfh_update(wfh_id: int, payload: dict):
    """Check HR's edit to a WFH request and hold it for Admin approval."""
    from .Human_resource import _hr_update_wfh

    wfh_obj = db.session.get(WorkFromHomeApplication, wfh_id)
    if not wfh_obj or not admin_id_in_tenant(wfh_obj.admin_id):
        return {"success": False, "message": "WFH request not found"}, 404
    employee = wfh_obj.admin
    if employee is None:
        return {"success": False, "message": "Employee not found for this WFH request"}, 404
    if _pending_for_target(tenant_id_for_admin(employee), WFH_UPDATE, wfh_id):
        return {"success": False, "message": "An edit to this WFH request is already waiting for Admin approval."}, 409

    snapshot = _wfh_snapshot(wfh_obj)
    body, code = _hr_update_wfh(wfh_id, payload, dry_run=True)
    if not body.get("success"):
        return body, code
    values = body["values"]
    if not _changed_keys(snapshot, values, WFH_KEYS):
        return {"success": False, "message": "Nothing to change. Edit at least one field first."}, 400

    return _stage(employee, WFH_UPDATE, {
        "target_id": int(wfh_id),
        "requested_on": ist_today().isoformat(),
        "snapshot": snapshot,
        "values": values,
    })


def _requested_on(payload: dict):
    try:
        return date.fromisoformat(_clean(payload.get("requested_on"))[:10])
    except ValueError:
        return None


def apply_leave_request(row, decider_label: str):
    """Apply an approved HR leave/WFH request. Returns (ok, message, status_code).

    The leave change and ``row`` are saved in one commit. On failure nothing is saved.
    """
    with tenant_scope(row.tenant_id):
        return _apply_leave_request(row, decider_label)


def _apply_leave_request(row, decider_label: str):
    from .Human_resource import _hr_create_leave_on_behalf, _hr_update_leave, _hr_update_wfh

    payload = _payload(row)
    values = payload.get("values") or {}
    if not values:
        return False, "This request has no details to apply. Reject it.", 400
    actor = db.session.get(Admin, row.requested_by_admin_id) if row.requested_by_admin_id else None
    common = {
        "actor": actor,
        "actor_email": _clean(row.requested_by_email) or None,
        "approved_by": decider_label,
    }
    request_type = _clean(row.request_type)
    target_id = int(payload.get("target_id") or 0)

    if request_type == LEAVE_ON_BEHALF:
        body, code = _hr_create_leave_on_behalf(
            dict(values), today_ist=_requested_on(payload), **common
        )
    elif request_type == LEAVE_UPDATE:
        leave_obj = db.session.get(LeaveApplication, target_id)
        if leave_obj is None:
            return False, "This leave no longer exists. Reject the request.", 409
        if _leave_snapshot(leave_obj) != (payload.get("snapshot") or {}):
            return False, STALE_MESSAGE, 409
        body, code = _hr_update_leave(
            target_id, dict(values), today_ist=_requested_on(payload), **common
        )
    elif request_type == WFH_UPDATE:
        wfh_obj = db.session.get(WorkFromHomeApplication, target_id)
        if wfh_obj is None:
            return False, "This WFH request no longer exists. Reject the request.", 409
        if _wfh_snapshot(wfh_obj) != (payload.get("snapshot") or {}):
            return False, STALE_MESSAGE, 409
        body, code = _hr_update_wfh(target_id, dict(values), **common)
    else:
        return False, "Unknown leave request type.", 400

    if not body.get("success"):
        db.session.rollback()
        return False, body.get("message") or "Could not apply this change.", code
    return True, body.get("message") or "", code


def _days_text(days: dict | None) -> str:
    days = days or {}
    paid = days.get("deducted_days")
    lwp = days.get("extra_days")
    if paid is None and lwp is None:
        return "—"
    return f"{float(paid or 0):g} paid · {float(lwp or 0):g} LWP"


def display_fields(request_type: str, payload: dict) -> list[dict]:
    """Rows for the Admin request card: what changes, from and to."""
    values = payload.get("values") or {}
    fields: list[dict] = []
    if request_type == LEAVE_ON_BEHALF:
        for key in ("leave_type", "start_date", "end_date", "status", "reason"):
            fields.append({
                "field": key,
                "label": FIELD_LABELS[key],
                "from": "—",
                "to": _shown(key, values.get(key)),
            })
        fields.append({
            "field": "days",
            "label": "Days charged",
            "from": "—",
            "to": _days_text(payload.get("preview")),
        })
        return fields

    snapshot = payload.get("snapshot") or {}
    keys = LEAVE_KEYS if request_type == LEAVE_UPDATE else WFH_KEYS
    target = "Leave" if request_type == LEAVE_UPDATE else "WFH"
    fields.append({
        "field": "target",
        "label": f"{target} request",
        "from": "—",
        "to": (
            f"#{payload.get('target_id')} · "
            f"{snapshot.get('leave_type') or 'Work From Home'} · "
            f"{_pretty_date(snapshot.get('start_date'))} to {_pretty_date(snapshot.get('end_date'))}"
        ),
    })
    for key in _changed_keys(snapshot, values, keys):
        fields.append({
            "field": key,
            "label": FIELD_LABELS[key],
            "from": _shown(key, snapshot.get(key)),
            "to": _shown(key, values.get(key)),
        })
    if request_type == LEAVE_UPDATE:
        fields.append({
            "field": "days",
            "label": "Days charged",
            "from": _days_text(payload.get("before_days")),
            "to": _days_text(payload.get("preview")),
        })
    return fields


def pending_overview(tenant_id: int) -> dict:
    """What HR has waiting for Admin: leave/WFH ids being edited and new on-behalf leaves."""
    leave_ids: dict[int, int] = {}
    wfh_ids: dict[int, int] = {}
    on_behalf: list[dict] = []
    rows = (
        EmployeeProfileChangeRequest.query.filter(
            EmployeeProfileChangeRequest.tenant_id == int(tenant_id),
            EmployeeProfileChangeRequest.status == "pending",
            EmployeeProfileChangeRequest.request_type.in_(LEAVE_REQUEST_TYPES),
        )
        .order_by(EmployeeProfileChangeRequest.created_at.desc())
        .all()
    )
    for row in rows:
        payload = _payload(row)
        if row.request_type == LEAVE_UPDATE:
            leave_ids[int(payload.get("target_id") or 0)] = row.id
        elif row.request_type == WFH_UPDATE:
            wfh_ids[int(payload.get("target_id") or 0)] = row.id
        else:
            values = payload.get("values") or {}
            employee = row.employee
            on_behalf.append({
                "request_id": row.id,
                "admin_id": values.get("admin_id"),
                "employee_name": _clean(getattr(employee, "first_name", None)) or "Employee",
                "emp_id": _clean(getattr(employee, "emp_id", None)),
                "leave_type": values.get("leave_type"),
                "start_date": values.get("start_date"),
                "end_date": values.get("end_date"),
                "status": values.get("status"),
                "reason": values.get("reason"),
                "requested_by_name": row.requested_by_name or "",
                "created_at": row.created_at.isoformat() if row.created_at else None,
            })
    return {"leave_ids": leave_ids, "wfh_ids": wfh_ids, "on_behalf": on_behalf}
