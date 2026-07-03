"""CTC annexure PDF — Indian offer-letter style breakup."""
from __future__ import annotations

from io import BytesIO

from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas

from . import tds_settings as tds_cfg
from .datetime_utils import isoformat_api, utc_now
from .models.Admin_models import Admin
from .models.ctc_breakup import CTCBreakup
from .models.employee_accounts import EmployeeAccounts


def _fmt_money(val) -> str:
    return f"{float(val or 0):,.2f}"


def _monthly_rows(ctc: dict) -> list[tuple[str, float]]:
    rows: list[tuple[str, float]] = []
    basic = float(ctc.get("basic_salary") or 0)
    da = float(ctc.get("dearness_allowance") or 0)
    if basic > 0:
        rows.append(("Basic", basic))
    if da > 0:
        rows.append(("Dearness Allowance (DA)", da))
    hra = float(ctc.get("hra") or 0)
    if hra > 0:
        pct = ctc.get("hra_pct")
        label = f"HRA ({pct}%)" if pct is not None else "HRA"
        rows.append((label, hra))
    head_map = (
        ("Special Allowance", "special_allowance"),
        ("Conveyance", "conveyance_allowance"),
        ("Medical Allowance", "medical_allowance"),
        ("LTA", "lta_allowance"),
    )
    shown = False
    for label, key in head_map:
        val = float(ctc.get(key) or 0)
        if val > 0:
            rows.append((label, val))
            shown = True
    if not shown:
        legacy = float(ctc.get("other_allowance") or 0)
        if legacy > 0:
            rows.append(("Other Allowance", legacy))
    return rows


def build_ctc_annexure_payload(admin_id: int) -> dict:
    admin = Admin.query.get(admin_id)
    if not admin:
        raise ValueError("Employee not found")

    row = CTCBreakup.query.filter_by(admin_id=admin_id).first()
    if not row:
        raise ValueError("No CTC breakup on file")

    ctc = row.to_dict()
    profile = EmployeeAccounts.query.filter_by(admin_id=admin_id).first()
    employer = tds_cfg.employer_details()

    emp_name = (
        getattr(admin, "first_name", None)
        or getattr(admin, "user_name", None)
        or "Employee"
    ).strip()
    emp_id = (getattr(admin, "emp_id", None) or "").strip() or "—"
    designation = (getattr(profile, "designation", None) or "").strip() or "—"
    location = (getattr(profile, "location", None) or "").strip() or "—"

    fixed_ctc = float(ctc.get("annual_ctc_computed") or ctc.get("fixed_ctc_annual") or 0)
    variable = float(ctc.get("variable_ctc_annual") or 0)
    total_ctc = float(ctc.get("total_ctc_annual") or (fixed_ctc + variable))

    return {
        "generated_at": isoformat_api(utc_now()),
        "employer": employer,
        "employee": {
            "name": emp_name,
            "emp_id": emp_id,
            "designation": designation,
            "location": location,
        },
        "ctc": ctc,
        "monthly_earnings": _monthly_rows(ctc),
        "monthly_deductions": [
            ("EPF (Employee)", float(ctc.get("epf") or 0)),
            ("ESIC (Employee)", float(ctc.get("esic") or 0)),
            (
                f"Professional Tax ({ctc.get('ptax_state') or 'MH'})",
                float(ctc.get("ptax") or 0),
            ),
        ],
        "annual_employer": [
            ("Employer PF", float(ctc.get("employer_pf_yearly") or 0)),
            ("PF Admin Charges", float(ctc.get("pf_admin_yearly") or 0)),
            ("EDLI", float(ctc.get("edli_yearly") or 0)),
            ("Statutory Bonus", float(ctc.get("statutory_bonus_yearly") or 0)),
            ("LWF (Employer)", float(ctc.get("lwf_employer_yearly") or 0)),
            ("Employer ESIC", float(ctc.get("employer_esic_yearly") or 0)),
            ("Gratuity", float(ctc.get("gratuity_yearly") or 0)),
            ("Mediclaim", float(ctc.get("mediclaim_yearly") or 0)),
        ],
        "fixed_ctc_annual": fixed_ctc,
        "variable_ctc_annual": variable,
        "total_ctc_annual": total_ctc,
        "disclaimer": (
            "This annexure is system-generated for salary structuring. "
            "PF Admin (0.5%) and EDLI (0.5%) on capped PF wages are included when enabled. "
            "Actual payroll may vary with attendance, revisions, and statutory updates."
        ),
    }


def generate_ctc_annexure_pdf(admin_id: int) -> BytesIO:
    payload = build_ctc_annexure_payload(admin_id)
    buffer = BytesIO()
    c = canvas.Canvas(buffer, pagesize=A4)
    width, height = A4
    left = 42
    right = width - 42
    y = height - 42

    def ensure_space(need: float = 40):
        nonlocal y
        if y < need:
            c.showPage()
            y = height - 42

    def line(text: str, *, bold: bool = False, size: int = 10, gap: int = 2):
        nonlocal y
        ensure_space(size + gap + 20)
        c.setFont("Helvetica-Bold" if bold else "Helvetica", size)
        c.drawString(left, y, str(text)[:110])
        y -= size + gap

    def section(title: str):
        nonlocal y
        y -= 4
        line(title, bold=True, size=11)
        y -= 2

    def money_row(label: str, amount: float, annual: bool = False):
        nonlocal y
        if amount <= 0 and label not in ("Gross Salary", "Net Salary", "Total Deductions"):
            return
        suffix = " (p.a.)" if annual else " (p.m.)"
        ensure_space(18)
        c.setFont("Helvetica", 9)
        c.drawString(left + 8, y, f"{label}{suffix}")
        c.drawRightString(right, y, f"Rs. {_fmt_money(amount)}")
        y -= 12

    employer = payload["employer"]
    emp = payload["employee"]
    ctc = payload["ctc"]

    line(employer.get("name") or "Employer", bold=True, size=14)
    line("CTC Annexure — Salary Structure", bold=True, size=12)
    line(f"Generated: {payload['generated_at']}", size=8)
    y -= 6

    section("Employee Details")
    for label, val in (
        ("Name", emp["name"]),
        ("Employee ID", emp["emp_id"]),
        ("Designation", emp["designation"]),
        ("Location", emp["location"]),
    ):
        line(f"{label}: {val}")

    section("A. Monthly Earnings")
    for label, amt in payload["monthly_earnings"]:
        money_row(label, amt)
    money_row("Gross Salary", float(ctc.get("gross_salary") or 0))

    section("B. Monthly Deductions")
    for label, amt in payload["monthly_deductions"]:
        money_row(label, amt)
    money_row("Total Deductions", float(ctc.get("deductions_total") or 0))

    section("C. Net Take-Home (Monthly)")
    money_row("Net Salary", float(ctc.get("net_salary") or 0))

    section("D. Annual Employer Contributions")
    for label, amt in payload["annual_employer"]:
        money_row(label, amt, annual=True)

    section("E. Annual CTC Summary")
    money_row("Fixed CTC", payload["fixed_ctc_annual"], annual=True)
    if payload["variable_ctc_annual"] > 0:
        money_row("Variable Pay", payload["variable_ctc_annual"], annual=True)
    money_row("Total CTC", payload["total_ctc_annual"], annual=True)

    y -= 8
    ensure_space(30)
    c.setFont("Helvetica-Oblique", 8)
    disclaimer = payload["disclaimer"]
    for i in range(0, len(disclaimer), 95):
        c.drawString(left, y, disclaimer[i : i + 95])
        y -= 10

    c.showPage()
    c.save()
    buffer.seek(0)
    return buffer
