"""Payroll TDS — monthly deduction from approved/submitted tax declarations + CTC."""
from __future__ import annotations

import calendar
from datetime import date

from .datetime_utils import isoformat_api
from . import tax_declaration_service as tax_decl
from . import tds_settings as tds_cfg
from .commands.tds_logic import financial_year_for_date, fy_start_end, run_tds_projection
from .models.Admin_models import Admin
from .models.ctc_breakup import CTCBreakup
from .models.employee_accounts import EmployeeAccounts
from .models.monthly_payroll import MonthlyPayroll

def financial_year_for_calendar_month(year: int, month_num: int) -> str:
    return financial_year_for_date(date(int(year), int(month_num), 1))


def as_of_date_for_payroll_month(year: int, month_num: int) -> date:
    today = date.today()
    last_day = calendar.monthrange(int(year), int(month_num))[1]
    month_end = date(int(year), int(month_num), last_day)
    return min(today, month_end)


def payroll_ytd_before_month(
    admin_id: int,
    financial_year: str,
    year: int,
    month_num: int,
    *,
    exclude_payroll_id: int | None = None,
) -> tuple[float, float]:
    """Sum gross and TDS from payroll rows in FY strictly before the given month."""
    fy_start, fy_end = fy_start_end(financial_year)
    target = date(int(year), int(month_num), 1)
    ytd_gross = 0.0
    ytd_tds = 0.0

    for row in MonthlyPayroll.query.filter_by(admin_id=admin_id).all():
        if exclude_payroll_id and row.id == exclude_payroll_id:
            continue
        try:
            y = int(row.year)
            m = int(row.month_num)
        except (TypeError, ValueError):
            continue
        row_date = date(y, m, 1)
        if not (fy_start <= row_date <= fy_end):
            continue
        if row_date >= target:
            continue
        ytd_gross += float(row.gross_salary_for_month or 0)
        ytd_tds += float(row.tds_final if row.tds_final is not None else row.tds_computed or 0)

    return ytd_gross, ytd_tds


def payroll_ytd_in_financial_year(
    admin_id: int,
    financial_year: str,
    *,
    exclude_payroll_id: int | None = None,
) -> tuple[float, float]:
    """Sum gross and TDS for all payroll rows in the financial year (for projection API)."""
    fy_start, fy_end = fy_start_end(financial_year)
    ytd_gross = 0.0
    ytd_tds = 0.0
    for row in MonthlyPayroll.query.filter_by(admin_id=admin_id).all():
        if exclude_payroll_id and row.id == exclude_payroll_id:
            continue
        try:
            y = int(row.year)
            m = int(row.month_num)
        except (TypeError, ValueError):
            continue
        d = date(y, m, 1)
        if fy_start <= d <= fy_end:
            ytd_gross += float(row.gross_salary_for_month or 0)
            ytd_tds += float(row.tds_final if row.tds_final is not None else row.tds_computed or 0)
    return ytd_gross, ytd_tds


def resolved_tds_inputs_for_payroll(
    admin_id: int,
    financial_year: str,
    profile: dict | None = None,
) -> dict:
    """
    Payroll uses approved or submitted declarations only.
    Draft/rejected/missing → profile regime, zero investment deductions.
    """
    profile = profile or {}
    inputs = {
        "tax_regime": profile.get("tax_regime"),
        "rent_paid_annual": 0.0,
        "is_metro": False,
        "section_80c_extra": 0.0,
        "section_80d": 0.0,
        "previous_employer_taxable": 0.0,
        "previous_employer_tds": 0.0,
        "section_80ccd1b": 0.0,
        "section_24_interest": 0.0,
        "lta_exemption": 0.0,
        "section_80e": 0.0,
        "section_80g": 0.0,
        "other_deductions": 0.0,
        "other_income": 0.0,
        "new_regime_deductions": 0.0,
    }
    declaration_source = {
        "found": False,
        "status": None,
        "declaration_id": None,
        "label": (
            "No approved tax declaration for payroll TDS."
            if tds_cfg.payroll_tds_approved_only()
            else "No approved/submitted tax declaration for payroll TDS."
        ),
        "payroll_ready": False,
        "tds_basis": None,
        "submitted_at": None,
        "financial_year": tax_decl.normalize_financial_year(financial_year),
    }

    payroll_statuses = tds_cfg.payroll_declaration_statuses()
    row = tax_decl.tax_declaration_for_admin(admin_id, financial_year)
    if row and (row.status or "").lower() in payroll_statuses:
        ctc = CTCBreakup.query.filter_by(admin_id=admin_id).first()
        monthly_epf = float(ctc.epf or 0) if ctc else 0.0
        regime_for_rules = tax_decl.normalize_regime(row.tax_regime or inputs.get("tax_regime"))
        try:
            from .commands.tds_logic import load_tax_rules
            rules = load_tax_rules(financial_year, regime_for_rules)
        except ValueError:
            rules = {}
        decl_inputs = tax_decl.declaration_tds_inputs_for_row(
            row, monthly_epf=monthly_epf, rules=rules
        )
        inputs.update(decl_inputs)
        inputs["tax_regime"] = row.tax_regime or inputs["tax_regime"]
        status = (row.status or "").lower()
        declaration_source = {
            "found": True,
            "status": status,
            "declaration_id": row.id,
            "label": tax_decl._declaration_status_label(status),
            "payroll_ready": status == "approved",
            "tds_basis": tax_decl._tds_basis_from_row(row),
            "declaration_phase": getattr(row, "declaration_phase", None) or "provisional",
            "final_proof_status": getattr(row, "final_proof_status", None),
            "submitted_at": isoformat_api(row.submitted_at),
            "financial_year": row.financial_year,
        }

    from .commands.tds_logic import normalize_regime
    return {
        **inputs,
        "declaration_source": declaration_source,
        "regime_norm": normalize_regime(inputs.get("tax_regime")),
    }


def compute_monthly_tds_for_payroll(
    admin_id: int,
    year: int,
    month_num: int,
    *,
    exclude_payroll_id: int | None = None,
) -> dict:
    """Return monthly TDS amount and metadata for a payroll month."""
    ctc = CTCBreakup.query.filter_by(admin_id=admin_id).first()
    if not ctc or not float(ctc.gross_salary or 0):
        return {
            "monthly_tds": 0.0,
            "skipped": True,
            "reason": "no_ctc",
            "declaration_source": {"found": False, "label": "CTC not configured"},
        }

    profile_row = EmployeeAccounts.query.filter_by(admin_id=admin_id).first()
    profile = profile_row.to_dict() if profile_row else {}
    admin = Admin.query.get(admin_id)

    fy = financial_year_for_calendar_month(year, month_num)
    as_of = as_of_date_for_payroll_month(year, month_num)
    tds_inputs = resolved_tds_inputs_for_payroll(admin_id, fy, profile)
    ytd_gross, ytd_tds = payroll_ytd_before_month(
        admin_id, fy, year, month_num, exclude_payroll_id=exclude_payroll_id
    )

    doj = None
    if profile.get("date_of_joining"):
        try:
            doj = date.fromisoformat(str(profile["date_of_joining"])[:10])
        except ValueError:
            doj = None
    if not doj and admin:
        doj = getattr(admin, "doj", None)

    monthly_ptax = float(ctc.ptax or 0)
    ptax_annual = monthly_ptax * 12

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
        ptax_annual=ptax_annual,
        as_of=as_of,
    )

    monthly_tds = float(projection.get("tds", {}).get("monthly_tds") or 0)
    return {
        "monthly_tds": monthly_tds,
        "skipped": False,
        "financial_year": fy,
        "declaration_source": tds_inputs.get("declaration_source"),
        "inputs_used": {
            "tax_regime": tds_inputs.get("tax_regime"),
            "rent_paid_annual": tds_inputs.get("rent_paid_annual"),
            "is_metro": tds_inputs.get("is_metro"),
            "section_80c_extra": tds_inputs.get("section_80c_extra"),
            "section_80d": tds_inputs.get("section_80d"),
            "section_80ccd1b": tds_inputs.get("section_80ccd1b"),
            "section_24_interest": tds_inputs.get("section_24_interest"),
            "lta_exemption": tds_inputs.get("lta_exemption"),
            "section_80e": tds_inputs.get("section_80e"),
            "section_80g": tds_inputs.get("section_80g"),
            "other_deductions": tds_inputs.get("other_deductions"),
            "other_income": tds_inputs.get("other_income"),
            "new_regime_deductions": tds_inputs.get("new_regime_deductions"),
            "previous_employer_taxable": tds_inputs.get("previous_employer_taxable"),
            "previous_employer_tds": tds_inputs.get("previous_employer_tds"),
            "from_declaration": bool(tds_inputs.get("declaration_source", {}).get("found")),
            "tds_basis": tds_inputs.get("declaration_source", {}).get("tds_basis"),
        },
        "annual_tax": projection.get("tax", {}).get("annual_tax"),
        "remaining_tax": projection.get("tds", {}).get("remaining_tax"),
    }


def recompute_payroll_deduction_totals(row: MonthlyPayroll) -> None:
    row.deductions_total_final = round(
        float(row.epf_final or 0)
        + float(row.esic_final or 0)
        + float(row.ptax_final or 0)
        + float(row.tds_final if row.tds_final is not None else row.tds_computed or 0),
        2,
    )
    row.net_salary_final = round(
        max(0.0, float(row.gross_salary_for_month or 0) - float(row.deductions_total_final or 0)),
        2,
    )


def apply_tds_to_payroll_row(row: MonthlyPayroll, *, overwrite_final: bool = True) -> dict:
    """Compute TDS for a payroll row and update totals."""
    try:
        year = int(row.year)
        month_num = int(row.month_num)
    except (TypeError, ValueError):
        row.tds_computed = 0.0
        if overwrite_final:
            row.tds_final = 0.0
        recompute_payroll_deduction_totals(row)
        return {"monthly_tds": 0.0, "skipped": True, "reason": "invalid_month"}

    result = compute_monthly_tds_for_payroll(
        row.admin_id,
        year,
        month_num,
        exclude_payroll_id=row.id,
    )
    tds_amount = round(float(result.get("monthly_tds") or 0), 2)
    row.tds_computed = tds_amount
    if overwrite_final:
        row.tds_final = tds_amount
    recompute_payroll_deduction_totals(row)
    return result


def refresh_payroll_tds_final(
    row: MonthlyPayroll,
    *,
    working_days_changed: bool = False,
    requested_tds_final: float | None = None,
) -> dict:
    """
    Recompute tds_computed and set tds_final.
    Manual TDS override is kept when requested value differs from computed;
    working-days changes always refresh TDS from declaration + projection.
    """
    try:
        year = int(row.year)
        month_num = int(row.month_num)
    except (TypeError, ValueError):
        row.tds_computed = 0.0
        row.tds_final = 0.0
        recompute_payroll_deduction_totals(row)
        return {"monthly_tds": 0.0, "skipped": True, "reason": "invalid_month"}

    result = compute_monthly_tds_for_payroll(
        row.admin_id,
        year,
        month_num,
        exclude_payroll_id=row.id,
    )
    computed = round(float(result.get("monthly_tds") or 0), 2)
    row.tds_computed = computed

    if working_days_changed or requested_tds_final is None:
        row.tds_final = computed
    elif abs(float(requested_tds_final) - computed) > 0.009:
        row.tds_final = round(float(requested_tds_final), 2)
    else:
        row.tds_final = computed

    recompute_payroll_deduction_totals(row)
    return result


def recalculate_payroll_tds_for_financial_year(admin_id: int, financial_year: str) -> int:
    """Recalculate TDS on all payroll rows in a financial year (after declaration approval)."""
    fy = tax_decl.normalize_financial_year(financial_year)
    fy_start, fy_end = fy_start_end(fy)
    updated = 0
    rows = MonthlyPayroll.query.filter_by(admin_id=admin_id).all()
    for row in rows:
        try:
            d = date(int(row.year), int(row.month_num), 1)
        except (TypeError, ValueError):
            continue
        if not (fy_start <= d <= fy_end):
            continue
        apply_tds_to_payroll_row(row, overwrite_final=True)
        updated += 1
    return updated


def payroll_tds_by_month(admin_id: int, financial_year: str) -> dict[str, float]:
    """Map YYYY-MM → TDS deducted from payroll rows in the financial year."""
    fy = tax_decl.normalize_financial_year(financial_year)
    fy_start, fy_end = fy_start_end(fy)
    out: dict[str, float] = {}
    for row in MonthlyPayroll.query.filter_by(admin_id=admin_id).all():
        try:
            y = int(row.year)
            m = int(row.month_num)
        except (TypeError, ValueError):
            continue
        d = date(y, m, 1)
        if not (fy_start <= d <= fy_end):
            continue
        key = f"{y}-{m:02d}"
        out[key] = float(
            row.tds_final if row.tds_final is not None else row.tds_computed or 0
        )
    return out


def merge_schedule_with_payroll_actuals(
    admin_id: int,
    financial_year: str,
    schedule: list[dict],
) -> list[dict]:
    """Overlay actual payroll TDS on projection schedule for past/processed months."""
    actual_by_month = payroll_tds_by_month(admin_id, financial_year)
    merged = []
    for entry in schedule or []:
        month_key = entry.get("month")
        actual = actual_by_month.get(month_key)
        if actual is not None:
            merged.append({
                **entry,
                "tds": round(actual, 2),
                "status": "actual",
                "source": "payroll",
            })
        else:
            merged.append({
                **entry,
                "source": entry.get("status") or "projected",
            })
    return merged


def build_tds_variance_report(
    admin_id: int,
    financial_year: str,
    projection: dict,
) -> dict:
    """Declared/projected tax vs payroll TDS deducted (YTD reconciliation)."""
    fy = tax_decl.normalize_financial_year(financial_year)
    ytd_gross, ytd_tds = payroll_ytd_in_financial_year(admin_id, fy)
    annual_tax = float(projection.get("tax", {}).get("annual_tax") or 0)
    prev_tds = float(projection.get("tds", {}).get("previous_employer_tds") or 0)
    remaining_tax = float(projection.get("tds", {}).get("remaining_tax") or 0)
    monthly_tds = float(projection.get("tds", {}).get("monthly_tds") or 0)
    remaining_months = int(projection.get("tds", {}).get("remaining_months") or 0)
    projected_future_tds = round(monthly_tds * remaining_months, 2)
    total_expected_tds = round(prev_tds + ytd_tds + projected_future_tds, 2)
    variance_vs_annual = round(annual_tax - total_expected_tds, 2)
    catch_up_needed = round(max(0.0, annual_tax - prev_tds - ytd_tds), 2)

    decl_source = projection.get("declaration_source") or {}
    schedule = merge_schedule_with_payroll_actuals(
        admin_id,
        fy,
        projection.get("tds", {}).get("schedule") or [],
    )

    return {
        "financial_year": fy,
        "declaration_basis": decl_source.get("tds_basis"),
        "declaration_status": decl_source.get("status"),
        "payroll_ready": bool(decl_source.get("payroll_ready")),
        "annual_tax_projected": annual_tax,
        "taxable_income": float(projection.get("taxable_income") or 0),
        "ytd_gross_payroll": round(ytd_gross, 2),
        "ytd_tds_deducted": round(ytd_tds, 2),
        "previous_employer_tds": round(prev_tds, 2),
        "remaining_tax_liability": round(remaining_tax, 2),
        "projected_monthly_tds": monthly_tds,
        "projected_future_tds": projected_future_tds,
        "total_expected_tds_fy": total_expected_tds,
        "variance_vs_annual_tax": variance_vs_annual,
        "catch_up_tds_needed": catch_up_needed,
        "schedule": schedule,
    }
