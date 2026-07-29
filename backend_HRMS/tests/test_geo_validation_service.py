"""Unit tests for geo_validation_service mapping + V2 path (stubbed Flask/DB)."""
import importlib.util
import sys
import types
from pathlib import Path
from unittest.mock import MagicMock, patch

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "website"


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


pkg = types.ModuleType("website")
pkg.__path__ = [str(WEB)]
sys.modules["website"] = pkg

# Minimal stubs before loading service
flask_stub = types.ModuleType("flask")
flask_stub.current_app = MagicMock()
flask_stub.has_app_context = lambda: False
flask_stub.request = None
sys.modules["flask"] = flask_stub

db_mod = types.ModuleType("website.db_stub")
db_stub = MagicMock()
db_stub.session = MagicMock()

cfg_mod = _load("website.geo_fence_config", WEB / "geo_fence_config.py")
sys.modules["website.geo_fence_config"] = cfg_mod
eng = _load("website.geo_fence_engine", WEB / "geo_fence_engine.py")
sys.modules["website.geo_fence_engine"] = eng

# Stub package children imported by service
att = types.ModuleType("website.models.attendance")
att.Location = MagicMock()
sys.modules["website.models"] = types.ModuleType("website.models")
sys.modules["website.models.attendance"] = att

gpa = types.ModuleType("website.models.geo_punch_attempt")
gpa.GeoPunchAttempt = MagicMock
sys.modules["website.models.geo_punch_attempt"] = gpa

# website.__init__ style: service does `from . import db`
website_pkg = sys.modules["website"]
website_pkg.db = db_stub

svc = _load("website.geo_validation_service", WEB / "geo_validation_service.py")


def _cfg(**overrides):
    c = dict(cfg_mod.get_geo_fence_config())
    c.update(overrides)
    return c


class _Office:
    def __init__(self):
        self.id = 1
        self.name = "HQ"
        self.latitude = 28.6139
        self.longitude = 77.2090
        self.radius = 100.0
        self.grace = 25.0


def test_legacy_zone_mapping():
    assert svc.geo_decision_to_legacy_zone(eng.GEO_INSIDE) == "INSIDE"
    assert svc.geo_decision_to_legacy_zone(eng.GEO_UNCERTAIN) == "NEAR"
    assert svc.geo_decision_to_legacy_zone(eng.GEO_OUTSIDE) == "OUTSIDE"
    assert svc.geo_decision_to_legacy_zone(eng.GEO_LOW_SIGNAL) == "NO_GPS"
    assert svc.geo_decision_to_legacy_zone(eng.GEO_NO_OFFICE) == "NO_OFFICE_CONFIG"


def test_location_status_mapping():
    assert svc.geo_decision_to_location_status(eng.GEO_INSIDE) == "inside_geofence"
    assert svc.geo_decision_to_location_status(eng.GEO_UNCERTAIN) == "uncertain_geofence"
    assert svc.geo_decision_to_location_status(eng.GEO_OUTSIDE) == "outside_geofence"


def test_v2_validate_inside(monkeypatch=None):
    with patch.object(svc, "_load_office_rows", return_value=[_Office()]):
        result = svc._v2_validate(
            {
                "lat": 28.6139,
                "lon": 77.2090,
                "accuracy_m": 15,
                "sample_count": 3,
                "spread_m": 10,
                "device_class": "mobile",
            },
            "attempt-test-1",
            _cfg(GEO_FENCE_V2=True),
        )
    assert result.engine == "v2"
    assert result.geo_decision == eng.GEO_INSIDE
    assert result.requires_reason is False
    assert result.in_range is True
    assert result.zone == "INSIDE"
    assert result.office_id == 1


def test_v2_validate_outside_requires_reason():
    with patch.object(svc, "_load_office_rows", return_value=[_Office()]):
        result = svc._v2_validate(
            {
                "latitude": 28.7000,
                "longitude": 77.3000,
                "accuracy_m": 20,
                "sample_count": 4,
                "spread_m": 15,
                "device_class": "mobile",
            },
            "attempt-test-2",
            _cfg(GEO_FENCE_V2=True),
        )
    assert result.geo_decision == eng.GEO_OUTSIDE
    assert result.requires_reason is True
    assert result.zone == "OUTSIDE"
    assert result.in_range is False


def test_validate_flag_off_uses_legacy():
    fake = svc.GeoValidationResult(
        engine="legacy",
        success=True,
        geo_decision=eng.GEO_INSIDE,
        policy_action=eng.POLICY_ALLOW,
        confidence=0.0,
        distance_m=5.0,
        matched_radius_m=100,
        matched_grace_m=25,
        office_id=None,
        office_name=None,
        location_status="inside_geofence",
        zone="INSIDE",
        in_range=True,
        requires_reason=False,
        attempt_id="x",
        latitude=1.0,
        longitude=2.0,
        accuracy_m=10,
        network_match=False,
    )
    with patch.object(svc, "is_geo_v2_enabled", return_value=False), patch.object(
        svc, "_legacy_validate", return_value=fake
    ) as legacy, patch.object(svc, "write_geo_audit", return_value=99):
        out = svc.validate_employee_location(
            payload={"lat": 1, "lon": 2},
            admin_id=1,
            direction="in",
            write_audit=True,
        )
    legacy.assert_called_once()
    assert out.engine == "legacy"
    assert out.audit_id == 99


def test_validate_engine_failure_safe_fallback():
    with patch.object(svc, "is_geo_v2_enabled", return_value=True), patch.object(
        svc, "_v2_validate", side_effect=RuntimeError("boom")
    ), patch.object(svc, "write_geo_audit", return_value=None):
        out = svc.validate_employee_location(
            payload={"lat": 1, "lon": 2},
            admin_id=1,
            direction="check",
            write_audit=True,
        )
    assert out.success is False
    assert out.error == "GEO_ENGINE_FAILURE"
    assert out.requires_reason is True
    assert out.zone == "NO_GPS"


def test_to_location_check_dict_shape():
    r = svc.GeoValidationResult(
        engine="v2",
        success=True,
        geo_decision=eng.GEO_INSIDE,
        policy_action=eng.POLICY_ALLOW,
        confidence=88.5,
        distance_m=12.3,
        matched_radius_m=100,
        matched_grace_m=25,
        office_id=1,
        office_name="HQ",
        location_status="inside_geofence",
        zone="INSIDE",
        in_range=True,
        requires_reason=False,
        attempt_id="abc",
        latitude=28.6,
        longitude=77.2,
        accuracy_m=15,
        network_match=False,
    )
    d = r.to_location_check_dict()
    assert d["success"] is True
    assert d["zone"] == "INSIDE"
    assert d["geo_decision"] == eng.GEO_INSIDE
    assert d["attempt_id"] == "abc"
    assert d["distance_meters"] == 12
