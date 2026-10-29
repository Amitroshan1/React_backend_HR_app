"""
Per-company mailboxes for HRMS emails (shared-DB multi-tenancy).

Recipients (To / CC) come from ``tenants.mailbox_*``.
``.env`` is only a fallback for the default tenant when that column is empty.
Other companies never receive the platform inbox.
"""
from __future__ import annotations

from typing import Optional

from flask import current_app

from .tenant_context import DEFAULT_TENANT_ID, get_current_tenant_id

MAILBOX_CONFIG_COLUMNS = {
    "ZEPTO_CC_HR": "mailbox_hr",
    "EMAIL_HR": "mailbox_hr",
    "ZEPTO_CC_ACCOUNT": "mailbox_accounts",
    "EMAIL_ACCOUNTS": "mailbox_accounts",
    "ZEPTO_CC_FINANCE": "mailbox_finance",
    "EMAIL_FINANCE": "mailbox_finance",
    "ZEPTO_CC_IT": "mailbox_it",
    "EMAIL_IT": "mailbox_it",
    "ZEPTO_CC_INVENTORY": "mailbox_inventory",
    "EMAIL_INVENTORY": "mailbox_inventory",
    "EMAIL_ADMIN": "mailbox_admin",
}

MAILBOX_FEATURE = {
    "mailbox_hr": None,
    "mailbox_admin": None,
    "mailbox_accounts": "account_panel",
    "mailbox_finance": "finance_panel",
    "mailbox_it": "it_panel",
    "mailbox_inventory": "it_panel",
}


def mailbox_columns_for_plan(plan: Optional[str] = None) -> list[str]:
    from .plan_features import has_feature

    allowed = []
    for column, feature in MAILBOX_FEATURE.items():
        if not feature or has_feature(feature, plan):
            allowed.append(column)
    return allowed


def company_mailbox(key: str, tenant_id: Optional[int] = None) -> Optional[str]:
    """Mailbox for config ``key`` in one tenant (default: the current tenant)."""
    column = MAILBOX_CONFIG_COLUMNS[key]
    return tenant_mailbox(column, tenant_id)


def tenant_mailbox(column: str, tenant_id: Optional[int] = None) -> Optional[str]:
    """Stored department inbox, or .env fallback for the default tenant only."""
    tid = int(tenant_id) if tenant_id not in (None, "") else get_current_tenant_id()
    tid = DEFAULT_TENANT_ID if tid is None else int(tid)

    value = ""
    try:
        from . import db
        from .models.tenant import Tenant

        tenant = db.session.get(Tenant, tid)
        value = (getattr(tenant, column, None) or "").strip() if tenant else ""
    except Exception:
        value = ""
    if value:
        return value
    if tid == DEFAULT_TENANT_ID:
        env_val = env_value_for_column(column)
        if env_val:
            return env_val
    return None


def env_value_for_column(column: str) -> str:
    """First non-empty .env / app.config address mapped to this mailbox column."""
    import os

    for env_key, mapped in MAILBOX_CONFIG_COLUMNS.items():
        if mapped != column:
            continue
        env_val = ""
        try:
            env_val = (current_app.config.get(env_key) or "").strip()
        except Exception:
            env_val = ""
        if not env_val:
            env_val = (os.getenv(env_key) or "").strip()
        if env_val:
            return env_val
    return ""


def display_mailboxes(tenant) -> dict:
    """Values for the settings form: saved company inbox, else .env for tenant 1."""
    from .models.tenant import TENANT_MAILBOX_COLUMNS

    out = {}
    is_owner = tenant is not None and int(getattr(tenant, "id", 0) or 0) == DEFAULT_TENANT_ID
    for key in TENANT_MAILBOX_COLUMNS:
        stored = (getattr(tenant, key, None) or "").strip() if tenant else ""
        out[key] = stored or (env_value_for_column(key) if is_owner else "")
    return out
