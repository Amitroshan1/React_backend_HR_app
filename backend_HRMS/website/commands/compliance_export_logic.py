"""Pure helpers for statutory compliance exports (PF ECR, ESIC, PT, Form 24Q)."""
from __future__ import annotations

import calendar
import csv
import io
import json
from pathlib import Path

from .ctc_breakup_logic import (
    ESIC_GROSS_CAP,
    PF_WAGE_CAP_MONTHLY,
    employee_esic_monthly,
    employer_esic_monthly,
    pf_wage_capped,
)

_PT_RULES_PATH = Path(__file__).resolve().parents[1] / "data" / "professional_tax_rules.json"

EPS_RATE = 8.33
PF_RATE = 12.0
EPS_CONTRIB_MAX = 1250.0


def _load_pt_rules() -> dict:
    if _PT_RULES_PATH.is_file():
        try:
            with open(_PT_RULES_PATH, encoding="utf-8") as fh:
                data = json.load(fh)
            if isinstance(data, dict):
                return data
        except (json.JSONDecodeError, OSError):
            pass
    return {}


def parse_financial_year(fy: str) -> int:
    s = (fy or "").strip()
    if "-" in s:
        return int(s.split("-")[0])
    if len(s) == 4 and s.isdigit():
        return int(s)
    raise ValueError("financial_year must be like 2025-26")


def quarter_month_pairs(financial_year: str, quarter: int) -> list[tuple[int, int]]:
    """Indian FY quarters: Q1=Apr–Jun … Q4=Jan–Mar."""
    if quarter not in (1, 2, 3, 4):
        raise ValueError("quarter must be 1..4")
    sy = parse_financial_year(financial_year)
    if quarter == 1:
        return [(sy, m) for m in (4, 5, 6)]
    if quarter == 2:
        return [(sy, m) for m in (7, 8, 9)]
    if quarter == 3:
        return [(sy, m) for m in (10, 11, 12)]
    return [(sy + 1, m) for m in (1, 2, 3)]


def compute_pf_ecr_amounts(
    *,
    basic: float,
    dearness_allowance: float,
    gross_wages: float,
    payable_days: float,
    calendar_days: int,
    epf_employee_paid: float,
) -> dict:
    epf_wages = pf_wage_capped(basic, dearness_allowance)
    eps_wages = epf_wages
    edli_wages = epf_wages
    eps_contribution = min(round(epf_wages * EPS_RATE / 100.0), EPS_CONTRIB_MAX)
    employer_pf_total = round(epf_wages * PF_RATE / 100.0)
    epf_er_diff = max(0, employer_pf_total - eps_contribution)
    ee_contribution = float(epf_employee_paid or 0)
    if ee_contribution <= 0:
        ee_contribution = round(epf_wages * PF_RATE / 100.0)
    ncp_days = max(0, int(round(float(calendar_days or 0) - float(payable_days or 0))))
    return {
        "gross_wages": round(float(gross_wages or 0), 0),
        "epf_wages": round(epf_wages, 0),
        "eps_wages": round(eps_wages, 0),
        "edli_wages": round(edli_wages, 0),
        "epf_contribution_ee": round(ee_contribution, 0),
        "eps_contribution_er": round(eps_contribution, 0),
        "epf_er_diff": round(epf_er_diff, 0),
        "ncp_days": ncp_days,
        "refund_of_advances": 0,
    }


def pf_ecr_csv_rows(lines: list[dict]) -> str:
    headers = [
        "UAN",
        "MEMBER NAME",
        "GROSS WAGES",
        "EPF WAGES",
        "EPS WAGES",
        "EDLI WAGES",
        "EPF CONTRIBUTION (EE)",
        "EPS CONTRIBUTION (ER)",
        "EPF ER DIFF",
        "NCP DAYS",
        "REFUND OF ADVANCES",
    ]
    buf = io.StringIO()
    writer = csv.writer(buf, lineterminator="\n")
    writer.writerow(headers)
    for row in lines:
        writer.writerow([
            row.get("uan") or "",
            row.get("member_name") or "",
            row.get("gross_wages", 0),
            row.get("epf_wages", 0),
            row.get("eps_wages", 0),
            row.get("edli_wages", 0),
            row.get("epf_contribution_ee", 0),
            row.get("eps_contribution_er", 0),
            row.get("epf_er_diff", 0),
            row.get("ncp_days", 0),
            row.get("refund_of_advances", 0),
        ])
    return buf.getvalue()


def esic_csv_rows(lines: list[dict]) -> str:
    headers = [
        "IP NUMBER",
        "EMPLOYEE NAME",
        "EMP ID",
        "NO OF DAYS",
        "TOTAL MONTHLY WAGES",
        "IP CONTRIBUTION",
        "EMPLOYER CONTRIBUTION",
    ]
    buf = io.StringIO()
    writer = csv.writer(buf, lineterminator="\n")
    writer.writerow(headers)
    for row in lines:
        writer.writerow([
            row.get("ip_number") or "",
            row.get("employee_name") or "",
            row.get("emp_id") or "",
            row.get("no_of_days", 0),
            row.get("total_monthly_wages", 0),
            row.get("ip_contribution", 0),
            row.get("employer_contribution", 0),
        ])
    return buf.getvalue()


def compute_esic_amounts(monthly_gross: float, esic_employee_paid: float = 0) -> dict:
    gross = float(monthly_gross or 0)
    if gross <= 0 or gross >= ESIC_GROSS_CAP:
        return {"applicable": False, "ip_contribution": 0.0, "employer_contribution": 0.0}
    ee = float(esic_employee_paid or 0)
    if ee <= 0:
        ee = round(employee_esic_monthly(gross), 2)
    er = round(employer_esic_monthly(gross), 2)
    return {"applicable": True, "ip_contribution": ee, "employer_contribution": er}


def pt_remittance_due_in_month(state_code: str, month_num: int) -> bool:
    spec = _load_pt_rules().get((state_code or "").upper()) or {}
    if not spec.get("levies_pt"):
        return False
    freq = (spec.get("frequency") or "monthly").lower()
    if freq == "monthly":
        return True
    if freq == "half_yearly":
        months = spec.get("remittance_months") or spec.get("deduction_months") or [6, 12]
        return int(month_num) in [int(m) for m in months]
    if freq == "annual":
        return int(month_num) == int(spec.get("remittance_month") or spec.get("deduction_month") or 3)
    return True


def pt_remittance_calendar(year: int) -> list[dict]:
    rules = _load_pt_rules()
    out = []
    for code, spec in sorted(rules.items()):
        if not spec.get("levies_pt"):
            continue
        freq = (spec.get("frequency") or "monthly").lower()
        due_months = []
        if freq == "monthly":
            due_months = list(range(1, 13))
        elif freq == "half_yearly":
            due_months = [int(m) for m in (spec.get("remittance_months") or spec.get("deduction_months") or [6, 12])]
        elif freq == "annual":
            due_months = [int(spec.get("remittance_month") or spec.get("deduction_month") or 3)]
        out.append({
            "state_code": code,
            "state_name": spec.get("name") or code,
            "frequency": freq,
            "due_months": due_months,
            "due_in_year": [
                {"year": year, "month_num": m, "month_name": calendar.month_name[m]}
                for m in due_months
            ],
            "note": spec.get("note"),
        })
    return out


def form_24q_csv_rows(lines: list[dict], *, financial_year: str, quarter: int) -> str:
    headers = [
        "FINANCIAL YEAR",
        "QUARTER",
        "PAN",
        "EMPLOYEE NAME",
        "EMP ID",
        "GROSS SALARY",
        "TDS DEDUCTED",
    ]
    buf = io.StringIO()
    writer = csv.writer(buf, lineterminator="\n")
    writer.writerow(headers)
    for row in lines:
        writer.writerow([
            financial_year,
            f"Q{quarter}",
            row.get("pan") or "",
            row.get("employee_name") or "",
            row.get("emp_id") or "",
            row.get("gross_salary", 0),
            row.get("tds_deducted", 0),
        ])
    return buf.getvalue()


def pt_summary_csv_rows(lines: list[dict], *, year: int, month_num: int) -> str:
    headers = [
        "STATE CODE",
        "STATE NAME",
        "EMPLOYEE COUNT",
        "PT DEDUCTED",
        "REMITS THIS MONTH",
        "FREQUENCY",
    ]
    buf = io.StringIO()
    writer = csv.writer(buf, lineterminator="\n")
    writer.writerow([f"PT Summary — {calendar.month_name[month_num]} {year}"])
    writer.writerow(headers)
    for row in lines:
        writer.writerow([
            row.get("state_code") or "",
            row.get("state_name") or "",
            row.get("employee_count", 0),
            row.get("pt_deducted", 0),
            "Yes" if row.get("remittance_due") else "No",
            row.get("frequency") or "",
        ])
    return buf.getvalue()
