"""Circle + department payroll batch for Finance approval."""
from __future__ import annotations

from .. import db
from ..datetime_utils import isoformat_api, utc_now


BATCH_DRAFT = "draft"
BATCH_PENDING_FINANCE = "pending_finance"
BATCH_APPROVED = "approved"
BATCH_REJECTED = "rejected"
BATCH_PAYSLIPS_ISSUED = "payslips_issued"

EDITABLE_BATCH_STATUSES = frozenset({BATCH_DRAFT, BATCH_REJECTED})
FROZEN_BATCH_STATUSES = frozenset(
    {BATCH_PENDING_FINANCE, BATCH_APPROVED, BATCH_PAYSLIPS_ISSUED}
)
LEAVE_BLOCK_BATCH_STATUSES = FROZEN_BATCH_STATUSES
COMPLIANCE_READY_STATUSES = frozenset({BATCH_APPROVED, BATCH_PAYSLIPS_ISSUED})
EMPLOYEE_VISIBLE_STATUSES = frozenset({BATCH_PAYSLIPS_ISSUED})


class PayrollBatch(db.Model):
    __tablename__ = "payroll_batches"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    tenant_id = db.Column(db.Integer, nullable=False, index=True)
    circle = db.Column(db.String(80), nullable=False)
    emp_type = db.Column(db.String(80), nullable=False)
    month = db.Column(db.String(20), nullable=False)
    month_num = db.Column(db.Integer, nullable=False)
    year = db.Column(db.String(4), nullable=False)
    status = db.Column(db.String(32), nullable=False, default=BATCH_DRAFT, index=True)
    accounts_saved = db.Column(db.Boolean, nullable=False, default=False)
    submitted_by_admin_id = db.Column(db.Integer, db.ForeignKey("admins.id"), nullable=True)
    submitted_at = db.Column(db.DateTime, nullable=True)
    decided_by_admin_id = db.Column(db.Integer, db.ForeignKey("admins.id"), nullable=True)
    decided_at = db.Column(db.DateTime, nullable=True)
    decision_comment = db.Column(db.Text, nullable=True)
    salary_credited_confirmed = db.Column(db.Boolean, nullable=False, default=False)
    salary_credited_by_admin_id = db.Column(db.Integer, db.ForeignKey("admins.id"), nullable=True)
    salary_credited_at = db.Column(db.DateTime, nullable=True)
    created_at = db.Column(db.DateTime, nullable=True, default=utc_now)
    updated_at = db.Column(db.DateTime, nullable=True, default=utc_now, onupdate=utc_now)

    members = db.relationship(
        "PayrollBatchMember",
        back_populates="batch",
        cascade="all, delete-orphan",
    )

    __table_args__ = (
        db.UniqueConstraint(
            "tenant_id",
            "circle",
            "emp_type",
            "month_num",
            "year",
            name="uq_payroll_batch_scope",
        ),
    )

    def to_dict(self, *, include_members=False):
        data = {
            "id": self.id,
            "tenant_id": self.tenant_id,
            "circle": self.circle,
            "emp_type": self.emp_type,
            "month": self.month,
            "month_num": self.month_num,
            "year": self.year,
            "status": self.status,
            "accounts_saved": bool(self.accounts_saved),
            "submitted_by_admin_id": self.submitted_by_admin_id,
            "submitted_at": isoformat_api(self.submitted_at),
            "decided_by_admin_id": self.decided_by_admin_id,
            "decided_at": isoformat_api(self.decided_at),
            "decision_comment": self.decision_comment,
            "salary_credited_confirmed": bool(self.salary_credited_confirmed),
            "salary_credited_by_admin_id": self.salary_credited_by_admin_id,
            "salary_credited_at": isoformat_api(self.salary_credited_at),
            "member_count": len(self.members or []),
            "created_at": isoformat_api(self.created_at),
            "updated_at": isoformat_api(self.updated_at),
        }
        if include_members:
            data["members"] = [m.to_dict() for m in (self.members or [])]
        return data


class PayrollBatchMember(db.Model):
    __tablename__ = "payroll_batch_members"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    batch_id = db.Column(
        db.Integer,
        db.ForeignKey("payroll_batches.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    payroll_id = db.Column(
        db.Integer,
        db.ForeignKey("monthly_payrolls.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    admin_id = db.Column(db.Integer, db.ForeignKey("admins.id", ondelete="CASCADE"), nullable=False)
    included = db.Column(db.Boolean, nullable=False, default=True)
    created_at = db.Column(db.DateTime, nullable=True, default=utc_now)

    batch = db.relationship("PayrollBatch", back_populates="members")
    payroll = db.relationship("MonthlyPayroll")

    __table_args__ = (
        db.UniqueConstraint("payroll_id", name="uq_payroll_batch_member_payroll"),
    )

    def to_dict(self):
        return {
            "id": self.id,
            "batch_id": self.batch_id,
            "payroll_id": self.payroll_id,
            "admin_id": self.admin_id,
            "included": bool(self.included),
        }
