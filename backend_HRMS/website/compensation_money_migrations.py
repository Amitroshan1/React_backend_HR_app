"""Idempotent FLOAT/DOUBLE → NUMERIC(14,2) for compensation money columns."""
from __future__ import annotations

from sqlalchemy import inspect, text

from .compensation_security import COMPENSATION_MONEY_TABLES

_NUMERIC_HINTS = ("numeric", "decimal", "number")


def _already_numeric(type_str: str) -> bool:
    t = (type_str or "").lower()
    return any(h in t for h in _NUMERIC_HINTS)


def _col_nullable(col: dict) -> bool:
    return bool(col.get("nullable", True))


def ensure_compensation_money_columns(engine, logger) -> list[str]:
    """ALTER existing money columns to DECIMAL/NUMERIC(14,2). SQLite skipped (affinity)."""
    dialect = engine.dialect.name
    if dialect == "sqlite":
        return []
    insp = inspect(engine)
    tables = set(insp.get_table_names())
    changed = []
    for table, columns in COMPENSATION_MONEY_TABLES.items():
        if table not in tables:
            continue
        existing = {c["name"]: c for c in insp.get_columns(table)}
        for col_name in columns:
            meta = existing.get(col_name)
            if not meta:
                continue
            type_str = str(meta.get("type") or "")
            if _already_numeric(type_str):
                continue
            nullable = _col_nullable(meta)
            try:
                _alter_money(engine, dialect, table, col_name, nullable)
                changed.append(f"{table}.{col_name}")
                if logger:
                    logger.info("Compensation money column %s.%s -> NUMERIC(14,2)", table, col_name)
            except Exception as exc:
                if logger:
                    logger.warning(
                        "Compensation money migrate skipped %s.%s: %s", table, col_name, exc
                    )
        # refresh types after batch for this table
        insp = inspect(engine)
    return changed


def _alter_money(engine, dialect: str, table: str, column: str, nullable: bool) -> None:
    null_sql = "NULL" if nullable else "NOT NULL"
    if dialect == "postgresql":
        qtable = f'"{table}"'
        qcol = f'"{column}"'
        using = f"ROUND(CAST({qcol} AS numeric), 2)"
        ddl = (
            f"ALTER TABLE {qtable} ALTER COLUMN {qcol} TYPE NUMERIC(14,2) USING {using}"
        )
        extra = "" if nullable else f"; ALTER TABLE {qtable} ALTER COLUMN {qcol} SET NOT NULL"
        stmt = ddl + extra
    elif dialect == "mysql":
        default = "" if nullable else " DEFAULT 0.00"
        stmt = (
            f"ALTER TABLE `{table}` MODIFY COLUMN `{column}` DECIMAL(14,2) {null_sql}{default}"
        )
    else:
        return
    with engine.begin() as conn:
        conn.execute(text(stmt))
