"""Background job rows for Phase 6 (bulk exports, mass emails, recalculations)."""
from __future__ import annotations

from .. import db
from ..datetime_utils import utc_now


class BackgroundJob(db.Model):
    __tablename__ = "background_jobs"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    tenant_id = db.Column(db.Integer, nullable=False, index=True)
    kind = db.Column(db.String(64), nullable=False, index=True)
    status = db.Column(db.String(20), nullable=False, default="pending", index=True)
    requested_by_admin_id = db.Column(db.Integer, nullable=True)
    payload_json = db.Column(db.Text, nullable=False, default="{}")
    result_json = db.Column(db.Text, nullable=True)
    error_message = db.Column(db.Text, nullable=True)
    created_at = db.Column(db.DateTime, nullable=False, default=utc_now)
    started_at = db.Column(db.DateTime, nullable=True)
    finished_at = db.Column(db.DateTime, nullable=True)
