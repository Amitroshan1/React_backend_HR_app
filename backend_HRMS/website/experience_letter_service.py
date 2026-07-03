"""Experience / service certificate PDF for exited employees."""
from __future__ import annotations

from io import BytesIO

from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas

from .relieving_letter_service import build_relieving_letter_payload


def generate_experience_letter_pdf(admin_id: int) -> BytesIO:
    payload = build_relieving_letter_payload(admin_id)
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
        c.drawString(left, y, str(text)[:100])
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
    exit_info = payload["exit"]

    line(employer.get("name") or "Employer", bold=True, size=14)
    line("EXPERIENCE CERTIFICATE", bold=True, size=13)
    line(f"Date: {payload['generated_at'][:10]}", size=10)
    y -= 10

    paragraph("To whom it may concern,")
    y -= 4

    tenure = ""
    if payload.get("doj") and exit_info.get("last_working_day"):
        tenure = f" from {payload['doj']} to {exit_info['last_working_day']}"

    paragraph(
        f"This is to certify that {emp['name']} (Employee ID: {emp['emp_id']}) was employed with "
        f"{employer.get('name') or 'our organization'} as {emp['designation']} in the "
        f"{emp['department']} function at {emp['location']}{tenure}."
    )

    paragraph(
        f"During this period, {emp['name']} was associated with us in a professional capacity and "
        "carried out assigned responsibilities with diligence. This certificate is issued upon "
        "separation for whatever purpose it may serve."
    )

    if exit_info.get("exit_type"):
        paragraph(f"Mode of separation: {exit_info['exit_type']}.")

    y -= 12
    line("For " + (employer.get("name") or "Employer"), bold=True, size=10)
    line("Authorized Signatory — Human Resources", size=10)
    line("This is a system-generated document.", size=8, gap=2)

    c.showPage()
    c.save()
    buffer.seek(0)
    return buffer
