"""Inventory purchase / indent request: Manager need-check, then Finance budget."""
from __future__ import annotations

from .. import db
from ..datetime_utils import utc_now


class InventoryPurchaseRequest(db.Model):
    __tablename__ = "inventory_purchase_requests"
    __table_args__ = (
        db.Index("ix_inv_pr_tenant_status", "tenant_id", "status"),
        db.Index("ix_inv_pr_tenant_created", "tenant_id", "created_at"),
    )

    id = db.Column(db.Integer, primary_key=True)
    tenant_id = db.Column(db.Integer, nullable=False, index=True)
    request_no = db.Column(db.String(40), nullable=False)

    requested_by_admin_id = db.Column(db.Integer, db.ForeignKey("admins.id"), nullable=True, index=True)
    requested_by_name = db.Column(db.String(150), nullable=True)
    requested_by_email = db.Column(db.String(160), nullable=True)

    title = db.Column(db.String(200), nullable=False)
    source = db.Column(db.String(20), nullable=False, default="inventory")
    category = db.Column(db.String(80), nullable=True)
    item_name = db.Column(db.String(200), nullable=True)
    quantity = db.Column(db.Integer, nullable=False, default=1)
    unit = db.Column(db.String(40), nullable=True)
    estimated_amount = db.Column(db.Numeric(12, 2), nullable=True)
    vendor_hint = db.Column(db.String(200), nullable=True)
    needed_by = db.Column(db.String(20), nullable=True)
    justification = db.Column(db.Text, nullable=False)
    attachments_json = db.Column(db.Text, nullable=True)

    status = db.Column(db.String(32), nullable=False, default="pending_manager", index=True)

    manager_admin_id = db.Column(db.Integer, db.ForeignKey("admins.id"), nullable=True)
    manager_name = db.Column(db.String(150), nullable=True)
    manager_remarks = db.Column(db.Text, nullable=True)
    manager_acted_at = db.Column(db.DateTime, nullable=True)

    finance_admin_id = db.Column(db.Integer, db.ForeignKey("admins.id"), nullable=True)
    finance_name = db.Column(db.String(150), nullable=True)
    finance_remarks = db.Column(db.Text, nullable=True)
    finance_acted_at = db.Column(db.DateTime, nullable=True)

    received_by_admin_id = db.Column(db.Integer, db.ForeignKey("admins.id"), nullable=True)
    received_at = db.Column(db.DateTime, nullable=True)
    receive_notes = db.Column(db.Text, nullable=True)

    created_at = db.Column(db.DateTime, nullable=False, default=utc_now)
    updated_at = db.Column(db.DateTime, nullable=False, default=utc_now, onupdate=utc_now)
