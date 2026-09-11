"""Activity log scope mapping (no Flask DB required)."""

from website.itam.activity_log_scope import (
    INVENTORY_SCOPE_ACTIONS,
    IT_SCOPE_ACTIONS,
    resolve_scope_actions,
    should_log_catalog_receive,
)


def test_catalog_receive_only_for_qty_managed_stock():
    assert should_log_catalog_receive(True) is True
    assert should_log_catalog_receive(False) is False


def test_explicit_action_is_kept_when_it_belongs_to_scope():
    assert resolve_scope_actions("it", ["checkout"]) == ["CHECKOUT"]
    assert resolve_scope_actions("all", ["checkout"]) == ["CHECKOUT"]


def test_explicit_action_outside_scope_matches_nothing():
    assert resolve_scope_actions("inventory", ["CHECKOUT"]) == ["__NO_MATCH__"]


def test_inventory_scope_includes_receive_and_export():
    actions = resolve_scope_actions("inventory")
    assert "RECEIVE" in actions
    assert "EXPORT" in actions
    assert "CHECKOUT" not in actions
    assert "LOST" not in actions
    assert "NOTE" not in actions


def test_it_scope_includes_checkout_not_receive():
    actions = resolve_scope_actions("it")
    assert "CHECKOUT" in actions
    assert "CHECKIN" in actions
    assert "RECEIVE" not in actions
    assert "TRANSFER" not in actions
    assert "ACK_CUSTODY" not in actions
    assert set(actions) == set(IT_SCOPE_ACTIONS)


def test_all_scope_does_not_restrict_actions():
    assert resolve_scope_actions("all") is None
    assert resolve_scope_actions("") is None
    assert INVENTORY_SCOPE_ACTIONS
