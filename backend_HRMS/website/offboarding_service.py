"""
Employee offboarding (Phase 1–2): unified status, checklist, exit sync, LWD jobs, dashboard.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Any, Optional

EXIT_TYPES = (
    "Resigned",
    "Terminated",
    "Absconded",
    "Retirement",
    "End of Contract",
)

OFFBOARDING_STATUS_LABELS = {
    "initiated": "Separation submitted",
    "notice": "Notice period",
    "clearance": "NOC clearance pending",
    "ready": "Ready to exit",
    "exited": "Exited",
    "fnf_settled": "F&F settled",
}

NOC_CLEARED_STATUSES = frozenset({"uploaded", "approved", "cleared", "completed"})
NOC_PENDING_STATUSES = frozenset({"pending"})
RESIGNATION_TERMINAL = frozenset({"rejected", "revoked", "completed"})


def _norm(value: Any) -> str:
    return str(value or "").strip().lower()


def noc_row_effective_status(raw_status: str, resignation_status: Optional[str]) -> str:
    status = _norm(raw_status) or "pending"
    res = _norm(resignation_status)
    if status == "pending" and res in ("revoked", "rejected"):
        return "rejected"
    return status


def noc_row_is_cleared(effective_status: str) -> bool:
    return _norm(effective_status) in NOC_CLEARED_STATUSES


def noc_row_is_pending(effective_status: str) -> bool:
    return _norm(effective_status) in NOC_PENDING_STATUSES


def compute_offboarding_status(
    *,
    is_exited: bool,
    resignation_status: Optional[str],
    has_resignation: bool,
    noc_total: int,
    noc_pending: int,
    fnf_latest_status: Optional[str],
) -> Optional[str]:
    """Return pipeline status or None if employee is not in offboarding."""
    if is_exited:
        fnf_st = _norm(fnf_latest_status)
        if fnf_st in ("finalized", "paid", "settled", "completed"):
            return "fnf_settled"
        return "exited"

    if not has_resignation:
        return None

    res_st = _norm(resignation_status)
    if res_st in ("rejected", "revoked"):
        return None
    if res_st == "pending":
        return "initiated"
    if res_st in ("approved", "completed"):
        if noc_total > 0:
            if noc_pending > 0:
                return "clearance"
            return "ready"
        return "notice"
    return "notice"


def build_exit_checklist(
    *,
    is_exited: bool,
    exit_type: str,
    resignation_status: Optional[str],
    has_resignation: bool,
    noc_total: int,
    noc_pending: int,
    unreturned_assets: int,
    pending_leave_count: int,
    pending_wfh_count: int,
    has_fnf_settlement: bool,
    fnf_latest_status: Optional[str],
    employee_exit_interview_submitted: bool = False,
    hr_interview_completed: bool = False,
) -> list[dict]:
    """Build checklist items with severity: hard | warning | info."""
    items: list[dict] = []

    if is_exited:
        items.append({
            "key": "already_exited",
            "severity": "hard",
            "label": "Employee is already marked as exited",
            "passed": False,
        })
        return items

    exit_t = _norm(exit_type) or "resigned"
    res_st = _norm(resignation_status)

    if exit_t == "resigned":
        if not has_resignation:
            items.append({
                "key": "no_resignation",
                "severity": "warning",
                "label": "No separation / resignation on file",
                "passed": False,
            })
        elif res_st == "pending":
            items.append({
                "key": "resignation_pending",
                "severity": "warning",
                "label": "Separation request is still pending manager approval",
                "passed": False,
            })
        elif res_st in ("rejected", "revoked"):
            items.append({
                "key": "resignation_inactive",
                "severity": "warning",
                "label": "Latest separation was rejected or revoked",
                "passed": False,
            })
        elif res_st == "approved":
            items.append({
                "key": "resignation_approved",
                "severity": "info",
                "label": "Separation approved",
                "passed": True,
            })

    if noc_total > 0:
        if noc_pending > 0:
            items.append({
                "key": "noc_pending",
                "severity": "hard",
                "label": f"{noc_pending} department NOC clearance(s) still pending",
                "passed": False,
            })
        else:
            items.append({
                "key": "noc_cleared",
                "severity": "info",
                "label": "All department NOC clearances completed",
                "passed": True,
            })
    else:
        items.append({
            "key": "noc_not_requested",
            "severity": "info",
            "label": "No department NOC requests on file (optional)",
            "passed": True,
        })

    if unreturned_assets > 0:
        items.append({
            "key": "assets_pending",
            "severity": "warning",
            "label": f"{unreturned_assets} IT asset(s) not marked returned",
            "passed": False,
        })

    if pending_leave_count > 0:
        items.append({
            "key": "leave_pending",
            "severity": "warning",
            "label": f"{pending_leave_count} leave request(s) still pending approval",
            "passed": False,
        })

    if pending_wfh_count > 0:
        items.append({
            "key": "wfh_pending",
            "severity": "warning",
            "label": f"{pending_wfh_count} WFH request(s) still pending approval",
            "passed": False,
        })

    if has_fnf_settlement:
        fnf_label = f"F&F settlement on file ({fnf_latest_status or 'draft'})"
        items.append({
            "key": "fnf_exists",
            "severity": "info",
            "label": fnf_label,
            "passed": True,
        })
    else:
        items.append({
            "key": "fnf_missing",
            "severity": "info",
            "label": "F&F not prepared yet (can be done in Accounts after exit)",
            "passed": True,
        })

    if employee_exit_interview_submitted:
        items.append({
            "key": "exit_interview_employee",
            "severity": "info",
            "label": "Employee exit interview feedback received",
            "passed": True,
        })
    else:
        items.append({
            "key": "exit_interview_employee",
            "severity": "warning",
            "label": "Employee exit interview feedback not submitted yet",
            "passed": False,
        })

    if hr_interview_completed:
        items.append({
            "key": "exit_interview_hr",
            "severity": "info",
            "label": "HR exit interview completed",
            "passed": True,
        })
    else:
        items.append({
            "key": "exit_interview_hr",
            "severity": "warning",
            "label": "HR exit interview not marked complete",
            "passed": False,
        })

    return items


def checklist_hard_blockers(checklist: list[dict]) -> list[dict]:
    return [i for i in checklist if i.get("severity") == "hard" and not i.get("passed")]


def checklist_can_exit_without_override(checklist: list[dict]) -> bool:
    return len(checklist_hard_blockers(checklist)) == 0


def parse_exit_type(raw: Any) -> str:
    val = str(raw or "").strip()
    for choice in EXIT_TYPES:
        if _norm(val) == _norm(choice):
            return choice
    return "Resigned"


def parse_iso_date(raw: Any, field_name: str) -> tuple[Optional[date], Optional[str]]:
    if not raw:
        return None, f"{field_name} is required"
    try:
        if isinstance(raw, date):
            return raw, None
        return datetime.fromisoformat(str(raw).strip()).date(), None
    except ValueError:
        return None, f"Invalid {field_name} format (YYYY-MM-DD)"


def admin_login_allowed(admin) -> bool:
    """Whether the employee may authenticate (login / session restore)."""
    if admin is None:
        return False
    if getattr(admin, "is_active", True) is False:
        return False
    if not getattr(admin, "is_exited", False):
        return True
    until = getattr(admin, "exit_login_until", None)
    if until and date.today() <= until:
        return True
    return False


def create_auto_fnf_draft_on_exit(
    admin_id: int,
    *,
    separation_date: date,
    last_working_day: date,
    notice_shortfall_days: int = 0,
) -> None:
    """Create a draft F&F settlement snapshot when HR processes exit."""
    from .models.fnf_settlement import FnfSettlement
    from .payroll_lifecycle_service import preview_fnf_settlement, save_fnf_settlement

    existing = (
        FnfSettlement.query.filter_by(admin_id=admin_id)
        .order_by(FnfSettlement.id.desc())
        .first()
    )
    if existing and (existing.status or "").strip().lower() in (
        "draft",
        "finalized",
        "paid",
        "settled",
        "completed",
    ):
        return

    preview = preview_fnf_settlement(
        admin_id,
        separation_date=separation_date,
        last_working_day=last_working_day,
        notice_recovery_days=float(notice_shortfall_days or 0),
    )
    snapshot = preview.get("settlement") or preview
    save_fnf_settlement(
        admin_id,
        separation_date=separation_date,
        last_working_day=last_working_day,
        snapshot=snapshot,
        note="Auto-created on employee exit",
        created_by_admin_id=None,
    )


def run_lwd_deactivation_job(run_date: Optional[date] = None) -> int:
    """Deactivate login for exited employees whose scheduled LWD has passed."""
    from . import db
    from .models.Admin_models import Admin, AuditLog

    today = run_date or date.today()
    rows = (
        Admin.query.filter(Admin.is_exited.is_(True))
        .filter(Admin.exit_login_until.isnot(None))
        .filter(Admin.exit_login_until < today)
        .all()
    )
    count = 0
    for admin in rows:
        admin.is_active = False
        admin.exit_login_until = None
        db.session.add(
            AuditLog(
                action="EMPLOYEE_LWD_DEACTIVATED",
                performed_by="scheduler",
                target_email=admin.email,
            )
        )
        count += 1
    return count


def _admin_display_name(admin) -> str:
    emp = getattr(admin, "employee_details", None)
    if emp and (getattr(emp, "name", None) or "").strip():
        return (emp.name or "").strip()
    return (
        (getattr(admin, "first_name", None) or "").strip()
        or (getattr(admin, "user_name", None) or "").strip()
        or (getattr(admin, "email", None) or "").strip()
        or "Unknown"
    )


NOC_SLA_DAYS = 5


def get_noc_sla_overdue_items(run_date: Optional[date] = None) -> list[dict]:
    """Department NOC requests pending longer than NOC_SLA_DAYS."""
    from datetime import time as dt_time
    from . import db
    from .models.seperation import NocDepartmentRequest

    today = run_date or date.today()
    cutoff = datetime.combine(today - timedelta(days=NOC_SLA_DAYS), dt_time.max)
    rows = (
        NocDepartmentRequest.query.filter(
            db.func.lower(db.func.coalesce(NocDepartmentRequest.status, "")) == "pending"
        )
        .filter(NocDepartmentRequest.requested_at.isnot(None))
        .filter(NocDepartmentRequest.requested_at <= cutoff)
        .order_by(NocDepartmentRequest.requested_at.asc())
        .all()
    )
    out = []
    for row in rows:
        res = row.resignation
        if not res:
            continue
        eff = noc_row_effective_status(row.status, getattr(res, "status", None))
        if not noc_row_is_pending(eff):
            continue
        emp = row.employee
        if not emp:
            from .models.Admin_models import Admin
            emp = Admin.query.get(row.admin_id)
        out.append(
            {
                "noc_id": row.id,
                "department_key": (row.department_key or "").strip().upper(),
                "employee_name": _admin_display_name(emp),
                "employee_email": getattr(emp, "email", None),
                "requested_at": row.requested_at.isoformat() if row.requested_at else None,
                "days_pending": (today - row.requested_at.date()).days if row.requested_at else None,
            }
        )
    return out


def build_exit_analytics(*, months: int = 12) -> dict:
    from . import db
    from .models.Admin_models import Admin, EmployeeExitHistory

    cutoff = date.today() - timedelta(days=max(1, months) * 31)
    rows = (
        db.session.query(EmployeeExitHistory, Admin)
        .join(Admin, Admin.id == EmployeeExitHistory.admin_id)
        .filter(EmployeeExitHistory.exit_date >= cutoff)
        .order_by(EmployeeExitHistory.exit_date.asc())
        .all()
    )

    by_month: dict[str, int] = {}
    by_type: dict[str, int] = {}
    by_circle: dict[str, int] = {}
    shortfall_total = 0
    shortfall_count = 0

    for hist, admin in rows:
        key = hist.exit_date.strftime("%Y-%m") if hist.exit_date else "unknown"
        by_month[key] = by_month.get(key, 0) + 1
        et = (hist.exit_type or "Unknown").strip()
        by_type[et] = by_type.get(et, 0) + 1
        circle = (admin.circle or "Unassigned").strip() or "Unassigned"
        by_circle[circle] = by_circle.get(circle, 0) + 1
        ns = int(hist.notice_shortfall_days or 0)
        if ns > 0:
            shortfall_total += ns
            shortfall_count += 1

    return {
        "period_months": months,
        "total_exits": len(rows),
        "by_month": [{"month": k, "count": v} for k, v in sorted(by_month.items())],
        "by_exit_type": [{"exit_type": k, "count": v} for k, v in sorted(by_type.items(), key=lambda x: -x[1])],
        "by_circle": [{"circle": k, "count": v} for k, v in sorted(by_circle.items(), key=lambda x: -x[1])],
        "avg_notice_shortfall_days": round(shortfall_total / shortfall_count, 1) if shortfall_count else 0,
        "employees_with_notice_shortfall": shortfall_count,
    }


def build_offboarding_dashboard() -> dict:
    from . import db
    from .models.Admin_models import Admin, EmployeeExitHistory

    today = date.today()
    week_end = today + timedelta(days=7)

    active_rows = (
        Admin.query.filter(db.func.coalesce(Admin.is_exited, False) == False)
        .order_by(Admin.first_name.asc(), Admin.id.asc())
        .all()
    )

    pipeline = []
    status_counts = {
        "initiated": 0,
        "notice": 0,
        "clearance": 0,
        "ready": 0,
    }

    for admin in active_rows:
        payload = build_offboarding_payload_for_admin(admin)
        status = payload.get("status")
        if not status:
            continue
        if status in status_counts:
            status_counts[status] += 1
        resignation = get_latest_resignation(admin.id)
        lwd = None
        if resignation and resignation.resignation_date:
            lwd = resignation.resignation_date
        pipeline.append(
            {
                "admin_id": admin.id,
                "emp_id": admin.emp_id,
                "name": _admin_display_name(admin),
                "email": admin.email,
                "circle": admin.circle,
                "emp_type": admin.emp_type,
                "status": status,
                "status_label": payload.get("status_label"),
                "resignation_date": payload.get("resignation_date"),
                "last_working_day": lwd.isoformat() if lwd else None,
                "noc_summary": payload.get("noc_summary"),
                "fnf_status": payload.get("fnf_status"),
            }
        )

    grace_rows = (
        Admin.query.filter(Admin.is_exited.is_(True))
        .filter(Admin.exit_login_until.isnot(None))
        .filter(Admin.exit_login_until >= today)
        .order_by(Admin.exit_login_until.asc())
        .all()
    )
    login_grace = [
        {
            "admin_id": a.id,
            "emp_id": a.emp_id,
            "name": _admin_display_name(a),
            "email": a.email,
            "circle": a.circle,
            "login_until": a.exit_login_until.isoformat() if a.exit_login_until else None,
            "exit_type": a.exit_type,
            "fnf_status": _norm(get_latest_fnf_status(a.id)) or "none",
        }
        for a in grace_rows
    ]

    lwd_subq = (
        db.session.query(
            EmployeeExitHistory.admin_id.label("admin_id"),
            db.func.max(EmployeeExitHistory.id).label("max_id"),
        )
        .group_by(EmployeeExitHistory.admin_id)
        .subquery()
    )
    lwd_rows = (
        db.session.query(EmployeeExitHistory, Admin)
        .join(lwd_subq, lwd_subq.c.max_id == EmployeeExitHistory.id)
        .join(Admin, Admin.id == EmployeeExitHistory.admin_id)
        .filter(EmployeeExitHistory.last_working_day.isnot(None))
        .filter(EmployeeExitHistory.last_working_day >= today)
        .filter(EmployeeExitHistory.last_working_day <= week_end)
        .order_by(EmployeeExitHistory.last_working_day.asc())
        .all()
    )
    lwd_this_week = [
        {
            "admin_id": admin.id,
            "emp_id": admin.emp_id,
            "name": _admin_display_name(admin),
            "email": admin.email,
            "circle": admin.circle,
            "last_working_day": hist.last_working_day.isoformat(),
            "is_exited": bool(admin.is_exited),
            "login_until": (
                admin.exit_login_until.isoformat() if getattr(admin, "exit_login_until", None) else None
            ),
        }
        for hist, admin in lwd_rows
    ]

    analytics = build_exit_analytics(months=12)
    sla_items = get_noc_sla_overdue_items(today)

    return {
        "summary": {
            **status_counts,
            "in_pipeline": sum(status_counts.values()),
            "login_grace_count": len(login_grace),
            "lwd_this_week_count": len(lwd_this_week),
            "exits_last_12_months": analytics.get("total_exits", 0),
            "noc_sla_overdue_count": len(sla_items),
        },
        "pipeline": pipeline,
        "login_grace": login_grace,
        "lwd_this_week": lwd_this_week,
        "analytics": analytics,
        "sla": {
            "noc_pending_days_threshold": NOC_SLA_DAYS,
            "noc_overdue": sla_items[:25],
        },
    }


def offboarding_summary_from_parts(
    *,
    is_exited: bool,
    resignation_status: Optional[str],
    resignation_date: Optional[date],
    has_resignation: bool,
    noc_total: int,
    noc_pending: int,
    noc_cleared: int,
    fnf_latest_status: Optional[str],
    can_exit: bool,
    checklist: list[dict],
) -> dict:
    status = compute_offboarding_status(
        is_exited=is_exited,
        resignation_status=resignation_status,
        has_resignation=has_resignation,
        noc_total=noc_total,
        noc_pending=noc_pending,
        fnf_latest_status=fnf_latest_status,
    )
    return {
        "status": status,
        "status_label": OFFBOARDING_STATUS_LABELS.get(status, "Not in separation") if status else "Not in separation",
        "resignation_status": resignation_status,
        "resignation_date": resignation_date.isoformat() if resignation_date else None,
        "noc_summary": {
            "total": noc_total,
            "pending": noc_pending,
            "cleared": noc_cleared,
        },
        "fnf_status": _norm(fnf_latest_status) or "none",
        "can_exit": can_exit,
        "hard_blocker_count": len(checklist_hard_blockers(checklist)),
        "checklist": checklist,
    }


# ---------------------------------------------------------------------------
# Database-backed helpers (import models lazily via callers passing session queries)
# ---------------------------------------------------------------------------

def get_latest_resignation(admin_id: int):
    from .models.seperation import Resignation

    return (
        Resignation.query.filter_by(admin_id=admin_id)
        .order_by(Resignation.id.desc())
        .first()
    )


def get_noc_stats_for_resignation(resignation_id: Optional[int], resignation_status: Optional[str]) -> tuple[int, int, int]:
    from .models.seperation import NocDepartmentRequest

    if not resignation_id:
        return 0, 0, 0
    rows = NocDepartmentRequest.query.filter_by(resignation_id=resignation_id).all()
    total = len(rows)
    pending = 0
    cleared = 0
    for row in rows:
        eff = noc_row_effective_status(row.status, resignation_status)
        if noc_row_is_pending(eff):
            pending += 1
        elif noc_row_is_cleared(eff):
            cleared += 1
    return total, pending, cleared


def get_latest_fnf_status(admin_id: int) -> Optional[str]:
    summary = get_latest_fnf_summary(admin_id)
    return summary.get("status") if summary else None


def get_latest_fnf_summary(admin_id: int) -> dict:
    from .models.fnf_settlement import FnfSettlement

    row = (
        FnfSettlement.query.filter_by(admin_id=admin_id)
        .order_by(FnfSettlement.id.desc())
        .first()
    )
    if not row:
        return {
            "status": "none",
            "settlement_id": None,
            "net_payable": None,
            "last_working_day": None,
            "separation_date": None,
        }
    return {
        "status": row.status,
        "settlement_id": row.id,
        "net_payable": float(row.net_payable or 0),
        "last_working_day": row.last_working_day.isoformat() if row.last_working_day else None,
        "separation_date": row.separation_date.isoformat() if row.separation_date else None,
    }


def count_unreturned_assets(admin_id: int) -> int:
    from .models.emp_detail_models import Asset

    return (
        Asset.query.filter_by(admin_id=admin_id)
        .filter(Asset.return_date.is_(None))
        .count()
    )


def count_pending_leave(admin_id: int) -> int:
    from .models.attendance import LeaveApplication

    return (
        LeaveApplication.query.filter_by(admin_id=admin_id)
        .filter(LeaveApplication.status == "Pending")
        .count()
    )


def count_pending_wfh(admin_id: int) -> int:
    from .models.attendance import WorkFromHomeApplication

    return (
        WorkFromHomeApplication.query.filter_by(admin_id=admin_id)
        .filter(WorkFromHomeApplication.status == "Pending")
        .count()
    )


def get_leave_balance_snapshot(admin_id: int) -> Optional[dict]:
    """Current PL/CL/comp balances for HR exit modal."""
    from .compoff_utils import get_effective_comp_balance
    from .models.attendance import LeaveBalance

    row = LeaveBalance.query.filter_by(admin_id=admin_id).first()
    if not row:
        return None
    return {
        "privilege_leave_balance": float(row.privilege_leave_balance or 0),
        "casual_leave_balance": float(row.casual_leave_balance or 0),
        "compensatory_leave_balance": float(get_effective_comp_balance(admin_id) or 0),
    }


def get_exit_interview_flags(admin_id: int) -> tuple[bool, bool]:
    from .models.exit_interview import ExitInterview

    row = ExitInterview.query.filter_by(admin_id=admin_id).first()
    if not row:
        return False, False
    return bool(row.submitted_at), bool(row.hr_interview_completed)


def build_offboarding_payload_for_admin(admin, exit_type: str = "Resigned") -> dict:
    if not admin:
        return {}
    is_exited = bool(getattr(admin, "is_exited", False))
    resignation = get_latest_resignation(admin.id)
    has_resignation = resignation is not None
    res_status = getattr(resignation, "status", None) if resignation else None
    res_date = getattr(resignation, "resignation_date", None) if resignation else None
    noc_total, noc_pending, noc_cleared = get_noc_stats_for_resignation(
        getattr(resignation, "id", None) if resignation else None,
        res_status,
    )
    fnf_status = get_latest_fnf_status(admin.id)
    has_fnf = fnf_status is not None
    emp_ei_submitted, hr_ei_done = get_exit_interview_flags(admin.id)

    checklist = build_exit_checklist(
        is_exited=is_exited,
        exit_type=exit_type,
        resignation_status=res_status,
        has_resignation=has_resignation,
        noc_total=noc_total,
        noc_pending=noc_pending,
        unreturned_assets=count_unreturned_assets(admin.id),
        pending_leave_count=count_pending_leave(admin.id),
        pending_wfh_count=count_pending_wfh(admin.id),
        has_fnf_settlement=has_fnf,
        fnf_latest_status=fnf_status,
        employee_exit_interview_submitted=emp_ei_submitted,
        hr_interview_completed=hr_ei_done,
    )
    can_exit = checklist_can_exit_without_override(checklist)

    return offboarding_summary_from_parts(
        is_exited=is_exited,
        resignation_status=res_status,
        resignation_date=res_date,
        has_resignation=has_resignation,
        noc_total=noc_total,
        noc_pending=noc_pending,
        noc_cleared=noc_cleared,
        fnf_latest_status=fnf_status,
        can_exit=can_exit,
        checklist=checklist,
    )


def create_employee_archive_snapshot(
    admin,
    *,
    last_working_day: date,
    exit_type: str,
    exit_reason: str,
    initiated_by: str,
) -> None:
    from . import db
    from .models.Admin_models import EmployeeArchive

    personal_email = None
    full_name = (getattr(admin, "first_name", None) or "").strip()
    emp_details = getattr(admin, "employee_details", None)
    if emp_details:
        if (getattr(emp_details, "name", None) or "").strip():
            full_name = (emp_details.name or "").strip()
        personal_email = (getattr(emp_details, "email", None) or "").strip() or None

    row = EmployeeArchive(
        admin_id=admin.id,
        full_name=full_name or (admin.email or "Unknown"),
        emp_id=getattr(admin, "emp_id", None),
        personal_email=personal_email or getattr(admin, "email", None),
        mobile=getattr(admin, "mobile", None),
        circle=getattr(admin, "circle", None),
        emp_type=getattr(admin, "emp_type", None),
        doj=getattr(admin, "doj", None),
        dol=last_working_day,
        exit_reason=exit_reason,
        exit_type=exit_type,
        exit_initiated_by=initiated_by,
    )
    from .exit_interview_service import default_rehire_eligible, default_rehire_cooldown_until

    row.rehire_eligible = default_rehire_eligible(exit_type)
    row.rehire_cooldown_until = default_rehire_cooldown_until(last_working_day)
    if not row.rehire_eligible:
        row.rehire_notes = "Auto-set: exit type not eligible for rehire by default"
    db.session.add(row)


def resolve_ex_employee_recipient_email(admin) -> Optional[str]:
    if not admin:
        return None
    emp_details = getattr(admin, "employee_details", None)
    if emp_details and (getattr(emp_details, "email", None) or "").strip():
        return (emp_details.email or "").strip()
    from .models.Admin_models import EmployeeArchive

    archive_row = (
        EmployeeArchive.query.filter_by(admin_id=admin.id)
        .order_by(EmployeeArchive.id.desc())
        .first()
    )
    if archive_row:
        pe = (getattr(archive_row, "personal_email", None) or "").strip()
        if pe and "@" in pe:
            return pe
    email = (getattr(admin, "email", None) or "").strip()
    return email if email and "@" in email else None


def send_relieving_letter_doc_share_on_exit(
    admin,
    *,
    created_by_admin_id: int | None = None,
) -> Optional[dict]:
    """Auto-send relieving letter via ex-employee secure document link."""
    from .relieving_letter_service import generate_relieving_letter_pdf
    from .ex_employee_share_service import create_ex_employee_doc_share_and_email

    recipient = resolve_ex_employee_recipient_email(admin)
    if not recipient:
        return None
    try:
        pdf_buffer = generate_relieving_letter_pdf(admin.id)
        pdf_bytes = pdf_buffer.getvalue()
    except Exception:
        return None
    if not pdf_bytes:
        return None

    display_name = f"Relieving-Letter-{(admin.emp_id or admin.id)}.pdf"
    ok, _msg, payload = create_ex_employee_doc_share_and_email(
        recipient_email=recipient,
        files=[(display_name, pdf_bytes)],
        created_by_admin_id=created_by_admin_id,
    )
    return payload if ok else None


def build_manager_team_offboarding(manager_admin) -> list[dict]:
    """Direct reports currently in separation / offboarding pipeline."""
    from . import db
    from .models.Admin_models import Admin
    from .manager_utils import is_manager_in_contact, resolve_manager_contact_for_employee

    if not manager_admin:
        return []

    rows = (
        Admin.query.filter(db.func.coalesce(Admin.is_exited, False) == False)
        .order_by(Admin.first_name.asc(), Admin.id.asc())
        .all()
    )
    out = []
    for admin in rows:
        if admin.id == manager_admin.id:
            continue
        contact = resolve_manager_contact_for_employee(admin)
        if not is_manager_in_contact(contact, manager_admin):
            continue
        payload = build_offboarding_payload_for_admin(admin)
        if not payload.get("status"):
            continue
        resignation = get_latest_resignation(admin.id)
        out.append(
            {
                "admin_id": admin.id,
                "emp_id": admin.emp_id,
                "name": _admin_display_name(admin),
                "email": admin.email,
                "circle": admin.circle,
                "status": payload.get("status"),
                "status_label": payload.get("status_label"),
                "resignation_date": payload.get("resignation_date"),
                "resignation_status": payload.get("resignation_status"),
                "noc_summary": payload.get("noc_summary"),
                "notice_end_date": (
                    (resignation.resignation_date + timedelta(days=90)).isoformat()
                    if resignation and resignation.resignation_date
                    else None
                ),
            }
        )
    return out


def complete_resignation_on_exit(admin_id: int) -> None:
    from .models.seperation import Resignation

    resignation = (
        Resignation.query.filter_by(admin_id=admin_id)
        .filter(Resignation.status == "Approved")
        .order_by(Resignation.id.desc())
        .first()
    )
    if resignation:
        resignation.status = "Completed"


def execute_employee_exit(
    admin,
    *,
    exit_type: str,
    exit_date: date,
    last_working_day: date,
    exit_reason: str,
    notice_shortfall_days: int,
    resignation_date: Optional[date],
    hr_email: str,
    force_override: bool,
    force_override_reason: str,
) -> tuple[bool, str, Optional[dict]]:
    """
    Validate checklist and mark employee exited.
    Returns (success, message, payload_or_none).
    """
    from . import db
    from .models.Admin_models import AuditLog, EmployeeExitHistory, Admin
    from .email import send_employee_exit_confirmation_email

    if getattr(admin, "is_exited", False):
        return False, "Employee already marked as exited", None

    checklist_payload = build_offboarding_payload_for_admin(admin, exit_type=exit_type)
    checklist = checklist_payload.get("checklist") or []
    hard_blockers = checklist_hard_blockers(checklist)

    if hard_blockers and not force_override:
        return False, "Exit blocked. Complete NOC clearances or use force override with reason.", checklist_payload

    if force_override:
        reason = (force_override_reason or "").strip()
        if len(reason) < 10:
            return False, "Force override requires a reason of at least 10 characters", checklist_payload

    today = date.today()
    deferred_login = last_working_day > today

    admin.is_exited = True
    admin.is_active = not deferred_login
    admin.exit_login_until = last_working_day if deferred_login else None
    admin.exit_date = last_working_day
    admin.exit_type = str(exit_type)[:30]
    admin.exit_reason = exit_reason

    exit_row = EmployeeExitHistory(
        admin_id=admin.id,
        exit_date=exit_date,
        exit_type=str(exit_type)[:30],
        exit_reason=exit_reason,
        created_by=hr_email,
        last_working_day=last_working_day,
        notice_shortfall_days=int(notice_shortfall_days or 0),
        resignation_date_snapshot=resignation_date,
        force_override=bool(force_override),
        force_override_reason=(force_override_reason or "").strip() or None,
    )
    db.session.add(exit_row)

    db.session.add(
        AuditLog(
            action="EMPLOYEE_EXITED",
            performed_by=hr_email,
            target_email=admin.email,
        )
    )

    complete_resignation_on_exit(admin.id)
    create_employee_archive_snapshot(
        admin,
        last_working_day=last_working_day,
        exit_type=exit_type,
        exit_reason=exit_reason,
        initiated_by=hr_email,
    )

    db.session.flush()

    try:
        create_auto_fnf_draft_on_exit(
            admin.id,
            separation_date=resignation_date or exit_date,
            last_working_day=last_working_day,
            notice_shortfall_days=int(notice_shortfall_days or 0),
        )
    except Exception:
        pass

    doc_share_payload = None
    try:
        created_by_id = None
        hr_admin = Admin.query.filter_by(email=hr_email).first() if hr_email else None
        if hr_admin:
            created_by_id = hr_admin.id
        doc_share_payload = send_relieving_letter_doc_share_on_exit(
            admin,
            created_by_admin_id=created_by_id,
        )
    except Exception:
        pass

    try:
        send_employee_exit_confirmation_email(
            admin,
            exit_type=exit_type,
            last_working_day=last_working_day,
            exit_reason=exit_reason,
            login_deferred=deferred_login,
            doc_link=(doc_share_payload or {}).get("doc_link"),
        )
    except Exception:
        pass

    return True, "Employee marked as exited successfully", {
        "employee_id": admin.id,
        "login_deferred_until": last_working_day.isoformat() if deferred_login else None,
        "relieving_letter_shared": bool(doc_share_payload),
        "offboarding": build_offboarding_payload_for_admin(admin),
    }
