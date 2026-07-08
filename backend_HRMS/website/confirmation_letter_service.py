"""Confirmation letter PDF after HR probation confirmation."""
from __future__ import annotations

from datetime import date
from io import BytesIO

from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas

from . import tds_settings as tds_cfg
from .datetime_utils import isoformat_api, utc_now
from .models.Admin_models import Admin
from .models.emp_detail_models import Employee
from .models.probation import ProbationReview
from .probation_utils import STATUS_HR_CONFIRMED, infer_status_from_row


def _confirmed_review(admin_id: int) -> ProbationReview | None:
    rows = (
        ProbationReview.query.filter_by(admin_id=admin_id)
        .order_by(ProbationReview.hr_decided_at.desc(), ProbationReview.id.desc())
        .all()
    )
    for row in rows:
        if infer_status_from_row(row) == STATUS_HR_CONFIRMED or row.hr_decision == "confirmed":
            return row
    return None


def build_confirmation_letter_payload(admin_id: int) -> dict:
    admin = Admin.query.get(admin_id)
    if not admin:
        raise ValueError("Employee not found")

    review = _confirmed_review(admin_id)
    if not review:
        raise ValueError("Confirmation letter is available only after HR confirms probation")

    employee = Employee.query.filter_by(admin_id=admin_id).first()
    employer = tds_cfg.employer_details()
    emp_name = (
        (employee.name if employee else None)
        or admin.first_name
        or admin.user_name
        or "Employee"
    )
    designation = (employee.designation if employee else None) or "—"
    confirmed_on = review.hr_decided_at.date() if review.hr_decided_at else date.today()

    return {
        "generated_at": isoformat_api(utc_now()),
        "employer": employer,
        "employee": {
            "name": emp_name,
            "emp_id": (admin.emp_id or "").strip() or "—",
            "email": (admin.email or "").strip() or "—",
            "designation": designation,
            "department": (admin.emp_type or "").strip() or "—",
            "circle": (admin.circle or "").strip() or "—",
            "doj": admin.doj.isoformat() if admin.doj else None,
        },
        "confirmation": {
            "confirmed_on": confirmed_on.isoformat(),
            "probation_end_date": review.probation_end_date.isoformat() if review.probation_end_date else None,
            "hr_notes": (review.hr_notes or "").strip() or None,
        },
    }


def generate_confirmation_letter_pdf(admin_id: int) -> BytesIO:
    payload = build_confirmation_letter_payload(admin_id)
    buffer = BytesIO()
    c = canvas.Canvas(buffer, pagesize=A4)
    width, height = A4
    left = 48
    right = width - 48
    y = height - 56

    def line(text: str, *, bold: bool = False, size: int = 11, gap: int = 4):
        nonlocal y
        if y < 72:
            c.showPage()
            y = height - 56
        c.setFont("Helvetica-Bold" if bold else "Helvetica", size)
        c.drawString(left, y, str(text)[:110])
        y -= size + gap

    def paragraph(text: str, size: int = 11):
        nonlocal y
        words = str(text or "").split()
        current = ""
        for word in words:
            trial = f"{current} {word}".strip()
            if c.stringWidth(trial, "Helvetica", size) > (right - left):
                line(current, size=size, gap=2)
                current = word
            else:
                current = trial
        if current:
            line(current, size=size, gap=6)

    employer = payload["employer"]
    emp = payload["employee"]
    conf = payload["confirmation"]

    line(employer.get("name") or "Employer", bold=True, size=14)
    addr = (employer.get("address") or "").strip()
    if addr:
        paragraph(addr, size=9)
    y -= 8
    line("EMPLOYEE CONFIRMATION LETTER", bold=True, size=13)
    line(f"Date: {payload['generated_at'][:10]}", size=10)
    y -= 10

    paragraph(f"Dear {emp['name']},")
    y -= 4
    paragraph(
        "We are pleased to inform you that you have successfully completed your probation period "
        "and your employment with the organization stands confirmed with effect from the date mentioned below."
    )
    y -= 6
    line(f"Employee ID: {emp['emp_id']}", size=10)
    line(f"Designation: {emp['designation']}", size=10)
    line(f"Department: {emp['department']}", size=10)
    line(f"Circle / Location: {emp['circle']}", size=10)
    if emp.get("doj"):
        line(f"Date of Joining: {emp['doj']}", size=10)
    if conf.get("probation_end_date"):
        line(f"Probation End Date: {conf['probation_end_date']}", size=10)
    line(f"Confirmation Effective Date: {conf['confirmed_on']}", size=10, bold=True)
    y -= 8
    paragraph(
        "You are expected to continue demonstrating the same level of dedication, professionalism, "
        "and performance. All other terms and conditions of your employment remain unchanged."
    )
    y -= 12
    line("For " + (employer.get("name") or "Employer"), size=10)
    line("Human Resources", size=10)
    line("Authorised Signatory", size=10)

    c.save()
    buffer.seek(0)
    return buffer
