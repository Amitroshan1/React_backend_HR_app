"""Form 16 Part A/B — detailed computed summary, reconciliation, enhanced PDF."""
from __future__ import annotations

from datetime import date
from io import BytesIO

from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas

from . import payroll_tds_service as payroll_tds
from . import tax_declaration_service as tax_decl
from . import tds_settings as tds_cfg
from .commands.tds_logic import financial_year_for_date, fy_start_end, run_tds_projection
from .models.Admin_models import Admin
from .models.ctc_breakup import CTCBreakup
from .models.employee_accounts import EmployeeAccounts
from .models.monthly_payroll import MonthlyPayroll
from .models.news_feed import Form16


def _fmt_money(val: float) -> str:
    return f"{float(val or 0):,.2f}"


def _parse_doj(profile: dict | None, admin: Admin | None) -> date | None:
    profile = profile or {}
    if profile.get("date_of_joining"):
        try:
            return date.fromisoformat(str(profile["date_of_joining"])[:10])
        except ValueError:
            pass
    if admin and getattr(admin, "doj", None):
        return admin.doj
    return None


def _quarter_for_month(month_num: int) -> str:
    if month_num in (4, 5, 6):
        return "Q1"
    if month_num in (7, 8, 9):
        return "Q2"
    if month_num in (10, 11, 12):
        return "Q3"
    return "Q4"


def build_quarterly_tds_schedule(admin_id: int, financial_year: str) -> list[dict]:
    """Part A quarterly TDS from payroll (Apr–Mar)."""
    fy = tax_decl.normalize_financial_year(financial_year)
    fy_start, fy_end = fy_start_end(fy)
    quarters = {
        "Q1": {"label": "Apr–Jun", "gross": 0.0, "tds": 0.0},
        "Q2": {"label": "Jul–Sep", "gross": 0.0, "tds": 0.0},
        "Q3": {"label": "Oct–Dec", "gross": 0.0, "tds": 0.0},
        "Q4": {"label": "Jan–Mar", "gross": 0.0, "tds": 0.0},
    }
    for row in MonthlyPayroll.query.filter_by(admin_id=admin_id).all():
        try:
            y = int(row.year)
            m = int(row.month_num)
        except (TypeError, ValueError):
            continue
        d = date(y, m, 1)
        if not (fy_start <= d <= fy_end):
            continue
        q = _quarter_for_month(m)
        quarters[q]["gross"] += float(row.gross_salary_for_month or 0)
        quarters[q]["tds"] += float(
            row.tds_final if row.tds_final is not None else row.tds_computed or 0
        )

    out = []
    for code in ("Q1", "Q2", "Q3", "Q4"):
        out.append({
            "quarter": code,
            "period": quarters[code]["label"],
            "gross_salary": round(quarters[code]["gross"], 2),
            "tds_deducted": round(quarters[code]["tds"], 2),
        })
    return out


def build_chapter_via_schedule(deductions: dict | None) -> list[dict]:
    """Part B Chapter VI-A style lines from projection deductions."""
    deductions = deductions or {}
    lines = [
        ("Standard deduction", deductions.get("standard_deduction")),
        ("HRA exemption", deductions.get("hra_exemption")),
        ("Section 80C (incl. EPF)", deductions.get("section_80c_total")),
        ("Section 80CCD(1B)", deductions.get("section_80ccd1b")),
        ("Section 80D", deductions.get("section_80d")),
        ("Section 24(b) — home loan interest", deductions.get("section_24_interest")),
        ("LTA exemption", deductions.get("lta_exemption")),
        ("Section 80E", deductions.get("section_80e")),
        ("Section 80G", deductions.get("section_80g")),
        ("Other Chapter VI-A", deductions.get("other_deductions")),
        ("New regime deductions", deductions.get("new_regime_deductions")),
        ("Professional tax", deductions.get("ptax_annual")),
    ]
    return [
        {"section": label, "amount": round(float(val or 0), 2)}
        for label, val in lines
        if val is not None and float(val or 0) > 0
    ]


def _latest_uploaded_figures(admin_id: int, financial_year: str) -> dict | None:
    row = (
        Form16.query.filter_by(admin_id=admin_id, financial_year=financial_year)
        .order_by(Form16.id.desc())
        .first()
    )
    if not row:
        return None
    if not any([
        row.parsed_gross_salary,
        row.parsed_tds_deducted,
        row.parsed_taxable_income,
        row.parsed_annual_tax,
    ]):
        return None
    return {
        "form16_id": row.id,
        "file_path": row.file_path or None,
        "data_source": row.data_source or "upload",
        "certificate_type": getattr(row, "certificate_type", None) or row.data_source,
        "part_type": getattr(row, "part_type", None),
        "gross_salary": float(row.parsed_gross_salary or 0),
        "tds_deducted": float(row.parsed_tds_deducted or 0),
        "taxable_income": float(row.parsed_taxable_income or 0),
        "annual_tax": float(row.parsed_annual_tax or 0),
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }


def list_form16_certificates(admin_id: int, financial_year: str) -> list[dict]:
    fy = tax_decl.normalize_financial_year(financial_year)
    rows = (
        Form16.query.filter_by(admin_id=admin_id, financial_year=fy)
        .order_by(Form16.created_at.desc(), Form16.id.desc())
        .all()
    )
    out = []
    for row in rows:
        cert_type = (getattr(row, "certificate_type", None) or row.data_source or "upload_manual").lower()
        out.append({
            "id": row.id,
            "financial_year": row.financial_year,
            "file_path": row.file_path,
            "certificate_type": cert_type,
            "part_type": getattr(row, "part_type", None),
            "is_official_traces": cert_type == "official_traces",
            "data_source": row.data_source,
            "parsed_gross_salary": float(row.parsed_gross_salary) if row.parsed_gross_salary is not None else None,
            "parsed_tds_deducted": float(row.parsed_tds_deducted) if row.parsed_tds_deducted is not None else None,
            "created_at": row.created_at.isoformat() if row.created_at else None,
        })
    return out


def reconcile_form16_figures(
    computed: dict,
    uploaded: dict | None,
    *,
    financial_year: str,
    tolerance: float = 100.0,
) -> dict:
    """Pure comparison of computed vs uploaded Form 16 figures."""
    if not uploaded:
        return {
            "financial_year": financial_year,
            "has_uploaded_figures": False,
            "computed": computed,
            "uploaded": None,
            "differences": None,
            "match_status": "no_uploaded_data",
        }

    differences = {
        key: round(float(computed.get(key, 0)) - float(uploaded.get(key, 0)), 2)
        for key in ("gross_salary", "tds_deducted", "taxable_income", "annual_tax")
    }
    matched = all(abs(v) <= tolerance for v in differences.values())
    return {
        "financial_year": financial_year,
        "has_uploaded_figures": True,
        "computed": computed,
        "uploaded": uploaded,
        "differences": differences,
        "match_status": "matched" if matched else "variance",
        "tolerance_inr": tolerance,
    }


def build_form16_reconciliation(admin_id: int, financial_year: str, computed: dict) -> dict:
    """Compare computed summary vs uploaded/TRACES figures."""
    uploaded = _latest_uploaded_figures(admin_id, financial_year)
    computed_figures = {
        "gross_salary": float(computed["part_a"]["gross_salary_ytd"]),
        "tds_deducted": float(computed["part_a"]["tds_deducted_ytd"]),
        "taxable_income": float(computed["part_b"]["taxable_income"]),
        "annual_tax": float(computed["part_b"]["annual_tax"]),
    }
    uploaded_figures = None
    if uploaded:
        uploaded_figures = {
            "gross_salary": uploaded["gross_salary"],
            "tds_deducted": uploaded["tds_deducted"],
            "taxable_income": uploaded["taxable_income"],
            "annual_tax": uploaded["annual_tax"],
            "data_source": uploaded.get("data_source"),
            "form16_id": uploaded.get("form16_id"),
        }
    return reconcile_form16_figures(
        computed_figures,
        uploaded_figures,
        financial_year=financial_year,
        tolerance=tds_cfg.form16_variance_tolerance(),
    )


def build_form16_summary(admin_id: int, financial_year: str | None = None) -> dict:
    """Structured Form 16 Part A/B summary from payroll and declaration data."""
    fy = tax_decl.normalize_financial_year(financial_year or financial_year_for_date())
    admin = Admin.query.get(admin_id)
    if not admin:
        raise ValueError("Employee not found")

    profile_row = EmployeeAccounts.query.filter_by(admin_id=admin_id).first()
    profile = profile_row.to_dict() if profile_row else {}
    ctc = CTCBreakup.query.filter_by(admin_id=admin_id).first()
    if not ctc or not float(ctc.gross_salary or 0):
        raise ValueError("CTC breakup not found or gross salary is zero")

    ytd_gross, ytd_tds = payroll_tds.payroll_ytd_in_financial_year(admin_id, fy)
    tds_inputs = tax_decl.resolved_tds_inputs_for_projection(
        admin_id, fy, profile, use_declaration=True
    )
    doj = _parse_doj(profile, admin)
    monthly_ptax = float(ctc.ptax or 0) * 12

    projection = run_tds_projection(
        monthly_gross=float(ctc.gross_salary or 0),
        monthly_basic=float(ctc.basic_salary or 0),
        monthly_hra=float(ctc.hra or 0),
        monthly_epf=float(ctc.epf or 0),
        tax_regime=tds_inputs.get("tax_regime"),
        financial_year=fy,
        pan=profile.get("pan"),
        date_of_joining=doj,
        ytd_gross=ytd_gross,
        ytd_tds=ytd_tds,
        previous_employer_taxable=tds_inputs.get("previous_employer_taxable") or 0,
        previous_employer_tds=tds_inputs.get("previous_employer_tds") or 0,
        rent_paid_annual=tds_inputs.get("rent_paid_annual") or 0,
        is_metro=bool(tds_inputs.get("is_metro")),
        section_80c_extra=tds_inputs.get("section_80c_extra") or 0,
        section_80d=tds_inputs.get("section_80d") or 0,
        section_80ccd1b=tds_inputs.get("section_80ccd1b") or 0,
        section_24_interest=tds_inputs.get("section_24_interest") or 0,
        lta_exemption=tds_inputs.get("lta_exemption") or 0,
        section_80e=tds_inputs.get("section_80e") or 0,
        section_80g=tds_inputs.get("section_80g") or 0,
        other_deductions=tds_inputs.get("other_deductions") or 0,
        other_income=tds_inputs.get("other_income") or 0,
        new_regime_deductions=tds_inputs.get("new_regime_deductions") or 0,
        ptax_annual=monthly_ptax,
    )

    variance = payroll_tds.build_tds_variance_report(admin_id, fy, {
        **projection,
        "declaration_source": tds_inputs.get("declaration_source"),
    })
    quarterly = build_quarterly_tds_schedule(admin_id, fy)
    chapter_via = build_chapter_via_schedule(projection.get("deductions"))

    from . import tds_settings as tds_cfg
    employer = tds_cfg.employer_details()

    emp_name = (admin.first_name or admin.user_name or "Employee").strip()
    emp_no = (admin.emp_id or "").strip() or "-"
    income = projection.get("income") or {}

    payload = {
        "financial_year": fy,
        "generated_at": date.today().isoformat(),
        "employer": employer,
        "employee": {
            "admin_id": admin_id,
            "name": emp_name,
            "emp_id": emp_no,
            "pan": profile.get("pan") or "—",
            "tax_regime": tds_inputs.get("tax_regime") or profile.get("tax_regime"),
            "tax_regime_source": tds_inputs.get("tax_regime_source"),
        },
        "part_a": {
            "gross_salary_ytd": round(ytd_gross, 2),
            "tds_deducted_ytd": round(ytd_tds, 2),
            "previous_employer_tds": float(tds_inputs.get("previous_employer_tds") or 0),
            "total_tds_including_previous": round(
                ytd_tds + float(tds_inputs.get("previous_employer_tds") or 0), 2
            ),
            "quarterly_schedule": quarterly,
            "monthly_tds": payroll_tds.payroll_tds_by_month(admin_id, fy),
        },
        "part_b": {
            "projected_annual_gross": float(income.get("projected_annual_gross") or 0),
            "taxable_income": float(projection.get("taxable_income") or 0),
            "annual_tax": float(projection.get("tax", {}).get("annual_tax") or 0),
            "deductions": projection.get("deductions") or {},
            "chapter_via_schedule": chapter_via,
            "regime": projection.get("regime"),
            "regime_label": projection.get("regime_label"),
            "other_income": float(tds_inputs.get("other_income") or 0),
        },
        "declaration": tds_inputs.get("declaration_source"),
        "variance": variance,
        "disclaimer": (
            "System-generated Form 16 Part A/B for reconciliation. "
            "Official Form 16 from TRACES may be uploaded separately by Accounts."
        ),
    }
    payload["reconciliation"] = build_form16_reconciliation(admin_id, fy, payload)
    payload["certificates"] = list_form16_certificates(admin_id, fy)
    return payload


def generate_form16_summary_pdf(admin_id: int, financial_year: str | None = None) -> BytesIO:
    summary = build_form16_summary(admin_id, financial_year)
    buffer = BytesIO()
    c = canvas.Canvas(buffer, pagesize=A4)
    width, height = A4
    left = 40
    y = height - 40

    def line(text: str, bold: bool = False, size: int = 10):
        nonlocal y
        if y < 60:
            c.showPage()
            y = height - 40
        c.setFont("Helvetica-Bold" if bold else "Helvetica", size)
        c.drawString(left, y, text[:100])
        y -= size + 2

    line(summary["employer"]["name"], bold=True, size=14)
    line(f"Form 16 Part A & B — FY {summary['financial_year']}")
    line(f"Generated: {summary['generated_at']}")
    y -= 8

    emp = summary["employee"]
    line("Employee Details", bold=True, size=11)
    for label, val in (
        ("Name", emp["name"]),
        ("Employee ID", emp["emp_id"]),
        ("PAN", emp["pan"]),
        ("Tax Regime", emp["tax_regime"] or "—"),
    ):
        line(f"{label}: {val}")

    y -= 6
    line("Part A — TDS (from payroll)", bold=True, size=11)
    part_a = summary["part_a"]
    for label, val in (
        ("Gross salary YTD", part_a["gross_salary_ytd"]),
        ("TDS deducted YTD", part_a["tds_deducted_ytd"]),
        ("Previous employer TDS", part_a["previous_employer_tds"]),
        ("Total TDS", part_a["total_tds_including_previous"]),
    ):
        line(f"{label}: Rs. {_fmt_money(val)}")

    line("Quarterly TDS schedule", bold=True, size=10)
    for q in part_a.get("quarterly_schedule") or []:
        line(
            f"  {q['quarter']} ({q['period']}): "
            f"Gross Rs. {_fmt_money(q['gross_salary'])}, TDS Rs. {_fmt_money(q['tds_deducted'])}"
        )

    y -= 6
    line("Part B — Income & tax (computed)", bold=True, size=11)
    part_b = summary["part_b"]
    for label, val in (
        ("Projected annual gross", part_b["projected_annual_gross"]),
        ("Taxable income", part_b["taxable_income"]),
        ("Annual tax", part_b["annual_tax"]),
    ):
        line(f"{label}: Rs. {_fmt_money(val)}")

    if part_b.get("chapter_via_schedule"):
        line("Chapter VI-A deductions", bold=True, size=10)
        for row in part_b["chapter_via_schedule"][:12]:
            line(f"  {row['section']}: Rs. {_fmt_money(row['amount'])}")

    recon = summary.get("reconciliation") or {}
    if recon.get("has_uploaded_figures"):
        y -= 6
        line("Uploaded vs computed", bold=True, size=10)
        line(f"Match status: {recon.get('match_status', '—')}")
        for key, diff in (recon.get("differences") or {}).items():
            line(f"  Diff {key}: Rs. {_fmt_money(diff)}")

    y -= 8
    c.setFont("Helvetica-Oblique", 8)
    c.drawString(left, y, summary["disclaimer"][:95])
    y -= 10
    c.drawString(left, y, summary["disclaimer"][95:190])

    c.showPage()
    c.save()
    buffer.seek(0)
    return buffer
