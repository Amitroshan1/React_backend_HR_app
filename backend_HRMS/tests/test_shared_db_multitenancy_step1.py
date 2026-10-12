"""Rollout step 1: caller resolution by JWT identity, scoped to the token's tenant."""
from types import SimpleNamespace
from unittest.mock import patch

from website.tenant_context import current_admin


def _run(claims, identity, admin_row):
    with patch("flask_jwt_extended.get_jwt", return_value=claims), patch(
        "flask_jwt_extended.get_jwt_identity", return_value=identity
    ), patch("website.models.Admin_models.Admin") as A:
        A.query.get.return_value = admin_row
        return current_admin(), A


def test_resolves_by_identity_not_email():
    row = SimpleNamespace(id=5, tenant_id=1, email="shared@x.com")
    admin, A = _run({"email": "someone-else@x.com", "tenant_id": 1}, "5", row)
    assert admin is row
    A.query.get.assert_called_once_with(5)
    A.query.filter_by.assert_not_called()


def test_rejects_row_from_other_tenant():
    row = SimpleNamespace(id=5, tenant_id=2)
    admin, _ = _run({"tenant_id": 1}, "5", row)
    assert admin is None


def test_legacy_token_without_tenant_claim_still_resolves():
    row = SimpleNamespace(id=5, tenant_id=1)
    admin, _ = _run({"email": "a@x.com"}, "5", row)
    assert admin is row


def test_null_tenant_row_counts_as_default_tenant():
    row = SimpleNamespace(id=5, tenant_id=None)
    admin, _ = _run({"tenant_id": 1}, "5", row)
    assert admin is row


def test_typed_tokens_are_not_a_login():
    row = SimpleNamespace(id=5, tenant_id=1)
    for claims in (
        {"token_type": "sensitive", "admin_id": 5},
        {"token_type": "tenant_select", "admin_ids": [5]},
    ):
        admin, A = _run(claims, "5", row)
        assert admin is None
        A.query.get.assert_not_called()


def test_missing_or_bad_identity():
    assert _run({"tenant_id": 1}, None, None)[0] is None
    assert _run({"tenant_id": 1}, "abc", None)[0] is None


def test_deleted_admin():
    assert _run({"tenant_id": 1}, "5", None)[0] is None


def test_no_request_context_returns_none():
    with patch("flask_jwt_extended.get_jwt", side_effect=RuntimeError("no ctx")):
        assert current_admin() is None
