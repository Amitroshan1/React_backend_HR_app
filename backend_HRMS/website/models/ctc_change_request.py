"""Draft / approval queue for CTC, policy, and statutory pack changes."""
from __future__ import annotations

from .. import db
from ..datetime_utils import isoformat_api, utc_now


PENDING_STATUSES = ("draft", "pending_hr", "pending_admin", "pending_finance")


class CTCChangeRequest(db.Model):
    __tablename__ = "ctc_change_requests"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    tenant_id = db.Column(db.Integer, nullable=True, index=True)
    admin_id = db.Column(db.Integer, db.ForeignKey("admins.id", ondelete="CASCADE"), nullable=True, index=True)
    kind = db.Column(db.String(32), nullable=False, default="employee_ctc", index=True)
    status = db.Column(db.String(24), nullable=False, default="pending_finance", index=True)
    payload = db.Column(db.JSON, nullable=False)
    note = db.Column(db.String(255), nullable=True)
    reject_reason = db.Column(db.String(500), nullable=True)
    effective_from = db.Column(db.Date, nullable=True)
    increment_pct = db.Column(db.Float, nullable=True)
    submitted_by_admin_id = db.Column(db.Integer, nullable=True)
    decided_by_admin_id = db.Column(db.Integer, nullable=True)
    decided_at = db.Column(db.DateTime, nullable=True)
    created_at = db.Column(db.DateTime, default=utc_now, nullable=True)
    updated_at = db.Column(db.DateTime, default=utc_now, onupdate=utc_now, nullable=True)

    admin = db.relationship("Admin", foreign_keys=[admin_id])

    def to_dict(self):
        emp = self.admin
        payload = self.payload if isinstance(self.payload, dict) else {}
        return {
            "id": self.id,
            "tenant_id": self.tenant_id,
            "admin_id": self.admin_id,
            "kind": self.kind,
            "status": self.status,
            "payload": payload,
            "note": self.note,
            "reject_reason": self.reject_reason,
            "effective_from": self.effective_from.isoformat() if self.effective_from else None,
            "increment_pct": self.increment_pct,
            "submitted_by_admin_id": self.submitted_by_admin_id,
            "decided_by_admin_id": self.decided_by_admin_id,
            "decided_at": isoformat_api(self.decided_at),
            "created_at": isoformat_api(self.created_at),
            "updated_at": isoformat_api(self.updated_at),
            "employee_name": getattr(emp, "first_name", None) if emp else None,
            "emp_id": getattr(emp, "emp_id", None) if emp else None,
            "email": getattr(emp, "email", None) if emp else None,
            "old_annual_ctc": payload.get("old_annual_ctc"),
            "new_annual_ctc": payload.get("annual_ctc") or payload.get("annual_ctc_computed"),
            "pack_id": payload.get("pack_id"),
            "recalc_count": len(payload.get("recalc_admin_ids") or []),
        }
