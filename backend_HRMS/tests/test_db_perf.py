"""Pool settings, startup indexes, case-insensitive compare and request timing log."""
import logging

from flask import Flask
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import Column, Integer, MetaData, String, Table, create_engine, inspect

from website import db as app_db
from website.db_perf import (
    IT_PERF_INDEXES,
    engine_options_from_env,
    ensure_indexes,
    register_request_perf_log,
)

LOG = logging.getLogger("test_db_perf")


def test_pool_options_off_by_default(monkeypatch):
    monkeypatch.delenv("DB_POOL_TUNING", raising=False)
    assert engine_options_from_env("mysql+pymysql://u:p@h/db") is None


def test_pool_options_on_for_mysql_only(monkeypatch):
    monkeypatch.setenv("DB_POOL_TUNING", "1")
    monkeypatch.setenv("DB_POOL_SIZE", "15")
    opts = engine_options_from_env("mysql+pymysql://u:p@h/db")
    assert opts["pool_pre_ping"] is True and opts["pool_size"] == 15
    assert engine_options_from_env("sqlite:///:memory:") is None


def _engine_with_tables(with_tenant_id):
    engine = create_engine("sqlite:///:memory:")
    meta = MetaData()
    Table(
        "it_removed_assets", meta,
        Column("id", Integer, primary_key=True),
        *([Column("tenant_id", Integer)] if with_tenant_id else []),
        Column("removed_at", String(30)),
    )
    Table(
        "it_support_tickets", meta,
        Column("id", Integer, primary_key=True),
        Column("requester_admin_id", Integer),
        Column("created_at", String(30)),
    )
    meta.create_all(engine)
    return engine


def test_indexes_created_once_and_missing_tables_ignored():
    engine = _engine_with_tables(with_tenant_id=True)
    created = ensure_indexes(engine, IT_PERF_INDEXES, LOG)
    assert set(created) == {"ix_it_removed_tenant_at", "ix_it_tickets_requester_created"}
    assert ensure_indexes(engine, IT_PERF_INDEXES, LOG) == []
    names = {ix["name"] for ix in inspect(engine).get_indexes("it_support_tickets")}
    assert "ix_it_tickets_requester_created" in names


def test_index_skipped_when_tenant_column_missing():
    engine = _engine_with_tables(with_tenant_id=False)
    assert ensure_indexes(engine, IT_PERF_INDEXES, LOG) == ["ix_it_tickets_requester_created"]


def _ci_sql(app):
    from website.models.it_models import ITAssetUnit
    from website.query_utils import ci_equals

    with app.app_context():
        return str(ci_equals(ITAssetUnit.status, "Available").compile(compile_kwargs={"literal_binds": True}))


def test_ci_equals_keeps_lower_unless_mysql_flag():
    app = Flask("ci")
    app.config.update(SQLALCHEMY_DATABASE_URI="sqlite:///:memory:", DB_CI_COLLATION=True)
    app_db.init_app(app)
    assert "lower(" in _ci_sql(app) and "'available'" in _ci_sql(app)


def test_request_perf_log(monkeypatch, caplog):
    monkeypatch.setenv("PERF_REQUEST_LOG", "1")
    app = Flask("perf_log")
    app.config.update(SQLALCHEMY_DATABASE_URI="sqlite:///:memory:")
    local_db = SQLAlchemy(app)
    register_request_perf_log(app, local_db)

    @app.route("/ping")
    def ping():
        from sqlalchemy import text

        local_db.session.execute(text("SELECT 1"))
        local_db.session.execute(text("SELECT 2"))
        return "ok"

    with caplog.at_level(logging.WARNING):
        assert app.test_client().get("/ping").data == b"ok"
    line = next(r.getMessage() for r in caplog.records if r.getMessage().startswith("PERF"))
    assert "GET /ping 200" in line and "queries=2" in line


def test_request_perf_log_off_by_default(monkeypatch):
    monkeypatch.delenv("PERF_REQUEST_LOG", raising=False)
    app = Flask("perf_off")
    before = len(app.before_request_funcs.get(None, []))
    register_request_perf_log(app, None)
    assert len(app.before_request_funcs.get(None, [])) == before
