"""Phase 2 provisioning helpers (dry-run friendly)."""
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from website.customer_provisioning import (
    ProvisionError,
    build_env_template,
    suggest_app_url,
)
from website.models.deployed_customer import suggest_database_name


def _customer(**kwargs):
    base = dict(
        company_name="Acme Corp",
        slug="acme_corp",
        plan="essential",
        app_url="",
        database_name="hrms_acme_corp",
        contact_email="admin@acme.test",
        notes="",
        status="provisioning",
        go_live_date=None,
    )
    base.update(kwargs)
    return SimpleNamespace(**base)


def test_build_env_template_contains_plan_and_db():
    c = _customer(plan="enterprise", app_url="https://hr.acme.test")
    body = build_env_template(c, database_uri="mysql+pymysql://u:p@localhost/hrms_acme_corp")
    assert "CUSTOMER_PLAN=enterprise" in body
    assert "SHOW_DEPLOYMENT_GUIDE=0" in body
    assert "DATABASE_URI=mysql+pymysql://u:p@localhost/hrms_acme_corp" in body
    assert "BASE_URL=https://hr.acme.test" in body
    assert "SECRET_KEY=" in body
    assert "JWT_SECRET_KEY=" in body


def test_suggest_app_url_from_domain(monkeypatch):
    monkeypatch.setenv("PROVISION_BASE_DOMAIN", "example.com")
    c = _customer(slug="acme_corp", app_url="")
    assert suggest_app_url(c) == "https://acme-corp.example.com"


def test_safe_db_name_via_provision_rejects_master_collision():
    from website.customer_provisioning import _safe_db_name

    assert _safe_db_name("hrms_acme") == "hrms_acme"
    with pytest.raises(ProvisionError):
        _safe_db_name("not_prefixed")
    with pytest.raises(ProvisionError):
        _safe_db_name("hrms-bad")


def test_provision_dry_run_without_mysql(monkeypatch):
    monkeypatch.delenv("PROVISION_MYSQL_HOST", raising=False)
    monkeypatch.delenv("PROVISION_MYSQL_USER", raising=False)
    monkeypatch.delenv("PROVISION_MYSQL_PASSWORD", raising=False)
    monkeypatch.setenv("PROVISION_ENABLED", "1")
    # Avoid colliding with whatever DATABASE_URI is loaded from local .env
    monkeypatch.setenv("DATABASE_URI", "mysql+pymysql://u:p@localhost/saffo_master")

    from website import customer_provisioning as mod

    c = _customer()
    c.to_dict = lambda: {"id": 1, "company_name": c.company_name, "status": c.status}

    with patch.object(mod, "db") as mock_db:
        mock_db.session = MagicMock()
        result = mod.provision_customer(
            c,
            create_database=True,
            create_schema=True,
            seed_admin=True,
            create_uploads=True,
            mark_active=False,
            admin_email="admin@acme.test",
            dry_run=True,
        )
    assert result["success"] is True
    assert result["dry_run"] is True
    assert result["env_file"]
    assert any(s["id"] == "database" and s.get("dry_run") for s in result["steps"])
    assert result["seed_admin"]["email"] == "admin@acme.test"
    assert result["seed_admin"]["password"]


def test_suggest_database_still_works():
    assert suggest_database_name("Company B", slug="company_b") == "hrms_company_b"
