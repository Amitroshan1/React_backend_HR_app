"""Payroll lifecycle service — loans, FnF, encashment, bank file."""
from __future__ import annotations

import calendar
from datetime import date, datetime

from .commands.payroll_lifecycle_logic import (
    bank_neft_csv_rows,
    compute_fnf_settlement,
    digits_only_account,
    leave_encashment_amount,
    loan_emi_for_month,
    parse_bank_details_text,
    years_of_service,
)
from .models.Admin_models import Admin
from .models.attendance import LeaveBalance
from .models.ctc_breakup import CTCBreakup
from .models.education import UploadDoc
from .models.employee_accounts import EmployeeAccounts
from .models.employee_salary_loan import EmployeeSalaryLoan
from .models.fnf_settlement import FnfSettlement
from .models.monthly_payroll import MonthlyPayroll
from .models.seperation import Resignation
from . import db


def active_loans_for_admin(admin_id: int) -> list[EmployeeSalaryLoan]:
    return (
        EmployeeSalaryLoan.query.filter_by(admin_id=admin_id, status="active")
        .order_by(EmployeeSalaryLoan.id.asc())
        .all()
    )


def total_loan_emi_for_month(admin_id: int) -> float:
    total = 0.0
    for loan in active_loans_for_admin(admin_id):
        total += loan_emi_for_month(
            emi_monthly=float(loan.emi_monthly or 0),
            balance_remaining=float(loan.balance_remaining or 0),
        )
    return round(total, 2)


def apply_loan_recovery_after_payroll(admin_id: int, amount: float) -> None:
    """Reduce loan balances after payroll loan recovery is finalized."""
    remaining = round(max(0.0, float(amount or 0)), 2)
    if remaining <= 0:
        return
    for loan in active_loans_for_admin(admin_id):
        if remaining <= 0:
            break
        bal = float(loan.balance_remaining or 0)
        if bal <= 0:
            loan.status = "closed"
            continue
        deduct = min(remaining, bal)
        loan.balance_remaining = round(bal - deduct, 2)
        remaining = round(remaining - deduct, 2)
        if loan.balance_remaining <= 0:
            loan.status = "closed"
        loan.updated_at = datetime.now()


def preview_leave_encashment(admin_id: int, *, include_cl: bool = False) -> dict:
    ctc = CTCBreakup.query.filter_by(admin_id=admin_id).first()
    gross = float(ctc.gross_salary or 0) if ctc else 0.0
    cal_days = calendar.monthrange(date.today().year, date.today().month)[1]
    one_day = gross / float(cal_days) if cal_days > 0 else 0.0

    lb = LeaveBalance.query.filter_by(admin_id=admin_id).first()
    pl = float(lb.privilege_leave_balance or 0) if lb else 0.0
    cl = float(lb.casual_leave_balance or 0) if lb else 0.0

    enc = leave_encashment_amount(
        pl_days=pl,
        cl_days=cl,
        one_day_salary=one_day,
        include_cl=include_cl,
    )
    return {"admin_id": admin_id, **enc}


def preview_fnf_settlement(
    admin_id: int,
    *,
    separation_date: date,
    last_working_day: date,
    pending_salary_days: float | None = None,
    include_cl_encashment: bool = False,
    notice_recovery_days: float = 0,
    other_deductions: float = 0,
    other_earnings: float = 0,
) -> dict:
    admin = Admin.query.get(admin_id)
    ctc = CTCBreakup.query.filter_by(admin_id=admin_id).first()
    accounts = EmployeeAccounts.query.filter_by(admin_id=admin_id).first()
    lb = LeaveBalance.query.filter_by(admin_id=admin_id).first()

    gross = float(ctc.gross_salary or 0) if ctc else 0.0
    basic = float(ctc.basic_salary or 0) if ctc else 0.0
    da = float(ctc.dearness_allowance or 0) if ctc else 0.0
    y, m = last_working_day.year, last_working_day.month
    cal_days = calendar.monthrange(y, m)[1]
    one_day = gross / float(cal_days) if cal_days > 0 else 0.0

    if pending_salary_days is None:
        pending_salary_days = float(last_working_day.day)

    doj = None
    if accounts and accounts.date_of_joining:
        doj = accounts.date_of_joining
    elif admin and admin.doj:
        doj = admin.doj

    yrs = years_of_service(doj, last_working_day)
    loan_rec = round(
        sum(float(l.balance_remaining or 0) for l in active_loans_for_admin(admin_id)),
        2,
    )

    pl = float(lb.privilege_leave_balance or 0) if lb else 0.0
    cl = float(lb.casual_leave_balance or 0) if lb else 0.0

    settlement = compute_fnf_settlement(
        one_day_salary=one_day,
        pending_salary_days=pending_salary_days,
        pl_leave_balance=pl,
        cl_leave_balance=cl,
        include_cl_encashment=include_cl_encashment,
        basic=basic,
        dearness_allowance=da,
        years_of_service_val=yrs,
        loan_recovery=loan_rec,
        notice_recovery_days=notice_recovery_days,
        other_deductions=other_deductions,
        other_earnings=other_earnings,
    )

    resignation = (
        Resignation.query.filter_by(admin_id=admin_id)
        .order_by(Resignation.id.desc())
        .first()
    )

    return {
        "admin_id": admin_id,
        "employee_name": (admin.first_name or admin.user_name or "") if admin else "",
        "emp_id": (admin.emp_id or "") if admin else "",
        "separation_date": separation_date.isoformat(),
        "last_working_day": last_working_day.isoformat(),
        "date_of_joining": doj.isoformat() if doj else None,
        "resignation_status": resignation.status if resignation else None,
        "settlement": settlement,
    }


def save_fnf_settlement(
    admin_id: int,
    *,
    separation_date: date,
    last_working_day: date,
    snapshot: dict,
    note: str | None,
    created_by_admin_id: int | None,
) -> FnfSettlement:
    net = float((snapshot or {}).get("net_payable") or 0)
    row = FnfSettlement(
        admin_id=admin_id,
        separation_date=separation_date,
        last_working_day=last_working_day,
        snapshot=snapshot,
        net_payable=net,
        status="draft",
        note=(note or "").strip() or None,
        created_by_admin_id=created_by_admin_id,
    )
    db.session.add(row)
    return row


def list_fnf_settlements(admin_id: int) -> list[dict]:
    rows = (
        FnfSettlement.query.filter_by(admin_id=admin_id)
        .order_by(FnfSettlement.id.desc())
        .all()
    )
    return [r.to_dict() for r in rows]


FNF_STATUSES = frozenset({"draft", "finalized", "paid", "settled", "completed"})


def update_fnf_settlement_status(settlement_id: int, status: str) -> FnfSettlement:
    row = FnfSettlement.query.get(settlement_id)
    if not row:
        raise ValueError("Settlement not found")
    st = (status or "").strip().lower()
    if st not in FNF_STATUSES:
        raise ValueError(f"Invalid status. Allowed: {', '.join(sorted(FNF_STATUSES))}")
    row.status = st
    return row


def get_fnf_settlement(settlement_id: int) -> FnfSettlement | None:
    return FnfSettlement.query.get(settlement_id)


def _bank_details_for_admin(admin_id: int) -> dict:
    accounts = EmployeeAccounts.query.filter_by(admin_id=admin_id).first()
    upload = UploadDoc.query.filter_by(admin_id=admin_id).first()
    parsed = parse_bank_details_text(getattr(accounts, "bank_details", None) if accounts else None)
    acct = (
        (getattr(upload, "bank_account_number", None) if upload else None)
        or parsed.get("bank_account_number")
    )
    ifsc = (
        (getattr(upload, "ifsc_code", None) if upload else None)
        or parsed.get("ifsc_code")
    )
    bank_name = parsed.get("bank_name") or ""
    return {
        "account_number": digits_only_account(acct),
        "ifsc": (ifsc or "").strip().upper(),
        "bank_name": bank_name,
    }


def build_bank_payment_file(
    *,
    year: int,
    month_num: int,
    circle: str | None = None,
    emp_type: str | None = None,
) -> dict:
    q = (
        db.session.query(MonthlyPayroll, Admin)
        .join(Admin, Admin.id == MonthlyPayroll.admin_id)
        .filter(
            MonthlyPayroll.month_num == int(month_num),
            MonthlyPayroll.year == str(int(year)),
        )
    )
    if circle:
        q = q.filter(Admin.circle == circle)
    if emp_type:
        q = q.filter(Admin.emp_type == emp_type)

    lines = []
    for payroll, admin in q.order_by(Admin.first_name.asc(), Admin.emp_id.asc()).all():
        net = float(payroll.net_salary_final or 0)
        if net <= 0:
            continue
        bank = _bank_details_for_admin(admin.id)
        name = (admin.first_name or admin.user_name or "Employee").strip()
        lines.append({
            "beneficiary_name": name,
            "account_number": bank["account_number"],
            "ifsc": bank["ifsc"],
            "amount": round(net, 2),
            "payment_mode": "NEFT",
            "narration": f"Salary {payroll.month} {payroll.year}",
            "emp_id": (admin.emp_id or "").strip(),
            "bank_name": bank["bank_name"],
        })

    return {
        "year": year,
        "month_num": month_num,
        "month_name": calendar.month_name[month_num],
        "row_count": len(lines),
        "lines": lines,
        "csv": bank_neft_csv_rows(lines),
        "missing_bank_count": sum(1 for x in lines if not x["account_number"] or not x["ifsc"]),
    }
