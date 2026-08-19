"""P1 ITAM: transition remark enforcement + action mapping (no Flask DB required)."""

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


# Load deps first (transition_service imports db — stub lightweight)
_actions = _load("actions", "actions.py")
_flags = _load("flags", "flags.py")
_remark = _load("remark_policy", "remark_policy.py")
_lifecycle = _load("lifecycle", "lifecycle.py")


# Stub website.db and models before loading transition_service
if "website.db" not in sys.modules:
    # transition_service does `from .. import db` — need website package attribute
    pass

# Minimal stubs so transition_service imports succeed without SQLAlchemy session ops
_fake_db = types.ModuleType("website._db_stub")


class _FakeSession:
    def add(self, *_a, **_k):
        return None


_fake_db.session = _FakeSession()
sys.modules["website"].db = _fake_db  # type: ignore

_datetime_utils = types.ModuleType("website.datetime_utils")


def _utc_now():
    from datetime import datetime, timezone

    return datetime.now(timezone.utc)


_datetime_utils.utc_now = _utc_now
sys.modules["website.datetime_utils"] = _datetime_utils

_models_pkg = types.ModuleType("website.models")
_models_pkg.__path__ = [str(_WEBSITE / "models")]
sys.modules["website.models"] = _models_pkg

_it_models = types.ModuleType("website.models.it_models")


class ITAssetTransition:
    query = None
    id = type("Col", (), {"desc": staticmethod(lambda: "id")})()
    transition_code = type("Col", (), {"like": staticmethod(lambda *_a, **_k: True)})()

    def __init__(self, **kwargs):
        for k, v in kwargs.items():
            setattr(self, k, v)
        if not hasattr(self, "id") or callable(getattr(self, "id", None)):
            self.id = 1


_it_models.ITAssetTransition = ITAssetTransition
sys.modules["website.models.it_models"] = _it_models

# Fake query for code generation
class _Q:
    def filter(self, *_a, **_k):
        return self

    def order_by(self, *_a, **_k):
        return self

    def first(self):
        return None


ITAssetTransition.query = _Q()

_ts = _load("transition_service", "transition_service.py")

action_for_unit_status = _ts.action_for_unit_status
action_for_return_destination = _ts.action_for_return_destination
extract_remark_fields = _ts.extract_remark_fields
transitions_enabled = _ts.transitions_enabled
record_transition = _ts.record_transition
TransitionValidationError = _ts.TransitionValidationError
validate_remark = _remark.validate_remark


def test_action_for_status_repair_and_quarantine():
    assert action_for_unit_status("repair") == "SEND_REPAIR"
    assert action_for_unit_status("notWorking") == "MARK_QUARANTINE"
    assert action_for_unit_status("not-working") == "MARK_QUARANTINE"
    assert action_for_unit_status("available", from_status="repair") == "COMPLETE_REPAIR"
    assert action_for_unit_status("available", from_status="assigned") == "CHECKIN"


def test_action_for_return_destination():
    assert action_for_return_destination("available") == "CHECKIN"
    assert action_for_return_destination("not-working") == "MARK_QUARANTINE"
    assert action_for_return_destination("repair") == "SEND_REPAIR"


def test_extract_remark_fields_aliases():
    fields = extract_remark_fields({"notes": "Assigned laptop for onboarding week"})
    assert fields["remark"] == "Assigned laptop for onboarding week"
    fields2 = extract_remark_fields({"rejection_reason": "Incomplete paperwork filed late"})
    assert "Incomplete" in fields2["remark"]


def test_transitions_disabled_by_default():
    assert transitions_enabled({}) is False
    assert transitions_enabled({"itam_transitions_v1": False}) is False


def test_record_transition_noop_when_flag_off():
    row = record_transition(
        action_code="CHECKOUT",
        remark="",
        config={"itam_transitions_v1": False},
    )
    assert row is None


def test_record_transition_requires_remark_when_flag_on():
    try:
        record_transition(
            action_code="CHECKOUT",
            remark="short",
            config={"itam_transitions_v1": True},
        )
        assert False, "expected TransitionValidationError"
    except TransitionValidationError as exc:
        assert "at least" in str(exc).lower() or "required" in str(exc).lower()


def test_record_transition_writes_when_valid():
    row = record_transition(
        action_code="CHECKOUT",
        remark="Assigned Dell Latitude for project Alpha kickoff",
        actor_admin_id=9,
        asset_unit_id=3,
        from_status="available",
        to_status="assigned",
        config={"itam_transitions_v1": True},
    )
    assert row is not None
    assert row.action_code == "CHECKOUT"
    assert row.remark.startswith("Assigned Dell")
    assert row.transition_code.startswith("TRN")


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
