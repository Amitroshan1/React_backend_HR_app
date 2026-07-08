"""ATS business logic."""
from __future__ import annotations

import secrets
from datetime import date, datetime, timedelta

from . import db
from .datetime_utils import isoformat_api, utc_now
from .models.recruitment import Candidate, JobRequisition, Offer
from .models.assessment import AssessmentInvite
from .email import send_assessment_invite_email
from flask import current_app
from flask_jwt_extended import get_jwt


CANDIDATE_STAGES = (
    "sourced",
    "screening",
    "assessment",
    "interview",
    "offer",
    "hired",
    "rejected",
)


def list_requisitions(*, status: str | None = None) -> list[dict]:
    q = JobRequisition.query.order_by(JobRequisition.created_at.desc())
    if status and status.lower() != "all":
        q = q.filter(JobRequisition.status == status.lower())
    return [r.to_dict() for r in q.all()]


def create_requisition(data: dict, *, created_by: str) -> JobRequisition:
    title = (data.get("title") or "").strip()
    if not title:
        raise ValueError("title is required")
    row = JobRequisition(
        title=title,
        circle=(data.get("circle") or "").strip() or None,
        emp_type=(data.get("emp_type") or "").strip() or None,
        headcount=int(data.get("headcount") or 1),
        status=(data.get("status") or "open").strip().lower(),
        description=(data.get("description") or "").strip() or None,
        created_by=created_by,
    )
    db.session.add(row)
    db.session.commit()
    return row


def update_requisition(req_id: int, data: dict) -> JobRequisition:
    row = JobRequisition.query.get(req_id)
    if not row:
        raise ValueError("Requisition not found")
    for key in ("title", "circle", "emp_type", "description", "status"):
        if key in data:
            val = data.get(key)
            if key == "status":
                setattr(row, key, (val or row.status).strip().lower())
            elif key in ("circle", "emp_type"):
                setattr(row, key, (val or "").strip() or None)
            elif key == "title":
                setattr(row, key, (val or "").strip())
            else:
                setattr(row, key, (val or "").strip() or None)
    if "headcount" in data:
        row.headcount = int(data.get("headcount") or row.headcount)
    db.session.commit()
    return row


def list_candidates(*, requisition_id: int | None = None, stage: str | None = None) -> list[dict]:
    q = Candidate.query.order_by(Candidate.updated_at.desc(), Candidate.created_at.desc())
    if requisition_id:
        q = q.filter(Candidate.requisition_id == requisition_id)
    if stage and stage.lower() != "all":
        q = q.filter(Candidate.stage == stage.lower())
    return [c.to_dict() for c in q.all()]


def create_candidate(data: dict) -> Candidate:
    full_name = (data.get("full_name") or data.get("name") or "").strip()
    email = (data.get("email") or "").strip().lower()
    if not full_name or not email:
        raise ValueError("full_name and email are required")
    row = Candidate(
        requisition_id=data.get("requisition_id"),
        full_name=full_name,
        email=email,
        mobile=(data.get("mobile") or "").strip() or None,
        stage=(data.get("stage") or "sourced").strip().lower(),
        notes=(data.get("notes") or "").strip() or None,
    )
    db.session.add(row)
    db.session.commit()
    return row


def update_candidate_stage(candidate_id: int, stage: str, notes: str | None = None) -> Candidate:
    stage = (stage or "").strip().lower()
    if stage not in CANDIDATE_STAGES:
        raise ValueError(f"stage must be one of: {', '.join(CANDIDATE_STAGES)}")
    row = Candidate.query.get(candidate_id)
    if not row:
        raise ValueError("Candidate not found")
    row.stage = stage
    row.updated_at = utc_now()
    if notes is not None:
        row.notes = notes.strip() or row.notes
    db.session.commit()
    return row


def send_candidate_assessment(candidate_id: int, *, department: str | None = None) -> dict:
    from .Human_resource import (
        ASSESSMENT_DURATION_MINUTES,
        ASSESSMENT_LINK_TTL_MINUTES,
        _assessment_hash_token,
    )
    from .email_validation import personal_email_validation_error

    row = Candidate.query.get(candidate_id)
    if not row:
        raise ValueError("Candidate not found")
    dept = (department or "").strip()
    if not dept and row.requisition:
        dept = row.requisition.emp_type or row.requisition.circle or "General"
    if not dept:
        dept = "General"

    email_err = personal_email_validation_error(row.email)
    if email_err:
        raise ValueError(email_err)

    raw_token = secrets.token_urlsafe(48)
    invite = AssessmentInvite(
        full_name=row.full_name,
        department=dept,
        candidate_email=row.email,
        token_hash=_assessment_hash_token(raw_token),
        expires_at=utc_now() + timedelta(minutes=ASSESSMENT_LINK_TTL_MINUTES),
        duration_minutes=ASSESSMENT_DURATION_MINUTES,
        status="invited",
    )
    db.session.add(invite)
    db.session.flush()
    row.assessment_invite_id = invite.id
    row.stage = "assessment"
    row.updated_at = utc_now()
    db.session.commit()

    hr_email = (get_jwt() or {}).get("email")
    send_assessment_invite_email(
        to_email=row.email,
        candidate_name=row.full_name,
        department=dept,
        token=raw_token,
        valid_minutes=ASSESSMENT_LINK_TTL_MINUTES,
        cc_emails=[hr_email] if hr_email else None,
    )
    base_url = (current_app.config.get("BASE_URL") or "").rstrip("/")
    return {
        "candidate": row.to_dict(),
        "assessment_invite_id": invite.id,
        "link": f"{base_url}/assessment?t={raw_token}",
    }


def create_or_update_offer(candidate_id: int, data: dict) -> Offer:
    row = Candidate.query.get(candidate_id)
    if not row:
        raise ValueError("Candidate not found")
    offer = Offer.query.filter_by(candidate_id=candidate_id).first()
    if not offer:
        offer = Offer(candidate_id=candidate_id)
        db.session.add(offer)
    if "annual_ctc" in data:
        new_ctc = float(data["annual_ctc"]) if data.get("annual_ctc") is not None else None
        if new_ctc is not None:
            req = row.requisition
            from .compensation_band_service import validate_ctc_for_position
            grade = (req.title if req else None) or "General"
            band_err = validate_ctc_for_position(
                circle=(req.circle if req else "") or "",
                emp_type=(req.emp_type if req else "") or "",
                grade=grade,
                proposed_annual_ctc=new_ctc,
            )
            if band_err:
                raise ValueError(band_err)
        offer.annual_ctc = new_ctc
    if "joining_date" in data and data.get("joining_date"):
        offer.joining_date = date.fromisoformat(str(data["joining_date"])[:10])
    if "status" in data:
        offer.status = (data.get("status") or offer.status).strip().lower()
    if "notes" in data:
        offer.notes = (data.get("notes") or "").strip() or None
    row.stage = "offer"
    row.updated_at = utc_now()
    db.session.commit()
    return offer


def send_candidate_offer_email(candidate_id: int) -> dict:
    """Email offer letter PDF to candidate with acceptance link."""
    import base64

    from .offer_letter_service import build_offer_letter_payload, generate_offer_letter_pdf
    from .email import send_offer_letter_email
    from .offer_acceptance_service import issue_acceptance_token, acceptance_link

    row = Candidate.query.get(candidate_id)
    if not row:
        raise ValueError("Candidate not found")
    if not row.offer:
        raise ValueError("Offer details are required before sending")

    raw_token = issue_acceptance_token(candidate_id)
    accept_url = acceptance_link(raw_token)

    payload = build_offer_letter_payload(candidate_id)
    pdf_buffer = generate_offer_letter_pdf(candidate_id)
    pdf_bytes = pdf_buffer.read()
    cand = payload.get("candidate") or {}
    role = payload.get("role") or {}
    offer = payload.get("offer") or {}

    attachments = [{
        "name": "offer-letter.pdf",
        "content": base64.b64encode(pdf_bytes).decode("ascii"),
        "mime_type": "application/pdf",
    }]
    hr_email = (get_jwt() or {}).get("email")
    sent = send_offer_letter_email(
        to_email=row.email,
        candidate_name=cand.get("full_name") or row.full_name,
        role_title=role.get("title") or "—",
        annual_ctc=offer.get("annual_ctc"),
        joining_date=offer.get("joining_date"),
        accept_url=accept_url,
        cc_emails=[hr_email] if hr_email else None,
        attachments=attachments,
    )
    if not sent:
        raise ValueError("Failed to send offer email")
    if row.offer:
        row.offer.status = "sent"
    row.updated_at = utc_now()
    db.session.commit()
    return {"candidate": row.to_dict(), "email_sent": True, "accept_url": accept_url}


def candidate_signup_payload(candidate_id: int) -> dict:
    row = Candidate.query.get(candidate_id)
    if not row:
        raise ValueError("Candidate not found")
    req = row.requisition
    offer = row.offer
    joining = offer.joining_date if offer and offer.joining_date else date.today()
    emp_type = (req.emp_type if req else None) or "Permanent"
    circle = (req.circle if req else None) or ""
    user_name = row.email.split("@")[0][:120] if row.email else f"cand{row.id}"
    return {
        "candidate_id": row.id,
        "signup": {
            "user_name": user_name,
            "first_name": row.full_name,
            "email": row.email,
            "mobile": row.mobile or "",
            "emp_id": "",
            "doj": joining.isoformat(),
            "emp_type": emp_type,
            "circle": circle,
            "designation": req.title if req else "",
        },
        "offer_annual_ctc": offer.annual_ctc if offer else None,
        "band_hint": _offer_band_hint(row),
    }


def _offer_band_hint(candidate: Candidate) -> dict | None:
    req = candidate.requisition
    offer = candidate.offer
    if not req or not offer or offer.annual_ctc is None:
        return None
    from .compensation_band_service import band_for_position, validate_ctc_for_position
    grade = (req.title or "General").strip() or "General"
    band = band_for_position(circle=req.circle or "", emp_type=req.emp_type or "", grade=grade)
    err = validate_ctc_for_position(
        circle=req.circle or "",
        emp_type=req.emp_type or "",
        grade=grade,
        proposed_annual_ctc=float(offer.annual_ctc),
    )
    return {
        "grade": grade,
        "band": band.to_dict() if band else None,
        "within_band": err is None,
        "band_message": err,
    }
