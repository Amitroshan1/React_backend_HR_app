"""Tokenized public offer acceptance (e-sign style)."""
from __future__ import annotations

import hashlib
import secrets
from datetime import timedelta

from flask import current_app

from . import db
from .datetime_utils import isoformat_api, utc_now
from .models.recruitment import Candidate, Offer

OFFER_ACCEPT_TTL_DAYS = 14


def _hash_token(raw_token: str) -> str:
    return hashlib.sha256(raw_token.encode("utf-8")).hexdigest()


def issue_acceptance_token(candidate_id: int) -> str:
    row = Candidate.query.get(candidate_id)
    if not row or not row.offer:
        raise ValueError("Offer details are required before sending acceptance link")
    raw = secrets.token_urlsafe(32)
    offer = row.offer
    offer.acceptance_token_hash = _hash_token(raw)
    offer.acceptance_expires_at = utc_now() + timedelta(days=OFFER_ACCEPT_TTL_DAYS)
    db.session.commit()
    return raw


def acceptance_link(raw_token: str) -> str:
    base = (current_app.config.get("BASE_URL") or "").rstrip("/")
    return f"{base}/offer-accept?t={raw_token}"


def _offer_for_token(raw_token: str) -> Offer | None:
    token = (raw_token or "").strip()
    if not token:
        return None
    return Offer.query.filter_by(acceptance_token_hash=_hash_token(token)).first()


def get_public_offer_context(raw_token: str) -> dict:
    offer = _offer_for_token(raw_token)
    if not offer:
        raise ValueError("Invalid or expired offer link")
    if offer.accepted_at:
        return _public_payload(offer, already_accepted=True)
    if offer.acceptance_expires_at and offer.acceptance_expires_at < utc_now():
        raise ValueError("This offer link has expired. Please contact HR for a new link.")
    return _public_payload(offer, already_accepted=False)


def accept_offer(raw_token: str, *, signer_name: str) -> dict:
    name = (signer_name or "").strip()
    if len(name) < 2:
        raise ValueError("Please enter your full name to accept the offer")
    offer = _offer_for_token(raw_token)
    if not offer:
        raise ValueError("Invalid or expired offer link")
    if offer.accepted_at:
        return _public_payload(offer, already_accepted=True)
    if offer.acceptance_expires_at and offer.acceptance_expires_at < utc_now():
        raise ValueError("This offer link has expired. Please contact HR for a new link.")
    offer.accepted_at = utc_now()
    offer.accepted_by_name = name[:150]
    offer.status = "accepted"
    cand = offer.candidate
    if cand:
        cand.updated_at = utc_now()
    db.session.commit()
    return _public_payload(offer, already_accepted=True)


def _public_payload(offer: Offer, *, already_accepted: bool) -> dict:
    cand = offer.candidate
    req = cand.requisition if cand else None
    return {
        "already_accepted": already_accepted,
        "candidate_name": cand.full_name if cand else None,
        "role_title": req.title if req else None,
        "circle": req.circle if req else None,
        "annual_ctc": offer.annual_ctc,
        "joining_date": offer.joining_date.isoformat() if offer.joining_date else None,
        "accepted_at": isoformat_api(offer.accepted_at) if offer.accepted_at else None,
        "accepted_by_name": offer.accepted_by_name,
        "offer_status": offer.status,
    }
