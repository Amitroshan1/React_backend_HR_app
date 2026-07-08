"""Post-signup hire completion: link ATS candidate, stage, draft CTC."""
from __future__ import annotations

from . import db
from .datetime_utils import utc_now
from .models.recruitment import Candidate
from .models.ctc_breakup import CTCBreakup
from .models.Admin_models import Admin


def complete_hire_from_signup(
    admin: Admin,
    *,
    candidate_id: int | None,
    offer_annual_ctc: float | None = None,
) -> dict:
    if not candidate_id or not admin:
        return {}
    cand = Candidate.query.get(int(candidate_id))
    if not cand:
        return {"warning": "Candidate record not found"}
    cand.admin_id = admin.id
    cand.stage = "hired"
    cand.updated_at = utc_now()

    annual = offer_annual_ctc
    if annual is None and cand.offer and cand.offer.annual_ctc is not None:
        annual = float(cand.offer.annual_ctc)

    has_draft_ctc = False
    if annual and annual > 0:
        row = CTCBreakup.query.filter_by(admin_id=admin.id).first()
        if not row:
            row = CTCBreakup(admin_id=admin.id)
            db.session.add(row)
        if not row.annual_ctc:
            row.annual_ctc = float(annual)
            row.annual_ctc_computed = float(annual)
            has_draft_ctc = True

    return {
        "candidate_id": cand.id,
        "stage": cand.stage,
        "admin_id": admin.id,
        "draft_ctc_seeded": has_draft_ctc,
    }


def hire_progress_for_candidate(candidate_id: int) -> dict:
    cand = Candidate.query.get(candidate_id)
    if not cand:
        raise ValueError("Candidate not found")
    offer = cand.offer
    has_draft_ctc = False
    if cand.admin_id:
        ctc = CTCBreakup.query.filter_by(admin_id=cand.admin_id).first()
        has_draft_ctc = bool(ctc and (ctc.annual_ctc or ctc.annual_ctc_computed))
    steps = {
        "offer_saved": bool(offer),
        "offer_sent": bool(offer and offer.status in ("sent", "accepted")),
        "offer_accepted": bool(offer and offer.accepted_at),
        "onboarded": bool(cand.admin_id),
        "draft_ctc": has_draft_ctc,
    }
    return {
        "candidate_id": cand.id,
        "stage": cand.stage,
        "admin_id": cand.admin_id,
        "steps": steps,
        "offer": offer.to_dict() if offer else None,
    }
