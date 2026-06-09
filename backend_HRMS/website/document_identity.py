"""Validation helpers for employee identity / bank document metadata."""
import re


def digits_only(value, max_len=None):
    s = re.sub(r"\D", "", str(value or ""))
    if max_len is not None:
        return s[:max_len]
    return s


def normalize_aadhaar(value):
    return digits_only(value, 12)


def normalize_pan(value):
    return str(value or "").strip().upper()[:10]


def normalize_ifsc(value):
    return str(value or "").strip().upper()[:11]


def validate_aadhaar(value):
    n = normalize_aadhaar(value)
    return len(n) == 12 and n.isdigit()


def validate_pan(value):
    return bool(re.match(r"^[A-Z]{5}[0-9]{4}[A-Z]$", normalize_pan(value)))


def validate_ifsc(value):
    return bool(re.match(r"^[A-Z]{4}0[A-Z0-9]{6}$", normalize_ifsc(value)))


def validate_bank_account(value):
    s = digits_only(value, 18)
    return 9 <= len(s) <= 18


def normalize_bank_branch_code(value):
    return str(value or "").strip().upper()[:20]


def validate_bank_branch_code(value):
    code = normalize_bank_branch_code(value)
    return 2 <= len(code) <= 20 and code.replace(" ", "").isalnum()


def mask_aadhaar(value):
    n = normalize_aadhaar(value)
    if len(n) < 4:
        return "—"
    return f"XXXX-XXXX-{n[-4:]}"


def mask_pan(value):
    p = normalize_pan(value)
    if len(p) < 4:
        return "—"
    return f"XXXXX{p[-4:]}" if len(p) == 10 else "—"


def mask_bank_account(value):
    s = digits_only(value, 18)
    if len(s) < 4:
        return "—"
    return f"{'X' * (len(s) - 4)}{s[-4:]}"
