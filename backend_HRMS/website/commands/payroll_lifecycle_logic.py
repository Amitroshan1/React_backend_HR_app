"""Payroll lifecycle — FnF, leave encashment, loan recovery, bank file (pure logic)."""
from __future__ import annotations

import calendar
import csv
import io
import re
from datetime import date


def parse_bank_details_text(text: str | None) -> dict:
    out: dict[str, str] = {}
    if not text:
        return out
    for line in str(text).split("\n"):
        trimmed = line.strip()
        if not trimmed or ":" not in trimmed:
            continue
        key, val = trimmed.split(":", 1)
        k = key.strip().lower()
        v = val.strip()
        if not v:
            continue
        if k == "account":
            out["bank_account_number"] = v
        elif k == "bank":
            out["bank_name"] = v
        elif k == "branch code":
            out["bank_branch_code"] = v
        elif k == "ifsc":
            out["ifsc_code"] = v.upper()
    return out


def loan_emi_for_month(*, emi_monthly: float, balance_remaining: float) -> float:
    emi = max(0.0, float(emi_monthly or 0))
    bal = max(0.0, float(balance_remaining or 0))
    if bal <= 0 or emi <= 0:
        return 0.0
    return round(min(emi, bal), 2)


def leave_encashment_amount(
    *,
    pl_days: float = 0,
    cl_days: float = 0,
    one_day_salary: float,
    include_cl: bool = False,
) -> dict:
    pl = max(0.0, float(pl_days or 0))
    cl = max(0.0, float(cl_days or 0)) if include_cl else 0.0
    per_day = max(0.0, float(one_day_salary or 0))
    pl_amt = round(pl * per_day, 2)
    cl_amt = round(cl * per_day, 2)
    return {
        "pl_days": pl,
        "cl_days": cl,
        "one_day_salary": round(per_day, 2),
        "pl_encashment": pl_amt,
        "cl_encashment": cl_amt,
        "total_encashment": round(pl_amt + cl_amt, 2),
    }


def gratuity_fnf_amount(
    *,
    basic: float,
    dearness_allowance: float,
    years_of_service: float,
    min_years: float = 5.0,
) -> dict:
    wage = max(0.0, float(basic or 0)) + max(0.0, float(dearness_allowance or 0))
    yrs = max(0.0, float(years_of_service or 0))
    eligible = yrs >= float(min_years) and wage > 0
    if not eligible:
        return {"eligible": False, "years_of_service": round(yrs, 2), "gratuity_amount": 0.0}
    # Payment of Gratuity Act: (15/26) × monthly wage × completed years (rounded)
    completed = int(yrs)
    if yrs - completed >= 0.5:
        completed += 1
    amount = round((wage / 26.0) * 15.0 * max(1, completed), 2)
    return {
        "eligible": True,
        "years_of_service": round(yrs, 2),
        "completed_years": completed,
        "gratuity_amount": amount,
    }


def years_of_service(doj: date | None, as_of: date) -> float:
    if not doj or not as_of or as_of < doj:
        return 0.0
    days = (as_of - doj).days
    return round(days / 365.25, 2)


def notice_recovery_amount(*, one_day_salary: float, recovery_days: float) -> float:
    return round(max(0.0, float(one_day_salary or 0)) * max(0.0, float(recovery_days or 0)), 2)


def compute_fnf_settlement(
    *,
    one_day_salary: float,
    pending_salary_days: float,
    pl_leave_balance: float,
    cl_leave_balance: float,
    include_cl_encashment: bool,
    basic: float,
    dearness_allowance: float,
    years_of_service_val: float,
    loan_recovery: float,
    notice_recovery_days: float,
    other_deductions: float = 0,
    other_earnings: float = 0,
) -> dict:
    pending_salary = round(max(0.0, float(one_day_salary or 0)) * max(0.0, float(pending_salary_days or 0)), 2)
    enc = leave_encashment_amount(
        pl_days=pl_leave_balance,
        cl_days=cl_leave_balance,
        one_day_salary=one_day_salary,
        include_cl=include_cl_encashment,
    )
    grat = gratuity_fnf_amount(
        basic=basic,
        dearness_allowance=dearness_allowance,
        years_of_service=years_of_service_val,
    )
    notice_rec = notice_recovery_amount(one_day_salary=one_day_salary, recovery_days=notice_recovery_days)
    loan_rec = round(max(0.0, float(loan_recovery or 0)), 2)
    other_ded = round(max(0.0, float(other_deductions or 0)), 2)
    other_earn = round(max(0.0, float(other_earnings or 0)), 2)

    earnings_total = round(
        pending_salary + enc["total_encashment"] + grat["gratuity_amount"] + other_earn,
        2,
    )
    deductions_total = round(notice_rec + loan_rec + other_ded, 2)
    net_payable = round(max(0.0, earnings_total - deductions_total), 2)

    return {
        "earnings": {
            "pending_salary_days": float(pending_salary_days or 0),
            "pending_salary": pending_salary,
            "leave_encashment": enc,
            "gratuity": grat,
            "other_earnings": other_earn,
            "total": earnings_total,
        },
        "deductions": {
            "notice_recovery_days": float(notice_recovery_days or 0),
            "notice_recovery": notice_rec,
            "loan_recovery": loan_rec,
            "other_deductions": other_ded,
            "total": deductions_total,
        },
        "net_payable": net_payable,
    }


def bank_neft_csv_rows(lines: list[dict]) -> str:
    headers = [
        "Beneficiary Name",
        "Beneficiary Account No",
        "IFSC",
        "Amount",
        "Payment Mode",
        "Narration",
        "Emp ID",
    ]
    buf = io.StringIO()
    writer = csv.writer(buf, lineterminator="\n")
    writer.writerow(headers)
    for row in lines:
        writer.writerow([
            row.get("beneficiary_name") or "",
            row.get("account_number") or "",
            row.get("ifsc") or "",
            row.get("amount", 0),
            row.get("payment_mode") or "NEFT",
            row.get("narration") or "",
            row.get("emp_id") or "",
        ])
    return buf.getvalue()


def digits_only_account(value: str | None) -> str:
    return re.sub(r"\D", "", str(value or ""))
