"""ATS offer letter PDF generation."""
from __future__ import annotations

from datetime import date
from io import BytesIO

from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas

from .pdf_watermark import install_page_watermark

from . import tds_settings as tds_cfg
from .datetime_utils import isoformat_api, utc_now
from .models.recruitment import Candidate, Offer


def build_offer_letter_payload(candidate_id: int) -> dict:
    row = Candidate.query.get(candidate_id)
    if not row:
        raise ValueError("Candidate not found")
    offer = row.offer
    if not offer:
        raise ValueError("Offer details are required before generating the letter")
    req = row.requisition
    employer = tds_cfg.employer_details()
    joining = offer.joining_date or date.today()

    return {
        "generated_at": isoformat_api(utc_now()),
        "employer": employer,
        "candidate": {
            "full_name": row.full_name,
            "email": row.email,
            "mobile": row.mobile,
        },
        "role": {
            "title": req.title if req else "—",
            "circle": (req.circle if req else None) or "—",
            "emp_type": (req.emp_type if req else None) or "—",
        },
        "offer": {
            "annual_ctc": float(offer.annual_ctc) if offer.annual_ctc is not None else None,
            "joining_date": joining.isoformat(),
            "status": offer.status,
            "notes": (offer.notes or "").strip() or None,
        },
    }


def generate_offer_letter_pdf(candidate_id: int) -> BytesIO:
    payload = build_offer_letter_payload(candidate_id)
    buffer = BytesIO()
    c = canvas.Canvas(buffer, pagesize=A4)
    width, height = A4
    install_page_watermark(c, A4)
    left = 48
    y = height - 56

    def line(text: str, *, bold: bool = False, size: int = 11, gap: int = 6):
        nonlocal y
        if y < 72:
            c.showPage()
            y = height - 56
        c.setFont("Helvetica-Bold" if bold else "Helvetica", size)
        c.drawString(left, y, text[:110])
        y -= size + gap

    employer = payload["employer"] or {}
    cand = payload["candidate"]
    role = payload["role"]
    offer = payload["offer"]

    line(employer.get("legal_name") or employer.get("name") or "Company", bold=True, size=14)
    if employer.get("address"):
        line(employer["address"], size=9, gap=4)
    y -= 8
    line(f"Date: {date.today().strftime('%d %B %Y')}", size=10)
    y -= 4
    line("OFFER OF EMPLOYMENT", bold=True, size=13)
    y -= 4
    line(f"Dear {cand.get('full_name') or 'Candidate'},", size=11)
    y -= 2
    line(
        f"We are pleased to offer you the position of {role.get('title')} "
        f"in {role.get('emp_type')} ({role.get('circle')}).",
        size=11,
        gap=8,
    )
    if offer.get("annual_ctc") is not None:
        line(f"Annual CTC: ₹ {offer['annual_ctc']:,.0f}", bold=True, size=11)
    line(f"Date of joining: {offer.get('joining_date')}", size=11)
    if offer.get("notes"):
        line(f"Notes: {offer['notes']}", size=10, gap=8)
    y -= 8
    line("This offer is subject to successful completion of background verification", size=10)
    line("and submission of required documents on joining.", size=10, gap=12)
    line("We look forward to welcoming you to the team.", size=11, gap=24)
    line("Authorised Signatory", size=11)
    line("Human Resources", size=10)

    c.save()
    buffer.seek(0)
    return buffer
