"""F&F settlement summary PDF."""
from __future__ import annotations

from io import BytesIO

from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas

from . import tds_settings as tds_cfg
from .datetime_utils import isoformat_api, utc_now
from .models.Admin_models import Admin
from .models.fnf_settlement import FnfSettlement


def _fmt_money(val) -> str:
    return f"{float(val or 0):,.2f}"


def generate_fnf_settlement_pdf(settlement_id: int) -> BytesIO:
    row = FnfSettlement.query.get(settlement_id)
    if not row:
        raise ValueError("Settlement not found")
    admin = Admin.query.get(row.admin_id)
    snap = row.snapshot if isinstance(row.snapshot, dict) else {}
    employer = tds_cfg.employer_details()

    emp_name = (
        (getattr(admin, "first_name", None) or "").strip()
        or (getattr(admin, "user_name", None) or "").strip()
        or "Employee"
    )
    emp_id = (getattr(admin, "emp_id", None) or "").strip() or "—"

    buffer = BytesIO()
    c = canvas.Canvas(buffer, pagesize=A4)
    width, height = A4
    left = 48
    right = width - 48
    y = height - 52

    def line(text: str, *, bold: bool = False, size: int = 10, gap: int = 3):
        nonlocal y
        if y < 60:
            c.showPage()
            y = height - 52
        c.setFont("Helvetica-Bold" if bold else "Helvetica", size)
        c.drawString(left, y, str(text)[:105])
        y -= size + gap

    def money_row(label: str, amount: float):
        nonlocal y
        if y < 60:
            c.showPage()
            y = height - 52
        c.setFont("Helvetica", 9)
        c.drawString(left + 8, y, label[:70])
        c.drawRightString(right, y, f"Rs. {_fmt_money(amount)}")
        y -= 12

    line(employer.get("name") or "Employer", bold=True, size=13)
    line("Full & Final Settlement Summary", bold=True, size=12)
    line(f"Generated: {isoformat_api(utc_now())[:10]}", size=8)
    y -= 6

    line(f"Employee: {emp_name} ({emp_id})", size=10)
    if row.separation_date:
        line(f"Separation date: {row.separation_date.isoformat()}")
    if row.last_working_day:
        line(f"Last working day: {row.last_working_day.isoformat()}")
    line(f"Status: {(row.status or 'draft').upper()}", bold=True)
    y -= 4

    earnings = snap.get("earnings") or {}
    deductions = snap.get("deductions") or {}

    line("Earnings", bold=True, size=11)
    for key, label in (
        ("pending_salary", "Pending salary"),
        ("leave_encashment", "Leave encashment"),
        ("gratuity", "Gratuity"),
        ("other_earnings", "Other earnings"),
    ):
        block = earnings.get(key) if isinstance(earnings.get(key), dict) else {}
        amt = block.get("amount") if isinstance(block, dict) else earnings.get(key)
        if isinstance(amt, (int, float)) and float(amt) != 0:
            money_row(label, float(amt))
        elif key == "gratuity" and isinstance(block, dict) and block.get("gratuity_amount"):
            money_row(label, float(block.get("gratuity_amount") or 0))
    money_row("Total earnings", float(earnings.get("total") or 0))

    y -= 4
    line("Deductions", bold=True, size=11)
    for key, label in (
        ("notice_recovery", "Notice recovery"),
        ("loan_recovery", "Loan recovery"),
        ("other_deductions", "Other deductions"),
    ):
        block = deductions.get(key) if isinstance(deductions.get(key), dict) else {}
        amt = block.get("amount") if isinstance(block, dict) else deductions.get(key)
        if isinstance(amt, (int, float)) and float(amt) != 0:
            money_row(label, float(amt))
    money_row("Total deductions", float(deductions.get("total") or 0))

    y -= 6
    line(f"Net payable: Rs. {_fmt_money(row.net_payable)}", bold=True, size=11)
    if row.note:
        y -= 4
        line(f"Note: {row.note}", size=9)

    c.showPage()
    c.save()
    buffer.seek(0)
    return buffer
