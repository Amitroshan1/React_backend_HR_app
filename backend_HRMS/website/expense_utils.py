"""Helpers for expense claim attachment paths (static files under uploads/expenses/)."""

CLAIM_EXPENSES_SUBDIR = "expenses"


def claim_attach_static_filename(stored_name):
    """
    Path segment for url_for('static', filename=...).
    Files on disk: website/static/uploads/expenses/<name>
    """
    if not stored_name:
        return None
    name = (stored_name or "").replace("\\", "/").strip().lstrip("/")
    if name.startswith(f"{CLAIM_EXPENSES_SUBDIR}/"):
        return f"uploads/{name}"
    return f"uploads/{CLAIM_EXPENSES_SUBDIR}/{name}"


def claim_attach_storage_name(basename):
    """Relative path stored in ExpenseLineItem.Attach_file (under uploads/expenses/)."""
    base = (basename or "").replace("\\", "/").strip().lstrip("/")
    if not base:
        return None
    if base.startswith(f"{CLAIM_EXPENSES_SUBDIR}/"):
        return base
    return f"{CLAIM_EXPENSES_SUBDIR}/{base}"
