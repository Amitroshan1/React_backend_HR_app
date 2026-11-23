"""Phase 5: encrypt CTC/payroll rupee columns into amount_blob (same tenant DEK as PII).

Python still sees floats on the instance (load unpack / after_flush restore).
SQL SUM of money columns is 0 when the KEK is on — finance uses payroll_finance_facts.
"""
from __future__ import annotations

import json
import logging

from sqlalchemy import event
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import set_committed_value

from .compensation_security import COMPENSATION_MONEY_TABLES
from .pii_crypto import decrypt_with_tenant_deks, encrypt_bytes, get_or_create_dek, kek_is_ready
from .tenant_context import DEFAULT_TENANT_ID, tenant_id_for_admin

logger = logging.getLogger(__name__)

CTC_MONEY_FIELDS = COMPENSATION_MONEY_TABLES["ctc_breakups"]
PAYROLL_MONEY_FIELDS = COMPENSATION_MONEY_TABLES["monthly_payrolls"]
LOAN_MONEY_FIELDS = COMPENSATION_MONEY_TABLES["employee_salary_loans"]
FNF_MONEY_FIELDS = COMPENSATION_MONEY_TABLES["fnf_settlements"]


def _tenant_for(row) -> int:
    from sqlalchemy.orm import object_session

    from .models.Admin_models import Admin

    admin_id = getattr(row, "admin_id", None)
    if not admin_id:
        return DEFAULT_TENANT_ID
    sess = object_session(row)
    admin = sess.get(Admin, admin_id) if sess is not None else None
    if admin is None:
        from . import db

        admin = db.session.get(Admin, admin_id)
    return tenant_id_for_admin(admin)


def _sql_cleared_money(row, name):
    """MySQL NOT NULL money columns cannot store NULL after sealing."""
    try:
        col = row.__mapper__.columns.get(name)
        if col is not None and not col.nullable:
            return 0
    except Exception:
        pass
    return None


def _aad(row, fields_key: str) -> bytes:
    tid = _tenant_for(row)
    table = row.__tablename__
    admin_id = int(getattr(row, "admin_id", 0) or 0)
    extra = ""
    if table == "monthly_payrolls":
        extra = f"|{getattr(row, 'year', '')}-{getattr(row, 'month_num', '')}"
    return f"{tid}|{table}|admin:{admin_id}{extra}|{fields_key}".encode("utf-8")


def _snapshot(row, fields) -> dict:
    out = {}
    for name in fields:
        val = getattr(row, name, None)
        if val is None:
            out[name] = None
        else:
            try:
                out[name] = float(val)
            except (TypeError, ValueError):
                out[name] = None
    return out


SEALED_JSON = {"_sealed": True}


def pack_amount_blob(row, fields) -> None:
    if getattr(row, "admin_id", None) is None:
        return
    if not kek_is_ready():
        if getattr(row, "amount_blob", None):
            for name in fields:
                setattr(row, name, _sql_cleared_money(row, name))
        return
    from .pii_crypto import tenant_crypto_revoked

    if tenant_crypto_revoked(_tenant_for(row)):
        raise RuntimeError("Compensation crypto is revoked for this company; cannot store amounts.")
    dek = get_or_create_dek(_tenant_for(row))
    if dek is None:
        return
    payload = _snapshot(row, fields)
    cached = getattr(row, "_vault_payload", None)
    if cached:
        for k, v in cached.items():
            if payload.get(k) is None and v is not None:
                payload[k] = v
    if all(v is None for v in payload.values()) and not getattr(row, "amount_blob", None):
        return
    blob = encrypt_bytes(dek, json.dumps(payload).encode("utf-8"), _aad(row, "amount_blob"))
    row.amount_blob = blob
    row._vault_payload = payload
    for name in fields:
        setattr(row, name, _sql_cleared_money(row, name))


def unpack_amount_blob(row, fields) -> None:
    blob = getattr(row, "amount_blob", None)
    if not blob:
        return
    if not kek_is_ready():
        logger.warning("amount_blob present but COMPENSATION_PII_KEK missing")
        return
    try:
        raw = decrypt_with_tenant_deks(_tenant_for(row), bytes(blob), _aad(row, "amount_blob"))
        payload = json.loads(raw.decode("utf-8"))
    except Exception:
        logger.warning("amount_blob decrypt failed table=%s id=%s", getattr(row, "__tablename__", "?"), getattr(row, "id", None))
        return
    row._vault_payload = payload
    for name in fields:
        if name in payload:
            try:
                set_committed_value(row, name, payload.get(name))
            except Exception:
                setattr(row, name, payload.get(name))


def pack_json_attr(row, attr: str) -> None:
    """Seal JSON compensation snapshots (revisions, change requests, F&F)."""
    if not hasattr(row, "json_blob"):
        return
    data = getattr(row, attr, None)
    if isinstance(data, dict) and data.get("_sealed"):
        data = getattr(row, "_json_cache", None)
    if not kek_is_ready():
        if getattr(row, "json_blob", None):
            setattr(row, attr, dict(SEALED_JSON))
        return
    from .pii_crypto import tenant_crypto_revoked

    tid = _tenant_for(row) if getattr(row, "admin_id", None) else int(getattr(row, "tenant_id", None) or DEFAULT_TENANT_ID)
    if tenant_crypto_revoked(tid):
        raise RuntimeError("Compensation crypto is revoked for this company; cannot store JSON snapshots.")
    dek = get_or_create_dek(tid)
    if dek is None:
        return
    if data is None:
        return
    payload = json.dumps(data, default=str).encode("utf-8")
    admin_id = int(getattr(row, "admin_id", 0) or 0)
    aad = f"{tid}|{row.__tablename__}|admin:{admin_id}|{attr}".encode("utf-8")
    row.json_blob = encrypt_bytes(dek, payload, aad)
    row._json_cache = data
    setattr(row, attr, dict(SEALED_JSON))


def unpack_json_attr(row, attr: str) -> None:
    blob = getattr(row, "json_blob", None)
    if not blob:
        return
    if not kek_is_ready():
        return
    tid = _tenant_for(row) if getattr(row, "admin_id", None) else int(getattr(row, "tenant_id", None) or DEFAULT_TENANT_ID)
    admin_id = int(getattr(row, "admin_id", 0) or 0)
    aad = f"{tid}|{row.__tablename__}|admin:{admin_id}|{attr}".encode("utf-8")
    try:
        raw = decrypt_with_tenant_deks(tid, bytes(blob), aad)
        data = json.loads(raw.decode("utf-8"))
    except Exception:
        logger.warning("json_blob decrypt failed table=%s", getattr(row, "__tablename__", "?"))
        return
    row._json_cache = data
    try:
        set_committed_value(row, attr, data)
    except Exception:
        setattr(row, attr, data)


def restore_json_attr(row, attr: str) -> None:
    data = getattr(row, "_json_cache", None)
    if data is None:
        return
    try:
        set_committed_value(row, attr, data)
    except Exception:
        setattr(row, attr, data)


def restore_payload(row, fields) -> None:
    payload = getattr(row, "_vault_payload", None)
    if not payload:
        return
    for name in fields:
        try:
            set_committed_value(row, name, payload.get(name))
        except Exception:
            setattr(row, name, payload.get(name))


def register_money_vault_hooks(db) -> None:
    if getattr(db, "_money_vault_hooks", False):
        return
    from .models.ctc_breakup import CTCBreakup
    from .models.ctc_breakup_revision import CTCBreakupRevision
    from .models.ctc_change_request import CTCChangeRequest
    from .models.employee_salary_loan import EmployeeSalaryLoan
    from .models.fnf_settlement import FnfSettlement
    from .models.monthly_payroll import MonthlyPayroll

    pairs = (
        (CTCBreakup, CTC_MONEY_FIELDS),
        (MonthlyPayroll, PAYROLL_MONEY_FIELDS),
        (EmployeeSalaryLoan, LOAN_MONEY_FIELDS),
        (FnfSettlement, FNF_MONEY_FIELDS),
    )
    for model, fields in pairs:
        def _mk_load(flds):
            def _load(target, _ctx):
                unpack_amount_blob(target, flds)
            return _load

        event.listen(model, "load", _mk_load(fields))

    event.listen(CTCBreakupRevision, "load", lambda t, c: unpack_json_attr(t, "snapshot"))
    event.listen(CTCChangeRequest, "load", lambda t, c: unpack_json_attr(t, "payload"))
    event.listen(FnfSettlement, "load", lambda t, c: unpack_json_attr(t, "snapshot"))

    @event.listens_for(Session, "before_flush")
    def _pack(session, _ctx, _instances):
        pending = session.info.setdefault("payroll_fact_keys", set())
        for obj in list(session.new) + list(session.dirty):
            if isinstance(obj, CTCBreakup):
                pack_amount_blob(obj, CTC_MONEY_FIELDS)
            elif isinstance(obj, MonthlyPayroll):
                pack_amount_blob(obj, PAYROLL_MONEY_FIELDS)
                pending.add((_tenant_for(obj), str(obj.year or ""), int(obj.month_num or 0)))
            elif isinstance(obj, EmployeeSalaryLoan):
                pack_amount_blob(obj, LOAN_MONEY_FIELDS)
            elif isinstance(obj, FnfSettlement):
                pack_amount_blob(obj, FNF_MONEY_FIELDS)
                pack_json_attr(obj, "snapshot")
            elif isinstance(obj, CTCBreakupRevision):
                pack_json_attr(obj, "snapshot")
            elif isinstance(obj, CTCChangeRequest):
                pack_json_attr(obj, "payload")

    @event.listens_for(Session, "after_flush")
    def _restore(session, _ctx):
        for obj in list(session.identity_map.values()):
            if isinstance(obj, CTCBreakup):
                restore_payload(obj, CTC_MONEY_FIELDS)
            elif isinstance(obj, MonthlyPayroll):
                restore_payload(obj, PAYROLL_MONEY_FIELDS)
            elif isinstance(obj, EmployeeSalaryLoan):
                restore_payload(obj, LOAN_MONEY_FIELDS)
            elif isinstance(obj, FnfSettlement):
                restore_payload(obj, FNF_MONEY_FIELDS)
                restore_json_attr(obj, "snapshot")
            elif isinstance(obj, CTCBreakupRevision):
                restore_json_attr(obj, "snapshot")
            elif isinstance(obj, CTCChangeRequest):
                restore_json_attr(obj, "payload")

    @event.listens_for(Session, "after_commit")
    def _facts(session):
        keys = session.info.pop("payroll_fact_keys", None)
        if not keys:
            return
        from .payroll_finance_facts import rebuild_month_facts

        for tenant_id, year, month_num in keys:
            if month_num:
                try:
                    rebuild_month_facts(tenant_id, year, month_num)
                except Exception:
                    logger.warning("finance facts rebuild failed tenant=%s %s-%s", tenant_id, year, month_num, exc_info=True)

    db._money_vault_hooks = True


def ensure_amount_blob_columns(engine, logger) -> None:
    from sqlalchemy import inspect, text

    dialect = engine.dialect.name
    blob = "BYTEA" if dialect == "postgresql" else "BLOB"
    tables = (
        "ctc_breakups",
        "monthly_payrolls",
        "employee_salary_loans",
        "fnf_settlements",
        "ctc_breakup_revisions",
        "ctc_change_requests",
    )
    try:
        insp = inspect(engine)
        have = set(insp.get_table_names())
        for table in tables:
            if table not in have:
                continue
            existing = {c["name"] for c in insp.get_columns(table)}
            col = "json_blob" if table in ("ctc_breakup_revisions", "ctc_change_requests") else "amount_blob"
            if table == "fnf_settlements":
                for extra in ("amount_blob", "json_blob"):
                    if extra in existing:
                        continue
                    stmt = (
                        text(f'ALTER TABLE "{table}" ADD COLUMN {extra} {blob}')
                        if dialect == "postgresql"
                        else text(f"ALTER TABLE {table} ADD COLUMN {extra} {blob}")
                    )
                    with engine.begin() as conn:
                        conn.execute(stmt)
                    if logger:
                        logger.info("Added column %s.%s", table, extra)
                    existing.add(extra)
                continue
            if col in existing:
                continue
            stmt = (
                text(f'ALTER TABLE "{table}" ADD COLUMN {col} {blob}')
                if dialect == "postgresql"
                else text(f"ALTER TABLE {table} ADD COLUMN {col} {blob}")
            )
            with engine.begin() as conn:
                conn.execute(stmt)
            if logger:
                logger.info("Added column %s.%s", table, col)
        if "fnf_settlements" in have:
            try:
                with engine.begin() as conn:
                    if dialect == "mysql":
                        conn.execute(text(
                            "ALTER TABLE fnf_settlements MODIFY COLUMN net_payable DECIMAL(14,2) NULL"
                        ))
                    elif dialect == "postgresql":
                        conn.execute(text('ALTER TABLE "fnf_settlements" ALTER COLUMN net_payable DROP NOT NULL'))
            except Exception as exc:
                if logger:
                    logger.warning("fnf net_payable nullable alter skipped: %s", exc)
        from .models.payroll_finance_fact import PayrollFinanceFact

        PayrollFinanceFact.__table__.create(bind=engine, checkfirst=True)
    except Exception as exc:
        if logger:
            logger.warning("amount_blob ensure skipped: %s", exc)


def migrate_legacy_amount_blobs(logger=None) -> int:
    if not kek_is_ready():
        return 0
    from . import db
    from .models.ctc_breakup import CTCBreakup
    from .models.employee_salary_loan import EmployeeSalaryLoan
    from .models.fnf_settlement import FnfSettlement
    from .models.ctc_breakup_revision import CTCBreakupRevision
    from .models.ctc_change_request import CTCChangeRequest
    from .models.monthly_payroll import MonthlyPayroll

    n = 0
    try:
        with db.session.no_autoflush:
            for model, fields in (
                (CTCBreakup, CTC_MONEY_FIELDS),
                (MonthlyPayroll, PAYROLL_MONEY_FIELDS),
                (EmployeeSalaryLoan, LOAN_MONEY_FIELDS),
                (FnfSettlement, FNF_MONEY_FIELDS),
            ):
                for row in model.query.filter(model.amount_blob.is_(None)).yield_per(50):
                    pack_amount_blob(row, fields)
                    restore_payload(row, fields)
                    n += 1
            for row in CTCBreakupRevision.query.filter(CTCBreakupRevision.json_blob.is_(None)).yield_per(50):
                pack_json_attr(row, "snapshot")
                restore_json_attr(row, "snapshot")
                n += 1
            for row in CTCChangeRequest.query.filter(CTCChangeRequest.json_blob.is_(None)).yield_per(50):
                pack_json_attr(row, "payload")
                restore_json_attr(row, "payload")
                n += 1
            for row in FnfSettlement.query.filter(FnfSettlement.json_blob.is_(None)).yield_per(50):
                pack_json_attr(row, "snapshot")
                restore_json_attr(row, "snapshot")
                n += 1
        if n:
            db.session.commit()
            if logger:
                logger.info("Encrypted amount_blob on %s compensation rows", n)
    except Exception as exc:
        db.session.rollback()
        if logger:
            logger.warning("amount_blob migrate skipped: %s", exc)
        return 0
    return n
