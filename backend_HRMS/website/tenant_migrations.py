"""
Shared-DB multi-tenancy schema migrations (idempotent, run at startup).

admins.email / user_name / mobile / emp_id move from globally unique to unique
per tenant, and admins.tenant_id becomes NOT NULL. Every step is safe to re-run
and never leaves a column without a unique index: the per-tenant index is built
before the old global one is dropped, and a column with per-tenant duplicates
keeps its global index until the data is fixed.
"""
from __future__ import annotations

from sqlalchemy import inspect, text

from .tenant_context import DEFAULT_TENANT_ID

ADMIN_TENANT_UNIQUE_COLUMNS = ("email", "user_name", "mobile", "emp_id")


def _q(dialect: str, name: str) -> str:
    return f"`{name}`" if dialect == "mysql" else f'"{name}"'


def _composite_name(column: str) -> str:
    return f"uq_admins_tenant_{column}"


def _unique_indexes(insp, table: str) -> list[dict]:
    """Unique indexes and unique constraints as [{name, columns, kind}]."""
    found: dict[str, dict] = {}
    try:
        for uc in insp.get_unique_constraints(table):
            if uc.get("name"):
                found[uc["name"]] = {
                    "name": uc["name"],
                    "columns": list(uc.get("column_names") or []),
                    "kind": "constraint",
                }
    except NotImplementedError:
        pass
    for ix in insp.get_indexes(table):
        if ix.get("unique") and ix.get("name") and ix["name"] not in found:
            found[ix["name"]] = {
                "name": ix["name"],
                "columns": list(ix.get("column_names") or []),
                "kind": "index",
            }
    return list(found.values())


def _duplicate_count(conn, dialect: str, column: str) -> int:
    col = _q(dialect, column)
    row = conn.execute(
        text(
            "SELECT COUNT(*) FROM ("
            f"SELECT tenant_id, {col} FROM admins "
            f"WHERE {col} IS NOT NULL "
            f"GROUP BY tenant_id, {col} HAVING COUNT(*) > 1"
            ") dup"
        )
    ).scalar()
    return int(row or 0)


def _drop_unique(conn, dialect: str, entry: dict, table: str = "admins") -> bool:
    name = entry["name"]
    if dialect == "mysql":
        conn.execute(text(f"ALTER TABLE {table} DROP INDEX {_q(dialect, name)}"))
        return True
    if dialect == "postgresql":
        if entry["kind"] == "constraint":
            conn.execute(text(f"ALTER TABLE {table} DROP CONSTRAINT {_q(dialect, name)}"))
        else:
            conn.execute(text(f"DROP INDEX {_q(dialect, name)}"))
        return True
    if dialect == "sqlite":
        if name.startswith("sqlite_autoindex_"):
            return False
        conn.execute(text(f"DROP INDEX {_q(dialect, name)}"))
        return True
    return False


def _tenant_id_nullable(insp) -> bool:
    for col in insp.get_columns("admins"):
        if col["name"] == "tenant_id":
            return bool(col.get("nullable", True))
    return True


def _autocommit_ddl_conn(engine):
    """One connection for admin DDL — avoids MDL self-deadlock across the pool."""
    return engine.connect().execution_options(isolation_level="AUTOCOMMIT")


def ensure_admin_tenant_uniques(engine, logger) -> dict:
    """
    Migrate admins to per-tenant unique identifiers and NOT NULL tenant_id.

    Returns a summary: {"created": [...], "dropped": [...], "skipped": {col: reason},
    "tenant_id_not_null": bool}.
    """
    summary = {"created": [], "dropped": [], "skipped": {}, "tenant_id_not_null": False}
    dialect = engine.dialect.name

    insp = inspect(engine)
    if "admins" not in insp.get_table_names():
        return summary
    columns = {c["name"] for c in insp.get_columns("admins")}
    if "tenant_id" not in columns:
        logger.warning("admins.tenant_id missing; per-tenant uniques skipped")
        return summary

    with _autocommit_ddl_conn(engine) as conn:
        conn.execute(
            text("UPDATE admins SET tenant_id = :tid WHERE tenant_id IS NULL"),
            {"tid": DEFAULT_TENANT_ID},
        )

        for column in ADMIN_TENANT_UNIQUE_COLUMNS:
            if column not in columns:
                continue
            composite = _composite_name(column)
            try:
                existing = _unique_indexes(inspect(conn), "admins")
                has_composite = any(e["name"] == composite for e in existing)

                if not has_composite:
                    dups = _duplicate_count(conn, dialect, column)
                    if dups:
                        summary["skipped"][column] = f"{dups} duplicate value(s) within a tenant"
                        logger.warning(
                            "admins.%s: %s duplicate value(s) within a tenant; "
                            "kept global unique index, fix data and restart",
                            column,
                            dups,
                        )
                        continue
                    conn.execute(
                        text(
                            f"CREATE UNIQUE INDEX {_q(dialect, composite)} "
                            f"ON admins (tenant_id, {_q(dialect, column)})"
                        )
                    )
                    summary["created"].append(composite)
                    logger.info("Created unique index admins(tenant_id, %s)", column)

                for entry in _unique_indexes(inspect(conn), "admins"):
                    if entry["columns"] != [column]:
                        continue
                    dropped = _drop_unique(conn, dialect, entry)
                    if dropped:
                        summary["dropped"].append(entry["name"])
                        logger.info("Dropped global unique %s on admins.%s", entry["name"], column)
                    else:
                        summary["skipped"][column] = f"cannot drop {entry['name']} on {dialect}"
                        logger.warning(
                            "admins.%s: global unique %s cannot be dropped on %s",
                            column,
                            entry["name"],
                            dialect,
                        )
            except Exception as e:
                summary["skipped"][column] = str(e)
                logger.warning("admins.%s per-tenant unique migration skipped: %s", column, e)

        try:
            if not _tenant_id_nullable(inspect(conn)):
                summary["tenant_id_not_null"] = True
            elif dialect == "mysql":
                conn.execute(text("ALTER TABLE admins MODIFY tenant_id INT NOT NULL"))
                summary["tenant_id_not_null"] = True
                logger.info("admins.tenant_id is now NOT NULL")
            elif dialect == "postgresql":
                conn.execute(text("ALTER TABLE admins ALTER COLUMN tenant_id SET NOT NULL"))
                summary["tenant_id_not_null"] = True
                logger.info("admins.tenant_id is now NOT NULL")
        except Exception as e:
            logger.warning("admins.tenant_id NOT NULL skipped: %s", e)

    return summary


def _admin_tenant_of(table: str, column: str) -> str:
    return f"(SELECT a.tenant_id FROM admins a WHERE a.id = {table}.{column})"


def _inventory_tenant_of(table: str, column: str = "inventory_item_id") -> str:
    return f"(SELECT i.tenant_id FROM it_inventory_items i WHERE i.id = {table}.{column})"


def ensure_tenant_id_column(engine, logger, table: str, sources: list[str]) -> dict:
    """
    Add a nullable, indexed ``tenant_id`` to ``table`` and fill NULL rows from the first
    non-NULL SQL expression in ``sources`` (default tenant when all are NULL).

    Returns {"added": bool, "backfilled": int}.
    """
    summary = {"added": False, "backfilled": 0}
    insp = inspect(engine)
    if table not in insp.get_table_names():
        return summary
    columns = {c["name"] for c in insp.get_columns(table)}
    if "tenant_id" not in columns:
        with engine.begin() as conn:
            conn.execute(text(f"ALTER TABLE {table} ADD COLUMN tenant_id INTEGER NULL"))
            conn.execute(text(f"CREATE INDEX ix_{table}_tenant_id ON {table} (tenant_id)"))
        summary["added"] = True
        logger.info("Added %s.tenant_id", table)

    fill = f"COALESCE({', '.join([*sources, ':tid'])})" if sources else ":tid"
    with engine.begin() as conn:
        result = conn.execute(
            text(f"UPDATE {table} SET tenant_id = {fill} WHERE tenant_id IS NULL"),
            {"tid": DEFAULT_TENANT_ID},
        )
        summary["backfilled"] = int(result.rowcount or 0)
    if summary["backfilled"]:
        logger.info("Backfilled tenant_id on %s %s row(s)", summary["backfilled"], table)
    return summary


def ensure_tenant_mailbox_columns(engine, logger) -> list[str]:
    """Add the nullable per-company mailbox columns to ``tenants``. Returns the added names."""
    from .models.tenant import TENANT_MAILBOX_COLUMNS

    insp = inspect(engine)
    if "tenants" not in insp.get_table_names():
        return []
    columns = {c["name"] for c in insp.get_columns("tenants")}
    added = [c for c in TENANT_MAILBOX_COLUMNS if c not in columns]
    if added:
        with engine.begin() as conn:
            for column in added:
                conn.execute(text(f"ALTER TABLE tenants ADD COLUMN {column} VARCHAR(200) NULL"))
        logger.info("Added tenants mailbox column(s): %s", ", ".join(added))
    return added


def ensure_company_country_columns(engine, logger) -> dict[str, bool]:
    """Add nullable country fields to existing shared-DB company registry tables."""
    tables = set(inspect(engine).get_table_names())
    result: dict[str, bool] = {}
    for table in ("tenants", "deployed_customers"):
        if table not in tables:
            continue
        columns = {column["name"] for column in inspect(engine).get_columns(table)}
        if "country" in columns:
            result[table] = False
            continue
        quoted_table = _q(engine.dialect.name, table)
        with engine.begin() as conn:
            conn.execute(text(f"ALTER TABLE {quoted_table} ADD COLUMN country VARCHAR(100) NULL"))
        result[table] = True
        logger.info("Added %s.country", table)
    return result


def ensure_manager_contact_tenant_id(engine, logger) -> dict:
    """manager_contacts.tenant_id from the linked L1, then L2, then L3 manager's tenant."""
    t = "manager_contacts"
    return ensure_tenant_id_column(
        engine,
        logger,
        t,
        [_admin_tenant_of(t, "l1_admin_id"), _admin_tenant_of(t, "l2_admin_id"), _admin_tenant_of(t, "l3_admin_id")],
    )


# Inventory items first: the log tables below backfill from their inventory item's tenant.
IT_TENANT_SOURCES = (
    ("it_inventory_items", [_admin_tenant_of("it_inventory_items", "created_by_admin_id")]),
    ("it_parcel_exports", [_admin_tenant_of("it_parcel_exports", "exported_by_admin_id")]),
    ("it_parcel_imports", [_admin_tenant_of("it_parcel_imports", "received_by_admin_id")]),
    (
        "it_removed_assets",
        [
            _inventory_tenant_of("it_removed_assets"),
            _admin_tenant_of("it_removed_assets", "owner_admin_id"),
            _admin_tenant_of("it_removed_assets", "removed_by_admin_id"),
        ],
    ),
    (
        "it_deleted_asset_logs",
        [
            _inventory_tenant_of("it_deleted_asset_logs"),
            _admin_tenant_of("it_deleted_asset_logs", "deleted_by_admin_id"),
        ],
    ),
    (
        "it_asset_transitions",
        [
            _inventory_tenant_of("it_asset_transitions"),
            _admin_tenant_of("it_asset_transitions", "actor_admin_id"),
        ],
    ),
    ("it_asset_units", [_inventory_tenant_of("it_asset_units")]),
    ("it_software_licenses", [_inventory_tenant_of("it_software_licenses")]),
    ("it_support_tickets", [_admin_tenant_of("it_support_tickets", "requester_admin_id")]),
    ("it_asset_return_requests", [_admin_tenant_of("it_asset_return_requests", "requester_admin_id")]),
)


def ensure_news_feed_tenant_id(engine, logger) -> dict:
    """news_feeds.tenant_id; posts have no author column, so existing posts go to the default tenant."""
    return ensure_tenant_id_column(engine, logger, "news_feeds", [])


BIO_DAY_TABLE = "biometric_attendance_day"
BIO_DAY_UNIQUE = "uq_bio_att_day_tenant_pin_date"
BIO_DAY_KEY = ["device_user_id", "attendance_date"]


def ensure_biometric_tenant_ids(engine, logger) -> dict:
    """
    biometric_devices.tenant_id (existing devices → default tenant) and
    biometric_attendance_day.tenant_id (from the mapped employee, else default tenant),
    then move the read-model unique key from (PIN, date) to (tenant, PIN, date).
    """
    return {
        "biometric_devices": ensure_tenant_id_column(engine, logger, "biometric_devices", []),
        BIO_DAY_TABLE: ensure_tenant_id_column(
            engine, logger, BIO_DAY_TABLE, [_admin_tenant_of(BIO_DAY_TABLE, "admin_id")]
        ),
        "unique": ensure_tenant_unique(engine, logger, BIO_DAY_TABLE, BIO_DAY_UNIQUE, BIO_DAY_KEY),
    }


def ensure_tenant_unique(engine, logger, table: str, name: str, key: list[str]) -> dict:
    """
    Replace a global unique on ``key`` with one on ``(tenant_id, *key)``. The per-tenant
    index is created first, so the table is never left without a unique key.

    Returns {"created": bool, "dropped": [...], "skipped": str | None}.
    """
    out = {"created": False, "dropped": [], "skipped": None}
    insp = inspect(engine)
    if table not in insp.get_table_names():
        return out
    dialect = engine.dialect.name
    if not any(e["columns"] == ["tenant_id", *key] for e in _unique_indexes(insp, table)):
        cols = ", ".join(_q(dialect, c) for c in ["tenant_id", *key])
        with engine.begin() as conn:
            conn.execute(text(f"CREATE UNIQUE INDEX {_q(dialect, name)} ON {table} ({cols})"))
        out["created"] = True
        logger.info("Created unique index %s(tenant_id, %s)", table, ", ".join(key))
    for entry in _unique_indexes(inspect(engine), table):
        if entry["columns"] != key:
            continue
        with engine.begin() as conn:
            dropped = _drop_unique(conn, dialect, entry, table)
        if dropped:
            out["dropped"].append(entry["name"])
            logger.info("Dropped global unique %s on %s", entry["name"], table)
        else:
            out["skipped"] = f"cannot drop {entry['name']} on {dialect}"
            logger.warning("%s: global unique %s cannot be dropped on %s", table, entry["name"], dialect)
    return out


# (table, per-tenant unique name, old global unique key); existing rows → default tenant.
MASTER_DATA_TENANT_TABLES = (
    ("master_data", "uq_master_tenant_type_name", ["master_type", "name"]),
    ("holiday_calendar", "uq_holiday_calendar_tenant_year_name", ["year", "holiday_name"]),
    ("hr_policy_documents", None, None),
    ("location", None, None),
)


def ensure_master_data_tenant_ids(engine, logger) -> dict:
    """tenant_id on departments/circles, holidays, HR policies and office locations, plus per-tenant uniques."""
    out = {}
    for table, unique_name, key in MASTER_DATA_TENANT_TABLES:
        try:
            out[table] = ensure_tenant_id_column(engine, logger, table, [])
            if unique_name:
                out[table]["unique"] = ensure_tenant_unique(engine, logger, table, unique_name, key)
        except Exception as e:
            out[table] = {"error": str(e)}
            logger.warning("%s.tenant_id migration skipped: %s", table, e)
    return out


def ensure_recruitment_tenant_ids(engine, logger) -> dict:
    """
    tenant_id on job requisitions, candidates (from the requisition, else the hired
    employee), assessment invites (from the candidate they were sent to) and headcount
    budgets (per-tenant unique). Other rows → default tenant.
    """
    tables = (
        ("job_requisitions", [], None, None),
        (
            "candidates",
            [
                "(SELECT r.tenant_id FROM job_requisitions r WHERE r.id = candidates.requisition_id)",
                _admin_tenant_of("candidates", "admin_id"),
            ],
            None,
            None,
        ),
        (
            "assessment_invites",
            ["(SELECT c.tenant_id FROM candidates c WHERE c.assessment_invite_id = assessment_invites.id LIMIT 1)"],
            None,
            None,
        ),
        (
            "headcount_budgets",
            [],
            "uq_headcount_budget_tenant_year_circle_dept",
            ["fiscal_year", "circle", "emp_type"],
        ),
    )
    out = {}
    for table, sources, unique_name, key in tables:
        try:
            out[table] = ensure_tenant_id_column(engine, logger, table, sources)
            if unique_name:
                out[table]["unique"] = ensure_tenant_unique(engine, logger, table, unique_name, key)
        except Exception as e:
            out[table] = {"error": str(e)}
            logger.warning("%s.tenant_id migration skipped: %s", table, e)
    return out


def ensure_compensation_tenant_ids(engine, logger) -> dict:
    """tenant_id on increment cycles, merit matrix and CTC bands (per-tenant unique keys); rows → default tenant."""
    tables = (
        ("increment_cycles", None, None),
        ("merit_matrix_entries", "uq_merit_matrix_tenant_circle_dept_rating", ["circle", "emp_type", "rating"]),
        ("compensation_bands", "uq_comp_band_tenant_circle_dept_grade", ["circle", "emp_type", "grade"]),
    )
    out = {}
    for table, unique_name, key in tables:
        try:
            out[table] = ensure_tenant_id_column(engine, logger, table, [])
            if unique_name:
                out[table]["unique"] = ensure_tenant_unique(engine, logger, table, unique_name, key)
        except Exception as e:
            out[table] = {"error": str(e)}
            logger.warning("%s.tenant_id migration skipped: %s", table, e)
    return out


def ensure_it_tenant_ids(engine, logger) -> dict:
    """tenant_id on IT stock and logs, then per-company unique codes. Returns {table: summary}."""
    out = {}
    for table, sources in IT_TENANT_SOURCES:
        try:
            out[table] = ensure_tenant_id_column(engine, logger, table, sources)
        except Exception as e:
            out[table] = {"error": str(e)}
            logger.warning("%s.tenant_id migration skipped: %s", table, e)
    codes = {}
    insp = inspect(engine)
    for table, name, key in IT_CODE_UNIQUES:
        try:
            columns = {c["name"] for c in insp.get_columns(table)} if table in insp.get_table_names() else set()
            if "tenant_id" not in columns or any(col not in columns for col in key):
                continue
            codes[f"{table}.{key[0]}"] = ensure_tenant_unique(engine, logger, table, name, key)
            insp = inspect(engine)
        except Exception as e:
            codes[f"{table}.{key[0]}"] = {"error": str(e)}
            logger.warning("%s per-company code unique skipped: %s", table, e)
    if codes:
        out["codes"] = codes
    return out


IT_CODE_UNIQUES = (
    ("it_inventory_items", "uq_it_inventory_tenant_code", ["inventory_code"]),
    ("it_asset_units", "uq_it_unit_tenant_code", ["unit_code"]),
    ("it_asset_units", "uq_it_unit_tenant_tag", ["asset_tag"]),
    ("it_software_licenses", "uq_it_license_tenant_code", ["license_code"]),
    ("it_support_tickets", "uq_it_ticket_tenant_code", ["ticket_code"]),
    ("it_removed_assets", "uq_it_removed_tenant_code", ["removed_code"]),
    ("it_deleted_asset_logs", "uq_it_deleted_tenant_code", ["delete_code"]),
    ("it_parcel_exports", "uq_it_export_tenant_code", ["export_code"]),
    ("it_parcel_imports", "uq_it_import_tenant_code", ["import_code"]),
    ("it_asset_return_requests", "uq_it_return_tenant_code", ["request_code"]),
    ("it_asset_transitions", "uq_it_transition_tenant_code", ["transition_code"]),
)


# Upload path columns too short for ``tenants/{id}/<folder>/<name>`` keys.
UPLOAD_PATH_COLUMNS = (
    ("expense_line_item", "Attach_file", 300),
    ("employees", "photo_filename", 300),
    ("family_details", "photo_filename", 300),
)


def ensure_varchar_length(engine, logger, table: str, column: str, length: int) -> bool:
    """Widen a VARCHAR column to ``length`` (MySQL / PostgreSQL; SQLite does not enforce it)."""
    insp = inspect(engine)
    if table not in insp.get_table_names():
        return False
    col = next((c for c in insp.get_columns(table) if c["name"] == column), None)
    current = getattr(col["type"], "length", None) if col else None
    if col is None or current is None or current >= length:
        return False
    dialect = engine.dialect.name
    if dialect == "mysql":
        stmt = f"ALTER TABLE {_q(dialect, table)} MODIFY {_q(dialect, column)} VARCHAR({length}) NULL"
    elif dialect == "postgresql":
        stmt = f"ALTER TABLE {_q(dialect, table)} ALTER COLUMN {_q(dialect, column)} TYPE VARCHAR({length})"
    else:
        return False
    with engine.begin() as conn:
        conn.execute(text(stmt))
    logger.info("Widened %s.%s to VARCHAR(%s)", table, column, length)
    return True


def ensure_upload_path_columns(engine, logger) -> dict:
    """Widen upload path columns for tenant-prefixed keys. Returns {table.column: widened}."""
    out = {}
    for table, column, length in UPLOAD_PATH_COLUMNS:
        try:
            out[f"{table}.{column}"] = ensure_varchar_length(engine, logger, table, column, length)
        except Exception as e:
            out[f"{table}.{column}"] = False
            logger.warning("%s.%s widen skipped: %s", table, column, e)
    return out
