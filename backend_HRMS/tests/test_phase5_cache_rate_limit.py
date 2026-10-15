"""
Phase 5: optional Redis cache and shared rate limits.

Without CACHE_REDIS_URL the app behaves as before. With a fake Redis client the
cache hits, bumps invalidate, and the rate limiter shares one counter.
"""
import importlib
import pkgutil
import time
from datetime import date

import pytest
from flask import Flask
from flask_jwt_extended import JWTManager, create_access_token

import website.models as models_pkg
from website import db

for _mod in pkgutil.iter_modules(models_pkg.__path__):
    if _mod.name != "confirmation_request":
        importlib.import_module(f"website.models.{_mod.name}")

from website.models.Admin_models import Admin  # noqa: E402
from website.models.holiday_calendar import HolidayCalendar  # noqa: E402
from website.models.master_data import MasterData  # noqa: E402
from website.models.tenant import Tenant  # noqa: E402
from website.tenant_context import register_tenant_guards  # noqa: E402


class FakeRedis:
    def __init__(self):
        self.store = {}
        self.ttls = {}

    def ping(self):
        return True

    def get(self, key):
        return self.store.get(key)

    def setex(self, key, ttl, value):
        self.store[key] = value if isinstance(value, (bytes, str)) else str(value)
        if isinstance(self.store[key], str):
            self.store[key] = self.store[key].encode()
        self.ttls[key] = int(ttl)

    def incr(self, key):
        raw = self.store.get(key)
        n = int(raw.decode() if isinstance(raw, bytes) else (raw or 0)) + 1
        self.store[key] = str(n).encode()
        return n

    def expire(self, key, seconds):
        self.ttls[key] = int(seconds)

    def ttl(self, key):
        return int(self.ttls.get(key, -1))


@pytest.fixture()
def fake_redis(monkeypatch):
    from website import cache, rate_limit

    fake = FakeRedis()
    cache.reset_client()
    rate_limit._redis_failed = False
    monkeypatch.setenv("CACHE_REDIS_URL", "redis://fake:6379/0")
    monkeypatch.setattr(cache, "client", lambda: fake)
    monkeypatch.setattr(cache, "redis_url", lambda: "redis://fake:6379/0")
    yield fake
    cache.reset_client()
    rate_limit._redis_failed = False


@pytest.fixture()
def app(fake_redis):
    from website.auth import auth
    from website.Human_resource import hr

    app = Flask("phase5_cache")
    app.config.update(
        SQLALCHEMY_DATABASE_URI="sqlite:///:memory:",
        SQLALCHEMY_TRACK_MODIFICATIONS=False,
        JWT_SECRET_KEY="phase5-cache-secret-key-32-bytes!!",
        TESTING=True,
        CACHE_REDIS_URL="redis://fake:6379/0",
        CACHE_DEFAULT_TIMEOUT=300,
        CACHE_KEY_PREFIX="hrms-test",
        RATE_LIMIT_BACKEND="redis",
    )
    db.init_app(app)
    register_tenant_guards(app, JWTManager(app))
    app.register_blueprint(auth, url_prefix="/api/auth")
    app.register_blueprint(hr, url_prefix="/api/HumanResource")
    with app.app_context():
        db.create_all()
        db.session.add(Tenant(id=1, name="One", slug="default", plan="enterprise", status="active"))
        db.session.add(Admin(
            id=2, tenant_id=1, email="hr@one.com", emp_id="H1", first_name="Hema",
            emp_type="Human Resource", circle="NHQ", is_active=True, is_exited=False, doj=date(2024, 1, 1),
        ))
        db.session.add_all([
            MasterData(tenant_id=1, master_type="department", name="Engineering", is_active=True),
            MasterData(tenant_id=1, master_type="circle", name="NHQ", is_active=True),
            HolidayCalendar(
                tenant_id=1, year=2026, holiday_name="Republic Day",
                holiday_date=date(2026, 1, 26), is_optional=False, is_active=True,
            ),
        ])
        db.session.commit()
        yield app
        db.session.remove()
        db.drop_all()


def _hr_headers(app):
    with app.app_context():
        token = create_access_token(
            identity="2",
            additional_claims={"email": "hr@one.com", "emp_type": "Human Resource", "tenant_id": 1},
        )
    return {"Authorization": f"Bearer {token}"}


def test_no_redis_url_skips_cache(monkeypatch):
    from website import cache

    cache.reset_client()
    monkeypatch.delenv("CACHE_REDIS_URL", raising=False)
    monkeypatch.setattr(cache, "redis_url", lambda: "")
    assert cache.client() is None
    asserts = []

    def loader():
        asserts.append(1)
        return ["A"]

    assert cache.cached_json(cache.NS_MASTER, 1, "department", loader) == ["A"]
    assert cache.cached_json(cache.NS_MASTER, 1, "department", loader) == ["A"]
    assert asserts == [1, 1]


def test_master_options_uses_cache(app, fake_redis):
    from website.cache import active_master_names

    client = app.test_client()
    headers = _hr_headers(app)
    first = client.get("/api/auth/master-options", headers=headers)
    assert first.status_code == 200
    body = first.get_json()
    assert body["circles"] == ["NHQ"]
    assert isinstance(body["departments"], list)
    keys_before = set(fake_redis.store)
    assert keys_before

    with app.app_context():
        assert active_master_names(1, "circle") == ["NHQ"]
    assert set(fake_redis.store) == keys_before

    second = client.get("/api/auth/master-options", headers=headers).get_json()
    assert second == body


def test_master_write_invalidates_cache(app, fake_redis):
    from website.cache import active_master_names

    client = app.test_client()
    headers = _hr_headers(app)
    with app.app_context():
        assert active_master_names(1, "department") == ["Engineering"]
    assert any(b"master" in (k if isinstance(k, bytes) else str(k).encode()) for k in fake_redis.store)

    create = client.post(
        "/api/HumanResource/master/department",
        json={"name": "Field"},
        headers=headers,
    )
    assert create.status_code in (200, 201), create.get_json()
    with app.app_context():
        assert active_master_names(1, "department") == ["Engineering", "Field"]


def test_holiday_cache_and_bump(app, fake_redis):
    from website.cache import NS_HOLIDAYS, active_holidays_for_year, bump_holidays

    with app.app_context():
        first = active_holidays_for_year(1, 2026)
        assert any(h["holiday_name"] == "Republic Day" for h in first)
        cached = active_holidays_for_year(1, 2026)
        assert cached == first
        bump_holidays(1)
        db.session.add(HolidayCalendar(
            tenant_id=1, year=2026, holiday_name="Diwali",
            holiday_date=date(2026, 11, 1), is_optional=False, is_active=True,
        ))
        db.session.commit()
        refreshed = active_holidays_for_year(1, 2026)
        assert any(h["holiday_name"] == "Diwali" for h in refreshed)


def test_plan_cache(app, fake_redis):
    from website.plan_features import get_plan

    with app.app_context():
        assert get_plan(1) == "enterprise"
        assert get_plan(1) == "enterprise"
        assert any("plan" in str(k) for k in fake_redis.store)


def test_rate_limit_shared_via_redis(app, fake_redis):
    from website.rate_limit import hit

    with app.app_context():
        app.config["RATE_LIMIT_BACKEND"] = "redis"
        assert hit("otp:test", limit=2, window_seconds=60) == (True, 0)
        assert hit("otp:test", limit=2, window_seconds=60) == (True, 0)
        allowed, retry = hit("otp:test", limit=2, window_seconds=60)
        assert allowed is False and retry >= 1


def test_rate_limit_falls_back_to_memory(monkeypatch):
    from website import cache, rate_limit

    cache.reset_client()
    rate_limit._redis_failed = False
    monkeypatch.setattr(rate_limit, "_backend", lambda: "memory")
    assert rate_limit.hit("mem:a", limit=1, window_seconds=60)[0] is True
    assert rate_limit.hit("mem:a", limit=1, window_seconds=60)[0] is False


def test_gunicorn_conf_loads():
    import importlib.util
    from pathlib import Path

    path = Path(__file__).resolve().parents[1] / "gunicorn.conf.py"
    spec = importlib.util.spec_from_file_location("hrms_gunicorn_conf", path)
    conf = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(conf)
    assert conf.workers >= 1
    assert conf.bind
    assert conf.worker_class in ("gthread", "sync", "gevent", "eventlet")
