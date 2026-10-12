"""Merit matrix: performance rating → allowed increment % range by circle/department."""
from __future__ import annotations

from .. import db
from ..datetime_utils import isoformat_api, utc_now


def _default_tenant_id():
    from ..tenant_context import get_current_tenant_id

    return get_current_tenant_id()

RATING_OPTIONS = (
    "Excellent",
    "Good",
    "Average",
    "Needs Improvement",
)


class MeritMatrixEntry(db.Model):
    __tablename__ = "merit_matrix_entries"
    __table_args__ = (
        db.UniqueConstraint(
            "tenant_id",
            "circle",
            "emp_type",
            "rating",
            name="uq_merit_matrix_tenant_circle_dept_rating",
        ),
    )

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    tenant_id = db.Column(db.Integer, nullable=True, default=_default_tenant_id, index=True)
    circle = db.Column(db.String(80), nullable=False, index=True)
    emp_type = db.Column(db.String(80), nullable=False, index=True)
    rating = db.Column(db.String(40), nullable=False, index=True)
    increment_pct_min = db.Column(db.Float, nullable=False, default=0)
    increment_pct_max = db.Column(db.Float, nullable=False, default=0)
    notes = db.Column(db.Text, nullable=True)
    created_by = db.Column(db.String(120), nullable=True)
    created_at = db.Column(db.DateTime, nullable=False, default=utc_now)

    def to_dict(self):
        return {
            "id": self.id,
            "circle": self.circle,
            "emp_type": self.emp_type,
            "rating": self.rating,
            "increment_pct_min": float(self.increment_pct_min),
            "increment_pct_max": float(self.increment_pct_max),
            "notes": self.notes,
            "created_by": self.created_by,
            "created_at": isoformat_api(self.created_at),
        }
