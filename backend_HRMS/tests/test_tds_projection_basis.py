from types import SimpleNamespace

from website.payroll_tds_service import (
    build_tds_basis,
    ctc_amounts_for_projection,
    normalize_projection_mode,
)


def test_employee_cannot_run_what_if():
    assert normalize_projection_mode("what_if", allow_what_if=False) == "payroll_ready"
    assert normalize_projection_mode("what_if", allow_what_if=True) == "what_if"
    assert normalize_projection_mode(None, allow_what_if=True) == "payroll_ready"


def test_ctc_amounts_stay_approved_unless_what_if_pending():
    live = SimpleNamespace(gross_salary=50000, basic_salary=25000, hra=10000, epf=1800, ptax=200)
    pending = SimpleNamespace(
        id=9,
        status="pending_finance",
        kind="employee_ctc",
        payload={"gross_salary": 80000, "basic_salary": 40000, "hra": 16000, "epf": 1800, "ptax": 200},
    )
    ready = ctc_amounts_for_projection(live, pending, "payroll_ready")
    assert ready["ctc_basis"] == "approved"
    assert ready["monthly_gross"] == 50000

    what = ctc_amounts_for_projection(live, pending, "what_if")
    assert what["ctc_basis"] == "pending_what_if"
    assert what["monthly_gross"] == 80000


def test_tds_basis_payroll_flags():
    basis = build_tds_basis(
        projection_mode="payroll_ready",
        ctc_basis="approved",
        declaration_source={"status": "submitted"},
        rules_version="2026-27",
        pending=None,
    )
    assert basis["ctc_basis"] == "approved"
    assert basis["rules_version"] == "2026-27"
    assert basis["payroll_would_use"]["ctc"] == "approved"
    assert basis["payroll_would_use"]["uses_this_ctc"] is True
    assert basis["payroll_would_use"]["uses_this_declaration"] is True
