"""
Rollout step 4: admins identifiers unique per tenant; admins.tenant_id NOT NULL.

Runs on SQLite always. Set TENANT_MIGRATION_MYSQL_URL (a scratch database the
test may drop tables in) to run the same checks on MySQL.
"""
import logging
import os

import pytest
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.exc import IntegrityError

from website.tenant_migrations import ensure_admin_tenant_uniques

LOG = logging.getLogger("tenant_migration_test")
MYSQL_URL = os.environ.get("TENANT_MIGRATION_MYSQL_URL")

_BACKENDS = ["sqlite"] + (["mysql"] if MYSQL_URL else [])


def _legacy_admins_ddl(dialect, *, global_unique=("email", "user_name", "mobile", "emp_id")):
    """Pre-step-4 layout: nullable tenant_id, single-column unique identifiers."""
    if dialect == "mysql":
        uniques = "".join(f", UNIQUE KEY `{c}` (`{c}`)" for c in global_unique)
        return [
            "CREATE TABLE admins ("
            "id INT AUTO_INCREMENT PRIMARY KEY, tenant_id INT NULL, "
            "email VARCHAR(120) NULL, user_name VARCHAR(120) NULL, "
            "mobile VARCHAR(15) NULL, emp_id VARCHAR(10) NULL"
            f"{uniques}) ENGINE=InnoDB"
        ]
    stmts = [
        "CREATE TABLE admins ("
        "id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER NULL, "
        "email VARCHAR(120), user_name VARCHAR(120), mobile VARCHAR(15), emp_id VARCHAR(10))"
    ]
    stmts += [f"CREATE UNIQUE INDEX ix_admins_{c} ON admins ({c})" for c in global_unique]
    return stmts


@pytest.fixture(params=_BACKENDS)
def engine(request):
    eng = create_engine("sqlite://" if request.param == "sqlite" else MYSQL_URL)
    with eng.begin() as conn:
        conn.execute(text("DROP TABLE IF EXISTS admins"))
    yield eng
    with eng.begin() as conn:
        conn.execute(text("DROP TABLE IF EXISTS admins"))
    eng.dispose()


def _create_legacy(engine, **kwargs):
    with engine.begin() as conn:
        for stmt in _legacy_admins_ddl(engine.dialect.name, **kwargs):
            conn.execute(text(stmt))


def _insert(engine, **values):
    cols = ", ".join(values)
    params = ", ".join(f":{k}" for k in values)
    with engine.begin() as conn:
        conn.execute(text(f"INSERT INTO admins ({cols}) VALUES ({params})"), values)


def _unique_index_columns(engine):
    insp = inspect(engine)
    return {
        ix["name"]: tuple(ix["column_names"])
        for ix in insp.get_indexes("admins")
        if ix.get("unique")
    }


def _seed(engine):
    _insert(engine, tenant_id=1, email="a@x.com", user_name="a", mobile="9000000001", emp_id="E1")
    _insert(engine, tenant_id=None, email="legacy@x.com", user_name="l", mobile="9000000002", emp_id="E2")
    _insert(engine, tenant_id=2, email="b@y.com", user_name="b", mobile="9000000003", emp_id="E3")


def test_migrates_to_per_tenant_uniques(engine):
    _create_legacy(engine)
    _seed(engine)

    summary = ensure_admin_tenant_uniques(engine, LOG)

    assert summary["skipped"] == {}
    assert sorted(summary["created"]) == [
        "uq_admins_tenant_email",
        "uq_admins_tenant_emp_id",
        "uq_admins_tenant_mobile",
        "uq_admins_tenant_user_name",
    ]
    assert len(summary["dropped"]) == 4
    uniques = _unique_index_columns(engine)
    assert uniques["uq_admins_tenant_email"] == ("tenant_id", "email")
    assert not any(cols in {("email",), ("user_name",), ("mobile",), ("emp_id",)} for cols in uniques.values())

    with engine.connect() as conn:
        assert conn.execute(text("SELECT COUNT(*) FROM admins WHERE tenant_id IS NULL")).scalar() == 0
        assert conn.execute(text("SELECT tenant_id FROM admins WHERE email='legacy@x.com'")).scalar() == 1

    # Same identifiers in another tenant are now allowed ...
    _insert(engine, tenant_id=2, email="a@x.com", user_name="a", mobile="9000000001", emp_id="E1")
    # ... but not twice in one tenant.
    with pytest.raises(IntegrityError):
        _insert(engine, tenant_id=1, email="a@x.com", user_name="z", mobile="9000000009", emp_id="E9")
    with pytest.raises(IntegrityError):
        _insert(engine, tenant_id=1, email="new@x.com", user_name="n", mobile="9000000008", emp_id="E1")


def test_tenant_id_becomes_not_null(engine):
    _create_legacy(engine)
    _seed(engine)

    summary = ensure_admin_tenant_uniques(engine, LOG)

    if engine.dialect.name == "sqlite":
        pytest.skip("SQLite cannot alter column nullability in place")
    assert summary["tenant_id_not_null"] is True
    col = next(c for c in inspect(engine).get_columns("admins") if c["name"] == "tenant_id")
    assert col["nullable"] is False
    with pytest.raises(IntegrityError):
        _insert(engine, tenant_id=None, email="n@x.com")


def test_rerun_is_a_no_op(engine):
    _create_legacy(engine)
    _seed(engine)
    ensure_admin_tenant_uniques(engine, LOG)
    before = _unique_index_columns(engine)

    summary = ensure_admin_tenant_uniques(engine, LOG)

    assert summary["created"] == [] and summary["dropped"] == [] and summary["skipped"] == {}
    assert _unique_index_columns(engine) == before


def test_duplicates_within_a_tenant_keep_column_untouched(engine):
    _create_legacy(engine, global_unique=("email", "user_name", "emp_id"))
    _insert(engine, tenant_id=1, email="a@x.com", mobile="9000000001")
    _insert(engine, tenant_id=1, email="b@x.com", mobile="9000000001")

    summary = ensure_admin_tenant_uniques(engine, LOG)

    assert "mobile" in summary["skipped"]
    assert "uq_admins_tenant_mobile" not in _unique_index_columns(engine)
    assert "uq_admins_tenant_email" in _unique_index_columns(engine)


def test_new_index_is_built_before_old_one_is_dropped(engine):
    """If creating the per-tenant index fails, the global index must survive."""
    _create_legacy(engine)
    _seed(engine)

    from website import tenant_migrations

    real = tenant_migrations._duplicate_count

    def boom(conn, dialect, column):
        if column == "emp_id":
            raise RuntimeError("simulated failure")
        return real(conn, dialect, column)

    tenant_migrations._duplicate_count = boom
    try:
        summary = ensure_admin_tenant_uniques(engine, LOG)
    finally:
        tenant_migrations._duplicate_count = real

    assert "emp_id" in summary["skipped"]
    assert ("emp_id",) in _unique_index_columns(engine).values()
    assert "uq_admins_tenant_emp_id" not in _unique_index_columns(engine)


def test_missing_table_or_column_is_ignored(engine):
    assert ensure_admin_tenant_uniques(engine, LOG)["created"] == []
    with engine.begin() as conn:
        conn.execute(text("CREATE TABLE admins (id INTEGER PRIMARY KEY, email VARCHAR(120))"))
    assert ensure_admin_tenant_uniques(engine, LOG)["created"] == []
