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

    # Earnings — Indian standard heads
    basic_salary = db.Column(db.Float, nullable=True)
    dearness_allowance = db.Column(db.Float, nullable=True)
    hra = db.Column(db.Float, nullable=True)
    hra_pct = db.Column(db.Float, nullable=True)
    special_allowance = db.Column(db.Float, nullable=True)
    conveyance_allowance = db.Column(db.Float, nullable=True)
    medical_allowance = db.Column(db.Float, nullable=True)
    lta_allowance = db.Column(db.Float, nullable=True)
    other_allowance = db.Column(db.Float, nullable=True)  # legacy sum of allowance heads
    gross_salary = db.Column(db.Float, nullable=True)
    net_salary = db.Column(db.Float, nullable=True)
    annual_ctc = db.Column(db.Float, nullable=True)  # target fixed CTC input
    annual_ctc_computed = db.Column(db.Float, nullable=True)  # fixed CTC from components
    variable_ctc_annual = db.Column(db.Float, nullable=True)
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
    pf_admin_yearly = db.Column(db.Float, nullable=True)
    pf_admin_monthly = db.Column(db.Float, nullable=True)
    edli_yearly = db.Column(db.Float, nullable=True)
    edli_monthly = db.Column(db.Float, nullable=True)
    statutory_bonus_yearly = db.Column(db.Float, nullable=True)
    statutory_bonus_monthly = db.Column(db.Float, nullable=True)
    lwf_employer_yearly = db.Column(db.Float, nullable=True)
    lwf_employee_yearly = db.Column(db.Float, nullable=True)
    include_pf_admin_in_ctc = db.Column(db.Boolean, nullable=True, default=True)
    include_edli_in_ctc = db.Column(db.Boolean, nullable=True, default=True)
    include_statutory_bonus_in_ctc = db.Column(db.Boolean, nullable=True, default=False)
    include_lwf_in_ctc = db.Column(db.Boolean, nullable=True, default=False)
    vpf_monthly = db.Column(db.Float, nullable=True)
    include_nps_in_ctc = db.Column(db.Boolean, nullable=True, default=False)
    nps_employer_pct = db.Column(db.Float, nullable=True)
    is_metro_hra = db.Column(db.Boolean, nullable=True)
    reimbursement_monthly = db.Column(db.Float, nullable=True)
    ptax_state = db.Column(db.String(2), nullable=True)
    effective_from = db.Column(db.Date, nullable=True)

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

    def allowance_heads_total(self):
        return (
            float(self.special_allowance or 0)
            + float(self.conveyance_allowance or 0)
            + float(self.medical_allowance or 0)
            + float(self.lta_allowance or 0)
        )

    def fixed_ctc_annual(self):
        return float(self.annual_ctc_computed or 0)

    def total_ctc_annual(self):
        return self.fixed_ctc_annual() + float(self.variable_ctc_annual or 0)

    def to_dict(self):
        heads_total = self.allowance_heads_total()
        other_legacy = float(self.other_allowance or 0)
        return {
            "id": self.id,
            "admin_id": self.admin_id,
            "basic_salary": self.basic_salary,
            "dearness_allowance": self.dearness_allowance,
            "hra": self.hra,
            "hra_pct": self.hra_pct,
            "special_allowance": self.special_allowance,
            "conveyance_allowance": self.conveyance_allowance,
            "medical_allowance": self.medical_allowance,
            "lta_allowance": self.lta_allowance,
            "other_allowance": heads_total if heads_total > 0 else other_legacy,
            "gross_salary": self.gross_salary,
            "net_salary": self.net_salary,
            "annual_ctc": self.annual_ctc,
            "annual_ctc_computed": self.annual_ctc_computed,
            "fixed_ctc_annual": self.annual_ctc_computed,
            "variable_ctc_annual": self.variable_ctc_annual,
            "total_ctc_annual": round(self.total_ctc_annual(), 2),
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
            "pf_admin_yearly": self.pf_admin_yearly,
            "pf_admin_monthly": self.pf_admin_monthly,
            "edli_yearly": self.edli_yearly,
            "edli_monthly": self.edli_monthly,
            "include_pf_admin_in_ctc": (
                True if self.include_pf_admin_in_ctc is None else bool(self.include_pf_admin_in_ctc)
            ),
            "include_edli_in_ctc": (
                True if self.include_edli_in_ctc is None else bool(self.include_edli_in_ctc)
            ),
            "include_statutory_bonus_in_ctc": bool(self.include_statutory_bonus_in_ctc),
            "include_lwf_in_ctc": bool(self.include_lwf_in_ctc),
            "ptax_state": self.ptax_state,
            "statutory_bonus_yearly": self.statutory_bonus_yearly,
            "statutory_bonus_monthly": self.statutory_bonus_monthly,
            "lwf_employer_yearly": self.lwf_employer_yearly,
            "lwf_employee_yearly": self.lwf_employee_yearly,
            "vpf_monthly": self.vpf_monthly,
            "include_nps_in_ctc": bool(self.include_nps_in_ctc),
            "nps_employer_pct": self.nps_employer_pct,
            "is_metro_hra": self.is_metro_hra,
            "reimbursement_monthly": self.reimbursement_monthly,
            "effective_from": (
                self.effective_from.isoformat() if self.effective_from else None
            ),
            "created_at": isoformat_api(self.created_at),
            "updated_at": isoformat_api(self.updated_at),
        }
