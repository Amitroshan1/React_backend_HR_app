"""CTC breakup per employee (single row per admin)."""

from datetime import datetime

from .. import db
from ..datetime_utils import isoformat_api, utc_now


class CTCBreakup(db.Model):
    __tablename__ = "ctc_breakups"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)

    admin_id = db.Column(
        db.Integer,
        db.ForeignKey("admins.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Earnings
    basic_salary = db.Column(db.Float, nullable=True)
    hra = db.Column(db.Float, nullable=True)
    hra_pct = db.Column(db.Float, nullable=True)
    other_allowance = db.Column(db.Float, nullable=True)
    gross_salary = db.Column(db.Float, nullable=True)
    net_salary = db.Column(db.Float, nullable=True)
    annual_ctc = db.Column(db.Float, nullable=True)
    annual_ctc_computed = db.Column(db.Float, nullable=True)
    mediclaim_yearly = db.Column(db.Float, nullable=True)

    # Deductions
    epf = db.Column(db.Float, nullable=True)
    epf_mode = db.Column(db.String(20), nullable=True)
    epf_pct = db.Column(db.Float, nullable=True)
    esic = db.Column(db.Float, nullable=True)
    esic_employer = db.Column(db.Float, nullable=True)
    ptax = db.Column(db.Float, nullable=True)
    ptax_month = db.Column(db.String(7), nullable=True)
    deductions_total = db.Column(db.Float, nullable=True)

    # Employer cost components (yearly / monthly)
    gratuity_yearly = db.Column(db.Float, nullable=True)
    gratuity_monthly = db.Column(db.Float, nullable=True)
    employer_pf_yearly = db.Column(db.Float, nullable=True)
    employer_pf_monthly = db.Column(db.Float, nullable=True)
    employer_esic_yearly = db.Column(db.Float, nullable=True)
    employer_esic_monthly = db.Column(db.Float, nullable=True)

    created_at = db.Column(db.DateTime, default=utc_now, nullable=True)
    updated_at = db.Column(
        db.DateTime,
        default=utc_now,
        onupdate=utc_now,
        nullable=True,
    )

    admin = db.relationship("Admin", back_populates="ctc_breakup_record")

    __table_args__ = (
        db.UniqueConstraint(
            "admin_id",
            name="uq_ctc_breakup_admin_id",
        ),
    )

    def to_dict(self):
        return {
            "id": self.id,
            "admin_id": self.admin_id,
            "basic_salary": self.basic_salary,
            "hra": self.hra,
            "hra_pct": self.hra_pct,
            "other_allowance": self.other_allowance,
            "gross_salary": self.gross_salary,
            "net_salary": self.net_salary,
            "annual_ctc": self.annual_ctc,
            "annual_ctc_computed": self.annual_ctc_computed,
            "mediclaim_yearly": self.mediclaim_yearly,
            "epf": self.epf,
            "epf_mode": self.epf_mode,
            "epf_pct": self.epf_pct,
            "esic": self.esic,
            "esic_employer": self.esic_employer,
            "ptax": self.ptax,
            "ptax_month": self.ptax_month,
            "deductions_total": self.deductions_total,
            "gratuity_yearly": self.gratuity_yearly,
            "gratuity_monthly": self.gratuity_monthly,
            "employer_pf_yearly": self.employer_pf_yearly,
            "employer_pf_monthly": self.employer_pf_monthly,
            "employer_esic_yearly": self.employer_esic_yearly,
            "employer_esic_monthly": self.employer_esic_monthly,
            "created_at": isoformat_api(self.created_at),
            "updated_at": isoformat_api(self.updated_at),
        }

