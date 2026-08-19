"""P3 ITAM: lifecycle mapping + custody invariants (no Flask DB required)."""

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


_life = _load("lifecycle", "lifecycle.py")
_flags = _load("flags", "flags.py")


def test_deployed_not_checked_out_without_employee():
    assert (
        _life.canonical_status("assigned", has_employee_assignee=False)
        == "Deployed"
    )
    assert (
        _life.canonical_status("assigned", has_employee_assignee=True)
        == "CheckedOut"
    )


def test_office_category_assigned_is_deployed():
    assert (
        _life.canonical_status("assigned", inventory_category="Office Assets")
        == "Deployed"
    )


def test_canonical_to_legacy_dual_write():
    assert _life.legacy_status_for_canonical("CheckedOut") == "assigned"
    assert _life.legacy_status_for_canonical("Deployed") == "assigned"
    assert _life.legacy_status_for_canonical("InStock") == "available"
    assert _life.legacy_status_for_canonical("InRepair") == "repair"


def test_default_custody_types():
    assert _life.default_custody_type("CheckedOut") == "EMPLOYEE"
    assert _life.default_custody_type("Deployed") == "LOCATION"
    assert _life.default_custody_type("InStock") == "NONE"
    assert _life.default_custody_type("InRepair") == "VENDOR"


def test_deploy_neq_checkout_allowed_edges():
    assert _life.is_allowed_transition("InStock", "CheckedOut")
    assert _life.is_allowed_transition("InStock", "Deployed")
    assert not _life.is_allowed_transition("CheckedOut", "Deployed")
    assert not _life.is_allowed_transition("Deployed", "CheckedOut")
    assert _life.is_allowed_transition("Deployed", "InStock")


def test_status_and_custody_labels():
    assert _life.status_label("CheckedOut") == "Checked out"
    assert _life.status_label("available") == "In stock"
    assert _life.custody_label("EMPLOYEE") == "Employee"
    assert _life.custody_label("LOCATION") == "Location"


def test_lifecycle_flag_default_off():
    assert _flags.is_itam_flag_enabled("itam_lifecycle_v1", {}) is False
    assert _flags.is_itam_flag_enabled("itam_lifecycle_v1", {"itam_lifecycle_v1": True}) is True


def test_lifecycle_for_legacy_status_change_without_db():
    # Stub deps for lifecycle_service import
    _fake_db = types.ModuleType("website.db_stub")

    class _S:
        def add(self, *_a, **_k):
            return None

        def flush(self):
            return None

        def commit(self):
            return None

    _fake_db.session = _S()
    sys.modules["website"].db = _fake_db  # type: ignore

    _dt = types.ModuleType("website.datetime_utils")

    def _utc_now():
        from datetime import datetime, timezone

        return datetime.now(timezone.utc)

    _dt.utc_now = _utc_now
    sys.modules["website.datetime_utils"] = _dt

    _models = types.ModuleType("website.models")
    _models.__path__ = [str(_WEBSITE / "models")]
    sys.modules["website.models"] = _models
    _it = types.ModuleType("website.models.it_models")

    class ITAssetCustody:
        pass

    class ITAssetUnit:
        pass

    class ITOfficeStockDeployment:
        query = None

    _it.ITAssetCustody = ITAssetCustody
    _it.ITAssetUnit = ITAssetUnit
    _it.ITOfficeStockDeployment = ITOfficeStockDeployment
    sys.modules["website.models.it_models"] = _it

    svc = _load("lifecycle_service", "lifecycle_service.py")
    life, ctype = svc.lifecycle_for_legacy_status_change("repair")
    assert life == "InRepair" and ctype == "VENDOR"
    life, ctype = svc.lifecycle_for_legacy_status_change("available")
    assert life == "InStock" and ctype == "NONE"
    life, ctype = svc.lifecycle_for_legacy_status_change("assigned", force_deployed=True)
    assert life == "Deployed" and ctype == "LOCATION"


if __name__ == "__main__":
    test_deployed_not_checked_out_without_employee()
    test_office_category_assigned_is_deployed()
    test_canonical_to_legacy_dual_write()
    test_default_custody_types()
    test_deploy_neq_checkout_allowed_edges()
    test_status_and_custody_labels()
    test_lifecycle_flag_default_off()
    test_lifecycle_for_legacy_status_change_without_db()
    print("test_itam_p3_lifecycle: OK")
