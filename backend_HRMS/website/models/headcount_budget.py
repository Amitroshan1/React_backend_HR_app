"""Headcount budget by circle and department."""
from __future__ import annotations

from .. import db
from ..datetime_utils import isoformat_api, utc_now


def _default_tenant_id():
    from ..tenant_context import get_current_tenant_id

    return get_current_tenant_id()


class HeadcountBudget(db.Model):
    __tablename__ = "headcount_budgets"
    __table_args__ = (
        db.UniqueConstraint(
            "tenant_id", "fiscal_year", "circle", "emp_type", name="uq_headcount_budget_tenant_year_circle_dept"
        ),
    )

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    tenant_id = db.Column(db.Integer, nullable=True, default=_default_tenant_id, index=True)
    fiscal_year = db.Column(db.String(20), nullable=False, index=True)
    circle = db.Column(db.String(80), nullable=False, index=True)
    emp_type = db.Column(db.String(80), nullable=False, index=True)
    budgeted_count = db.Column(db.Integer, nullable=False, default=0)
    notes = db.Column(db.Text, nullable=True)
    created_by = db.Column(db.String(120), nullable=True)
    created_at = db.Column(db.DateTime, nullable=False, default=utc_now)

    def to_dict(self):
        return {
            "id": self.id,
            "fiscal_year": self.fiscal_year,
            "circle": self.circle,
            "emp_type": self.emp_type,
            "budgeted_count": self.budgeted_count,
            "notes": self.notes,
            "created_by": self.created_by,
            "created_at": isoformat_api(self.created_at),
        }
