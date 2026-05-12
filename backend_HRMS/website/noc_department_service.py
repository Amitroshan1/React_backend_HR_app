"""
Shared list/upload/download logic for per-department NOC clearance rows (NocDepartmentRequest).
Scopes: manager | hr | accounts | it
"""

import os
from datetime import datetime

from flask import current_app
from sqlalchemy.orm import joinedload
from werkzeug.utils import secure_filename

from . import db
from .models.Admin_models import Admin
from .models.seperation import NocDepartmentRequest, Resignation

NOC_DEPT_LABELS = {
    "HR": "Human Resource",
    "ACCOUNTS": "Accounts",
    "MANAGER": "Reporting Manager",
    "IT": "IT Department",
}


def _norm(value):
    return (value or "").strip().lower()


def _serialize_date(value):
    return value.isoformat() if value and hasattr(value, "isoformat") else None


def _serialize_datetime(value):
    if value is None:
        return None
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return str(value)


def _display_name_for_admin(admin_row):
    if not admin_row:
        return "Unknown"
    emp = getattr(admin_row, "employee_details", None)
    if emp and (getattr(emp, "name", None) or "").strip():
        return (emp.name or "").strip()
    parts = [
        (getattr(admin_row, "first_name", None) or "").strip(),
        (getattr(admin_row, "user_name", None) or "").strip(),
    ]
    for p in parts:
        if p:
            return p
    email = (getattr(admin_row, "email", None) or "").strip()
    return email.split("@")[0] if email else "Unknown"


def _resignation_terminal_invalidates_pending_noc(res_status):
    """Employee revoked resignation, or reporting manager rejected it."""
    return (res_status or "").strip().lower() in ("revoked", "rejected")


def _effective_noc_row_status(noc_row, resignation):
    raw = (noc_row.status or "").strip() or "Pending"
    rs = (getattr(resignation, "status", None) or "").strip().lower() if resignation else ""
    if raw.lower() == "pending" and _resignation_terminal_invalidates_pending_noc(rs):
        return "Rejected"
    return raw


def reject_pending_noc_rows_for_resignation(resignation_id):
    """When resignation is Revoked or manager-rejected, cancel Pending department NOC lines."""
    if resignation_id is None:
        return 0
    n = 0
    rows = NocDepartmentRequest.query.filter_by(resignation_id=resignation_id).all()
    for row in rows:
        if (row.status or "").strip().lower() == "pending":
            row.status = "Rejected"
            n += 1
    return n


def _peer_noc_statuses_by_department(row):
    """Statuses of all NOC line items for this employee + resignation (HR / Accounts / IT / Manager)."""
    if not row or not getattr(row, "resignation_id", None):
        return {}
    res = getattr(row, "resignation", None)
    if res is None and getattr(row, "resignation_id", None):
        res = Resignation.query.get(row.resignation_id)
    siblings = NocDepartmentRequest.query.filter(
        NocDepartmentRequest.admin_id == row.admin_id,
        NocDepartmentRequest.resignation_id == row.resignation_id,
    ).all()
    out = {}
    for s in siblings:
        k = (s.department_key or "").strip().upper()
        if k:
            out[k] = _effective_noc_row_status(s, res)
    return out


def serialize_noc_row(row):
    emp = row.employee
    res = row.resignation
    dk = (row.department_key or "").strip().upper()
    fn = None
    if row.file_path:
        fn = os.path.basename(row.file_path)
    eff_status = _effective_noc_row_status(row, res)
    return {
        "id": row.id,
        "department_key": dk,
        "department_label": NOC_DEPT_LABELS.get(dk, dk),
        "noc_date": _serialize_date(row.noc_date),
        "requested_at": _serialize_datetime(row.requested_at),
        "status": eff_status,
        "employee_name": _display_name_for_admin(emp),
        "employee_email": getattr(emp, "email", None),
        "emp_id": getattr(emp, "emp_id", None),
        "circle": getattr(emp, "circle", None),
        "emp_type": getattr(emp, "emp_type", None),
        "resignation_date": _serialize_date(res.resignation_date) if res else None,
        "resignation_reason": (res.reason if res else None) or "",
        "resignation_status": (getattr(res, "status", None) or "").strip() if res else None,
        "filename": fn,
        "noc_status_by_department": _peer_noc_statuses_by_department(row),
    }


def _can_access_row(scope, approver, row):
    """scope: manager | hr | accounts | it"""
    if not approver or not row:
        return False
    emp = row.employee
    if not emp:
        return False
    dk = (row.department_key or "").strip().upper()
    if scope == "manager":
        if dk != "MANAGER":
            return False
        from .manager import _is_manager_for_target

        return _is_manager_for_target(approver, emp)
    if scope == "hr":
        if dk != "HR":
            return False
        et = _norm(approver.emp_type or "")
        return et in ("human resource", "human resources", "hr")
    if scope == "accounts":
        if dk != "ACCOUNTS":
            return False
        et = _norm(approver.emp_type or "")
        return et in ("account", "accounts", "accountant")
    if scope == "it":
        if dk != "IT":
            return False
        et = " ".join(_norm(approver.emp_type or "").split())
        return et in ("it", "it department", "information technology")
    return False


def _status_matches_filter(row, sl):
    res = getattr(row, "resignation", None)
    st = _effective_noc_row_status(row, res)
    if sl in ("all", ""):
        return True
    if sl == "pending" and st != "Pending":
        return False
    if sl in ("approved", "uploaded") and st != "Uploaded":
        return False
    if sl == "rejected" and st != "Rejected":
        return False
    return True


def list_noc_requests(scope, approver, status_raw):
    status_raw = (status_raw or "All").strip()
    sl = status_raw.lower()

    rows = (
        NocDepartmentRequest.query.options(
            joinedload(NocDepartmentRequest.employee),
            joinedload(NocDepartmentRequest.resignation),
        )
        .order_by(NocDepartmentRequest.requested_at.desc(), NocDepartmentRequest.id.desc())
        .all()
    )
    items = []
    for row in rows:
        if not _can_access_row(scope, approver, row):
            continue
        if not _status_matches_filter(row, sl):
            continue
        items.append(serialize_noc_row(row))
    return items


def _get_row_for_mutation(req_id):
    return (
        NocDepartmentRequest.query.options(
            joinedload(NocDepartmentRequest.employee),
            joinedload(NocDepartmentRequest.resignation),
        ).get(req_id)
    )


def upload_noc_document(scope, approver, req_id, file_storage):
    row = _get_row_for_mutation(req_id)
    if not row:
        return {"success": False, "message": "NOC request not found", "http": 404}
    if not _can_access_row(scope, approver, row):
        return {"success": False, "message": "Not allowed for this request", "http": 403}
    res = row.resignation
    if res and _resignation_terminal_invalidates_pending_noc(res.status):
        return {
            "success": False,
            "message": "Upload not allowed: resignation was withdrawn or rejected.",
            "http": 409,
        }
    if (row.status or "").strip() != "Pending":
        return {"success": False, "message": "Upload not allowed for this status", "http": 409}
    if not file_storage or not file_storage.filename:
        return {"success": False, "message": "No file provided", "http": 400}

    upload_dir = os.path.join(current_app.root_path, "static", "uploads", "noc_department")
    os.makedirs(upload_dir, exist_ok=True)
    safe_base = secure_filename(file_storage.filename)
    prefix = f"{row.admin_id}_{req_id}_{datetime.now().strftime('%Y%m%d_%H%M%S')}_"
    filename = prefix + safe_base
    abs_path = os.path.join(upload_dir, filename)
    file_storage.save(abs_path)
    rel_path = f"noc_department/{filename}"

    row.file_path = rel_path
    row.status = "Uploaded"
    row.uploaded_at = datetime.now()
    row.uploaded_by_admin_id = approver.id
    db.session.commit()

    return {
        "success": True,
        "message": "NOC document uploaded",
        "request": serialize_noc_row(row),
        "http": 200,
    }


def download_noc_document(scope, approver, req_id):
    row = (
        NocDepartmentRequest.query.options(
            joinedload(NocDepartmentRequest.employee),
            joinedload(NocDepartmentRequest.resignation),
        ).get(req_id)
    )
    if not row or not row.file_path:
        return {"success": False, "message": "File not found", "http": 404}
    if not _can_access_row(scope, approver, row):
        return {"success": False, "message": "Not allowed", "http": 403}

    # HR-only: block download until reporting manager approves resignation (other scopes may download once uploaded).
    if scope == "hr":
        res = row.resignation
        res_status = (getattr(res, "status", None) or "").strip().lower()
        if res_status != "approved":
            return {
                "success": False,
                "message": "Download is available only after the resignation is approved by the reporting manager.",
                "http": 403,
            }

    full_path = os.path.join(current_app.root_path, "static", "uploads", row.file_path)
    if not os.path.isfile(full_path):
        return {"success": False, "message": "File missing on server", "http": 404}

    return {
        "success": True,
        "path": full_path,
        "download_name": os.path.basename(row.file_path),
    }
