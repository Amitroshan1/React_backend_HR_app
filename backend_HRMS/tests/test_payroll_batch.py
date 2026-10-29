"""Payroll batch rules must not change rows that have no batch."""
from datetime import date

from website.commands.payroll_governance_logic import assert_status_transition
from website.models.monthly_payroll import MonthlyPayroll
from website.models.payroll_batch import (
    BATCH_APPROVED,
    BATCH_PENDING_FINANCE,
    BATCH_PAYSLIPS_ISSUED,
    PayrollBatch,
)
from website.payroll_batch_service import (
    decide_batch,
    employee_may_see_payroll_row,
    month_is_closed,
    payroll_ready_for_compliance,
)


def test_month_is_closed_only_after_last_day():
    assert month_is_closed(2026, 9, today=date(2026, 10, 1)) is True
    assert month_is_closed(2026, 10, today=date(2026, 10, 26)) is False
    assert month_is_closed(2026, 10, today=date(2026, 11, 1)) is True


def test_legacy_status_still_valid_without_batch():
    assert_status_transition("draft", "reviewed")
    assert_status_transition("reviewed", "paid")
    assert_status_transition("paid", "locked")


def test_employee_visibility_and_compliance_without_batch():
    row = MonthlyPayroll(admin_id=1, month="October", month_num=10, year="2026", status="draft")
    assert employee_may_see_payroll_row(row) is True
    assert payroll_ready_for_compliance(row) is True


def test_employee_hidden_until_payslips_issued():
    batch = PayrollBatch(
        tenant_id=1,
        circle="NHQ",
        emp_type="Accounts",
        month="October",
        month_num=10,
        year="2026",
        status=BATCH_PENDING_FINANCE,
    )
    row = MonthlyPayroll(id=9, admin_id=1, month="October", month_num=10, year="2026", status="draft")

    class _Member:
        def __init__(self, b):
            self.batch = b

    # Patch lookup by attaching a fake member path through batch_for_payroll_row
    from website import payroll_batch_service as svc

    original = svc.batch_for_payroll_row
    svc.batch_for_payroll_row = lambda r: batch
    try:
        assert employee_may_see_payroll_row(row) is False
        assert payroll_ready_for_compliance(row) is False
        batch.status = BATCH_APPROVED
        assert employee_may_see_payroll_row(row) is False
        assert payroll_ready_for_compliance(row) is True
        batch.status = BATCH_PAYSLIPS_ISSUED
        assert employee_may_see_payroll_row(row) is True
    finally:
        svc.batch_for_payroll_row = original


def test_submitter_cannot_approve():
    batch = PayrollBatch(
        tenant_id=1,
        circle="NHQ",
        emp_type="Accounts",
        month="September",
        month_num=9,
        year="2026",
        status=BATCH_PENDING_FINANCE,
        submitted_by_admin_id=5,
    )
    try:
        decide_batch(batch, action="approve", actor_admin_id=5)
        assert False, "expected submitter block"
    except ValueError as exc:
        assert "cannot approve" in str(exc).lower()
    decide_batch(batch, action="approve", actor_admin_id=9)
    assert batch.status == BATCH_APPROVED
