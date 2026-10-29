"""
Per-company Admin approval switches (Phase follow-up).

Every toggle starts **on** so behaviour is unchanged until an Admin turns one off.
``general`` and ``leave_unlock`` always need Admin (cannot be switched off).
Org Admins always bypass (same as today's leave on-behalf path).
"""
from __future__ import annotations

from typing import Optional

_NAMESPACE = "approval"

# Toggleable kinds. True = must wait for Admin.
_DEFAULTS = {
    "signup": True,
    "exit": True,
    "rehire": True,
    "profile_change": True,
    "leave_on_behalf": True,
    "leave_update": True,
    "wfh_update": True,
    "probation": True,
    # When HR applies immediately because a switch is off, also email Admin.
    "notify_admin_on_bypass": False,
}

# Probation on-role / extend / reject always needs Admin (employee mail only after approve).
_ALWAYS_REQUIRED = frozenset({"general", "leave_unlock", "probation"})
_BOOL_KEYS = tuple(_DEFAULTS.keys())

SWITCH_META = (
    {
        "key": "signup",
        "label": "New employee signup",
        "risk": "Off means HR can create logins and set offer salaries without Admin review.",
    },
    {
        "key": "exit",
        "label": "Employee exit",
        "risk": "Off means HR can end access immediately without Admin review.",
    },
    {
        "key": "rehire",
        "label": "Employee rehire",
        "risk": "Off means HR can restore exited employees without Admin review.",
    },
    {
        "key": "profile_change",
        "label": "Department / circle / designation / employment status",
        "risk": "Off means HR can change these fields immediately.",
    },
    {
        "key": "leave_on_behalf",
        "label": "Leave applied by HR",
        "risk": "Off means HR leave-on-behalf is saved immediately.",
    },
    {
        "key": "leave_update",
        "label": "Leave change by HR",
        "risk": "Off means HR leave edits are saved immediately.",
    },
    {
        "key": "wfh_update",
        "label": "WFH change by HR",
        "risk": "Off means HR WFH edits are saved immediately.",
    },
    {
        "key": "notify_admin_on_bypass",
        "label": "Email Admin when HR applies without approval",
        "risk": "When on, Admin still gets a notice even if the switch above is off.",
    },
)


def _company_store():
    try:
        from . import company_settings
    except Exception:
        return None
    return company_settings if company_settings.available() else None


def load_approval_settings(tenant_id=None) -> dict:
    store = _company_store()
    if store is not None:
        tid = store.settings_tenant_id(tenant_id)
        saved = store.stored_settings(_NAMESPACE, tid)
        if saved is not None:
            return {**_DEFAULTS, **{k: bool(saved.get(k, _DEFAULTS[k])) for k in _BOOL_KEYS}}
        if tid != store.DEFAULT_TENANT_ID:
            return dict(_DEFAULTS)
    return dict(_DEFAULTS)


def save_approval_settings(updates: dict, tenant_id=None, *, admin_id=None) -> dict:
    current = load_approval_settings(tenant_id)
    for key in _BOOL_KEYS:
        if key in updates:
            current[key] = bool(updates[key])
    store = _company_store()
    if store is None:
        raise RuntimeError("Approval settings can only be saved inside the app")
    store.save_settings(_NAMESPACE, store.settings_tenant_id(tenant_id), current, admin_id=admin_id)
    return current


def settings_payload(tenant_id=None) -> dict:
    current = load_approval_settings(tenant_id)
    return {
        "settings": current,
        "switches": [
            {
                **meta,
                "value": bool(current.get(meta["key"], _DEFAULTS.get(meta["key"], True))),
                "always_required": False,
            }
            for meta in SWITCH_META
        ],
        "always_required": sorted(_ALWAYS_REQUIRED),
    }


def approval_required(kind: str, *, tenant_id=None) -> bool:
    """
    True when this action must create a pending Admin request.

    Org Admins always bypass. ``general`` / ``leave_unlock`` always require approval.
    """
    key = (kind or "").strip()
    if key in _ALWAYS_REQUIRED:
        return True
    try:
        from .plan_features import is_org_admin

        if is_org_admin():
            return False
    except Exception:
        pass
    settings = load_approval_settings(tenant_id)
    if key not in _DEFAULTS:
        return True
    if key == "notify_admin_on_bypass":
        return False
    return bool(settings.get(key, True))


def notify_admin_on_bypass(tenant_id=None) -> bool:
    return bool(load_approval_settings(tenant_id).get("notify_admin_on_bypass"))


def maybe_notify_bypass(kind: str, summary: str, *, tenant_id=None) -> None:
    """Best-effort notice when HR applied a change because the switch was off."""
    if not notify_admin_on_bypass(tenant_id):
        return
    try:
        from flask import current_app

        from .company_mailbox import company_mailbox
        from .email import send_email_via_zeptomail

        to_addr = (company_mailbox("EMAIL_ADMIN") or company_mailbox("ZEPTO_CC_HR") or "").strip()
        sender = (current_app.config.get("ZEPTO_SENDER_EMAIL") or "").strip()
        if not to_addr or not sender:
            return
        send_email_via_zeptomail(
            sender_email=sender,
            subject=f"HR applied without Admin approval: {kind}",
            body=f"<p>{summary}</p><p>This happened because the Admin approval switch for "
            f"<strong>{kind}</strong> is off.</p>",
            recipient_email=to_addr,
        )
    except Exception:
        try:
            from flask import current_app

            current_app.logger.warning("approval bypass notify failed for %s", kind, exc_info=True)
        except Exception:
            pass
