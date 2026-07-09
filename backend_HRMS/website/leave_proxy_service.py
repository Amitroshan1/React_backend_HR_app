"""Shared leave creation for HR/manager proxy and attendance regularization approval."""
from __future__ import annotations

from . import db
from .models.attendance import LeaveApplication, LeaveBalance


class LeaveProxyError(Exception):
    def __init__(self, message: str, status_code: int = 400):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def create_proxy_leave_application(
    *,
    admin_id: int,
    leave_type: str,
    start_date,
    end_date,
    reason: str,
    status: str,
    applied_by_admin_id: int | None = None,
    applied_on_behalf: bool = False,
):
    from .Human_resource import (
        _apply_approved_leave_effect,
        _check_leave_application_conflicts,
        _compute_leave_projection,
        _validate_optional_leave_on_behalf,
    )
    from .models.Admin_models import Admin

    admin = Admin.query.get(admin_id)
    if not admin:
        raise LeaveProxyError("Employee not found", 404)

    leave_balance = LeaveBalance.query.filter_by(admin_id=admin_id).first()
    if not leave_balance:
        raise LeaveProxyError("Leave balance not configured for employee", 400)

    if leave_type == "Optional Leave":
        opt_err = _validate_optional_leave_on_behalf(admin_id, start_date, end_date)
        if opt_err:
            raise LeaveProxyError(opt_err, 400)

    conflict = _check_leave_application_conflicts(
        admin_id, start_date, end_date, leave_type=leave_type
    )
    if conflict:
        raise LeaveProxyError(conflict, 409)

    projection, proj_err = _compute_leave_projection(
        admin=admin,
        leave_balance=leave_balance,
        leave_type=leave_type,
        start_date=start_date,
        end_date=end_date,
    )
    if proj_err:
        raise LeaveProxyError(proj_err, 400)

    leave_obj = LeaveApplication(
        admin_id=admin_id,
        leave_type=leave_type,
        reason=reason,
        start_date=start_date,
        end_date=end_date,
        status=status,
        deducted_days=projection["deducted_days"],
        extra_days=projection["extra_days"],
        requested_deducted_days=projection["requested_deducted_days"],
        sandwich_pl_days=projection["sandwich_pl_days"],
        applied_by_admin_id=applied_by_admin_id,
        applied_on_behalf=bool(applied_on_behalf),
    )

    if status == "Approved":
        apply_err = _apply_approved_leave_effect(leave_obj, leave_balance)
        if apply_err:
            raise LeaveProxyError(apply_err, 400)

    db.session.add(leave_obj)
    return leave_obj, leave_balance, projection
