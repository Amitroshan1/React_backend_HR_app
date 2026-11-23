"""Company KYB invite, profile, and uploaded proofs (platform tenant onboarding)."""
from __future__ import annotations

from .. import db
from ..datetime_utils import isoformat_api, utc_now

KYB_INVITE_STATUSES = (
    "sent",
    "in_progress",
    "submitted",
    "needs_fix",
    "verified",
    "expired",
    "cancelled",
)
TENANT_KYC_STATUSES = (
    "not_required",
    "skipped",
    "invite_sent",
    "in_progress",
    "submitted",
    "needs_fix",
    "verified",
)


class TenantKybInvite(db.Model):
    __tablename__ = "tenant_kyb_invites"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    tenant_id = db.Column(db.Integer, db.ForeignKey("tenants.id"), nullable=False, index=True)
    token_hash = db.Column(db.String(64), nullable=False, unique=True, index=True)
    sent_to_email = db.Column(db.String(200), nullable=False)
    sent_by_admin_id = db.Column(db.Integer, nullable=True)
    status = db.Column(db.String(32), nullable=False, default="sent", index=True)
    revision = db.Column(db.Integer, nullable=False, default=1)
    expires_at = db.Column(db.DateTime, nullable=False, index=True)
    opened_at = db.Column(db.DateTime, nullable=True)
    submitted_at = db.Column(db.DateTime, nullable=True)
    auto_check_json = db.Column(db.Text, nullable=True)
    reviewer_admin_id = db.Column(db.Integer, nullable=True)
    reviewed_at = db.Column(db.DateTime, nullable=True)
    review_note = db.Column(db.Text, nullable=True)
    created_at = db.Column(db.DateTime, nullable=False, default=utc_now)
    updated_at = db.Column(db.DateTime, nullable=False, default=utc_now, onupdate=utc_now)

    documents = db.relationship("TenantKybDocument", backref="invite", lazy="dynamic")

    def to_public_meta(self) -> dict:
        return {
            "status": self.status,
            "expires_at": isoformat_api(self.expires_at),
            "submitted_at": isoformat_api(self.submitted_at),
            "revision": self.revision,
        }


class TenantKybProfile(db.Model):
    __tablename__ = "tenant_kyb_profiles"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    tenant_id = db.Column(db.Integer, db.ForeignKey("tenants.id"), nullable=False, unique=True)
    legal_name = db.Column(db.String(200), nullable=True)
    trade_name = db.Column(db.String(200), nullable=True)
    entity_type = db.Column(db.String(32), nullable=True)
    cin = db.Column(db.String(21), nullable=True, index=True)
    llpin = db.Column(db.String(12), nullable=True, index=True)
    gstin = db.Column(db.String(15), nullable=True, index=True)
    pan = db.Column(db.String(10), nullable=True, index=True)
    gst_exempt_reason = db.Column(db.String(200), nullable=True)
    registered_address = db.Column(db.String(500), nullable=True)
    signatory_name = db.Column(db.String(150), nullable=True)
    signatory_designation = db.Column(db.String(120), nullable=True)
    signatory_pan = db.Column(db.String(10), nullable=True)
    signatory_mobile = db.Column(db.String(15), nullable=True)
    signatory_email = db.Column(db.String(200), nullable=True)
    updated_at = db.Column(db.DateTime, nullable=False, default=utc_now, onupdate=utc_now)

    def to_public_dict(self) -> dict:
        return {
            "legal_name": self.legal_name or "",
            "trade_name": self.trade_name or "",
            "entity_type": self.entity_type or "",
            "cin": self.cin or "",
            "llpin": self.llpin or "",
            "gstin": self.gstin or "",
            "pan": self.pan or "",
            "gst_exempt_reason": self.gst_exempt_reason or "",
            "registered_address": self.registered_address or "",
            "signatory_name": self.signatory_name or "",
            "signatory_designation": self.signatory_designation or "",
            "signatory_pan": self.signatory_pan or "",
            "signatory_mobile": self.signatory_mobile or "",
            "signatory_email": self.signatory_email or "",
        }


class TenantKybDocument(db.Model):
    __tablename__ = "tenant_kyb_documents"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    tenant_id = db.Column(db.Integer, db.ForeignKey("tenants.id"), nullable=False, index=True)
    invite_id = db.Column(db.Integer, db.ForeignKey("tenant_kyb_invites.id"), nullable=False, index=True)
    doc_type = db.Column(db.String(32), nullable=False)
    storage_key = db.Column(db.String(400), nullable=False)
    original_filename = db.Column(db.String(255), nullable=False)
    content_type = db.Column(db.String(80), nullable=False)
    size_bytes = db.Column(db.Integer, nullable=False, default=0)
    sha256 = db.Column(db.String(64), nullable=False)
    invite_revision = db.Column(db.Integer, nullable=False, default=1)
    uploaded_at = db.Column(db.DateTime, nullable=False, default=utc_now)

    def to_public_dict(self) -> dict:
        return {
            "id": self.id,
            "doc_type": self.doc_type,
            "original_filename": self.original_filename,
            "content_type": self.content_type,
            "size_bytes": self.size_bytes,
            "uploaded_at": isoformat_api(self.uploaded_at),
        }
