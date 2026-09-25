"""Phase 1 control-plane helpers for deployed customer registry."""
from website.models.deployed_customer import (
    STATUS_ORDER,
    normalize_plan,
    normalize_status,
    slugify_company,
    status_can_transition,
    suggest_database_name,
)


def test_slugify_company_basic():
    assert slugify_company("Acme Corp") == "acme_corp"
    assert slugify_company("  Foo & Bar Ltd. ") == "foo_and_bar_ltd"


def test_suggest_database_name():
    assert suggest_database_name("Acme Corp") == "hrms_acme_corp"
    assert suggest_database_name("", slug="company_b") == "hrms_company_b"


def test_normalize_plan_and_status():
    assert normalize_plan("Enterprise") == "enterprise"
    assert normalize_plan("gold") is None
    assert normalize_status("Provisioning") == "provisioning"
    assert normalize_status("unknown") is None
    assert set(STATUS_ORDER) == {"provisioning", "active", "suspended", "cancelled"}


def test_status_transitions():
    assert status_can_transition("provisioning", "active")
    assert status_can_transition("active", "suspended")
    assert status_can_transition("suspended", "active")
    assert not status_can_transition("active", "provisioning")
    assert not status_can_transition("cancelled", "active")
    assert status_can_transition("cancelled", "provisioning")
