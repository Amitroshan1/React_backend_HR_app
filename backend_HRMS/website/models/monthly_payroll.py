from datetime import datetime

from .. import db
from ..datetime_utils import isoformat_api, utc_now


class MonthlyPayroll(db.Model):
    __tablename__ = "monthly_payrolls"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)

    # Candidate
    admin_id = db.Column(
        db.Integer,
        db.ForeignKey("admins.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Month + year (aligns with existing PaySlip usage)
    month = db.Column(db.String(20), nullable=False)  # e.g. "January"
    month_num = db.Column(db.Integer, nullable=False)  # 1..12 (for calculations)
    year = db.Column(db.String(4), nullable=False)  # e.g. "2026"

    # Gross salary (CTC breakup gross prorated by calendar days, then adjusted by actual working days)
    ctc_gross_salary = db.Column(db.Float, nullable=True)
    calendar_days = db.Column(db.Integer, nullable=True)
    one_day_salary = db.Column(db.Float, nullable=True)
    actual_working_days = db.Column(db.Float, nullable=True)
    gross_salary_for_month = db.Column(db.Float, nullable=True)

    # Deductions from CTC (computed) and editable finals (saved by Accounts)
    epf_computed = db.Column(db.Float, nullable=True)
    esic_computed = db.Column(db.Float, nullable=True)
    ptax_computed = db.Column(db.Float, nullable=True)

    tds_computed = db.Column(db.Float, nullable=True)
    tds_final = db.Column(db.Float, nullable=True)

    epf_final = db.Column(db.Float, nullable=True)
    esic_final = db.Column(db.Float, nullable=True)
    ptax_final = db.Column(db.Float, nullable=True)
    lwf_computed = db.Column(db.Float, nullable=True)
    lwf_final = db.Column(db.Float, nullable=True)

    arrears_gross_computed = db.Column(db.Float, nullable=True)
    arrears_gross_final = db.Column(db.Float, nullable=True)

    leave_encashment_computed = db.Column(db.Float, nullable=True)
    leave_encashment_final = db.Column(db.Float, nullable=True)
    loan_recovery_computed = db.Column(db.Float, nullable=True)
    loan_recovery_final = db.Column(db.Float, nullable=True)

    reimbursement_computed = db.Column(db.Float, nullable=True)
    reimbursement_final = db.Column(db.Float, nullable=True)

    statutory_bonus_computed = db.Column(db.Float, nullable=True)
    statutory_bonus_final = db.Column(db.Float, nullable=True)

    status = db.Column(db.String(20), nullable=False, default="draft")
    status_changed_at = db.Column(db.DateTime, nullable=True)
    status_changed_by_admin_id = db.Column(db.Integer, db.ForeignKey("admins.id"), nullable=True)

    deductions_total_final = db.Column(db.Float, nullable=True)
    net_salary_final = db.Column(db.Float, nullable=True)

    created_at = db.Column(db.DateTime, nullable=True, default=utc_now)
    updated_at = db.Column(db.DateTime, nullable=True, default=utc_now, onupdate=utc_now)

    admin = db.relationship(
        "Admin",
        foreign_keys=[admin_id],
        back_populates="payroll_records",
    )
    status_changed_by = db.relationship(
        "Admin",
        foreign_keys=[status_changed_by_admin_id],
    )

    __table_args__ = (
        db.UniqueConstraint("admin_id", "month_num", "year", name="uq_payroll_admin_month_year"),
    )

    def total_gross_amount(self) -> float:
        return round(
            float(self.gross_salary_for_month or 0)
            + float(self.arrears_gross_final or 0)
            + float(self.leave_encashment_final or 0)
            + float(self.reimbursement_final or 0)
            + float(self.statutory_bonus_final or 0),
            2,
        )

    def to_dict(self):
        return {
            "id": self.id,
            "admin_id": self.admin_id,
            "month": self.month,
            "month_num": self.month_num,
            "year": self.year,
            "ctc_gross_salary": self.ctc_gross_salary,
            "calendar_days": self.calendar_days,
            "one_day_salary": self.one_day_salary,
            "actual_working_days": self.actual_working_days,
            "gross_salary_for_month": self.gross_salary_for_month,
            "epf_computed": self.epf_computed,
            "esic_computed": self.esic_computed,
            "ptax_computed": self.ptax_computed,
            "tds_computed": self.tds_computed,
            "tds_final": self.tds_final,
            "epf_final": self.epf_final,
            "esic_final": self.esic_final,
            "ptax_final": self.ptax_final,
            "lwf_computed": self.lwf_computed,
            "lwf_final": self.lwf_final,
            "arrears_gross_computed": self.arrears_gross_computed,
            "arrears_gross_final": self.arrears_gross_final,
            "leave_encashment_final": self.leave_encashment_final,
            "loan_recovery_final": self.loan_recovery_final,
            "reimbursement_final": self.reimbursement_final,
            "statutory_bonus_final": self.statutory_bonus_final,
            "status": (self.status or "draft"),
            "status_changed_at": isoformat_api(self.status_changed_at),
            "status_changed_by_admin_id": self.status_changed_by_admin_id,
            "total_gross_final": self.total_gross_amount(),
            "deductions_total_final": self.deductions_total_final,
            "net_salary_final": self.net_salary_final,
            "created_at": isoformat_api(self.created_at),
            "updated_at": isoformat_api(self.updated_at),
        }

