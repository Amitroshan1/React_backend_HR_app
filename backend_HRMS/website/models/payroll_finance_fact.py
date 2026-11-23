"""Department-month payroll totals (encrypted). Finance dashboards must not SUM employee nets."""
from __future__ import annotations

from .. import db
from ..datetime_utils import utc_now


class PayrollFinanceFact(db.Model):
    __tablename__ = "payroll_finance_facts"
    __table_args__ = (
        db.UniqueConstraint(
            "tenant_id",
            "year",
            "month_num",
            "circle",
            "emp_type",
            name="uq_payroll_finance_fact_scope",
        ),
    )

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    tenant_id = db.Column(db.Integer, nullable=False, index=True)
    year = db.Column(db.String(4), nullable=False)
    month_num = db.Column(db.Integer, nullable=False)
    circle = db.Column(db.String(80), nullable=False, default="")
    emp_type = db.Column(db.String(80), nullable=False, default="")
    headcount = db.Column(db.Integer, nullable=False, default=0)
    totals_blob = db.Column(db.LargeBinary, nullable=True)
    updated_at = db.Column(db.DateTime, nullable=False, default=utc_now, onupdate=utc_now)
