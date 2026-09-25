"""Phase 1 shared-DB multi-tenancy foundation."""
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from website.models.tenant import (
    TENANT_PLANS,
    normalize_tenant_plan,
    normalize_tenant_status,
    slugify_tenant,
)
from website.tenant_context import (
    DEFAULT_TENANT_ID,
    require_same_tenant,
    tenant_id_for_admin,
)


def test_slugify_tenant():
    assert slugify_tenant("Acme Corp") == "acme_corp"
    assert slugify_tenant("  Foo & Bar Ltd. ") == "foo_and_bar_ltd"
    assert slugify_tenant("") == "company"


def test_normalize_tenant_plan_status():
    assert normalize_tenant_plan("Enterprise") == "enterprise"
    assert normalize_tenant_plan("gold") is None
    assert normalize_tenant_status("Active") == "active"
    assert normalize_tenant_status("unknown") is None
    assert set(TENANT_PLANS) == {"basic", "essential", "enterprise"}


def test_tenant_id_for_admin_defaults():
    assert tenant_id_for_admin(None) == DEFAULT_TENANT_ID
    assert tenant_id_for_admin(SimpleNamespace()) == DEFAULT_TENANT_ID
    assert tenant_id_for_admin(SimpleNamespace(tenant_id=None)) == DEFAULT_TENANT_ID
    assert tenant_id_for_admin(SimpleNamespace(tenant_id=7)) == 7
    assert tenant_id_for_admin(SimpleNamespace(tenant_id="3")) == 3


def test_require_same_tenant():
    assert require_same_tenant(1, claims_tenant_id=1) is True
    assert require_same_tenant(2, claims_tenant_id=1) is False
    assert require_same_tenant(None, claims_tenant_id=1) is False


def test_plan_prefers_tenant_plan():
    from flask import Flask

    from website.plan_features import get_plan

    fake_tenant = SimpleNamespace(plan="enterprise")
    app = Flask(__name__)
    app.config["CUSTOMER_PLAN"] = "basic"
    with app.app_context():
        with patch("website.models.tenant.Tenant") as T:
            T.query.get.return_value = fake_tenant
            assert get_plan(tenant_id=1) == "enterprise"


def test_plan_falls_back_to_env():
    from flask import Flask

    from website.plan_features import get_plan

    app = Flask(__name__)
    app.config["CUSTOMER_PLAN"] = "essential"
    with app.app_context():
        with patch("website.models.tenant.Tenant") as T:
            T.query.get.return_value = None
            assert get_plan(tenant_id=99) == "essential"


def test_silo_provision_disabled_by_default(monkeypatch):
    monkeypatch.delenv("PROVISION_ENABLED", raising=False)
    from website.customer_provisioning import provision_enabled

    assert provision_enabled() is False


def test_silo_provision_requires_explicit_enable(monkeypatch):
    monkeypatch.setenv("PROVISION_ENABLED", "1")
    from website.customer_provisioning import provision_enabled

    assert provision_enabled() is True


def test_issue_login_token_includes_tenant_id():
    from website import auth as auth_mod

    admin = SimpleNamespace(id=42, email="a@test.com", emp_type="Admin", tenant_id=1)

    with patch.object(auth_mod, "create_access_token", return_value="tok") as cat:
        with patch("website.session_timeout.session_expires_delta", return_value=None):
            with patch("website.session_timeout.session_timeout_minutes", return_value=30):
                with patch(
                    "website.plan_features.plan_payload",
                    return_value={
                        "plan": "essential",
                        "plan_label": "Essential",
                        "features": [],
                    },
                ):
                    out = auth_mod._issue_login_token(admin)

    assert out["success"] is True
    assert out["tenant_id"] == 1
    assert out["token"] == "tok"
    kwargs = cat.call_args.kwargs
    assert kwargs["additional_claims"]["tenant_id"] == 1
    assert kwargs["additional_claims"]["email"] == "a@test.com"
