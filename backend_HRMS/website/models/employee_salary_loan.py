"""Salary advance / loan recovery for payroll."""
from __future__ import annotations

from .. import db
from ..datetime_utils import isoformat_api, utc_now


class EmployeeSalaryLoan(db.Model):
    __tablename__ = "employee_salary_loans"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    admin_id = db.Column(
        db.Integer,
        db.ForeignKey("admins.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    description = db.Column(db.String(255), nullable=True)
    principal_amount = db.Column(db.Float, nullable=False, default=0.0)
    emi_monthly = db.Column(db.Float, nullable=False, default=0.0)
    balance_remaining = db.Column(db.Float, nullable=False, default=0.0)
    start_date = db.Column(db.Date, nullable=True)
    status = db.Column(db.String(20), nullable=False, default="active")
    created_at = db.Column(db.DateTime, nullable=True, default=utc_now)
    updated_at = db.Column(db.DateTime, nullable=True, default=utc_now, onupdate=utc_now)

    admin = db.relationship("Admin", backref="salary_loans")

    def to_dict(self):
        return {
            "id": self.id,
            "admin_id": self.admin_id,
            "description": self.description,
            "principal_amount": float(self.principal_amount or 0),
            "emi_monthly": float(self.emi_monthly or 0),
            "balance_remaining": float(self.balance_remaining or 0),
            "start_date": self.start_date.isoformat() if self.start_date else None,
            "status": self.status,
            "created_at": isoformat_api(self.created_at),
            "updated_at": isoformat_api(self.updated_at),
        }
