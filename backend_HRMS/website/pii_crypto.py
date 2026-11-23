"""Phase 4: AES-256-GCM envelope for payout PII (bank/PAN/Aadhaar).

KEK from COMPENSATION_PII_KEK (urlsafe-b64 or hex, 32 bytes). Per-tenant DEK is
wrapped with that KEK. No KEK → plaintext passthrough (dev); production logs a gap.
AAD binds tenant + table + admin_id + column so ciphertext cannot be swapped.
"""
from __future__ import annotations

import base64
import logging
import os
import threading

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from .tenant_context import DEFAULT_TENANT_ID, tenant_id_for_admin

logger = logging.getLogger(__name__)

KEK_ENV = "COMPENSATION_PII_KEK"
KEK_PREV_ENV = "COMPENSATION_PII_KEK_PREVIOUS"
_DEK_CACHE: dict[int, bytes] = {}
_DEK_PREV_CACHE: dict[int, bytes] = {}
_CACHE_LOCK = threading.Lock()

UPLOAD_PII_FIELDS = ("aadhaar_number", "pan_number", "bank_account_number")
ACCOUNTS_PII_FIELDS = (
    "pan",
    "bank_details",
    "uan",
    "pf_account_number",
    "esi_number",
    "pran",
)


def _parse_kek(raw: str) -> bytes | None:
    raw = (raw or "").strip()
    if not raw:
        return None
    key = None
    try:
        key = base64.urlsafe_b64decode(raw + ("=" * ((4 - len(raw) % 4) % 4)))
    except Exception:
        key = None
    if key is None or len(key) != 32:
        try:
            key = bytes.fromhex(raw)
        except Exception:
            return None
    if len(key) != 32:
        return None
    return key


def load_kek() -> bytes | None:
    return _parse_kek(os.getenv(KEK_ENV) or "")


def load_previous_kek() -> bytes | None:
    return _parse_kek(os.getenv(KEK_PREV_ENV) or "")


def _iter_keks():
    seen = set()
    for key in (load_kek(), load_previous_kek()):
        if key and key not in seen:
            seen.add(key)
            yield key


def kek_is_ready() -> bool:
    return load_kek() is not None


def _aad(tenant_id: int, table: str, admin_id: int, column: str) -> bytes:
    return f"{int(tenant_id)}|{table}|admin:{int(admin_id)}|{column}".encode("utf-8")


def encrypt_bytes(dek: bytes, plaintext: bytes, aad: bytes) -> bytes:
    nonce = os.urandom(12)
    ct = AESGCM(dek).encrypt(nonce, plaintext, aad)
    return b"\x01" + nonce + ct


def decrypt_bytes(dek: bytes, blob: bytes, aad: bytes) -> bytes:
    if not blob or blob[0] != 1:
        raise ValueError("unknown pii blob version")
    nonce, ct = blob[1:13], blob[13:]
    return AESGCM(dek).decrypt(nonce, ct, aad)


def wrap_dek(kek: bytes, dek: bytes, tenant_id: int) -> bytes:
    return encrypt_bytes(kek, dek, f"tenant-dek:{int(tenant_id)}".encode("utf-8"))


def unwrap_dek(kek: bytes, blob: bytes, tenant_id: int) -> bytes:
    return decrypt_bytes(kek, blob, f"tenant-dek:{int(tenant_id)}".encode("utf-8"))


def unwrap_dek_any_kek(blob: bytes, tenant_id: int) -> bytes:
    last = None
    for kek in _iter_keks():
        try:
            return unwrap_dek(kek, blob, tenant_id)
        except (InvalidTag, ValueError) as exc:
            last = exc
    if last:
        raise last
    raise ValueError("no KEK configured")


def decrypt_with_deks(deks: list[bytes], blob: bytes, aad: bytes) -> bytes:
    last = None
    for dek in deks:
        if not dek:
            continue
        try:
            return decrypt_bytes(dek, blob, aad)
        except (InvalidTag, ValueError) as exc:
            last = exc
    if last:
        raise last
    raise ValueError("no DEK")


def clear_dek_cache(tenant_id: int | None = None) -> None:
    with _CACHE_LOCK:
        if tenant_id is None:
            _DEK_CACHE.clear()
            _DEK_PREV_CACHE.clear()
        else:
            tid = int(tenant_id)
            _DEK_CACHE.pop(tid, None)
            _DEK_PREV_CACHE.pop(tid, None)


def _key_row(tenant_id: int):
    from .models.tenant_crypto_key import TenantCryptoKey

    return TenantCryptoKey.query.filter_by(tenant_id=int(tenant_id)).first()


def tenant_crypto_revoked(tenant_id: int) -> bool:
    try:
        row = _key_row(tenant_id)
    except RuntimeError:
        return False
    return bool(row and row.revoked_at)


def tenant_deks_for_decrypt(tenant_id: int) -> list[bytes]:
    """Current DEK first, previous DEK during an in-flight rotation."""
    tid = int(tenant_id or DEFAULT_TENANT_ID)
    if tenant_crypto_revoked(tid):
        return []
    current = get_or_create_dek(tid)
    out = []
    if current:
        out.append(current)
    with _CACHE_LOCK:
        prev = _DEK_PREV_CACHE.get(tid)
    if prev:
        out.append(prev)
        return out
    try:
        row = _key_row(tid)
    except RuntimeError:
        return out
    if row and row.wrapped_dek_previous:
        try:
            prev = unwrap_dek_any_kek(bytes(row.wrapped_dek_previous), tid)
            with _CACHE_LOCK:
                _DEK_PREV_CACHE[tid] = prev
            out.append(prev)
        except (InvalidTag, ValueError):
            logger.critical("Previous DEK unwrap failed for tenant %s", tid)
    return out


def decrypt_with_tenant_deks(tenant_id: int, blob: bytes, aad: bytes) -> bytes:
    return decrypt_with_deks(tenant_deks_for_decrypt(tenant_id), blob, aad)


def get_or_create_dek(tenant_id: int) -> bytes | None:
    kek = load_kek()
    if kek is None:
        return None
    tid = int(tenant_id or DEFAULT_TENANT_ID)
    with _CACHE_LOCK:
        if tid in _DEK_CACHE:
            return _DEK_CACHE[tid]
    from . import db
    from .models.tenant_crypto_key import TenantCryptoKey

    row = TenantCryptoKey.query.filter_by(tenant_id=tid).first()
    if row and row.revoked_at:
        logger.critical("Compensation crypto revoked for tenant %s", tid)
        return None
    if row and row.wrapped_dek:
        try:
            dek = unwrap_dek_any_kek(bytes(row.wrapped_dek), tid)
        except (InvalidTag, ValueError):
            logger.critical("PII DEK unwrap failed for tenant %s", tid)
            raise
    else:
        dek = AESGCM.generate_key(bit_length=256)
        wrapped = wrap_dek(kek, dek, tid)
        if row:
            row.wrapped_dek = wrapped
        else:
            db.session.add(TenantCryptoKey(tenant_id=tid, wrapped_dek=wrapped, key_version=1))
    with _CACHE_LOCK:
        _DEK_CACHE[tid] = dek
    return dek


def last4_digits(value: str | None) -> str | None:
    digits = "".join(ch for ch in str(value or "") if ch.isdigit())
    if len(digits) < 4:
        return None
    return digits[-4:]


def last4_pan(value: str | None) -> str | None:
    s = "".join(ch for ch in str(value or "").upper() if ch.isalnum())
    if len(s) < 4:
        return None
    return s[-4:]


def pii_get(row, field: str) -> str | None:
    enc = getattr(row, f"{field}_enc", None)
    if enc:
        admin_id = getattr(row, "admin_id", None)
        if admin_id is None:
            return None
        tenant_id = _tenant_for_row(row)
        table = row.__tablename__
        try:
            return decrypt_with_tenant_deks(
                tenant_id, bytes(enc), _aad(tenant_id, table, int(admin_id), field)
            ).decode("utf-8")
        except (InvalidTag, ValueError, UnicodeDecodeError):
            logger.warning("PII decrypt failed table=%s field=%s admin_id=%s", table, field, admin_id)
            return None
    raw = getattr(row, field, None)
    return str(raw) if raw else None


def pii_set(row, field: str, value: str | None) -> None:
    text = (str(value).strip() if value is not None and str(value).strip() else None)
    admin_id = getattr(row, "admin_id", None)
    tenant_id = _tenant_for_row(row) if admin_id else None
    if admin_id and tenant_id and tenant_crypto_revoked(tenant_id):
        raise RuntimeError("Compensation crypto is revoked for this company; cannot store identity data.")
    dek = get_or_create_dek(tenant_id) if admin_id else None
    if dek is None or admin_id is None:
        enc = getattr(row, f"{field}_enc", None)
        if enc:
            setattr(row, field, None)
            return
        setattr(row, field, text)
        setattr(row, f"{field}_enc", None)
        _set_last4(row, field, text)
        return
    if text is None:
        setattr(row, field, None)
        setattr(row, f"{field}_enc", None)
        _set_last4(row, field, None)
        return
    blob = encrypt_bytes(
        dek,
        text.encode("utf-8"),
        _aad(_tenant_for_row(row), row.__tablename__, int(admin_id), field),
    )
    setattr(row, f"{field}_enc", blob)
    setattr(row, field, None)
    _set_last4(row, field, text)


def _set_last4(row, field: str, text: str | None) -> None:
    if field in ("bank_account_number", "bank_details"):
        if hasattr(row, "bank_account_last4"):
            row.bank_account_last4 = last4_digits(text)
    if field in ("pan", "pan_number") and hasattr(row, "pan_last4"):
        row.pan_last4 = last4_pan(text)


def _tenant_for_row(row) -> int:
    from .models.Admin_models import Admin

    admin_id = getattr(row, "admin_id", None)
    if admin_id:
        admin = Admin.query.get(admin_id)
        return tenant_id_for_admin(admin)
    return DEFAULT_TENANT_ID


def seal_model(row, fields) -> None:
    if row is None:
        return
    for field in fields:
        plain = getattr(row, field, None)
        enc = getattr(row, f"{field}_enc", None)
        if plain and not enc:
            pii_set(row, field, plain)
        elif plain and enc:
            setattr(row, field, None)


def register_pii_session_hooks(db) -> None:
    from sqlalchemy import event
    from sqlalchemy.orm import Session

    from .models.education import UploadDoc
    from .models.employee_accounts import EmployeeAccounts

    if getattr(db, "_pii_hooks_registered", False):
        return

    @event.listens_for(Session, "before_flush")
    def _seal_pii(session, _ctx, _instances):
        if not kek_is_ready():
            return
        for obj in list(session.new) + list(session.dirty):
            if isinstance(obj, UploadDoc):
                seal_model(obj, UPLOAD_PII_FIELDS)
            elif isinstance(obj, EmployeeAccounts):
                seal_model(obj, ACCOUNTS_PII_FIELDS)

    db._pii_hooks_registered = True


def ensure_pii_columns(engine, logger) -> None:
    from sqlalchemy import inspect, text

    dialect = engine.dialect.name
    blob = "BYTEA" if dialect == "postgresql" else "BLOB"
    specs = {
        "upload_docs": (
            ("aadhaar_number_enc", blob),
            ("pan_number_enc", blob),
            ("bank_account_number_enc", blob),
            ("bank_account_last4", "VARCHAR(4) NULL"),
            ("pan_last4", "VARCHAR(4) NULL"),
        ),
        "employee_accounts": (
            ("bank_details_enc", blob),
            ("bank_account_last4", "VARCHAR(4) NULL"),
            ("pan_enc", blob),
            ("pan_last4", "VARCHAR(4) NULL"),
            ("uan_enc", blob),
            ("pf_account_number_enc", blob),
            ("esi_number_enc", blob),
            ("pran_enc", blob),
        ),
    }
    try:
        insp = inspect(engine)
        tables = set(insp.get_table_names())
        for table, cols in specs.items():
            if table not in tables:
                continue
            existing = {c["name"] for c in insp.get_columns(table)}
            for name, col_type in cols:
                if name in existing:
                    continue
                stmt = (
                    text(f'ALTER TABLE "{table}" ADD COLUMN {name} {col_type}')
                    if dialect == "postgresql"
                    else text(f"ALTER TABLE {table} ADD COLUMN {name} {col_type}")
                )
                with engine.begin() as conn:
                    conn.execute(stmt)
                if logger:
                    logger.info("Added column %s.%s", table, name)
        from .models.tenant_crypto_key import TenantCryptoKey

        TenantCryptoKey.__table__.create(bind=engine, checkfirst=True)
        _ensure_tenant_crypto_rotation_columns(engine, dialect, logger)
    except Exception as exc:
        if logger:
            logger.warning("PII column ensure skipped: %s", exc)


def _ensure_tenant_crypto_rotation_columns(engine, dialect: str, logger) -> None:
    from sqlalchemy import inspect, text

    table = "tenant_crypto_keys"
    insp = inspect(engine)
    if table not in set(insp.get_table_names()):
        return
    existing = {c["name"] for c in insp.get_columns(table)}
    blob = "BYTEA" if dialect == "postgresql" else "BLOB"
    specs = (
        ("wrapped_dek_previous", f"{blob} NULL"),
        ("key_version", "INTEGER NOT NULL DEFAULT 1"),
        ("revoked_at", "TIMESTAMP NULL" if dialect == "postgresql" else "DATETIME NULL"),
    )
    for name, col_type in specs:
        if name in existing:
            continue
        stmt = (
            text(f'ALTER TABLE "{table}" ADD COLUMN {name} {col_type}')
            if dialect == "postgresql"
            else text(f"ALTER TABLE {table} ADD COLUMN {name} {col_type}")
        )
        with engine.begin() as conn:
            conn.execute(stmt)
        if logger:
            logger.info("Added column %s.%s", table, name)


def migrate_legacy_pii_plaintext(logger=None) -> int:
    """Seal leftover clear columns when KEK is present. Idempotent."""
    if not kek_is_ready():
        return 0
    from sqlalchemy import or_

    from . import db
    from .models.education import UploadDoc
    from .models.employee_accounts import EmployeeAccounts

    n = 0
    try:
        uq = UploadDoc.query.filter(
            or_(
                UploadDoc.aadhaar_number.isnot(None),
                UploadDoc.pan_number.isnot(None),
                UploadDoc.bank_account_number.isnot(None),
            )
        )
        for row in uq.yield_per(100):
            seal_model(row, UPLOAD_PII_FIELDS)
            n += 1
        aq = EmployeeAccounts.query.filter(
            or_(
                EmployeeAccounts.pan.isnot(None),
                EmployeeAccounts.bank_details.isnot(None),
                EmployeeAccounts.uan.isnot(None),
                EmployeeAccounts.pf_account_number.isnot(None),
                EmployeeAccounts.esi_number.isnot(None),
                EmployeeAccounts.pran.isnot(None),
            )
        )
        for row in aq.yield_per(100):
            seal_model(row, ACCOUNTS_PII_FIELDS)
            n += 1
        if n:
            db.session.commit()
            if logger:
                logger.info("PII sealed %s identity rows", n)
    except Exception as exc:
        db.session.rollback()
        if logger:
            logger.warning("PII plaintext migrate skipped: %s", exc)
        return 0
    return n
