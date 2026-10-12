"""CTC band guardrails by circle, department, and grade."""
from __future__ import annotations

from .. import db
from ..datetime_utils import isoformat_api, utc_now


def _default_tenant_id():
    from ..tenant_context import get_current_tenant_id

    return get_current_tenant_id()


class CompensationBand(db.Model):
    __tablename__ = "compensation_bands"
    __table_args__ = (
        db.UniqueConstraint(
            "tenant_id",
            "circle",
            "emp_type",
            "grade",
            name="uq_comp_band_tenant_circle_dept_grade",
        ),
    )

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    tenant_id = db.Column(db.Integer, nullable=True, default=_default_tenant_id, index=True)
    circle = db.Column(db.String(80), nullable=False, index=True)
    emp_type = db.Column(db.String(80), nullable=False, index=True)
    grade = db.Column(db.String(80), nullable=False, default="General", index=True)
    min_annual_ctc = db.Column(db.Float, nullable=False, default=0)
    mid_annual_ctc = db.Column(db.Float, nullable=True)
    max_annual_ctc = db.Column(db.Float, nullable=False, default=0)
    notes = db.Column(db.Text, nullable=True)
    created_by = db.Column(db.String(120), nullable=True)
    created_at = db.Column(db.DateTime, nullable=False, default=utc_now)

    def to_dict(self):
        return {
            "id": self.id,
            "circle": self.circle,
            "emp_type": self.emp_type,
            "grade": self.grade,
            "min_annual_ctc": float(self.min_annual_ctc),
            "mid_annual_ctc": float(self.mid_annual_ctc) if self.mid_annual_ctc is not None else None,
            "max_annual_ctc": float(self.max_annual_ctc),
            "notes": self.notes,
            "created_by": self.created_by,
            "created_at": isoformat_api(self.created_at),
        }
