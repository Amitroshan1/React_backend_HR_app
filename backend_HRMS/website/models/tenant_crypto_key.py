"""Wrapped per-tenant data-encryption keys (Phase 4). The DEK never stored in clear."""
from __future__ import annotations

from .. import db
from ..datetime_utils import utc_now


class TenantCryptoKey(db.Model):
    __tablename__ = "tenant_crypto_keys"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    tenant_id = db.Column(db.Integer, nullable=False, unique=True, index=True)
    wrapped_dek = db.Column(db.LargeBinary, nullable=False)
    wrapped_dek_previous = db.Column(db.LargeBinary, nullable=True)
    key_version = db.Column(db.Integer, nullable=False, default=1)
    revoked_at = db.Column(db.DateTime, nullable=True)
    created_at = db.Column(db.DateTime, nullable=False, default=utc_now)
    rotated_at = db.Column(db.DateTime, nullable=True)
