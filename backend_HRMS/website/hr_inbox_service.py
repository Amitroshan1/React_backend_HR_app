"""Aggregate pending HR work items for unified inbox."""
from __future__ import annotations

from datetime import date, timedelta

from . import db
from .datetime_utils import isoformat_api
from .models.Admin_models import Admin
from .models.attendance import LeaveApplication, WorkFromHomeApplication
from .models.probation import ProbationReview
from .models.seperation import NocDepartmentRequest
from .offboarding_service import build_offboarding_dashboard
from .probation_api import _serialize_probation_review, infer_status_from_row
from .probation_utils import TERMINAL_STATUSES, is_probation_review_row_active


def _enabled_non_exited_admin_filters():
    from sqlalchemy import or_

    return (
        or_(Admin.is_exited == False, Admin.is_exited.is_(None)),
        or_(Admin.is_active == True, Admin.is_active.is_(None)),
    )


def _inbox_employee_fields(admin) -> dict:
    if not admin:
        return {}
    return {
        "employee_email": admin.email,
        "circle": admin.circle,
        "emp_type": admin.emp_type,
    }


def build_hr_inbox(*, hr_admin) -> dict:
    """Build unified HR inbox summary and items."""
    from .noc_department_service import list_noc_requests

    today = date.today()
    items: list[dict] = []

    # Probation awaiting HR decision
    probation_rows = (
        ProbationReview.query.order_by(
            ProbationReview.probation_end_date.asc(),
            ProbationReview.id.asc(),
        ).all()
    )
    probation_count = 0
    for row in probation_rows:
        admin = row.admin or Admin.query.get(row.admin_id)
        status = infer_status_from_row(row)
        if status in TERMINAL_STATUSES:
            continue
        if not is_probation_review_row_active(row, admin, today):
            continue
        serialized = _serialize_probation_review(row, run_date=today)
        if not serialized.get("awaiting_hr_decision"):
            continue
        probation_count += 1
        items.append(
            {
                "type": "probation",
                "id": f"probation-{row.id}",
                "ref_id": row.id,
                "admin_id": row.admin_id,
                "title": f"Probation decision — {serialized.get('employee_name') or 'Employee'}",
                "subtitle": f"Ends {serialized.get('probation_end_date') or '—'}",
                "employee_name": serialized.get("employee_name"),
                "emp_id": serialized.get("emp_id"),
                "due_at": serialized.get("probation_end_date"),
                "priority": "high" if serialized.get("overdue") else "normal",
                "deep_link_view": "probation_reviews",
                "deep_link_employee_tab": "offboarding",
                "created_at": serialized.get("reviewed_at") or serialized.get("reminder_sent_at"),
                **_inbox_employee_fields(admin),
            }
        )

    # HR NOC pending
    noc_rows = list_noc_requests("hr", hr_admin, "Pending")
    noc_count = len(noc_rows)
    for row in noc_rows:
        items.append(
            {
                "type": "noc",
                "id": f"noc-{row.get('id')}",
                "ref_id": row.get("id"),
                "admin_id": row.get("admin_id"),
                "title": f"NOC clearance — {row.get('employee_name') or 'Employee'}",
                "subtitle": row.get("department_key") or "HR",
                "employee_name": row.get("employee_name"),
                "emp_id": row.get("emp_id"),
                "due_at": row.get("requested_at"),
                "priority": "high" if row.get("sla_overdue") else "normal",
                "deep_link_view": "noc_requests",
                "created_at": row.get("requested_at"),
            }
        )

    # Exit pipeline (active separations)
    offboarding = build_offboarding_dashboard()
    pipeline = offboarding.get("pipeline") or []
    exit_count = 0
    for row in pipeline:
        status = (row.get("status") or "").strip().lower()
        if status not in ("initiated", "notice", "clearance", "ready"):
            continue
        exit_count += 1
        items.append(
            {
                "type": "exit",
                "id": f"exit-{row.get('admin_id')}",
                "ref_id": row.get("admin_id"),
                "admin_id": row.get("admin_id"),
                "title": f"Separation — {row.get('name') or 'Employee'}",
                "subtitle": row.get("status_label") or status.title(),
                "employee_name": row.get("name"),
                "emp_id": row.get("emp_id"),
                "due_at": row.get("last_working_day"),
                "priority": "normal",
                "deep_link_view": "offboarding_dashboard",
                "created_at": row.get("resignation_date"),
            }
        )

    # Leave / WFH pending (HR override queue)
    leave_count = 0
    leave_q = (
        LeaveApplication.query.join(Admin, LeaveApplication.admin_id == Admin.id)
        .filter(db.func.lower(LeaveApplication.status) == "pending")
        .order_by(LeaveApplication.created_at.desc())
        .limit(100)
        .all()
    )
    for row in leave_q:
        leave_count += 1
        admin = row.admin
        items.append(
            {
                "type": "leave",
                "id": f"leave-{row.id}",
                "ref_id": row.id,
                "admin_id": row.admin_id,
                "title": f"Leave pending — {admin.first_name if admin else 'Employee'}",
                "subtitle": f"{row.leave_type or 'Leave'} • {row.start_date} to {row.end_date}",
                "employee_name": admin.first_name if admin else None,
                "emp_id": admin.emp_id if admin else None,
                "due_at": row.start_date.isoformat() if row.start_date else None,
                "priority": "normal",
                "deep_link_view": "leave_updation",
                "deep_link_employee_tab": "leave",
                "deep_link_filters": {
                    "status": "pending",
                    "request_type": "leave",
                    "ref_id": f"leave-{row.id}",
                    "admin_id": row.admin_id,
                },
                "created_at": isoformat_api(row.created_at),
                **_inbox_employee_fields(admin),
            }
        )

    wfh_q = (
        WorkFromHomeApplication.query.join(Admin, WorkFromHomeApplication.admin_id == Admin.id)
        .filter(db.func.lower(WorkFromHomeApplication.status) == "pending")
        .order_by(WorkFromHomeApplication.created_at.desc())
        .limit(100)
        .all()
    )
    for row in wfh_q:
        leave_count += 1
        admin = row.admin
        items.append(
            {
                "type": "leave",
                "id": f"wfh-{row.id}",
                "ref_id": row.id,
                "admin_id": row.admin_id,
                "title": f"WFH pending — {admin.first_name if admin else 'Employee'}",
                "subtitle": f"WFH • {row.start_date} to {row.end_date}",
                "employee_name": admin.first_name if admin else None,
                "emp_id": admin.emp_id if admin else None,
                "due_at": row.start_date.isoformat() if row.start_date else None,
                "priority": "normal",
                "deep_link_view": "leave_updation",
                "deep_link_employee_tab": "leave",
                "deep_link_filters": {
                    "status": "pending",
                    "request_type": "wfh",
                    "ref_id": f"wfh-{row.id}",
                    "admin_id": row.admin_id,
                },
                "created_at": isoformat_api(row.created_at),
                **_inbox_employee_fields(admin),
            }
        )

    from .models.salary_revision_request import SalaryRevisionRequest

    salary_rows = (
        SalaryRevisionRequest.query.filter_by(status="pending")
        .order_by(SalaryRevisionRequest.created_at.asc())
        .limit(100)
        .all()
    )
    salary_pending = len(salary_rows)
    for row in salary_rows:
        admin = row.admin or Admin.query.get(row.admin_id)
        rev_type = (row.revision_type or "probation").replace("_", " ").title()
        items.append(
            {
                "type": "salary_revision",
                "id": f"salary-rev-{row.id}",
                "ref_id": row.id,
                "admin_id": row.admin_id,
                "title": f"Salary revision — {admin.first_name if admin else 'Employee'}",
                "subtitle": f"{rev_type} • pending Accounts action",
                "employee_name": admin.first_name if admin else None,
                "emp_id": admin.emp_id if admin else None,
                "due_at": row.effective_from.isoformat() if row.effective_from else None,
                "priority": "normal",
                "deep_link_view": "employee_360",
                "deep_link_employee_tab": "payroll",
                "created_at": isoformat_api(row.created_at),
                **_inbox_employee_fields(admin),
            }
        )

    items.sort(key=lambda x: (x.get("priority") != "high", x.get("due_at") or "", x.get("created_at") or ""))

    return {
        "summary": {
            "probation": probation_count,
            "noc_pending": noc_count,
            "exit_pipeline": exit_count,
            "leave_pending": leave_count,
            "salary_revision": salary_pending,
            "total": probation_count + noc_count + exit_count + leave_count + salary_pending,
        },
        "items": items[:200],
    }
