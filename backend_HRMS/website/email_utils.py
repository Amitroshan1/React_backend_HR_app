"""Email address normalization and validation."""
from email_validator import EmailNotValidError, validate_email


def normalize_email_address(raw: str):
    """
    Validate and normalize an email address.
    Returns (normalized_email_or_none, error_message_or_none).
    """
    addr = (raw or "").strip()
    if not addr:
        return None, "Email is required."
    try:
        normalized = validate_email(addr, check_deliverability=False).normalized
        return normalized, None
    except EmailNotValidError:
        return None, "Please enter a valid email address (e.g. name@company.com)."
