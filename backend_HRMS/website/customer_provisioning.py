"""
LEGACY — silo (database-per-company) provisioning.

Primary architecture is shared-DB SaaS (docs/SHARED_DB_MULTI_TENANCY.md).
This module remains for dedicated-hosting exceptions only.

Requires BOTH:
  SILO_PROVISION_LEGACY=1   (API gate in Admin.py)
  PROVISION_ENABLED=1       (and optionally PROVISION_MYSQL_*)

Capabilities when legacy is on:
  - Create MySQL database `hrms_<slug>`
  - Apply schema (SQLAlchemy create_all on tenant DB)
  - Seed first company Super Admin
  - Create uploads folder
  - Generate customer .env template (secrets never stored in registry)

Env (master, legacy only):
  SILO_PROVISION_LEGACY=1
  PROVISION_ENABLED=1
  PROVISION_MYSQL_HOST / PORT / USER / PASSWORD
      (optional; when missing → dry-run: artifacts only, no CREATE DATABASE)
  PROVISION_UPLOADS_ROOT=/var/hrms/uploads   (optional)
  PROVISION_ARTIFACTS_DIR=/var/hrms/artifacts (optional; write .env file)
  PROVISION_BASE_DOMAIN=solviotec.com        (optional; suggest https://{slug}.domain)
"""
from __future__ import annotations

import json
import logging
import os
import re
import secrets
import string
from datetime import date, datetime
from typing import Any, Optional
from urllib.parse import quote_plus, urlparse

from flask import current_app
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from . import db
from .datetime_utils import utc_now
from .models.deployed_customer import (
    DeployedCustomer,
    suggest_database_name,
)

logger = logging.getLogger(__name__)

# Tables that belong on vendor master only — skip on customer DBs.
_VENDOR_ONLY_TABLES = frozenset({"deployed_customers", "tenants"})


class ProvisionError(Exception):
    """User-facing provisioning failure."""

    def __init__(self, message: str, *, status_code: int = 400):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def provision_enabled() -> bool:
    """True when silo provision may run (caller must also check SILO_PROVISION_LEGACY)."""
    raw = (os.getenv("PROVISION_ENABLED") or "").strip().lower()
    if raw in ("0", "false", "no", "off"):
        return False
    if raw in ("1", "true", "yes", "on"):
        return True
    # Default: never auto-enable — silo is legacy.
    return False


def _mysql_admin_config() -> Optional[dict]:
    host = (os.getenv("PROVISION_MYSQL_HOST") or "").strip()
    user = (os.getenv("PROVISION_MYSQL_USER") or "").strip()
    password = os.getenv("PROVISION_MYSQL_PASSWORD")
    if not host or not user or password is None:
        return None
    port = (os.getenv("PROVISION_MYSQL_PORT") or "3306").strip() or "3306"
    return {
        "host": host,
        "port": port,
        "user": user,
        "password": password,
    }


def _safe_db_name(name: str) -> str:
    n = (name or "").strip()
    if not re.fullmatch(r"[A-Za-z0-9_]{1,64}", n):
        raise ProvisionError(
            "Database name must be 1–64 letters, numbers, or underscores"
        )
    if not n.lower().startswith("hrms_"):
        raise ProvisionError("Database name must start with hrms_")
    return n


def _master_database_name() -> Optional[str]:
    uri = (os.getenv("DATABASE_URI") or "").strip()
    if not uri:
        try:
            uri = (current_app.config.get("SQLALCHEMY_DATABASE_URI") or "").strip()
        except Exception:
            uri = ""
    if not uri:
        return None
    try:
        # mysql+pymysql://user:pass@host:3306/dbname
        path = urlparse(uri.replace("mysql+pymysql://", "mysql://", 1)).path or ""
        name = path.lstrip("/").split("?")[0]
        return name or None
    except Exception:
        return None


def _tenant_uri(db_name: str, cfg: dict) -> str:
    user = quote_plus(cfg["user"])
    password = quote_plus(cfg["password"])
    return (
        f"mysql+pymysql://{user}:{password}@{cfg['host']}:{cfg['port']}/{db_name}"
        f"?charset=utf8mb4"
    )


def _admin_server_uri(cfg: dict) -> str:
    user = quote_plus(cfg["user"])
    password = quote_plus(cfg["password"])
    return f"mysql+pymysql://{user}:{password}@{cfg['host']}:{cfg['port']}/?charset=utf8mb4"


def _gen_secret(nbytes: int = 32) -> str:
    return secrets.token_hex(nbytes)


def _gen_password(length: int = 14) -> str:
    alphabet = string.ascii_letters + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(length))


def suggest_app_url(customer: DeployedCustomer) -> str:
    if (customer.app_url or "").strip():
        return customer.app_url.strip()
    domain = (os.getenv("PROVISION_BASE_DOMAIN") or "").strip().lstrip(".")
    slug = (customer.slug or "company").replace("_", "-")
    if domain:
        return f"https://{slug}.{domain}"
    return ""


def build_env_template(
    customer: DeployedCustomer,
    *,
    database_uri: Optional[str] = None,
    secret_key: Optional[str] = None,
    jwt_secret: Optional[str] = None,
    uploads_root: Optional[str] = None,
) -> str:
    """Generate a ready-to-use backend .env for the customer instance."""
    plan = (customer.plan or "essential").lower()
    base_url = suggest_app_url(customer) or "https://hr.customer.example.com"
    db_name = customer.database_name or suggest_database_name(
        customer.company_name, slug=customer.slug
    )
    uri = database_uri or f"mysql+pymysql://USER:PASSWORD@localhost/{db_name}"
    uploads = uploads_root or f"/var/www/hrms/{customer.slug or 'customer'}/uploads"
    sk = secret_key or _gen_secret()
    jk = jwt_secret or _gen_secret()
    lines = [
        f"# HRMS customer instance — {customer.company_name}",
        f"# Generated {datetime.now().strftime('%Y-%m-%d %H:%M')} UTC (Phase 2 provision)",
        f"# Plan: {plan} | Slug: {customer.slug or ''}",
        "",
        f"SECRET_KEY={sk}",
        f"JWT_SECRET_KEY={jk}",
        f"DATABASE_URI={uri}",
        f"BASE_URL={base_url}",
        f"CORS_ORIGINS={base_url}",
        f"CUSTOMER_PLAN={plan}",
        "SHOW_DEPLOYMENT_GUIDE=0",
        "RUN_DB_CREATE_ALL=1",
        f"UPLOADS_ROOT={uploads}",
        "",
        "# Copy ZEPTO_* / EMAIL_* from your mail provider as needed",
        "# ZEPTO_API_KEY=",
        "# ZEPTO_BASE_URL=https://api.zeptomail.in/v1.1/email",
        "# ZEPTO_SENDER_EMAIL=",
        "# EMAIL_HR=",
        "",
    ]
    return "\n".join(lines)


def _create_database(db_name: str, cfg: dict) -> None:
    engine = create_engine(_admin_server_uri(cfg), pool_pre_ping=True)
    try:
        with engine.begin() as conn:
            conn.execute(
                text(
                    f"CREATE DATABASE IF NOT EXISTS `{db_name}` "
                    "CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
                )
            )
    finally:
        engine.dispose()


def _apply_schema(tenant_uri: str) -> int:
    """Create application tables on the tenant DB. Returns table count applied."""
    # Models are already registered on metadata by create_app() at process start.
    engine = create_engine(tenant_uri, pool_pre_ping=True)
    try:
        tables = [
            t
            for t in db.Model.metadata.sorted_tables
            if t.name not in _VENDOR_ONLY_TABLES
        ]
        if not tables:
            raise ProvisionError(
                "No ORM tables registered — restart the app and retry provision",
                status_code=500,
            )
        db.Model.metadata.create_all(bind=engine, tables=tables)
        return len(tables)
    finally:
        engine.dispose()


def _seed_company_admin(
    tenant_uri: str,
    *,
    email: str,
    first_name: str,
    password: str,
    emp_id: str = "ADM0001",
) -> dict:
    from .models.Admin_models import Admin

    engine = create_engine(tenant_uri, pool_pre_ping=True)
    Session = sessionmaker(bind=engine)
    session = Session()
    try:
        existing = session.query(Admin).filter(Admin.email == email).first()
        if existing:
            return {
                "email": existing.email,
                "emp_id": existing.emp_id,
                "created": False,
                "message": "Admin already existed — password not rotated",
            }
        admin = Admin(
            email=email,
            first_name=first_name or "Company Admin",
            emp_id=emp_id,
            emp_type="Super Admin",
            is_active=True,
            is_exited=False,
            doj=date.today(),
        )
        admin.set_password(password)
        session.add(admin)
        session.commit()
        return {
            "email": email,
            "emp_id": emp_id,
            "first_name": admin.first_name,
            "created": True,
        }
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
        engine.dispose()


def _ensure_uploads_dir(path: str) -> None:
    os.makedirs(path, exist_ok=True)


def _write_artifact(slug: str, filename: str, content: str) -> Optional[str]:
    root = (os.getenv("PROVISION_ARTIFACTS_DIR") or "").strip()
    if not root:
        return None
    folder = os.path.join(root, slug or "customer")
    os.makedirs(folder, exist_ok=True)
    path = os.path.join(folder, filename)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(content)
    return path


def _append_provision_log(customer: DeployedCustomer, entry: dict) -> None:
    """Store a short JSON log on the customer notes trail (non-destructive prefix)."""
    stamp = utc_now().isoformat(timespec="seconds")
    line = f"[provision {stamp}] {json.dumps(entry, default=str)}"
    prev = (customer.notes or "").strip()
    # Keep last ~4k chars of notes.
    merged = f"{line}\n{prev}".strip() if prev else line
    customer.notes = merged[:4000]


def provision_customer(
    customer: DeployedCustomer,
    *,
    create_database: bool = True,
    create_schema: bool = True,
    seed_admin: bool = True,
    create_uploads: bool = True,
    mark_active: bool = False,
    admin_email: Optional[str] = None,
    admin_name: Optional[str] = None,
    dry_run: Optional[bool] = None,
) -> dict[str, Any]:
    """
    Provision artifacts (+ optional live MySQL) for one DeployedCustomer.

    Returns a dict safe to return to Super Admin (includes one-time seed password).
    """
    if not provision_enabled():
        raise ProvisionError("Provisioning is disabled on this instance", status_code=403)

    status = (customer.status or "").lower()
    if status == "cancelled":
        raise ProvisionError("Cannot provision a cancelled company — set status to provisioning first")
    if status == "suspended":
        raise ProvisionError("Company is suspended — activate or set to provisioning first")

    db_name = _safe_db_name(
        customer.database_name
        or suggest_database_name(customer.company_name, slug=customer.slug)
    )
    customer.database_name = db_name

    master_db = _master_database_name()
    if master_db and master_db.lower() == db_name.lower():
        raise ProvisionError(
            f"Refusing to provision into the master database ({master_db})"
        )

    mysql_cfg = _mysql_admin_config()
    if dry_run is None:
        dry_run = mysql_cfg is None

    steps: list[dict] = []
    secret_key = _gen_secret()
    jwt_secret = _gen_secret()
    seed_password = _gen_password() if seed_admin else None
    email = (admin_email or customer.contact_email or "").strip().lower()
    if seed_admin and not email:
        raise ProvisionError(
            "Contact email (or admin_email) is required to seed the company admin"
        )

    uploads_root_base = (os.getenv("PROVISION_UPLOADS_ROOT") or "").strip()
    uploads_path = None
    if uploads_root_base:
        uploads_path = os.path.join(uploads_root_base, customer.slug or db_name)

    if not (customer.app_url or "").strip():
        suggested = suggest_app_url(customer)
        if suggested:
            customer.app_url = suggested

    tenant_uri = None
    if mysql_cfg and not dry_run:
        tenant_uri = _tenant_uri(db_name, mysql_cfg)

    # --- Create database ---
    if create_database:
        if dry_run or not mysql_cfg:
            steps.append(
                {
                    "id": "database",
                    "ok": True,
                    "dry_run": True,
                    "message": f"Would CREATE DATABASE `{db_name}` (set PROVISION_MYSQL_* for live create)",
                }
            )
        else:
            try:
                _create_database(db_name, mysql_cfg)
                steps.append(
                    {
                        "id": "database",
                        "ok": True,
                        "message": f"Created database `{db_name}` (or already existed)",
                    }
                )
            except Exception as e:
                logger.exception("PROVISION_CREATE_DB_FAILED db=%s", db_name)
                raise ProvisionError(f"Failed to create database: {e}", status_code=500)

    # --- Schema ---
    if create_schema:
        if dry_run or not tenant_uri:
            steps.append(
                {
                    "id": "schema",
                    "ok": True,
                    "dry_run": True,
                    "message": "Would apply HRMS schema via create_all on tenant DB",
                }
            )
        else:
            try:
                n = _apply_schema(tenant_uri)
                steps.append(
                    {
                        "id": "schema",
                        "ok": True,
                        "message": f"Applied schema ({n} tables)",
                    }
                )
            except Exception as e:
                logger.exception("PROVISION_SCHEMA_FAILED db=%s", db_name)
                raise ProvisionError(f"Failed to apply schema: {e}", status_code=500)

    # --- Seed admin ---
    seed_info = None
    if seed_admin:
        if dry_run or not tenant_uri:
            steps.append(
                {
                    "id": "seed_admin",
                    "ok": True,
                    "dry_run": True,
                    "message": f"Would seed Super Admin {email}",
                }
            )
            seed_info = {
                "email": email,
                "password": seed_password,
                "emp_id": "ADM0001",
                "created": False,
                "dry_run": True,
            }
        else:
            try:
                seed_info = _seed_company_admin(
                    tenant_uri,
                    email=email,
                    first_name=admin_name or customer.company_name.split()[0],
                    password=seed_password,
                )
                seed_info["password"] = seed_password if seed_info.get("created") else None
                steps.append(
                    {
                        "id": "seed_admin",
                        "ok": True,
                        "message": (
                            "Seeded Super Admin"
                            if seed_info.get("created")
                            else "Admin already present"
                        ),
                    }
                )
            except Exception as e:
                logger.exception("PROVISION_SEED_FAILED db=%s", db_name)
                raise ProvisionError(f"Failed to seed admin: {e}", status_code=500)

    # --- Uploads ---
    if create_uploads:
        if not uploads_path:
            steps.append(
                {
                    "id": "uploads",
                    "ok": True,
                    "dry_run": True,
                    "message": "Set PROVISION_UPLOADS_ROOT to auto-create uploads folder",
                }
            )
        else:
            try:
                _ensure_uploads_dir(uploads_path)
                steps.append(
                    {
                        "id": "uploads",
                        "ok": True,
                        "message": f"Uploads folder ready: {uploads_path}",
                    }
                )
            except Exception as e:
                raise ProvisionError(f"Failed to create uploads dir: {e}", status_code=500)

    env_body = build_env_template(
        customer,
        database_uri=tenant_uri,
        secret_key=secret_key,
        jwt_secret=jwt_secret,
        uploads_root=uploads_path,
    )
    artifact_path = _write_artifact(customer.slug or db_name, ".env", env_body)
    steps.append(
        {
            "id": "env",
            "ok": True,
            "message": (
                f"Wrote {artifact_path}"
                if artifact_path
                else "Generated .env content (download from response)"
            ),
            "artifact_path": artifact_path,
        }
    )

    if mark_active and not dry_run and create_database and create_schema:
        customer.status = "active"
        if not customer.go_live_date:
            customer.go_live_date = date.today()
        steps.append({"id": "status", "ok": True, "message": "Marked Active"})
    elif (customer.status or "").lower() == "provisioning":
        steps.append(
            {
                "id": "status",
                "ok": True,
                "message": "Left as Provisioning — Activate when the app URL is live",
            }
        )

    summary = {
        "dry_run": bool(dry_run),
        "database_name": db_name,
        "app_url": customer.app_url or "",
        "ok_steps": sum(1 for s in steps if s.get("ok")),
        "failed": False,
    }
    _append_provision_log(customer, summary)
    db.session.commit()

    return {
        "success": True,
        "phase": 2,
        "dry_run": bool(dry_run),
        "customer": customer.to_dict(),
        "steps": steps,
        "env_file": env_body,
        "env_filename": f"{customer.slug or db_name}.env",
        "seed_admin": seed_info,
        "next_steps": [
            "Deploy the same codebase to the customer server (or container)",
            "Place the generated .env in backend_HRMS/.env on that instance",
            "Point DNS / reverse proxy to the instance BASE_URL",
            "Build frontend and serve dist/; proxy /api to backend",
            "Log in as the seeded Super Admin and configure HR master data",
            "Mark the company Active in the registry when go-live is confirmed",
        ],
        "message": (
            "Dry-run complete — configure PROVISION_MYSQL_* for live database create"
            if dry_run
            else "Provisioning completed"
        ),
    }


def env_template_only(customer: DeployedCustomer) -> dict[str, Any]:
    """GET helper: generate .env without mutating infrastructure."""
    db_name = customer.database_name or suggest_database_name(
        customer.company_name, slug=customer.slug
    )
    if not customer.database_name:
        customer.database_name = db_name
        db.session.commit()
    body = build_env_template(customer)
    return {
        "success": True,
        "env_file": body,
        "env_filename": f"{customer.slug or db_name}.env",
        "customer": customer.to_dict(),
    }
