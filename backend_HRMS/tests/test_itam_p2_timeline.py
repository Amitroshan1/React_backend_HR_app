"""P2 ITAM: timeline CSV + date parse helpers (no Flask DB required)."""

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

_fake_db = types.ModuleType("website._db_stub")


class _FakeSession:
    def add(self, *_a, **_k):
        return None

    def commit(self):
        return None


def _or_(*_a, **_k):
    return None


_fake_db.session = _FakeSession()
_fake_db.or_ = _or_
_fake_db.func = types.SimpleNamespace(max=lambda *_a, **_k: None)
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

_admin_models = types.ModuleType("website.models.Admin_models")


class Admin:
    query = None


_admin_models.Admin = Admin
sys.modules["website.models.Admin_models"] = _admin_models

_it_models = types.ModuleType("website.models.it_models")


class ITAssetTransition:
    query = None


class ITAssetAssignment:
    query = None


_it_models.ITAssetTransition = ITAssetTransition
_it_models.ITAssetAssignment = ITAssetAssignment
sys.modules["website.models.it_models"] = _it_models

# transition_service needs ITAssetTransition for record_transition
_ts = _load("transition_service", "transition_service.py")
_timeline = _load("timeline_service", "timeline_service.py")


def test_timeline_to_csv_headers_and_row():
    csv_text = _timeline.timeline_to_csv(
        [
            {
                "occurredAt": "2026-08-13T10:00:00",
                "transitionCode": "TRN-1",
                "actionCode": "CHECKOUT",
                "actionLabel": "Assigned to employee",
                "fromStatus": "available",
                "toStatus": "assigned",
                "remark": "Issued laptop for project Alpha",
                "reasonCode": "",
                "conditionGrade": "",
                "actor": {"name": "IT Admin", "empId": "E1"},
            }
        ]
    )
    assert "occurred_at" in csv_text
    assert "remark" in csv_text
    assert "TRN-1" in csv_text
    assert "Issued laptop for project Alpha" in csv_text
    assert "IT Admin" in csv_text


def test_timeline_to_csv_empty():
    csv_text = _timeline.timeline_to_csv([])
    lines = [ln for ln in csv_text.strip().splitlines() if ln]
    assert len(lines) == 1
    assert "action_code" in lines[0]


def test_parse_dt_date_and_iso():
    d = _timeline._parse_dt("2026-08-13")
    assert d is not None
    assert d.year == 2026 and d.month == 8 and d.day == 13
    iso = _timeline._parse_dt("2026-08-13T12:30:00Z")
    assert iso is not None
    assert iso.hour == 12
    assert _timeline._parse_dt("") is None
    assert _timeline._parse_dt("not-a-date") is None


def test_timeline_flag_default_off():
    assert _timeline.timeline_enabled({}) is False
    assert _timeline.timeline_enabled({"itam_timeline_v1": True}) is True


if __name__ == "__main__":
    test_timeline_to_csv_headers_and_row()
    test_timeline_to_csv_empty()
    test_parse_dt_date_and_iso()
    test_timeline_flag_default_off()
    print("test_itam_p2_timeline: OK")
