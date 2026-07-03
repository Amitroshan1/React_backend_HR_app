"""DB-backed statutory compliance export builders."""
from __future__ import annotations

import calendar

from .commands.compliance_export_logic import (
    compute_esic_amounts,
    compute_pf_ecr_amounts,
    form_24q_csv_rows,
    esic_csv_rows,
    pf_ecr_csv_rows,
    pt_remittance_calendar,
    pt_remittance_due_in_month,
    pt_summary_csv_rows,
    quarter_month_pairs,
)
from .commands.professional_tax import normalize_ptax_state, resolve_ptax_state_for_employee
from .ctc_settings import load_ctc_settings
from .models.Admin_models import Admin
from .models.ctc_breakup import CTCBreakup
from .models.employee_accounts import EmployeeAccounts
from .models.monthly_payroll import MonthlyPayroll
from . import db


def _payroll_query(year: int, month_num: int, *, circle: str | None = None, emp_type: str | None = None):
    q = (
        db.session.query(MonthlyPayroll, Admin, CTCBreakup, EmployeeAccounts)
        .join(Admin, Admin.id == MonthlyPayroll.admin_id)
        .outerjoin(CTCBreakup, CTCBreakup.admin_id == MonthlyPayroll.admin_id)
        .outerjoin(EmployeeAccounts, EmployeeAccounts.admin_id == MonthlyPayroll.admin_id)
        .filter(
            MonthlyPayroll.month_num == int(month_num),
            MonthlyPayroll.year == str(int(year)),
        )
    )
    if circle:
        q = q.filter(Admin.circle == circle)
    if emp_type:
        q = q.filter(Admin.emp_type == emp_type)
    return q.order_by(Admin.first_name.asc(), Admin.emp_id.asc())


def _member_name(admin: Admin) -> str:
    return (getattr(admin, "first_name", None) or getattr(admin, "user_name", None) or "Employee").strip()


def _resolve_state(ctc: CTCBreakup | None, accounts: EmployeeAccounts | None) -> str:
    policy = load_ctc_settings()
    return resolve_ptax_state_for_employee(
        explicit_state=getattr(ctc, "ptax_state", None) if ctc else None,
        saved_state=getattr(ctc, "ptax_state", None) if ctc else None,
        location=getattr(accounts, "location", None) if accounts else None,
        default_state=policy.get("default_ptax_state", "MH"),
    )


def build_pf_ecr_export(*, year: int, month_num: int, circle: str | None = None, emp_type: str | None = None) -> dict:
    lines = []
    for payroll, admin, ctc, accounts in _payroll_query(year, month_num, circle=circle, emp_type=emp_type).all():
        basic = float(getattr(ctc, "basic_salary", 0) or 0) if ctc else 0.0
        da = float(getattr(ctc, "dearness_allowance", 0) or 0) if ctc else 0.0
        gross = float(payroll.gross_salary_for_month or 0) + float(payroll.arrears_gross_final or 0)
        amounts = compute_pf_ecr_amounts(
            basic=basic,
            dearness_allowance=da,
            gross_wages=gross,
            payable_days=float(payroll.actual_working_days or 0),
            calendar_days=int(payroll.calendar_days or calendar.monthrange(year, month_num)[1]),
            epf_employee_paid=float(payroll.epf_final or 0),
        )
        if amounts["epf_wages"] <= 0 and amounts["epf_contribution_ee"] <= 0:
            continue
        lines.append({
            "uan": (getattr(accounts, "uan", None) or "").strip() if accounts else "",
            "member_name": _member_name(admin),
            "emp_id": (admin.emp_id or "").strip(),
            **amounts,
        })
    csv_text = pf_ecr_csv_rows(lines)
    return {
        "year": year,
        "month_num": month_num,
        "month_name": calendar.month_name[month_num],
        "row_count": len(lines),
        "lines": lines,
        "csv": csv_text,
    }


def build_esic_statement(*, year: int, month_num: int, circle: str | None = None, emp_type: str | None = None) -> dict:
    lines = []
    for payroll, admin, ctc, accounts in _payroll_query(year, month_num, circle=circle, emp_type=emp_type).all():
        gross = float(payroll.gross_salary_for_month or 0) + float(payroll.arrears_gross_final or 0)
        esic = compute_esic_amounts(gross, float(payroll.esic_final or 0))
        if not esic["applicable"] and float(payroll.esic_final or 0) <= 0:
            continue
        ee = float(payroll.esic_final or 0) or esic["ip_contribution"]
        er = float(getattr(ctc, "esic_employer", 0) or 0) if ctc else esic["employer_contribution"]
        if er <= 0:
            er = esic["employer_contribution"]
        lines.append({
            "ip_number": (getattr(accounts, "esi_number", None) or "").strip() if accounts else "",
            "employee_name": _member_name(admin),
            "emp_id": (admin.emp_id or "").strip(),
            "no_of_days": float(payroll.actual_working_days or 0),
            "total_monthly_wages": round(gross, 2),
            "ip_contribution": round(ee, 2),
            "employer_contribution": round(er, 2),
        })
    return {
        "year": year,
        "month_num": month_num,
        "month_name": calendar.month_name[month_num],
        "row_count": len(lines),
        "lines": lines,
        "csv": esic_csv_rows(lines),
    }


def build_pt_summary(*, year: int, month_num: int, circle: str | None = None, emp_type: str | None = None) -> dict:
    from .commands.compliance_export_logic import _load_pt_rules

    rules = _load_pt_rules()
    by_state: dict[str, dict] = {}

    for payroll, admin, ctc, accounts in _payroll_query(year, month_num, circle=circle, emp_type=emp_type).all():
        pt = float(payroll.ptax_final or 0)
        if pt <= 0:
            continue
        state = normalize_ptax_state(_resolve_state(ctc, accounts), "MH")
        spec = rules.get(state) or {}
        bucket = by_state.setdefault(state, {
            "state_code": state,
            "state_name": spec.get("name") or state,
            "frequency": spec.get("frequency") or "monthly",
            "employee_count": 0,
            "pt_deducted": 0.0,
            "remittance_due": pt_remittance_due_in_month(state, month_num),
        })
        bucket["employee_count"] += 1
        bucket["pt_deducted"] = round(bucket["pt_deducted"] + pt, 2)

    lines = sorted(by_state.values(), key=lambda x: x["state_code"])
    total_pt = round(sum(x["pt_deducted"] for x in lines), 2)
    due_states = [x for x in lines if x["remittance_due"]]
    return {
        "year": year,
        "month_num": month_num,
        "month_name": calendar.month_name[month_num],
        "total_pt_deducted": total_pt,
        "states_with_remittance_due": [x["state_code"] for x in due_states],
        "lines": lines,
        "csv": pt_summary_csv_rows(lines, year=year, month_num=month_num),
    }


def build_form_24q_export(
    *,
    financial_year: str,
    quarter: int,
    circle: str | None = None,
    emp_type: str | None = None,
) -> dict:
    months = quarter_month_pairs(financial_year, quarter)
    agg: dict[int, dict] = {}

    for y, m in months:
        for payroll, admin, _ctc, accounts in _payroll_query(y, m, circle=circle, emp_type=emp_type).all():
            aid = admin.id
            bucket = agg.setdefault(aid, {
                "pan": (getattr(accounts, "pan", None) or "").strip().upper() if accounts else "",
                "employee_name": _member_name(admin),
                "emp_id": (admin.emp_id or "").strip(),
                "gross_salary": 0.0,
                "tds_deducted": 0.0,
            })
            gross = float(payroll.gross_salary_for_month or 0) + float(payroll.arrears_gross_final or 0)
            tds = float(payroll.tds_final or 0) if payroll.tds_final is not None else float(payroll.tds_computed or 0)
            bucket["gross_salary"] = round(bucket["gross_salary"] + gross, 2)
            bucket["tds_deducted"] = round(bucket["tds_deducted"] + tds, 2)

    lines = sorted(agg.values(), key=lambda x: x["employee_name"])
    return {
        "financial_year": financial_year,
        "quarter": quarter,
        "months_included": [{"year": y, "month_num": m, "month_name": calendar.month_name[m]} for y, m in months],
        "row_count": len(lines),
        "lines": lines,
        "csv": form_24q_csv_rows(lines, financial_year=financial_year, quarter=quarter),
    }


def get_pt_remittance_calendar(year: int) -> dict:
    return {"year": year, "calendar": pt_remittance_calendar(year)}
