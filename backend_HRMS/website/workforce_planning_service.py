"""Headcount budget vs actual reporting."""
from __future__ import annotations

from sqlalchemy import or_, func

from . import db
from .models.Admin_models import Admin
from .models.headcount_budget import HeadcountBudget
from .models.recruitment import JobRequisition


def _enabled_filters():
    return (
        or_(Admin.is_exited == False, Admin.is_exited.is_(None)),
        or_(Admin.is_active == True, Admin.is_active.is_(None)),
    )


def list_budgets(*, fiscal_year: str) -> list[dict]:
    rows = (
        HeadcountBudget.query.filter(HeadcountBudget.fiscal_year == fiscal_year)
        .order_by(HeadcountBudget.circle.asc(), HeadcountBudget.emp_type.asc())
        .all()
    )
    return [r.to_dict() for r in rows]


def upsert_budget(data: dict, *, created_by: str) -> HeadcountBudget:
    fiscal_year = (data.get("fiscal_year") or "").strip()
    circle = (data.get("circle") or "").strip()
    emp_type = (data.get("emp_type") or "").strip()
    if not fiscal_year or not circle or not emp_type:
        raise ValueError("fiscal_year, circle, and emp_type are required")
    row = HeadcountBudget.query.filter_by(
        fiscal_year=fiscal_year, circle=circle, emp_type=emp_type
    ).first()
    if not row:
        row = HeadcountBudget(
            fiscal_year=fiscal_year,
            circle=circle,
            emp_type=emp_type,
            created_by=created_by,
        )
        db.session.add(row)
    row.budgeted_count = int(data.get("budgeted_count") or 0)
    row.notes = (data.get("notes") or "").strip() or None
    db.session.commit()
    return row


def build_workforce_plan(*, fiscal_year: str) -> dict:
    actual_rows = (
        db.session.query(Admin.circle, Admin.emp_type, func.count(Admin.id))
        .filter(*_enabled_filters())
        .group_by(Admin.circle, Admin.emp_type)
        .all()
    )
    actual_map = {}
    for circle, emp_type, count in actual_rows:
        key = (circle or "Unassigned", emp_type or "Unassigned")
        actual_map[key] = count

    budgets = HeadcountBudget.query.filter_by(fiscal_year=fiscal_year).all()
    budget_map = {(b.circle, b.emp_type): b for b in budgets}

    open_reqs = (
        JobRequisition.query.filter(JobRequisition.status == "open").all()
    )
    open_map = {}
    for req in open_reqs:
        key = (req.circle or "Unassigned", req.emp_type or "Unassigned")
        open_map[key] = open_map.get(key, 0) + int(req.headcount or 0)

    keys = set(actual_map.keys()) | set(budget_map.keys()) | set(open_map.keys())
    rows = []
    for circle, emp_type in sorted(keys):
        budget_row = budget_map.get((circle, emp_type))
        budgeted = budget_row.budgeted_count if budget_row else 0
        actual = actual_map.get((circle, emp_type), 0)
        open_roles = open_map.get((circle, emp_type), 0)
        rows.append({
            "circle": circle,
            "emp_type": emp_type,
            "budgeted": budgeted,
            "actual": actual,
            "open_requisitions": open_roles,
            "variance": actual - budgeted,
            "gap_to_budget": max(0, budgeted - actual),
            "budget_id": budget_row.id if budget_row else None,
            "notes": budget_row.notes if budget_row else None,
        })

    return {
        "fiscal_year": fiscal_year,
        "summary": {
            "total_budgeted": sum(r["budgeted"] for r in rows),
            "total_actual": sum(r["actual"] for r in rows),
            "total_open_roles": sum(r["open_requisitions"] for r in rows),
            "total_variance": sum(r["variance"] for r in rows),
        },
        "rows": rows,
    }
