from datetime import datetime
from zoneinfo import ZoneInfo

from .. import db


IST = ZoneInfo("Asia/Kolkata")


def _ist_now_naive():
    # Store as naive IST to match existing DB patterns (naive DateTime columns).
    return datetime.now(IST).replace(tzinfo=None)


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

    epf_final = db.Column(db.Float, nullable=True)
    esic_final = db.Column(db.Float, nullable=True)
    ptax_final = db.Column(db.Float, nullable=True)

    deductions_total_final = db.Column(db.Float, nullable=True)
    net_salary_final = db.Column(db.Float, nullable=True)

    created_at = db.Column(db.DateTime, nullable=True, default=_ist_now_naive)
    updated_at = db.Column(db.DateTime, nullable=True, default=_ist_now_naive, onupdate=_ist_now_naive)

    admin = db.relationship("Admin", back_populates="payroll_records")

    __table_args__ = (
        db.UniqueConstraint("admin_id", "month_num", "year", name="uq_payroll_admin_month_year"),
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
            "epf_final": self.epf_final,
            "esic_final": self.esic_final,
            "ptax_final": self.ptax_final,
            "deductions_total_final": self.deductions_total_final,
            "net_salary_final": self.net_salary_final,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }

