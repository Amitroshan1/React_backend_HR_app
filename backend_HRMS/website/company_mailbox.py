"""
Per-company mailboxes for HRMS emails (shared-DB multi-tenancy, rollout step 9).

Emails used to read HR / Accounts / IT / Administration addresses straight from
``.env``, so every company's notifications went to the platform company's
inboxes. ``company_mailbox(key)`` resolves the same config keys per tenant:

- the tenant's ``tenants.mailbox_*`` column when set;
- otherwise the ``.env`` value, for the default tenant only;
- otherwise None: another company's mail never falls back to the platform inbox.
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
    "ZEPTO_CC_IT": "mailbox_it",
    "EMAIL_IT": "mailbox_it",
    "EMAIL_ADMIN": "mailbox_admin",
}


def company_mailbox(key: str, tenant_id: Optional[int] = None) -> Optional[str]:
    """Mailbox for config ``key`` in one tenant (default: the current tenant)."""
    column = MAILBOX_CONFIG_COLUMNS[key]
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
        return current_app.config.get(key)
    return None
