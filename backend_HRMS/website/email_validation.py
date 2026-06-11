"""Validation for external recipient emails (assessment invites, ex-employee doc sharing)."""
import os
import re

EMAIL_FORMAT_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

_DEFAULT_ALLOWED_PERSONAL_EMAIL_DOMAINS = frozenset({
    "gmail.com",
    "googlemail.com",
    "outlook.com",
    "hotmail.com",
    "live.com",
    "msn.com",
    "yahoo.com",
    "yahoo.in",
    "yahoo.co.in",
    "ymail.com",
    "icloud.com",
    "me.com",
    "mac.com",
    "rediffmail.com",
    "protonmail.com",
    "proton.me",
    "aol.com",
    "zoho.com",
    "mail.com",
})


def _allowed_personal_email_domains():
    raw = (os.getenv("ALLOWED_RECIPIENT_EMAIL_DOMAINS") or "").strip()
    if not raw:
        return _DEFAULT_ALLOWED_PERSONAL_EMAIL_DOMAINS
    return frozenset(
        d.strip().lower().lstrip("@")
        for d in raw.split(",")
        if d.strip()
    )


def extract_email_domain(email: str) -> str:
    return (email or "").strip().lower().split("@")[-1]


def is_allowed_personal_email(email: str) -> bool:
    normalized = (email or "").strip().lower()
    if not EMAIL_FORMAT_RE.match(normalized):
        return False
    return extract_email_domain(normalized) in _allowed_personal_email_domains()


def personal_email_validation_error(email: str) -> str | None:
    normalized = (email or "").strip()
    if not normalized:
        return "Email is required."
    if not EMAIL_FORMAT_RE.match(normalized.lower()):
        return "Please enter a valid email address."
    if not is_allowed_personal_email(normalized):
        return "Please enter a valid email address."
    return None
