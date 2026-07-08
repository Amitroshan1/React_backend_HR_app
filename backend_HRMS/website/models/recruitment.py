"""Lightweight ATS: job requisitions, candidates, offers."""
from __future__ import annotations

from .. import db
from ..datetime_utils import isoformat_api, utc_now


class JobRequisition(db.Model):
    __tablename__ = "job_requisitions"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    title = db.Column(db.String(200), nullable=False)
    circle = db.Column(db.String(80), nullable=True, index=True)
    emp_type = db.Column(db.String(80), nullable=True, index=True)
    headcount = db.Column(db.Integer, nullable=False, default=1)
    status = db.Column(db.String(20), nullable=False, default="open", index=True)
    description = db.Column(db.Text, nullable=True)
    created_by = db.Column(db.String(120), nullable=True)
    created_at = db.Column(db.DateTime, nullable=False, default=utc_now)

    candidates = db.relationship("Candidate", backref="requisition", lazy=True)

    def to_dict(self):
        return {
            "id": self.id,
            "title": self.title,
            "circle": self.circle,
            "emp_type": self.emp_type,
            "headcount": self.headcount,
            "status": self.status,
            "description": self.description,
            "created_by": self.created_by,
            "created_at": isoformat_api(self.created_at),
            "candidate_count": len(self.candidates or []),
        }


class Candidate(db.Model):
    __tablename__ = "candidates"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    requisition_id = db.Column(
        db.Integer,
        db.ForeignKey("job_requisitions.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    full_name = db.Column(db.String(150), nullable=False)
    email = db.Column(db.String(150), nullable=False, index=True)
    mobile = db.Column(db.String(20), nullable=True)
    stage = db.Column(db.String(30), nullable=False, default="sourced", index=True)
    assessment_invite_id = db.Column(db.Integer, nullable=True, index=True)
    admin_id = db.Column(db.Integer, db.ForeignKey("admins.id", ondelete="SET NULL"), nullable=True)
    notes = db.Column(db.Text, nullable=True)
    created_at = db.Column(db.DateTime, nullable=False, default=utc_now)
    updated_at = db.Column(db.DateTime, nullable=True, onupdate=utc_now)

    offer = db.relationship("Offer", backref="candidate", uselist=False, lazy=True)

    def to_dict(self):
        req = self.requisition
        off = self.offer
        return {
            "id": self.id,
            "requisition_id": self.requisition_id,
            "requisition_title": req.title if req else None,
            "full_name": self.full_name,
            "email": self.email,
            "mobile": self.mobile,
            "stage": self.stage,
            "assessment_invite_id": self.assessment_invite_id,
            "admin_id": self.admin_id,
            "notes": self.notes,
            "created_at": isoformat_api(self.created_at),
            "updated_at": isoformat_api(self.updated_at),
            "offer": off.to_dict() if off else None,
        }


class Offer(db.Model):
    __tablename__ = "candidate_offers"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    candidate_id = db.Column(
        db.Integer,
        db.ForeignKey("candidates.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
        index=True,
    )
    annual_ctc = db.Column(db.Float, nullable=True)
    joining_date = db.Column(db.Date, nullable=True)
    status = db.Column(db.String(20), nullable=False, default="draft", index=True)
    notes = db.Column(db.Text, nullable=True)
    acceptance_token_hash = db.Column(db.String(64), nullable=True, index=True)
    acceptance_expires_at = db.Column(db.DateTime, nullable=True)
    accepted_at = db.Column(db.DateTime, nullable=True)
    accepted_by_name = db.Column(db.String(150), nullable=True)
    created_at = db.Column(db.DateTime, nullable=False, default=utc_now)

    def to_dict(self):
        return {
            "id": self.id,
            "candidate_id": self.candidate_id,
            "annual_ctc": self.annual_ctc,
            "joining_date": self.joining_date.isoformat() if self.joining_date else None,
            "status": self.status,
            "notes": self.notes,
            "accepted_at": isoformat_api(self.accepted_at) if self.accepted_at else None,
            "accepted_by_name": self.accepted_by_name,
            "acceptance_pending": bool(self.acceptance_token_hash and not self.accepted_at),
            "created_at": isoformat_api(self.created_at),
        }
