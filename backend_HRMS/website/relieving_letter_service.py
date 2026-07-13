"""Relieving letter PDF for exited employees."""
from __future__ import annotations

from io import BytesIO

from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas

from .pdf_watermark import install_page_watermark

from . import tds_settings as tds_cfg
from .datetime_utils import isoformat_api, utc_now
from .models.Admin_models import Admin, EmployeeExitHistory
from .models.employee_accounts import EmployeeAccounts


def build_relieving_letter_payload(admin_id: int) -> dict:
    admin = Admin.query.get(admin_id)
    if not admin:
        raise ValueError("Employee not found")
    if not getattr(admin, "is_exited", False):
        raise ValueError("Relieving letter is available only after exit is processed")

    hist = (
        EmployeeExitHistory.query.filter_by(admin_id=admin_id)
        .order_by(EmployeeExitHistory.id.desc())
        .first()
    )
    profile = EmployeeAccounts.query.filter_by(admin_id=admin_id).first()
    employer = tds_cfg.employer_details()

    emp_name = (
        (getattr(profile, "name", None) or "").strip()
        or (getattr(admin, "first_name", None) or "").strip()
        or (getattr(admin, "user_name", None) or "").strip()
        or "Employee"
    )
    designation = (getattr(profile, "designation", None) or "").strip() or "—"
    location = (getattr(profile, "location", None) or admin.circle or "").strip() or "—"
    lwd = None
    if hist and hist.last_working_day:
        lwd = hist.last_working_day
    elif admin.exit_date:
        lwd = admin.exit_date

    doj = getattr(profile, "date_of_joining", None) or getattr(admin, "doj", None)

    return {
        "generated_at": isoformat_api(utc_now()),
        "employer": employer,
        "employee": {
            "name": emp_name,
            "emp_id": (admin.emp_id or "").strip() or "—",
            "email": (admin.email or "").strip() or "—",
            "designation": designation,
            "location": location,
            "department": (admin.emp_type or "").strip() or "—",
        },
        "exit": {
            "exit_type": (admin.exit_type or hist.exit_type if hist else None) or "Resigned",
            "exit_reason": (admin.exit_reason or hist.exit_reason if hist else None) or "",
            "last_working_day": lwd.isoformat() if lwd else None,
            "resignation_date": (
                hist.resignation_date_snapshot.isoformat()
                if hist and hist.resignation_date_snapshot
                else None
            ),
            "notice_shortfall_days": int(hist.notice_shortfall_days or 0) if hist else 0,
        },
        "doj": doj.isoformat() if doj else None,
    }


def generate_relieving_letter_pdf(admin_id: int) -> BytesIO:
    payload = build_relieving_letter_payload(admin_id)
    buffer = BytesIO()
    c = canvas.Canvas(buffer, pagesize=A4)
    width, height = A4
    install_page_watermark(c, A4)
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
    addr = (employer.get("address") or "").strip()
    if addr:
        paragraph(addr, size=9)
    y -= 8
    line("RELIEVING LETTER", bold=True, size=13)
    line(f"Date: {payload['generated_at'][:10]}", size=10)
    y -= 10

    paragraph(
        f"To whom it may concern,"
    )
    y -= 4
    paragraph(
        f"This is to certify that {emp['name']} (Employee ID: {emp['emp_id']}) was employed with "
        f"{employer.get('name') or 'the organization'} as {emp['designation']} "
        f"({emp['department']}) at {emp['location']}."
    )
    if payload.get("doj"):
        paragraph(f"Date of joining: {payload['doj']}.")
    if exit_info.get("last_working_day"):
        paragraph(
            f"Last working day: {exit_info['last_working_day']}. "
            f"Mode of separation: {exit_info['exit_type']}."
        )
    if exit_info.get("resignation_date"):
        paragraph(f"Resignation submitted on: {exit_info['resignation_date']}.")
    if int(exit_info.get("notice_shortfall_days") or 0) > 0:
        paragraph(
            f"Notice shortfall: {exit_info['notice_shortfall_days']} day(s) as recorded at exit."
        )

    y -= 6
    paragraph(
        "We confirm that the employee has been relieved from services and, to the best of our knowledge, "
        "has completed handover formalities applicable at the time of exit. "
        "We wish them success in their future endeavours."
    )
    y -= 16
    line("For " + (employer.get("name") or "Employer"), bold=True, size=10)
    line("Authorized Signatory — Human Resources", size=10)
    line("This is a system-generated document.", size=8, gap=2)

    c.showPage()
    c.save()
    buffer.seek(0)
    return buffer
