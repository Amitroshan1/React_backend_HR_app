"""Activity log scope mapping (no Flask DB required)."""

from website.itam.activity_log_scope import (
    INVENTORY_SCOPE_ACTIONS,
    IT_SCOPE_ACTIONS,
    resolve_scope_actions,
)


def test_explicit_action_overrides_scope():
    assert resolve_scope_actions("inventory", ["checkout"]) == ["CHECKOUT"]


def test_inventory_scope_includes_receive_and_export():
    actions = resolve_scope_actions("inventory")
    assert "RECEIVE" in actions
    assert "EXPORT" in actions
    assert "CHECKOUT" not in actions


def test_it_scope_includes_checkout_not_receive():
    actions = resolve_scope_actions("it")
    assert "CHECKOUT" in actions
    assert "CHECKIN" in actions
    assert "RECEIVE" not in actions
    assert set(actions) == set(IT_SCOPE_ACTIONS)


def test_all_scope_does_not_restrict_actions():
    assert resolve_scope_actions("all") is None
    assert resolve_scope_actions("") is None
    assert INVENTORY_SCOPE_ACTIONS
