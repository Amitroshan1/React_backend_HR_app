"""HR Offboarding: separation request list, detail, and Admin exit submit."""
from __future__ import annotations

import os
from datetime import date
from typing import Optional

from flask import current_app
from sqlalchemy.orm import joinedload

from . import db
from .datetime_utils import isoformat_api, utc_now
from .models.Admin_models import Admin
from .models.employee_profile_change import EmployeeProfileChangeRequest
from .models.seperation import NocApplicationRequest, NocDepartmentRequest, Resignation
from .noc_department_service import (
    NOC_DEPT_LABELS,
    _effective_noc_row_status,
    upload_noc_document,
)
from .tenant_context import admin_tenant_clause, tenant_id_for_admin


NOC_DONE_STATUSES = frozenset({"uploaded", "approved", "cleared", "completed"})


def _norm(value) -> str:
    return (value or "").strip().lower()


def _display_name(admin: Optional[Admin]) -> str:
    if not admin:
        return "Unknown"
    return (getattr(admin, "first_name", None) or "").strip() or (admin.email or "Unknown")


def _serialize_date(value):
    return value.isoformat() if value and hasattr(value, "isoformat") else None


def _pending_exit_request(admin: Admin):
    if not admin:
        return None
    return (
        EmployeeProfileChangeRequest.query.filter_by(
            tenant_id=tenant_id_for_admin(admin),
            employee_admin_id=admin.id,
            request_type="exit",
            status="pending",
        )
        .order_by(EmployeeProfileChangeRequest.id.desc())
        .first()
    )


def _noc_rows_for_resignation(resignation: Resignation):
    return (
        NocDepartmentRequest.query.filter_by(
            admin_id=resignation.admin_id,
            resignation_id=resignation.id,
        )
        .order_by(NocDepartmentRequest.id.asc())
        .all()
    )


def _exit_noc_application(resignation: Resignation):
    """Latest 'No dues clearance (Exit)' application linked to this separation, if any."""
    try:
        return (
            NocApplicationRequest.query.filter_by(
                admin_id=resignation.admin_id,
                separation_id=resignation.id,
                request_type="exit_no_dues",
            )
            .order_by(NocApplicationRequest.id.desc())
            .first()
        )
    except Exception:
        return None


def _noc_applied(resignation: Resignation, rows=None, application=None) -> bool:
    """True when employee applied for exit NOC (or legacy dept rows already exist)."""
    if application is not None:
        return True
    rows = rows if rows is not None else _noc_rows_for_resignation(resignation)
    return bool(rows)


def _serialize_noc_application(application, noc_items=None) -> Optional[dict]:
    if application is None:
        return None
    return {
        "id": application.id,
        "request_type": application.request_type,
        "request_label": "No dues clearance (Exit)",
        "status": application.status,
        "details": application.details or "",
        "created_at": isoformat_api(application.created_at) if application.created_at else None,
        "department_labels": [n.get("department_label") for n in (noc_items or [])],
    }


def _noc_all_uploaded(resignation: Resignation, rows=None) -> bool:
    rows = rows if rows is not None else _noc_rows_for_resignation(resignation)
    if not rows:
        return False
    for row in rows:
        st = _norm(_effective_noc_row_status(row, resignation))
        if st not in NOC_DONE_STATUSES:
            return False
    return True


def _compute_hr_bucket(resignation: Resignation, admin: Admin, rows=None, noc_applied=None) -> str:
    """Filter bucket for HR separation list."""
    if getattr(admin, "is_exited", False):
        return "exited"
    status = _norm(resignation.status)
    if status == "revoked":
        return "revoked"
    if status == "rejected":
        return "manager_rejected"
    if status == "pending":
        return "pending_manager"
    if _pending_exit_request(admin):
        return "pending_admin"
    rows = rows if rows is not None else _noc_rows_for_resignation(resignation)
    if status == "approved":
        applied = _noc_applied(resignation, rows) if noc_applied is None else noc_applied
        if not applied:
            return "ready_for_admin"
        if _noc_all_uploaded(resignation, rows):
            return "ready_for_admin"
        return "noc_pending"
    return "all"


def _serialize_noc_for_hr(row: NocDepartmentRequest, resignation: Resignation) -> dict:
    dk = (row.department_key or "").strip().upper()
    eff = _effective_noc_row_status(row, resignation)
    has_file = bool(row.file_path)
    return {
        "id": row.id,
        "department_key": dk,
        "department_label": NOC_DEPT_LABELS.get(dk, dk),
        "status": eff,
        "has_file": has_file,
        "filename": os.path.basename(row.file_path) if has_file else None,
        "requested_at": isoformat_api(row.requested_at) if row.requested_at else None,
        "uploaded_at": isoformat_api(row.uploaded_at) if row.uploaded_at else None,
        "can_upload": dk == "HR" and _norm(eff) == "pending",
        "can_download": has_file,
    }


def serialize_separation_list_item(resignation: Resignation) -> dict:
    admin = resignation.admin or Admin.query.get(resignation.admin_id)
    rows = _noc_rows_for_resignation(resignation)
    application = _exit_noc_application(resignation)
    noc_applied = _noc_applied(resignation, rows, application)
    bucket = (
        _compute_hr_bucket(resignation, admin, rows, noc_applied=noc_applied)
        if admin
        else "all"
    )
    uploaded = sum(
        1 for r in rows if _norm(_effective_noc_row_status(r, resignation)) in NOC_DONE_STATUSES
    )
    pending_exit = _pending_exit_request(admin) if admin else None
    return {
        "resignation_id": resignation.id,
        "admin_id": resignation.admin_id,
        "employee_name": _display_name(admin),
        "employee_email": getattr(admin, "email", None) if admin else None,
        "emp_id": getattr(admin, "emp_id", None) if admin else None,
        "circle": getattr(admin, "circle", None) if admin else None,
        "emp_type": getattr(admin, "emp_type", None) if admin else None,
        "resignation_date": _serialize_date(resignation.resignation_date),
        "reason": (resignation.reason or "")[:240],
        "manager_status": (resignation.status or "").strip() or "Pending",
        "applied_on": isoformat_api(resignation.applied_on) if resignation.applied_on else None,
        "noc_total": len(rows),
        "noc_uploaded": uploaded,
        "noc_applied": noc_applied,
        "noc_not_applied": not noc_applied,
        "noc_application_id": application.id if application else None,
        "noc_message": None if noc_applied else "Not applied for NOC",
        "bucket": bucket,
        "is_exited": bool(getattr(admin, "is_exited", False)) if admin else False,
        "pending_admin_exit": bool(pending_exit),
        "pending_exit_request_id": pending_exit.id if pending_exit else None,
        "ready_for_admin": bucket == "ready_for_admin",
    }


def serialize_separation_detail(resignation: Resignation) -> dict:
    admin = resignation.admin or Admin.query.get(resignation.admin_id)
    rows = _noc_rows_for_resignation(resignation)
    item = serialize_separation_list_item(resignation)
    noc_items = [_serialize_noc_for_hr(r, resignation) for r in rows]
    application = _exit_noc_application(resignation)
    pending_exit = _pending_exit_request(admin) if admin else None
    ready = item["bucket"] == "ready_for_admin"
    return {
        **item,
        "reason": resignation.reason or "",
        "hr_remarks": getattr(resignation, "hr_remarks", None) or "",
        "noc_items": noc_items,
        "noc_application": _serialize_noc_application(application, noc_items),
        "manager_approved": _norm(resignation.status) == "approved",
        "all_nocs_uploaded": _noc_all_uploaded(resignation, rows) if item["noc_applied"] else False,
        "can_submit_to_admin": ready,
        "submit_blocked_reason": (
            None
            if ready
            else (
                "Employee already exited."
                if item["bucket"] == "exited"
                else "Exit already waiting for Admin approval."
                if item["bucket"] == "pending_admin"
                else "Waiting for manager to approve the resignation."
                if item["bucket"] == "pending_manager"
                else "Manager rejected this resignation."
                if item["bucket"] == "manager_rejected"
                else "Resignation was revoked."
                if item["bucket"] == "revoked"
                else "All selected department NOCs must be uploaded before submitting to Admin."
                if item["bucket"] == "noc_pending"
                else "Not ready to submit to Admin."
            )
        ),
        "pending_exit": (
            {
                "id": pending_exit.id,
                "created_at": isoformat_api(pending_exit.created_at) if pending_exit.created_at else None,
                "requested_by_name": pending_exit.requested_by_name,
            }
            if pending_exit
            else None
        ),
        "exit_preview": {
            "exit_type": "Resigned",
            "exit_date": _serialize_date(resignation.resignation_date) or date.today().isoformat(),
            "last_working_day": _serialize_date(resignation.resignation_date) or date.today().isoformat(),
            "resignation_date": _serialize_date(resignation.resignation_date),
        },
    }


def list_separations(*, status_filter: str = "all") -> dict:
    status_filter = _norm(status_filter) or "all"
    rows = (
        Resignation.query.options(joinedload(Resignation.admin))
        .join(Admin, Resignation.admin_id == Admin.id)
        .filter(admin_tenant_clause())
        .order_by(Resignation.applied_on.desc(), Resignation.id.desc())
        .limit(500)
        .all()
    )
    items = [serialize_separation_list_item(r) for r in rows]
    counts = {
        "all": len(items),
        "pending_manager": 0,
        "manager_approved": 0,
        "manager_rejected": 0,
        "noc_pending": 0,
        "ready_for_admin": 0,
        "pending_admin": 0,
        "exited": 0,
        "revoked": 0,
        "needs_attention": 0,
    }
    for item in items:
        b = item.get("bucket") or "all"
        if b in counts:
            counts[b] += 1
        if b == "ready_for_admin" or b == "noc_pending" or b == "pending_manager":
            counts["needs_attention"] += 1
        # manager_approved is useful as Approved and not yet exited/pending admin
        if b in ("noc_pending", "ready_for_admin", "pending_admin"):
            counts["manager_approved"] += 1

    if status_filter in ("all", ""):
        filtered = items
    elif status_filter == "manager_approved":
        filtered = [i for i in items if i["bucket"] in ("noc_pending", "ready_for_admin", "pending_admin")]
    elif status_filter == "needs_attention":
        filtered = [
            i for i in items if i["bucket"] in ("pending_manager", "noc_pending", "ready_for_admin")
        ]
    else:
        filtered = [i for i in items if i.get("bucket") == status_filter]

    return {"success": True, "separations": filtered, "summary": counts, "filter": status_filter}


def get_separation(resignation_id: int) -> tuple[Optional[dict], Optional[str], int]:
    row = (
        Resignation.query.options(joinedload(Resignation.admin))
        .join(Admin, Resignation.admin_id == Admin.id)
        .filter(admin_tenant_clause(), Resignation.id == int(resignation_id))
        .first()
    )
    if not row:
        return None, "Separation request not found.", 404
    return serialize_separation_detail(row), None, 200


def download_separation_noc(resignation_id: int, noc_req_id: int, hr_admin: Admin):
    """HR may download any department NOC file for a separation in their tenant."""
    resignation = (
        Resignation.query.join(Admin, Resignation.admin_id == Admin.id)
        .filter(admin_tenant_clause(), Resignation.id == int(resignation_id))
        .first()
    )
    if not resignation:
        return {"success": False, "message": "Separation not found", "http": 404}

    row = NocDepartmentRequest.query.filter_by(
        id=int(noc_req_id),
        resignation_id=resignation.id,
    ).first()
    if not row or not row.file_path:
        return {"success": False, "message": "NOC file not found", "http": 404}

    if tenant_id_for_admin(resignation.admin) != tenant_id_for_admin(hr_admin):
        return {"success": False, "message": "Not allowed", "http": 403}

    full_path = os.path.join(current_app.root_path, "static", "uploads", row.file_path)
    if not os.path.isfile(full_path):
        return {"success": False, "message": "File missing on server", "http": 404}

    return {
        "success": True,
        "path": full_path,
        "download_name": os.path.basename(row.file_path),
        "http": 200,
    }


def upload_hr_noc(resignation_id: int, hr_admin: Admin, file_storage):
    resignation = (
        Resignation.query.join(Admin, Resignation.admin_id == Admin.id)
        .filter(admin_tenant_clause(), Resignation.id == int(resignation_id))
        .first()
    )
    if not resignation:
        return {"success": False, "message": "Separation not found", "http": 404}

    row = NocDepartmentRequest.query.filter_by(
        resignation_id=resignation.id,
        department_key="HR",
    ).first()
    if not row:
        return {
            "success": False,
            "message": "No HR NOC was requested for this separation.",
            "http": 404,
        }
    return upload_noc_document("hr", hr_admin, row.id, file_storage)


def submit_separation_exit_to_admin(
    resignation_id: int,
    hr_admin: Admin,
    *,
    remarks: str = "",
    exit_date: Optional[date] = None,
    last_working_day: Optional[date] = None,
    force_override: bool = False,
    force_override_reason: str = "",
) -> tuple[Optional[dict], Optional[str], int]:
    """Stage Admin exit request when manager approved and all NOCs uploaded."""
    from .employee_profile_change_service import pending_request_message, stage_action_request
    from .offboarding_service import parse_exit_type, validate_employee_exit

    detail, err, code = get_separation(resignation_id)
    if err:
        return None, err, code
    if not detail.get("can_submit_to_admin"):
        return None, detail.get("submit_blocked_reason") or "Not ready to submit to Admin.", 400

    admin = Admin.query.get(detail["admin_id"])
    if not admin:
        return None, "Employee not found.", 404

    blocked = pending_request_message(admin)
    if blocked:
        return None, blocked, 400

    remarks_clean = (remarks or "").strip()
    if len(remarks_clean) < 10:
        return None, "Write HR remarks of at least 10 characters before submitting to Admin.", 400

    # Persist remarks on resignation when column exists.
    resignation = Resignation.query.get(int(resignation_id))
    if resignation is not None and hasattr(resignation, "hr_remarks"):
        resignation.hr_remarks = remarks_clean[:2000]

    exit_d = exit_date or resignation.resignation_date or date.today()
    lwd = last_working_day or exit_d
    exit_type = parse_exit_type("Resigned")
    exit_reason = (
        f"HR separation clearance complete. {remarks_clean}"
    )[:500]

    ok, message, checklist_payload = validate_employee_exit(
        admin,
        exit_type=exit_type,
        force_override=force_override,
        force_override_reason=force_override_reason,
    )
    if not ok:
        status = 409 if checklist_payload else 400
        body = {"success": False, "message": message}
        if checklist_payload:
            body["offboarding"] = checklist_payload
        return body, message, status

    if detail.get("noc_applied"):
        noc_summary = [
            {
                "department": n.get("department_label"),
                "status": n.get("status"),
                "has_file": n.get("has_file"),
            }
            for n in (detail.get("noc_items") or [])
        ]
    else:
        noc_summary = [
            {"department": "No dues clearance (Exit)", "status": "Not applied", "has_file": False}
        ]
    exit_payload = {
        "exit_type": exit_type,
        "exit_reason": exit_reason,
        "exit_date": exit_d.isoformat(),
        "last_working_day": lwd.isoformat(),
        "resignation_date": (
            resignation.resignation_date.isoformat() if resignation and resignation.resignation_date else None
        ),
        "notice_shortfall_days": 0,
        "force_override": bool(force_override),
        "force_override_reason": (force_override_reason or "").strip(),
        "source": "hr_separation_clearance",
        "resignation_id": resignation_id,
        "manager_status": detail.get("manager_status"),
        "hr_remarks": remarks_clean,
        "noc_summary": noc_summary,
    }

    from .approval_settings import approval_required, maybe_notify_bypass
    from .employee_profile_change_service import _apply_exit
    from .offboarding_service import send_exit_employee_notifications

    try:
        if not approval_required("exit"):
            performer = getattr(hr_admin, "email", None) or "HR"
            row = stage_action_request(admin, "exit", {}, exit_payload)
            exit_notice = _apply_exit(admin, row, performer)
            row.status = "approved"
            row.decided_at = utc_now()
            row.decision_note = "Applied immediately (Admin approval switch off)."
            db.session.commit()
            try:
                send_exit_employee_notifications(
                    admin,
                    exit_type=exit_notice.get("exit_type"),
                    last_working_day=exit_notice.get("last_working_day"),
                    exit_reason=exit_notice.get("exit_reason"),
                    hr_email=exit_notice.get("hr_email") or performer,
                    deferred_login=bool(exit_notice.get("deferred_login")),
                )
            except Exception as mail_err:
                current_app.logger.warning("Exit email failed after separation submit: %s", mail_err)
            maybe_notify_bypass("exit", f"HR exited {admin.email} from separation clearance.")
            return {
                "success": True,
                "pending_approval": False,
                "message": "Employee exit applied.",
                "detail": serialize_separation_detail(resignation),
            }, None, 200

        stage_action_request(admin, "exit", {}, exit_payload)
        db.session.commit()
        return {
            "success": True,
            "pending_approval": True,
            "message": (
                "Exit request sent to Admin with separation details. "
                "The employee stays active until Admin approves."
            ),
            "detail": serialize_separation_detail(resignation),
        }, None, 200
    except Exception as exc:
        db.session.rollback()
        current_app.logger.exception("submit_separation_exit_to_admin failed")
        return None, str(exc) or "Could not submit exit to Admin.", 500
