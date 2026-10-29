"""
Additive schema align on app start.

Safe for production data:
- create missing tables only
- add missing columns as NULL (existing rows stay valid)
- never drop / rename / change type / add NOT NULL without a default
- never add unique or foreign-key constraints on existing tables
- one failed statement does not abort the rest or crash boot
"""
from __future__ import annotations

import importlib
import logging
from pathlib import Path

from sqlalchemy import inspect, text
from sqlalchemy.exc import NoReferencedTableError, SQLAlchemyError

log = logging.getLogger(__name__)

_SKIP_PK_ON_EXISTING = True
# Leftover models whose FKs point at tables/classes we no longer ship (e.g. signups).
_SKIP_MODEL_MODULES = frozenset({"confirmation_request"})


def _load_model_modules() -> None:
    root = Path(__file__).resolve().parent
    modules = []
    models_dir = root / "models"
    if models_dir.is_dir():
        for path in models_dir.glob("*.py"):
            if path.name.startswith("_") or path.stem in _SKIP_MODEL_MODULES:
                continue
            modules.append(f"website.models.{path.stem}")
    bio = root / "biometric" / "models.py"
    if bio.is_file():
        modules.append("website.biometric.models")
    for name in modules:
        try:
            importlib.import_module(name)
        except Exception as exc:
            log.warning("schema align: skip import %s (%s)", name, exc)


def _quote(name: str, dialect) -> str:
    return dialect.identifier_preparer.quote(name)


def _column_sql(column, dialect) -> str | None:
    if _SKIP_PK_ON_EXISTING and column.primary_key:
        return None
    try:
        type_sql = column.type.compile(dialect=dialect)
    except Exception:
        return None
    default_sql = ""
    server_default = column.server_default
    arg = getattr(server_default, "arg", None) if server_default is not None else None
    if isinstance(arg, (int, float)):
        default_sql = f" DEFAULT {arg}"
    elif isinstance(arg, str) and arg.replace("_", "").isalnum():
        default_sql = f" DEFAULT {arg}"
    return f"{_quote(column.name, dialect)} {type_sql} NULL{default_sql}"


def _existing_tables(insp) -> set[str]:
    names = set(insp.get_table_names() or [])
    try:
        names.update(insp.get_view_names() or [])
    except Exception:
        pass
    return {n.lower() for n in names}


def _existing_columns(insp, table: str) -> set[str]:
    try:
        return {c["name"].lower() for c in insp.get_columns(table)}
    except Exception:
        return set()


def _iter_tables(metadata, logger):
    try:
        return list(metadata.sorted_tables)
    except (NoReferencedTableError, SQLAlchemyError) as exc:
        logger.warning("schema align: table sort skipped (%s); using unsorted metadata", exc)
        return list(metadata.tables.values())


def align_schema(db, *, logger=None, load_modules=True) -> dict:
    """
    Bring the live database up to registered SQLAlchemy metadata.

    Returns ``{created_tables, added_columns, errors}``.
    """
    logger = logger or log
    if load_modules:
        _load_model_modules()
    created_tables: list[str] = []
    added_columns: list[str] = []
    errors: list[str] = []

    engine = db.engine
    dialect = engine.dialect
    metadata = db.metadata

    try:
        with engine.begin() as conn:
            try:
                conn.execute(text("SET SESSION lock_wait_timeout=8"))
            except SQLAlchemyError:
                pass
            insp = inspect(conn)
            present = _existing_tables(insp)

            for table in _iter_tables(metadata, logger):
                tname = table.name
                if tname.lower() not in present:
                    try:
                        table.create(bind=conn, checkfirst=True)
                        created_tables.append(tname)
                        present.add(tname.lower())
                        logger.info("schema align: created table %s", tname)
                    except SQLAlchemyError as exc:
                        msg = f"create {tname}: {exc}"
                        errors.append(msg)
                        logger.warning("schema align: %s", msg)
                    continue

                have = _existing_columns(insp, tname)
                for column in table.columns:
                    if column.name.lower() in have:
                        continue
                    ddl = _column_sql(column, dialect)
                    if not ddl:
                        continue
                    stmt = (
                        f"ALTER TABLE {_quote(tname, dialect)} ADD COLUMN {ddl}"
                    )
                    try:
                        conn.execute(text(stmt))
                        have.add(column.name.lower())
                        added_columns.append(f"{tname}.{column.name}")
                        logger.info("schema align: added column %s.%s", tname, column.name)
                    except SQLAlchemyError as exc:
                        msg = f"add {tname}.{column.name}: {exc}"
                        errors.append(msg)
                        logger.warning("schema align: %s", msg)
    except Exception as exc:
        errors.append(str(exc))
        logger.warning("schema align aborted: %s", exc)

    return {
        "created_tables": created_tables,
        "added_columns": added_columns,
        "errors": errors,
    }
