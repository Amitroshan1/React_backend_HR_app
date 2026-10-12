"""Module rollout — Accounts: payroll, claims, loans and tax data stay inside the caller's tenant."""
import importlib
import pkgutil
from datetime import date, timedelta

import pytest
from flask import Flask
from flask_jwt_extended import JWTManager, create_access_token

import website.models as models_pkg
from website import db

for _mod in pkgutil.iter_modules(models_pkg.__path__):
    # confirmation_request references a Signup model that is not defined.
    if _mod.name != "confirmation_request":
        importlib.import_module(f"website.models.{_mod.name}")

from website.models.Admin_models import Admin  # noqa: E402
from website.models.employee_salary_loan import EmployeeSalaryLoan  # noqa: E402
from website.models.employee_tax_declaration import EmployeeTaxDeclaration  # noqa: E402
from website.models.expense import ExpenseClaimHeader, ExpenseLineItem  # noqa: E402
from website.models.monthly_payroll import MonthlyPayroll  # noqa: E402
from website.models.news_feed import Form16, PaySlip  # noqa: E402
from website.models.salary_revision_request import SalaryRevisionRequest  # noqa: E402
from website.models.tenant import Tenant  # noqa: E402
from website.tenant_context import register_tenant_guards  # noqa: E402

ACC_TYPE = "Accounts"
TODAY = date.today()
MONTH = "January"
YEAR = "2026"


@pytest.fixture()
def app():
    from website.Accounts import Accounts

    app = Flask("tenancy_accounts_module")
    app.config.update(
        SQLALCHEMY_DATABASE_URI="sqlite:///:memory:",
        SQLALCHEMY_TRACK_MODIFICATIONS=False,
        JWT_SECRET_KEY="test-tenancy-accounts-module-secret",
        TESTING=True,
    )
    db.init_app(app)
    register_tenant_guards(app, JWTManager(app))
    app.register_blueprint(Accounts, url_prefix="/api/accounts")

    with app.app_context():
        db.create_all()
        db.session.add_all([
            Tenant(id=1, name="One", slug="default", plan="enterprise", status="active"),
            Tenant(id=2, name="Two", slug="two", plan="enterprise", status="active"),
        ])
        common = dict(circle="NHQ", is_active=True, is_exited=False, doj=TODAY - timedelta(days=400))
        db.session.add_all([
            Admin(id=1, tenant_id=1, email="acc@one.com", emp_id="A1", first_name="One Acc", emp_type=ACC_TYPE, **common),
            Admin(id=2, tenant_id=1, email="dup@x.com", emp_id="E1", first_name="Alpha Dev", emp_type="Engineering", **common),
            Admin(id=3, tenant_id=2, email="acc@two.com", emp_id="A1", first_name="Two Acc", emp_type=ACC_TYPE, **common),
            Admin(id=4, tenant_id=2, email="dup@x.com", emp_id="E1", first_name="Beta Dev", emp_type="Engineering", **common),
        ])
        db.session.flush()
        for aid in (2, 4):
            db.session.add(MonthlyPayroll(
                id=aid * 10, admin_id=aid, month=MONTH, month_num=1, year=YEAR,
                status="locked", net_salary_final=1000.0 * aid,
            ))
            claim = ExpenseClaimHeader(
                id=aid * 10, admin_id=aid, employee_name=f"Emp {aid}", designation="Dev",
                email="dup@x.com", emp_id="E1", project_name="P", country_state="KA",
                travel_from_date=TODAY, travel_to_date=TODAY,
            )
            db.session.add(claim)
            db.session.flush()
            db.session.add(ExpenseLineItem(
                id=aid * 10, claim_id=claim.id, sr_no=1, date=TODAY, purpose="Cab",
                amount=100.0, currency="INR", status="Pending",
            ))
            db.session.add(EmployeeSalaryLoan(
                id=aid * 10, admin_id=aid, principal_amount=1000, emi_monthly=100, balance_remaining=1000,
            ))
            db.session.add(SalaryRevisionRequest(id=aid * 10, admin_id=aid, status="pending"))
            db.session.add(EmployeeTaxDeclaration(
                id=aid * 10, admin_id=aid, financial_year="2025-26", status="submitted",
            ))
            db.session.add(PaySlip(
                id=aid * 10, admin_id=aid, month=MONTH, year=YEAR, file_path=f"payslips/{aid}.pdf",
            ))
        db.session.commit()
        yield app
        db.session.remove()
        db.drop_all()


def _acc(app, tenant_id):
    admin_id = 1 if tenant_id == 1 else 3
    with app.app_context():
        token = create_access_token(
            identity=str(admin_id),
            additional_claims={"email": f"acc@{'one' if tenant_id == 1 else 'two'}.com",
                               "emp_type": ACC_TYPE, "tenant_id": tenant_id},
        )
    return {"Authorization": f"Bearer {token}"}


BASE = "/api/accounts"


def test_employee_type_count_only_own_tenant(app):
    res = app.test_client().get(f"{BASE}/employee-type-count", headers=_acc(app, 1))
    counts = {r["emp_type"]: r["count"] for r in res.get_json()["data"]}
    assert counts == {ACC_TYPE: 1, "Engineering": 1}


def test_payroll_history_only_own_tenant(app):
    res = app.test_client().post(
        f"{BASE}/payroll/history", json={"month": MONTH, "year": YEAR}, headers=_acc(app, 2),
    )
    assert [r["admin_id"] for r in res.get_json()["history"]] == [4]


def test_payroll_list_drops_other_tenants_ids(app):
    res = app.test_client().post(
        f"{BASE}/payroll/list", json={"admin_ids": [2, 4], "month": MONTH, "year": YEAR}, headers=_acc(app, 1),
    )
    assert [p["admin_id"] for p in res.get_json()["payrolls"]] == [2]


def test_payroll_by_id_of_other_tenant_is_not_found(app):
    c = app.test_client()
    assert c.get(f"{BASE}/payroll/audit/40", headers=_acc(app, 1)).status_code == 404
    assert c.get(f"{BASE}/payroll/40/download", headers=_acc(app, 1)).status_code == 404
    assert c.get(f"{BASE}/payroll/audit/20", headers=_acc(app, 1)).status_code == 200


def test_payroll_status_skips_other_tenants_rows(app):
    res = app.test_client().post(
        f"{BASE}/payroll/status",
        json={"admin_ids": [4], "month": MONTH, "year": YEAR, "status": "paid"},
        headers=_acc(app, 1),
    )
    assert res.get_json()["errors"] == [{"admin_id": 4, "message": "Payroll row not found"}]


def test_bank_file_only_own_tenant(app):
    res = app.test_client().get(
        f"{BASE}/compliance/bank-file?year={YEAR}&month={MONTH}&format=json", headers=_acc(app, 2),
    )
    assert [line["emp_id"] for line in res.get_json()["lines"]] == ["E1"]
    assert res.get_json()["lines"][0]["amount"] == 4000.0


def test_expense_claims_only_own_tenant(app):
    c = app.test_client()
    res = c.get(f"{BASE}/expense-claims", headers=_acc(app, 1))
    assert [r["id"] for r in res.get_json()["claims"]] == [20]
    assert c.get(f"{BASE}/expense-claims/40/excel", headers=_acc(app, 1)).status_code == 404


def test_cannot_act_on_other_tenants_claim_line_item(app):
    res = app.test_client().post(
        f"{BASE}/expense-claims/line-items/40/action", json={"action": "approve"}, headers=_acc(app, 1),
    )
    assert res.status_code == 404
    with app.app_context():
        assert db.session.get(ExpenseLineItem, 40).status == "Pending"


def test_loans_scoped_to_tenant(app):
    c = app.test_client()
    res = c.get(f"{BASE}/payroll/loans", headers=_acc(app, 1))
    assert [r["admin_id"] for r in res.get_json()["loans"]] == [2]
    body = {"admin_id": 4, "principal_amount": 500, "emi_monthly": 50}
    assert c.post(f"{BASE}/payroll/loans", json=body, headers=_acc(app, 1)).status_code == 404
    assert c.put(f"{BASE}/payroll/loans/40", json={"emi_monthly": 1}, headers=_acc(app, 1)).status_code == 404
    with app.app_context():
        assert db.session.get(EmployeeSalaryLoan, 40).emi_monthly == 100


def test_salary_revisions_scoped_to_tenant(app):
    c = app.test_client()
    res = c.get(f"{BASE}/pending-salary-revisions", headers=_acc(app, 2))
    assert [r["admin_id"] for r in res.get_json()["requests"]] == [4]
    res = c.patch(f"{BASE}/pending-salary-revisions/20", json={"status": "completed"}, headers=_acc(app, 2))
    assert res.status_code == 404


def test_tax_declarations_scoped_to_tenant(app):
    c = app.test_client()
    res = c.get(f"{BASE}/tax-declarations?status=submitted", headers=_acc(app, 1))
    assert [d["admin_id"] for d in res.get_json()["declarations"]] == [2]
    res = c.post(f"{BASE}/tax-declarations/40/review", json={"action": "approve"}, headers=_acc(app, 1))
    assert res.status_code == 404
    with app.app_context():
        assert db.session.get(EmployeeTaxDeclaration, 40).status == "submitted"


def test_payslip_delete_of_other_tenant_is_not_found(app):
    res = app.test_client().delete(f"{BASE}/payslip/40", headers=_acc(app, 1))
    assert res.status_code == 404
    with app.app_context():
        assert db.session.get(PaySlip, 40) is not None


def test_traces_import_matches_emp_id_in_own_tenant(app):
    from io import BytesIO

    csv = b"Employee ID,TDS Deducted\nE1,1234\n"
    res = app.test_client().post(
        f"{BASE}/form16/traces-import",
        data={"financial_year": "2025-26", "file": (BytesIO(csv), "traces.csv")},
        content_type="multipart/form-data",
        headers=_acc(app, 2),
    )
    assert res.get_json()["imported"] == 1
    with app.app_context():
        assert [f.admin_id for f in Form16.query.all()] == [4]


def test_url_employee_id_of_other_tenant_is_not_found(app):
    c = app.test_client()
    assert c.get(f"{BASE}/ctc-breakup/revisions/4", headers=_acc(app, 1)).status_code == 404
    assert c.get(f"{BASE}/employee-documents/4", headers=_acc(app, 1)).status_code == 404


def test_hr_compensation_proposal_of_other_tenant_is_not_found(app):
    from website.compensation_service import hr_approve_proposal, list_proposals

    with app.app_context():
        approver = db.session.get(Admin, 1)
        with pytest.raises(ValueError, match="Proposal not found"):
            hr_approve_proposal(approver, 40)
        assert [p["admin_id"] for p in list_proposals(tenant_id=1, status="pending")] == [2]
