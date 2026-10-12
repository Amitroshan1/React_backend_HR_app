"""Module rollout — HR: employee lists, lookups and approvals stay inside the caller's tenant."""
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

from website.models.Admin_models import Admin, EmployeeExitHistory  # noqa: E402
from website.models.attendance import LeaveApplication, LeaveBalance  # noqa: E402
from website.models.employee_circle_history import EmployeeCircleHistory  # noqa: E402
from website.models.seperation import Resignation  # noqa: E402
from website.models.tenant import Tenant  # noqa: E402
from website.tenant_context import register_tenant_guards  # noqa: E402

HR_TYPE = "Human Resource"
TODAY = date.today()


@pytest.fixture()
def app():
    from website.Human_resource import hr

    app = Flask("tenancy_hr_module")
    app.config.update(
        SQLALCHEMY_DATABASE_URI="sqlite:///:memory:",
        SQLALCHEMY_TRACK_MODIFICATIONS=False,
        JWT_SECRET_KEY="test-tenancy-hr-module-secret-32b",
        TESTING=True,
    )
    db.init_app(app)
    register_tenant_guards(app, JWTManager(app))
    app.register_blueprint(hr, url_prefix="/api/HumanResource")

    with app.app_context():
        db.create_all()
        db.session.add_all([
            Tenant(id=1, name="One", slug="default", plan="enterprise", status="active"),
            Tenant(id=2, name="Two", slug="two", plan="enterprise", status="active"),
        ])
        common = dict(circle="NHQ", is_active=True, is_exited=False, doj=TODAY - timedelta(days=400))
        db.session.add_all([
            Admin(id=1, tenant_id=1, email="hr@one.com", emp_id="H1", first_name="One HR", emp_type=HR_TYPE, **common),
            Admin(id=2, tenant_id=1, email="dup@x.com", emp_id="E1", first_name="Alpha Dev", emp_type="Engineering", **common),
            Admin(id=3, tenant_id=2, email="hr@two.com", emp_id="H1", first_name="Two HR", emp_type=HR_TYPE, **common),
            Admin(id=4, tenant_id=2, email="dup@x.com", emp_id="E1", first_name="Beta Dev", emp_type="Engineering", **common),
        ])
        db.session.flush()
        for aid in (2, 4):
            db.session.add(LeaveBalance(
                admin_id=aid, privilege_leave_balance=5, casual_leave_balance=5, compensatory_leave_balance=0,
            ))
            db.session.add(LeaveApplication(
                id=aid * 10, admin_id=aid, leave_type="Casual Leave", reason="Family function at home",
                start_date=TODAY + timedelta(days=5), end_date=TODAY + timedelta(days=5), status="Pending",
            ))
            db.session.add(Resignation(
                admin_id=aid, resignation_date=TODAY + timedelta(days=30), reason="Moving city", status="Pending",
            ))
            db.session.add(EmployeeCircleHistory(
                admin_id=aid, from_circle="BLR", to_circle="NHQ",
                effective_from=TODAY - timedelta(days=10), recorded_by="hr",
            ))
        db.session.add(EmployeeExitHistory(admin_id=4, exit_date=TODAY, exit_type="Resignation"))
        db.session.commit()
        yield app
        db.session.remove()
        db.drop_all()


def _hr(app, tenant_id):
    admin_id = 1 if tenant_id == 1 else 3
    with app.app_context():
        token = create_access_token(
            identity=str(admin_id),
            additional_claims={"email": f"hr@{'one' if tenant_id == 1 else 'two'}.com",
                               "emp_type": HR_TYPE, "tenant_id": tenant_id},
        )
    return {"Authorization": f"Bearer {token}"}


BASE = "/api/HumanResource"


def test_search_lists_only_own_tenant(app):
    c = app.test_client()
    res = c.get(f"{BASE}/search?circle=NHQ&emp_type=Engineering", headers=_hr(app, 1))
    assert [e["id"] for e in res.get_json()["employees"]] == [2]
    res = c.get(f"{BASE}/employee/search?circle=NHQ&emp_type=Engineering", headers=_hr(app, 2))
    assert [e["id"] for e in res.get_json()["employees"]] == [4]


def test_active_employees_only_own_tenant(app):
    res = app.test_client().get(f"{BASE}/employees/active", headers=_hr(app, 1))
    assert sorted(e["id"] for e in res.get_json()["employees"]) == [1, 2]


def test_dashboard_counts_only_own_tenant(app):
    c = app.test_client()
    one = c.get(f"{BASE}/dashboard", headers=_hr(app, 1)).get_json()["counts"]
    two = c.get(f"{BASE}/dashboard", headers=_hr(app, 2)).get_json()["counts"]
    assert one["total_employees"] == 2 and two["total_employees"] == 2
    assert one["exits_this_month"] == 0 and two["exits_this_month"] == 1


def test_leave_requests_list_only_own_tenant(app):
    res = app.test_client().get(f"{BASE}/leave-updation/requests?request_type=leave", headers=_hr(app, 1))
    assert [r["id"] for r in res.get_json()["requests"]] == [20]


def test_cannot_update_other_tenants_leave(app):
    c = app.test_client()
    res = c.patch(f"{BASE}/leave-updation/requests/40", json={"status": "Rejected"}, headers=_hr(app, 1))
    assert res.status_code == 404
    with app.app_context():
        assert db.session.get(LeaveApplication, 40).status == "Pending"
    assert c.get(f"{BASE}/leave-updation/requests/40/audit", headers=_hr(app, 1)).status_code == 404


def test_leave_on_behalf_rejects_other_tenants_employee(app):
    body = {"admin_id": 4, "leave_type": "Casual Leave", "start_date": TODAY.isoformat(), "end_date": TODAY.isoformat()}
    res = app.test_client().post(f"{BASE}/leave-updation/requests/preview", json=body, headers=_hr(app, 1))
    assert res.status_code == 404


def test_display_details_rejects_other_tenants_employee(app):
    c = app.test_client()
    url = f"{BASE}/display-details?user_id={{}}&detail_type=Leave%20Details"
    assert c.get(url.format(4), headers=_hr(app, 1)).status_code == 404
    assert c.get(url.format(2), headers=_hr(app, 1)).status_code == 200


def test_employee_by_email_resolves_in_own_tenant(app):
    c = app.test_client()
    one = c.get(f"{BASE}/employee/by-email/dup@x.com", headers=_hr(app, 1)).get_json()["employee"]
    two = c.get(f"{BASE}/employee/by-email/dup@x.com", headers=_hr(app, 2)).get_json()["employee"]
    assert one["first_name"] == "Alpha Dev" and two["first_name"] == "Beta Dev"


def test_url_employee_id_of_other_tenant_is_not_found(app):
    c = app.test_client()
    assert c.get(f"{BASE}/employee/profile/4", headers=_hr(app, 1)).status_code == 404
    assert c.get(f"{BASE}/leave-balance/4", headers=_hr(app, 1)).status_code == 404
    assert c.get(f"{BASE}/leave-balance/2", headers=_hr(app, 1)).status_code == 200


def test_noc_list_only_own_tenant(app):
    res = app.test_client().get(f"{BASE}/noc", headers=_hr(app, 1))
    assert [r["admin_id"] for r in res.get_json()["noc_list"]] == [2]


def test_circle_transfers_only_own_tenant(app):
    res = app.test_client().get(f"{BASE}/circle-transfers", headers=_hr(app, 2))
    assert {t.get("admin_id") for t in res.get_json()["transfers"]} == {4}


def test_offboarding_dashboard_only_own_tenant(app):
    c = app.test_client()
    one = c.get(f"{BASE}/offboarding/dashboard", headers=_hr(app, 1)).get_json()
    two = c.get(f"{BASE}/offboarding/dashboard", headers=_hr(app, 2)).get_json()
    assert one["analytics"]["total_exits"] == 0
    assert two["analytics"]["total_exits"] == 1


def test_employee_lookup_by_emp_id_resolves_in_own_tenant(app):
    c = app.test_client()
    assert c.get(f"{BASE}/employee/lookup?emp_id=E1", headers=_hr(app, 2)).get_json()["employee"]["admin_id"] == 4
    assert c.get(f"{BASE}/employee/lookup?emp_id=E1", headers=_hr(app, 1)).get_json()["employee"]["admin_id"] == 2


def test_family_photo_is_saved_in_the_employee_company(app, tmp_path):
    import io

    from website.models.family_models import FamilyDetails

    app.root_path = str(tmp_path / "site")
    (tmp_path / "site").mkdir()
    with app.app_context():
        row = FamilyDetails(
            admin_id=4, name="Kid", dob=TODAY, age=8, relation="Son",
            occupation="Student", address="Home",
        )
        db.session.add(row)
        db.session.commit()
        family_id = row.id
    client = app.test_client()
    saved = client.post(
        f"{BASE}/family/{family_id}/photo",
        data={"photo": (io.BytesIO(b"png"), "kid.png")},
        headers=_hr(app, 2),
    )
    assert saved.status_code == 200, saved.get_json()
    key = saved.get_json()["photo_filename"]
    assert key.startswith("tenants/2/family/")
    assert (tmp_path / "site" / "static" / "uploads").joinpath(*key.split("/")).is_file()
    denied = client.post(
        f"{BASE}/family/{family_id}/photo",
        data={"photo": (io.BytesIO(b"png"), "kid.png")},
        headers=_hr(app, 1),
    )
    assert denied.status_code == 404


def test_designation_change_waits_for_admin_approval(app, monkeypatch):
    from website.employee_profile_change_service import decide_profile_change, get_change_request
    from website.models.emp_detail_models import Employee

    client = app.test_client()
    res = client.put(
        f"{BASE}/employee/by-email/dup@x.com",
        json={"designation": "Software Engineer"},
        headers=_hr(app, 1),
    )
    body = res.get_json()
    assert res.status_code == 200, body
    assert body["pending_approval"] is True
    assert body["pending_fields"] == ["designation"]

    with app.app_context():
        employee = Employee.query.filter_by(admin_id=2).first()
        assert employee is None or employee.designation != "Software Engineer"
        pending = client.get(f"{BASE}/employee-change-requests?status=pending", headers=_hr(app, 1)).get_json()
    assert pending["count"] == 1
    request_id = pending["requests"][0]["id"]
    hidden = client.get(f"{BASE}/employee-change-requests?status=pending", headers=_hr(app, 2)).get_json()
    assert hidden["count"] == 0

    monkeypatch.setattr(
        "website.employee_profile_change_service.current_admin",
        lambda: db.session.get(Admin, 1),
    )
    with app.app_context():
        row = get_change_request(1, request_id)
        payload, message, status = decide_profile_change(row, "approve")
        assert status == 200, message
        assert payload["status"] == "approved"
        employee = Employee.query.filter_by(admin_id=2).first()
        assert employee is not None
        assert employee.designation == "Software Engineer"
        history = client.get(f"{BASE}/employee-change-requests?status=approved", headers=_hr(app, 1)).get_json()
    assert history["requests"][0]["decided_by_name"]


def test_new_signup_cannot_sign_in_until_admin_approves(app, monkeypatch):
    from website.employee_profile_change_service import decide_profile_change, get_change_request
    from website.models.master_data import MasterData

    with app.app_context():
        db.session.add_all([
            MasterData(tenant_id=1, master_type="department", name="Engineering", is_active=True),
            MasterData(tenant_id=1, master_type="circle", name="NHQ", is_active=True),
        ])
        db.session.commit()

    client = app.test_client()
    res = client.post(
        f"{BASE}/signup",
        json={
            "email": "newhire@one.com",
            "first_name": "New Hire",
            "user_name": "newhire",
            "mobile": "9999999999",
            "emp_id": "NH1",
            "doj": TODAY.isoformat(),
            "emp_type": "Engineering",
            "circle": "NHQ",
            "designation": "Software Engineer",
            "employment_status": "probation",
        },
        headers=_hr(app, 1),
    )
    body = res.get_json()
    assert res.status_code == 201, body
    assert body["pending_approval"] is True
    with app.app_context():
        assert Admin.query.filter_by(email="newhire@one.com").first() is None

    pending = client.get(f"{BASE}/employee-change-requests?status=pending", headers=_hr(app, 1)).get_json()
    signup = next(row for row in pending["requests"] if row["request_type"] == "signup")
    monkeypatch.setattr(
        "website.employee_profile_change_service.current_admin",
        lambda: db.session.get(Admin, 1),
    )
    with app.app_context():
        row = get_change_request(1, signup["id"])
        payload, message, status = decide_profile_change(row, "approve")
        assert status == 200, message
        created = Admin.query.filter_by(email="newhire@one.com").one()
        assert created.is_active is True
        assert created.emp_id == "NH1"


def test_exit_and_rehire_wait_for_admin_approval(app, monkeypatch):
    from website.employee_profile_change_service import decide_profile_change, get_change_request

    client = app.test_client()
    past = (TODAY - timedelta(days=100)).isoformat()
    exit_body = {
        "employee_email": "dup@x.com",
        "exit_type": "Resigned",
        "exit_reason": "Moving city",
        "exit_date": past,
        "last_working_day": past,
    }
    res = client.post(f"{BASE}/mark-exit", json=exit_body, headers=_hr(app, 1))
    body = res.get_json()
    assert res.status_code == 200, body
    assert body["pending_approval"] is True
    with app.app_context():
        assert db.session.get(Admin, 2).is_exited is False

    pending = client.get(f"{BASE}/employee-change-requests?status=pending", headers=_hr(app, 1)).get_json()
    exit_row = next(row for row in pending["requests"] if row["request_type"] == "exit")
    assert exit_row["request_label"] == "Employee exit"
    hidden = client.get(f"{BASE}/employee-change-requests?status=pending", headers=_hr(app, 2)).get_json()
    assert all(row["id"] != exit_row["id"] for row in hidden["requests"])

    monkeypatch.setattr(
        "website.employee_profile_change_service.current_admin",
        lambda: db.session.get(Admin, 1),
    )
    with app.app_context():
        row = get_change_request(1, exit_row["id"])
        payload, message, status = decide_profile_change(row, "reject", "Not now")
        assert status == 200, message
        assert payload["status"] == "rejected"
        assert db.session.get(Admin, 2).is_exited is False

    res = client.post(f"{BASE}/mark-exit", json=exit_body, headers=_hr(app, 1))
    assert res.status_code == 200, res.get_json()
    pending = client.get(f"{BASE}/employee-change-requests?status=pending", headers=_hr(app, 1)).get_json()
    exit_row = next(row for row in pending["requests"] if row["request_type"] == "exit")
    with app.app_context():
        row = get_change_request(1, exit_row["id"])
        payload, message, status = decide_profile_change(row, "approve")
        assert status == 200, message
        employee = db.session.get(Admin, 2)
        assert employee.is_exited is True

    res = client.post(f"{BASE}/archive/employee/2/rejoin", headers=_hr(app, 1))
    body = res.get_json()
    assert res.status_code == 200, body
    assert body["pending_approval"] is True
    with app.app_context():
        assert db.session.get(Admin, 2).is_exited is True

    pending = client.get(f"{BASE}/employee-change-requests?status=pending", headers=_hr(app, 1)).get_json()
    rehire = next(row for row in pending["requests"] if row["request_type"] == "rehire")
    with app.app_context():
        row = get_change_request(1, rehire["id"])
        payload, message, status = decide_profile_change(row, "approve")
        assert status == 200, message
        employee = db.session.get(Admin, 2)
        assert employee.is_exited is False
        assert employee.is_active is True


def test_hr_written_request_is_visible_only_to_that_company(app, monkeypatch):
    from website.employee_profile_change_service import decide_profile_change, get_change_request

    client = app.test_client()
    res = client.post(
        f"{BASE}/admin-requests",
        json={"subject": "Add Finance department", "details": "Please add a Finance department for the new team."},
        headers=_hr(app, 1),
    )
    body = res.get_json()
    assert res.status_code == 201, body
    assert body["pending_approval"] is True

    pending = client.get(f"{BASE}/employee-change-requests?status=pending", headers=_hr(app, 1)).get_json()
    row_json = next(row for row in pending["requests"] if row["request_type"] == "general")
    assert row_json["request_label"] == "General request"
    assert row_json["employee_name"] == "Add Finance department"
    hidden = client.get(f"{BASE}/employee-change-requests?status=pending", headers=_hr(app, 2)).get_json()
    assert all(row["id"] != row_json["id"] for row in hidden["requests"])

    monkeypatch.setattr(
        "website.employee_profile_change_service.current_admin",
        lambda: db.session.get(Admin, 1),
    )
    with app.app_context():
        row = get_change_request(1, row_json["id"])
        payload, message, status = decide_profile_change(row, "approve")
        assert status == 200, message
        assert payload["status"] == "approved"
        assert any(field["field"] == "details" for field in payload["fields"])
