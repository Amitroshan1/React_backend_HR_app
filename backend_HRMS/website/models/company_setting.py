"""Per-company settings documents (leave policy, TDS / payroll, CTC structuring)."""
from __future__ import annotations

from .. import db
from ..datetime_utils import utc_now


class CompanySetting(db.Model):
    __tablename__ = "company_settings"
    __table_args__ = (
        db.UniqueConstraint("tenant_id", "namespace", name="uq_company_settings_tenant_namespace"),
    )

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    tenant_id = db.Column(db.Integer, nullable=False, index=True)
    namespace = db.Column(db.String(40), nullable=False)
    data = db.Column(db.Text, nullable=False, default="{}")
    updated_at = db.Column(db.DateTime, nullable=False, default=utc_now, onupdate=utc_now)
    updated_by_admin_id = db.Column(db.Integer, nullable=True)
