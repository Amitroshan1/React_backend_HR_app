"""Unit tests for isolated geo_fence_engine (no Flask / DB required)."""
import importlib.util
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "website"

# Load modules without package __init__ (avoids Flask import)
def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


# Stub package path for relative import in engine
import types
pkg = types.ModuleType("website")
pkg.__path__ = [str(WEB)]
sys.modules["website"] = pkg

cfg_mod = _load("website.geo_fence_config", WEB / "geo_fence_config.py")
sys.modules["website.geo_fence_config"] = cfg_mod
eng = _load("website.geo_fence_engine", WEB / "geo_fence_engine.py")


def _cfg(**overrides):
    c = dict(cfg_mod.get_geo_fence_config())
    c.update(overrides)
    return c


OFFICE = eng.OfficeRecord(
    id=1,
    name="HQ",
    latitude=28.6139,
    longitude=77.2090,
    radius_m=100.0,
    grace_m=25.0,
)


def test_haversine_zero():
    d = eng.haversine_distance_m(28.6139, 77.2090, 28.6139, 77.2090)
    assert d < 0.01


def test_haversine_known_scale():
    # ~111 m per 0.001 deg latitude
    d = eng.haversine_distance_m(28.6139, 77.2090, 28.6149, 77.2090)
    assert 100 < d < 130


def test_inside_high_confidence():
    m = eng.build_measurement(
        latitude=28.6139,
        longitude=77.2090,
        accuracy=15,
        sample_count=3,
        spread=20,
        acquisition_ms=4000,
        device_class="mobile",
        network_match=False,
    )
    r = eng.evaluate_geofence(measurement=m, offices=[OFFICE], cfg=_cfg())
    assert r.geo_decision == eng.GEO_INSIDE
    assert r.policy_action == eng.POLICY_ALLOW
    assert r.spatial_class == eng.SPATIAL_CONTAINED


def test_uncertain_intersection():
    # ~132 m north of office, accuracy 45 → intersects with R=100 G=25
    m = eng.build_measurement(
        latitude=28.6151,
        longitude=77.2090,
        accuracy=45,
        sample_count=3,
        spread=30,
        acquisition_ms=5000,
        device_class="mobile",
        network_match=False,
    )
    r = eng.evaluate_geofence(measurement=m, offices=[OFFICE], cfg=_cfg())
    assert r.distance_m is not None and r.distance_m > 100
    assert r.geo_decision == eng.GEO_UNCERTAIN
    assert r.policy_action == eng.POLICY_ALLOW_FLAGGED


def test_outside_confident():
    m = eng.build_measurement(
        latitude=28.6200,
        longitude=77.2090,
        accuracy=15,
        sample_count=4,
        spread=25,
        acquisition_ms=5000,
        device_class="mobile",
        network_match=False,
    )
    r = eng.evaluate_geofence(measurement=m, offices=[OFFICE], cfg=_cfg())
    assert r.geo_decision == eng.GEO_OUTSIDE
    assert r.policy_action == eng.POLICY_REQUIRE_REASON


def test_network_never_forces_inside_when_outside():
    m = eng.build_measurement(
        latitude=28.6200,
        longitude=77.2090,
        accuracy=15,
        sample_count=4,
        spread=25,
        acquisition_ms=5000,
        device_class="desktop",
        network_match=True,  # office IP match
    )
    r = eng.evaluate_geofence(measurement=m, offices=[OFFICE], cfg=_cfg())
    assert r.geo_decision == eng.GEO_OUTSIDE
    assert r.policy_action == eng.POLICY_REQUIRE_REASON
    assert r.diagnostics.get("network_booster_only") is True
    # Network raises confidence vs same fix without network
    m2 = eng.build_measurement(
        latitude=28.6200,
        longitude=77.2090,
        accuracy=15,
        sample_count=4,
        spread=25,
        acquisition_ms=5000,
        device_class="desktop",
        network_match=False,
    )
    r2 = eng.evaluate_geofence(measurement=m2, offices=[OFFICE], cfg=_cfg())
    assert r.confidence >= r2.confidence


def test_network_boosts_confidence_numbers():
    base = dict(
        latitude=28.6139,
        longitude=77.2090,
        accuracy=40,
        sample_count=2,
        spread=40,
        acquisition_ms=6000,
        device_class="desktop",
    )
    c_on, _ = eng.compute_confidence(eng.build_measurement(**base, network_match=True), _cfg())
    c_off, _ = eng.compute_confidence(eng.build_measurement(**base, network_match=False), _cfg())
    assert c_on > c_off


def test_client_confidence_ignored():
    m = eng.build_measurement(
        latitude=28.6200,
        longitude=77.2090,
        accuracy=15,
        sample_count=3,
        spread=20,
        device_class="mobile",
        network_match=False,
        confidence=99,
        geo_decision="INSIDE",
        policy_action="ALLOW",
    )
    r = eng.evaluate_geofence(measurement=m, offices=[OFFICE], cfg=_cfg())
    assert r.geo_decision != eng.GEO_INSIDE


def test_no_gps():
    m = eng.build_measurement(device_class="mobile")
    r = eng.evaluate_geofence(measurement=m, offices=[OFFICE], cfg=_cfg())
    assert r.geo_decision == eng.GEO_NO_GPS
    assert r.policy_action == eng.POLICY_REQUIRE_REASON


def test_no_office():
    m = eng.build_measurement(
        latitude=28.6139,
        longitude=77.2090,
        accuracy=20,
        sample_count=3,
        spread=10,
        device_class="mobile",
    )
    r = eng.evaluate_geofence(measurement=m, offices=[], cfg=_cfg())
    assert r.geo_decision == eng.GEO_NO_OFFICE
    assert r.policy_action == eng.POLICY_ALLOW_FLAGGED


def test_low_signal_high_accuracy_value():
    m = eng.build_measurement(
        latitude=28.6139,
        longitude=77.2090,
        accuracy=300,
        sample_count=2,
        spread=50,
        device_class="mobile",
    )
    r = eng.evaluate_geofence(measurement=m, offices=[OFFICE], cfg=_cfg())
    assert r.geo_decision == eng.GEO_LOW_SIGNAL
    assert r.policy_action == eng.POLICY_REQUIRE_REASON


def test_office_specific_grace():
    tight = eng.OfficeRecord(1, "Small", 28.6139, 77.2090, 75.0, 15.0)
    # Point ~95m away: with grace 15 → may be INTERSECTS (95-20 <= 90); with grace 0 more likely OUTSIDE
    m = eng.build_measurement(
        latitude=28.61475,
        longitude=77.2090,
        accuracy=20,
        sample_count=3,
        spread=15,
        device_class="mobile",
        acquisition_ms=4000,
    )
    r = eng.evaluate_geofence(measurement=m, offices=[tight], cfg=_cfg())
    assert r.matched_grace_m == 15.0
    assert r.matched_radius_m == 75.0


def test_select_nearest_of_two():
    far = eng.OfficeRecord(2, "Far", 19.0760, 72.8777, 100.0, 25.0)
    m = eng.build_measurement(
        latitude=28.6139,
        longitude=77.2090,
        accuracy=20,
        sample_count=3,
        spread=10,
        device_class="mobile",
    )
    r = eng.evaluate_geofence(measurement=m, offices=[far, OFFICE], cfg=_cfg())
    assert r.office and r.office["id"] == 1


if __name__ == "__main__":
    tests = [v for k, v in list(globals().items()) if k.startswith("test_") and callable(v)]
    failed = 0
    for fn in tests:
        try:
            fn()
            print("PASS", fn.__name__)
        except AssertionError as e:
            failed += 1
            print("FAIL", fn.__name__, e)
        except Exception as e:
            failed += 1
            print("ERROR", fn.__name__, e)
    if failed:
        raise SystemExit(1)
    print(f"PASS: {len(tests)} geo_fence_engine tests")
