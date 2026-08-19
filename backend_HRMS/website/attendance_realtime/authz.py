"""Authorization helpers for attendance SSE (reuse existing role/team rules)."""

from __future__ import annotations

from typing import Optional, Set


def _norm_emp_type(admin) -> str:
    raw = (
        getattr(admin, "emp_type", None)
        or getattr(admin, "department", None)
        or ""
    )
    return str(raw).strip().lower().replace("-", " ").replace("_", " ")


def is_hr_or_admin(admin) -> bool:
    et = _norm_emp_type(admin)
    if et in ("admin", "administrator", "administration", "hr", "human resource", "human resources"):
        return True
    if "super" in et:
        return True
    return False


def resolve_allowed_employee_ids(viewer_admin) -> Optional[Set[int]]:
    """
    Return:
      None  → may receive all employee attendance events (HR/Admin)
      set() → only listed Admin.ids (self + managed team when applicable)
    """
    if not viewer_admin or not getattr(viewer_admin, "id", None):
        return set()

    if is_hr_or_admin(viewer_admin):
        return None

    allowed: Set[int] = {int(viewer_admin.id)}
    try:
        from ..manager import _team_member_admin_ids

        for tid in _team_member_admin_ids(viewer_admin) or []:
            allowed.add(int(tid))
    except Exception:
        pass
    return allowed


def viewer_may_see_employee(viewer_admin, employee_admin_id: int) -> bool:
    allowed = resolve_allowed_employee_ids(viewer_admin)
    if allowed is None:
        return True
    try:
        return int(employee_admin_id) in allowed
    except (TypeError, ValueError):
        return False
