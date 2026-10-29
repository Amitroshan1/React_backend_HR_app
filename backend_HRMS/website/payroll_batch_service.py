"""Payroll batch: draft fill, Finance freeze, approval, and payslip issue."""
from __future__ import annotations

import calendar
from datetime import date, datetime
from zoneinfo import ZoneInfo

from . import db
from .circle_transfer_utils import had_circle_transfer_in_month
from .datetime_utils import utc_now
from .models.Admin_models import Admin
from .models.ctc_breakup import CTCBreakup
from .models.monthly_payroll import MonthlyPayroll
from .models.news_feed import PaySlip
from .models.payroll_batch import (
    BATCH_APPROVED,
    BATCH_DRAFT,
    BATCH_PAYSLIPS_ISSUED,
    BATCH_PENDING_FINANCE,
    BATCH_REJECTED,
    COMPLIANCE_READY_STATUSES,
    EDITABLE_BATCH_STATUSES,
    EMPLOYEE_VISIBLE_STATUSES,
    FROZEN_BATCH_STATUSES,
    LEAVE_BLOCK_BATCH_STATUSES,
    PayrollBatch,
    PayrollBatchMember,
)
from .tenant_context import get_current_tenant_id


def _today_ist() -> date:
    return datetime.now(ZoneInfo("Asia/Kolkata")).date()


def month_is_closed(year: int, month_num: int, *, today=None) -> bool:
    today = today or _today_ist()
    last = calendar.monthrange(int(year), int(month_num))[1]
    return today > date(int(year), int(month_num), last)


def counted_through_date(year: int, month_num: int, *, today=None) -> date:
    today = today or _today_ist()
    last = calendar.monthrange(int(year), int(month_num))[1]
    month_end = date(int(year), int(month_num), last)
    month_start = date(int(year), int(month_num), 1)
    if (today.year, today.month) == (int(year), int(month_num)):
        return today
    if (today.year, today.month) > (int(year), int(month_num)):
        return month_end
    return month_start


def find_batch(*, tenant_id, circle, emp_type, month_num, year):
    return PayrollBatch.query.filter_by(
        tenant_id=int(tenant_id),
        circle=(circle or "").strip(),
        emp_type=(emp_type or "").strip(),
        month_num=int(month_num),
        year=str(year),
    ).first()


def get_or_create_draft_batch(*, tenant_id, circle, emp_type, month, month_num, year):
    row = find_batch(
        tenant_id=tenant_id,
        circle=circle,
        emp_type=emp_type,
        month_num=month_num,
        year=year,
    )
    if row:
        return row
    row = PayrollBatch(
        tenant_id=int(tenant_id),
        circle=(circle or "").strip(),
        emp_type=(emp_type or "").strip(),
        month=month,
        month_num=int(month_num),
        year=str(year),
        status=BATCH_DRAFT,
        accounts_saved=False,
    )
    db.session.add(row)
    db.session.flush()
    return row


def batch_for_payroll_id(payroll_id: int) -> PayrollBatch | None:
    if not payroll_id:
        return None
    member = PayrollBatchMember.query.filter_by(payroll_id=int(payroll_id)).first()
    return member.batch if member else None


def batch_for_payroll_row(row: MonthlyPayroll | None) -> PayrollBatch | None:
    if row is None:
        return None
    if getattr(row, "id", None):
        found = batch_for_payroll_id(row.id)
        if found:
            return found
    return None


def is_frozen_batch(batch: PayrollBatch | None) -> bool:
    if batch is None:
        return False
    return (batch.status or "") in FROZEN_BATCH_STATUSES


def is_editable_batch(batch: PayrollBatch | None) -> bool:
    if batch is None:
        return True
    return (batch.status or "") in EDITABLE_BATCH_STATUSES


def assert_row_not_batch_frozen(row: MonthlyPayroll) -> None:
    batch = batch_for_payroll_row(row)
    if is_frozen_batch(batch):
        raise ValueError(
            f"Payroll is in a {batch.status} batch and cannot be edited. "
            "Wait for Finance or reopen after a rejection."
        )


def assert_legacy_status_allowed(row: MonthlyPayroll) -> None:
    batch = batch_for_payroll_row(row)
    if batch is None:
        return
    raise ValueError(
        "This employee is in a department payroll batch. "
        "Use Submit for Finance instead of Mark Reviewed / Paid / Lock."
    )


def leave_blocked_for_month(admin_id: int, year: int, month_num: int) -> PayrollBatch | None:
    members = (
        PayrollBatchMember.query.join(PayrollBatch, PayrollBatch.id == PayrollBatchMember.batch_id)
        .filter(
            PayrollBatchMember.admin_id == int(admin_id),
            PayrollBatch.month_num == int(month_num),
            PayrollBatch.year == str(year),
            PayrollBatch.status.in_(tuple(LEAVE_BLOCK_BATCH_STATUSES)),
        )
        .first()
    )
    return members.batch if members else None


def employee_may_see_payroll_row(row: MonthlyPayroll) -> bool:
    batch = batch_for_payroll_row(row)
    if batch is None:
        return True
    return (batch.status or "") in EMPLOYEE_VISIBLE_STATUSES


def payroll_ready_for_compliance(row: MonthlyPayroll) -> bool:
    batch = batch_for_payroll_row(row)
    if batch is None:
        return True
    return (batch.status or "") in COMPLIANCE_READY_STATUSES


def other_active_batch_for_admin(admin_id: int, year, month_num, *, exclude_batch_id=None):
    q = (
        PayrollBatchMember.query.join(PayrollBatch, PayrollBatch.id == PayrollBatchMember.batch_id)
        .filter(
            PayrollBatchMember.admin_id == int(admin_id),
            PayrollBatch.month_num == int(month_num),
            PayrollBatch.year == str(year),
            PayrollBatch.status.in_(tuple(FROZEN_BATCH_STATUSES | {BATCH_DRAFT, BATCH_REJECTED})),
        )
    )
    if exclude_batch_id:
        q = q.filter(PayrollBatch.id != int(exclude_batch_id))
    return q.first()


def sync_batch_members(batch: PayrollBatch, payroll_rows: list[MonthlyPayroll]) -> None:
    existing = {m.payroll_id: m for m in (batch.members or [])}
    for row in payroll_rows:
        if not row or not row.id:
            continue
        status = (row.status or "draft").strip().lower()
        if status in {"paid", "locked"}:
            continue
        other = other_active_batch_for_admin(
            row.admin_id, batch.year, batch.month_num, exclude_batch_id=batch.id
        )
        if other:
            continue
        member = existing.get(row.id)
        if member:
            member.included = True
            continue
        db.session.add(
            PayrollBatchMember(
                batch_id=batch.id,
                payroll_id=row.id,
                admin_id=row.admin_id,
                included=True,
            )
        )


def should_overwrite_computed(batch: PayrollBatch | None) -> bool:
    if batch is None:
        return False
    if is_frozen_batch(batch):
        return False
    return not bool(batch.accounts_saved)


def mark_accounts_saved(batch: PayrollBatch | None) -> None:
    if batch is None or is_frozen_batch(batch):
        return
    batch.accounts_saved = True
    batch.updated_at = utc_now()


def finance_mailbox_or_error() -> tuple[str | None, str | None]:
    from .company_mailbox import company_mailbox

    addr = (company_mailbox("EMAIL_FINANCE") or company_mailbox("ZEPTO_CC_FINANCE") or "").strip()
    if not addr:
        return None, "Finance mailbox is not configured. Set EMAIL_FINANCE before submitting payroll."
    return addr, None


def accounts_mailbox() -> str:
    from .company_mailbox import company_mailbox

    return (
        company_mailbox("ZEPTO_CC_ACCOUNT")
        or company_mailbox("EMAIL_ACCOUNTS")
        or ""
    ).strip()


def submit_batch(batch: PayrollBatch, *, actor_admin_id: int, include_admin_ids=None):
    if not is_editable_batch(batch):
        raise ValueError(f"Batch is {batch.status} and cannot be submitted.")
    if not month_is_closed(int(batch.year), int(batch.month_num)):
        through = counted_through_date(int(batch.year), int(batch.month_num))
        raise ValueError(
            f"Submit is allowed only after the month ends. Days are counted through {through.isoformat()}."
        )
    _, mailbox_err = finance_mailbox_or_error()
    if mailbox_err:
        raise ValueError(mailbox_err)

    include = {int(x) for x in (include_admin_ids or [])} if include_admin_ids else None
    warnings = []
    missing_ctc = []
    members = list(batch.members or [])
    if not members:
        raise ValueError("No payroll rows in this batch.")

    for member in members:
        payroll = member.payroll or db.session.get(MonthlyPayroll, member.payroll_id)
        admin = db.session.get(Admin, member.admin_id)
        if include is not None:
            member.included = member.admin_id in include
        if not member.included:
            continue
        if payroll and (payroll.status or "").lower() in {"paid", "locked"}:
            member.included = False
            continue
        ctc = CTCBreakup.query.filter_by(admin_id=member.admin_id).first()
        if not ctc or float(getattr(ctc, "gross_salary", 0) or 0) <= 0:
            missing_ctc.append(getattr(admin, "emp_id", None) or member.admin_id)
        if admin and had_circle_transfer_in_month(admin, int(batch.year), int(batch.month_num)):
            if include is None or member.admin_id not in include:
                member.included = False
                warnings.append(
                    f"{getattr(admin, 'emp_id', member.admin_id)} changed circle this month and was left out."
                )
        if payroll and float(getattr(payroll, "statutory_bonus_final", 0) or 0) <= 0:
            warnings.append("Statutory bonus is still 0 for at least one included employee.")
        if payroll and float(getattr(payroll, "loan_recovery_final", 0) or 0) <= 0:
            warnings.append("Loan recovery is still 0 for at least one included employee.")

    if missing_ctc:
        raise ValueError(
            "Every included employee needs a saved CTC before submit. Missing: "
            + ", ".join(str(x) for x in missing_ctc[:8])
        )
    if not any(m.included for m in members):
        raise ValueError("No employees remain in this batch to submit.")

    warnings = list(dict.fromkeys(warnings))
    batch.status = BATCH_PENDING_FINANCE
    batch.submitted_by_admin_id = actor_admin_id
    batch.submitted_at = utc_now()
    batch.decided_by_admin_id = None
    batch.decided_at = None
    batch.decision_comment = None
    batch.updated_at = utc_now()
    return warnings


def decide_batch(batch: PayrollBatch, *, action: str, actor_admin_id: int, comment: str | None = None):
    if (batch.status or "") != BATCH_PENDING_FINANCE:
        raise ValueError(f"Batch is {batch.status}, not waiting on Finance.")
    if batch.submitted_by_admin_id and int(batch.submitted_by_admin_id) == int(actor_admin_id):
        raise ValueError("The person who submitted this payroll cannot approve it.")
    action = (action or "").strip().lower()
    if action not in {"approve", "reject"}:
        raise ValueError("action must be approve or reject")
    batch.decided_by_admin_id = actor_admin_id
    batch.decided_at = utc_now()
    batch.decision_comment = (comment or "").strip() or None
    batch.updated_at = utc_now()
    if action == "approve":
        batch.status = BATCH_APPROVED
    else:
        batch.status = BATCH_REJECTED
        batch.accounts_saved = True
    return batch.status


def confirm_salary_credited(batch: PayrollBatch, *, actor_admin_id: int):
    if (batch.status or "") != BATCH_APPROVED:
        raise ValueError("Payslips can be generated only after Finance approves this batch.")
    batch.salary_credited_confirmed = True
    batch.salary_credited_by_admin_id = actor_admin_id
    batch.salary_credited_at = utc_now()
    batch.updated_at = utc_now()


def mark_payslips_issued(batch: PayrollBatch):
    batch.status = BATCH_PAYSLIPS_ISSUED
    batch.updated_at = utc_now()


def existing_payslip(admin_id: int, month: str, year: str) -> PaySlip | None:
    return PaySlip.query.filter_by(admin_id=int(admin_id), month=month, year=str(year)).first()


def list_batches_for_month(*, tenant_id, month_num, year, status=None):
    q = PayrollBatch.query.filter_by(
        tenant_id=int(tenant_id),
        month_num=int(month_num),
        year=str(year),
    )
    if status:
        q = q.filter(PayrollBatch.status == status)
    return q.order_by(PayrollBatch.circle.asc(), PayrollBatch.emp_type.asc()).all()


def list_pending_finance_batches(*, tenant_id=None):
    tid = int(tenant_id if tenant_id is not None else get_current_tenant_id())
    return (
        PayrollBatch.query.filter_by(tenant_id=tid, status=BATCH_PENDING_FINANCE)
        .order_by(PayrollBatch.submitted_at.desc(), PayrollBatch.id.desc())
        .all()
    )


def pending_finance_count(*, tenant_id=None) -> int:
    tid = int(tenant_id if tenant_id is not None else get_current_tenant_id())
    return PayrollBatch.query.filter_by(tenant_id=tid, status=BATCH_PENDING_FINANCE).count()


def write_generated_payslip_pdf(payroll: MonthlyPayroll, admin) -> str:
    """Write a PDF from the frozen payroll row into the existing payslips folder."""
    from io import BytesIO
    from reportlab.lib.pagesizes import A4
    from reportlab.pdfgen import canvas

    from .tenant_context import tenant_id_for_admin
    from .upload_tenancy import tenant_upload_path

    import os
    import uuid
    from flask import current_app

    buffer = BytesIO()
    c = canvas.Canvas(buffer, pagesize=A4)
    width, height = A4
    y = height - 48
    name = (getattr(admin, "first_name", None) or "Employee").strip()
    emp_id = (getattr(admin, "emp_id", None) or "-").strip()
    c.setFont("Helvetica-Bold", 16)
    c.drawCentredString(width / 2, y, "Pay Slip")
    y -= 22
    c.setFont("Helvetica", 11)
    c.drawCentredString(width / 2, y, f"{payroll.month} {payroll.year}")
    y -= 28
    c.setFont("Helvetica-Bold", 12)
    c.drawString(48, y, name)
    y -= 16
    c.setFont("Helvetica", 10)
    c.drawString(48, y, f"Employee ID: {emp_id}")
    y -= 24
    lines = [
        ("Working days", float(payroll.actual_working_days or 0)),
        ("Gross", float(payroll.gross_salary_for_month or 0)),
        ("Arrears", float(payroll.arrears_gross_final or 0)),
        ("Bonus", float(payroll.statutory_bonus_final or 0)),
        ("EPF", float(payroll.epf_final or 0)),
        ("P.Tax", float(payroll.ptax_final or 0)),
        ("ESIC", float(payroll.esic_final or 0)),
        ("LWF", float(payroll.lwf_final or 0)),
        ("TDS", float(payroll.tds_final if payroll.tds_final is not None else payroll.tds_computed or 0)),
        ("Net", float(payroll.net_salary_final or 0)),
    ]
    for label, value in lines:
        c.drawString(48, y, label)
        c.drawRightString(width - 48, y, f"{value:,.2f}")
        y -= 16
    c.save()
    buffer.seek(0)

    uploads_root = current_app.config.get("UPLOADS_ROOT")
    if not uploads_root:
        uploads_root = os.path.abspath(os.path.join(current_app.root_path, "..", "uploads"))
    timestamp = datetime.now().strftime("%Y%m%d%H%M%S")
    final_name = (
        f"{admin.id}_{payroll.month}_{payroll.year}_{timestamp}_"
        f"{uuid.uuid4().hex[:10]}_generated.pdf"
    )
    abs_path, rel_path = tenant_upload_path(
        uploads_root, f"payslips/{final_name}", tenant_id_for_admin(admin)
    )
    os.makedirs(os.path.dirname(abs_path), exist_ok=True)
    with open(abs_path, "wb") as fh:
        fh.write(buffer.getvalue())
    return rel_path


def batch_public_payload(batch: PayrollBatch) -> dict:
    return {
        "id": batch.id,
        "circle": batch.circle,
        "emp_type": batch.emp_type,
        "month": batch.month,
        "month_num": batch.month_num,
        "year": batch.year,
        "status": batch.status,
        "accounts_saved": bool(batch.accounts_saved),
        "submitted_at": batch.submitted_at.isoformat() if batch.submitted_at else None,
        "decided_at": batch.decided_at.isoformat() if batch.decided_at else None,
        "decision_comment": batch.decision_comment if batch.status == BATCH_REJECTED else None,
        "salary_credited_confirmed": bool(batch.salary_credited_confirmed),
        "member_count": sum(1 for m in (batch.members or []) if m.included),
        "counted_through": counted_through_date(int(batch.year), int(batch.month_num)).isoformat(),
        "month_closed": month_is_closed(int(batch.year), int(batch.month_num)),
    }
