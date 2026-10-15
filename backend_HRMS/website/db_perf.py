"""
Database performance settings that do not change any API response.

- Connection pool tuning (DB_POOL_TUNING=1).
- Composite indexes for IT / inventory list queries (DB_PERF_INDEXES, on by default).
- Per-request timing + SQL query count log (PERF_REQUEST_LOG=1).
"""
import os
import time

from sqlalchemy import event, inspect, text

_TRUTHY = {"1", "true", "yes", "on"}


def env_flag(name, default=False):
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in _TRUTHY


def _env_int(name, default):
    try:
        return int(os.getenv(name, str(default)))
    except ValueError:
        return default


def engine_options_from_env(database_uri):
    """SQLALCHEMY_ENGINE_OPTIONS for MySQL/Postgres when DB_POOL_TUNING=1, else None (library defaults)."""
    if not env_flag("DB_POOL_TUNING") or not database_uri or database_uri.startswith("sqlite"):
        return None
    return {
        "pool_pre_ping": True,
        "pool_recycle": _env_int("DB_POOL_RECYCLE", 1800),
        "pool_size": _env_int("DB_POOL_SIZE", 10),
        "max_overflow": _env_int("DB_MAX_OVERFLOW", 20),
        "pool_timeout": _env_int("DB_POOL_TIMEOUT", 30),
    }


# (table, index name, columns). Skipped when the table or any column is missing
# (for example tenant_id on single-company servers).
IT_PERF_INDEXES = (
    ("it_asset_units", "ix_it_units_item_status", ("inventory_item_id", "status")),
    ("it_asset_units", "ix_it_units_status_hw", ("status", "hw_type")),
    ("it_software_licenses", "ix_it_licenses_item_status", ("inventory_item_id", "status")),
    ("it_support_tickets", "ix_it_tickets_requester_created", ("requester_admin_id", "created_at")),
    ("it_asset_return_requests", "ix_it_returns_requester_created", ("requester_admin_id", "created_at")),
    ("it_inventory_quantity_assignments", "ix_it_qty_admin_qty", ("assigned_to_admin_id", "quantity")),
    ("it_inventory_items", "ix_it_items_tenant_invcat", ("tenant_id", "inventory_category")),
    ("it_removed_assets", "ix_it_removed_tenant_at", ("tenant_id", "removed_at")),
    ("it_deleted_asset_logs", "ix_it_deleted_tenant_at", ("tenant_id", "deleted_at")),
)


def ensure_indexes(engine, wanted, logger):
    """Create missing indexes one by one; a failure only skips that index. Returns names created."""
    insp = inspect(engine)
    tables = set(insp.get_table_names())
    created = []
    for table, name, cols in wanted:
        if table not in tables:
            continue
        columns = {c["name"] for c in insp.get_columns(table)}
        if not set(cols) <= columns:
            continue
        if name in {ix["name"] for ix in insp.get_indexes(table)}:
            continue
        col_sql = ", ".join(cols)
        if engine.dialect.name == "postgresql":
            ddl = f'CREATE INDEX IF NOT EXISTS {name} ON "{table}" ({col_sql})'
        else:
            ddl = f"CREATE INDEX {name} ON {table} ({col_sql})"
        try:
            with engine.begin() as conn:
                conn.execute(text(ddl))
            created.append(name)
        except Exception as exc:
            # Another worker may have created it first ("Duplicate key name").
            logger.warning("index %s skipped: %s", name, exc)
    if created:
        logger.info("performance indexes created: %s", ", ".join(created))
    return created


def register_request_perf_log(app, db):
    """Log method, path, status, time, SQL query count and size for each request (PERF_REQUEST_LOG=1)."""
    if not env_flag("PERF_REQUEST_LOG"):
        return
    from flask import g, has_request_context, request

    slow_ms = _env_int("PERF_SLOW_MS", 0)
    listening = set()

    def _count(*_args, **_kwargs):
        if has_request_context():
            g._perf_queries = g.get("_perf_queries", 0) + 1

    @app.before_request
    def _perf_start():
        g._perf_started = time.perf_counter()
        g._perf_queries = 0
        engine = db.engine
        if id(engine) not in listening:
            event.listen(engine, "before_cursor_execute", _count)
            listening.add(id(engine))

    @app.after_request
    def _perf_log(response):
        started = g.get("_perf_started")
        if started is None:
            return response
        ms = (time.perf_counter() - started) * 1000
        if ms >= slow_ms:
            app.logger.warning(
                "PERF %s %s %s %.0fms queries=%d bytes=%s",
                request.method,
                request.path,
                response.status_code,
                ms,
                g.get("_perf_queries", 0),
                response.calculate_content_length(),
            )
        return response
