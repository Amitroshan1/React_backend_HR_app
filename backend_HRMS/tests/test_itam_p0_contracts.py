"""P0 ITAM contracts: flags default OFF, remark policy, lifecycle mapping.

Avoids importing website/__init__.py (Flask) so tests run in a bare Python env.
"""

from __future__ import annotations

import importlib.util
import sys
import types
from pathlib import Path

_WEBSITE = Path(__file__).resolve().parents[1] / "website"
_ITAM = _WEBSITE / "itam"


def _ensure_pkg():
    if "website" not in sys.modules:
        website = types.ModuleType("website")
        website.__path__ = [str(_WEBSITE)]
        sys.modules["website"] = website
    if "website.itam" not in sys.modules:
        itam = types.ModuleType("website.itam")
        itam.__path__ = [str(_ITAM)]
        sys.modules["website.itam"] = itam


def _load(mod_name: str, filename: str):
    _ensure_pkg()
    full = f"website.itam.{mod_name}"
    if full in sys.modules:
        return sys.modules[full]
    spec = importlib.util.spec_from_file_location(full, _ITAM / filename)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[full] = mod
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


_actions = _load("actions", "actions.py")
_flags = _load("flags", "flags.py")
_remark = _load("remark_policy", "remark_policy.py")
_lifecycle = _load("lifecycle", "lifecycle.py")
_contracts = _load("contracts", "contracts.py")

ACTION_CODES = _actions.ACTION_CODES
TransitionAction = _actions.TransitionAction
is_valid_action = _actions.is_valid_action
ITAM_FLAG_KEYS = _flags.ITAM_FLAG_KEYS
get_itam_flags = _flags.get_itam_flags
is_itam_flag_enabled = _flags.is_itam_flag_enabled
load_itam_flags_from_env = _flags.load_itam_flags_from_env
CanonicalStatus = _lifecycle.CanonicalStatus
canonical_status = _lifecycle.canonical_status
is_terminal_status = _lifecycle.is_terminal_status
REMARK_POLICIES = _remark.REMARK_POLICIES
validate_remark = _remark.validate_remark
CONTRACT_VERSION = _contracts.CONTRACT_VERSION
PHASE = _contracts.PHASE
api_contract_snapshot = _contracts.api_contract_snapshot


def test_contract_version_and_phase():
    assert CONTRACT_VERSION.startswith("itam-p0-")
    assert PHASE == "P0"


def test_all_actions_have_remark_policy():
    for code in ACTION_CODES:
        assert code in REMARK_POLICIES, f"missing policy for {code}"


def test_flags_default_off():
    flags = load_itam_flags_from_env({})
    assert set(flags) == set(ITAM_FLAG_KEYS)
    assert all(v is False for v in flags.values())


def test_flags_env_truthy():
    flags = load_itam_flags_from_env({"ITAM_TRANSITIONS_V1": "1", "ITAM_TIMELINE_V1": "yes"})
    assert flags["itam_transitions_v1"] is True
    assert flags["itam_timeline_v1"] is True
    assert flags["itam_lifecycle_v1"] is False


def test_is_itam_flag_enabled_unknown_false():
    assert is_itam_flag_enabled("not_a_real_flag") is False


def test_get_itam_flags_from_config_dict():
    cfg = {k: False for k in ITAM_FLAG_KEYS}
    cfg["itam_transitions_v1"] = True
    flags = get_itam_flags(cfg)
    assert flags["itam_transitions_v1"] is True
    assert flags["itam_timeline_v1"] is False


def test_validate_remark_checkout_ok():
    ok, err = validate_remark(
        TransitionAction.CHECKOUT.value,
        "Assigned Dell laptop for project onboarding",
    )
    assert ok is True
    assert err is None


def test_validate_remark_empty_rejected():
    ok, err = validate_remark(TransitionAction.CHECKOUT.value, "   ")
    assert ok is False
    assert "required" in (err or "").lower()


def test_validate_remark_too_short():
    ok, err = validate_remark(TransitionAction.MARK_QUARANTINE.value, "short")
    assert ok is False
    assert "at least" in (err or "").lower()


def test_validate_remark_retire_needs_reason_and_grade():
    ok, err = validate_remark(
        TransitionAction.RETIRE.value,
        "Device end of life after wipe and certificate filed",
        reason_code=None,
        condition_grade="Fail",
    )
    assert ok is False
    assert "reason" in (err or "").lower()

    ok2, err2 = validate_remark(
        TransitionAction.RETIRE.value,
        "Device end of life after wipe and certificate filed",
        reason_code="EOL",
        condition_grade="Fail",
    )
    assert ok2 is True
    assert err2 is None


def test_canonical_status_legacy_map():
    assert canonical_status("available") == CanonicalStatus.IN_STOCK.value
    assert canonical_status("assigned") == CanonicalStatus.CHECKED_OUT.value
    assert canonical_status("notWorking") == CanonicalStatus.QUARANTINE.value
    assert canonical_status("in-repair") == CanonicalStatus.IN_REPAIR.value


def test_canonical_status_assigned_location_hint():
    assert (
        canonical_status("assigned", inventory_category="Office Assets")
        == CanonicalStatus.DEPLOYED.value
    )
    assert (
        canonical_status("assigned", has_employee_assignee=False)
        == CanonicalStatus.DEPLOYED.value
    )


def test_terminal_status():
    assert is_terminal_status("Retired") is True
    assert is_terminal_status("dead") is True
    assert is_terminal_status("available") is False


def test_is_valid_action():
    assert is_valid_action("checkout") is True
    assert is_valid_action("NOPE") is False


def test_api_contract_snapshot_shape():
    snap = api_contract_snapshot({k: False for k in ITAM_FLAG_KEYS})
    assert snap["contract_version"] == CONTRACT_VERSION
    assert snap["phase"] == PHASE
    assert snap["flags"]["itam_transitions_v1"] is False
    assert "CHECKOUT" in snap["action_codes"]
    assert "CHECKOUT" in snap["remark_policies"]
    assert snap["lifecycle"]["legacy_status_map"]["available"] == "InStock"
    assert any(e.get("path") == "/api/it/itam/meta" for e in snap["api_endpoints"])


if __name__ == "__main__":
    failed = 0
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn()
                print("OK", name)
            except Exception as exc:
                failed += 1
                print("FAIL", name, exc)
    raise SystemExit(failed)
