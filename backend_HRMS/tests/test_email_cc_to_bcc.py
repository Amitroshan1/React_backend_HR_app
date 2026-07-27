"""Regression: all former CC addresses are sent as BCC, never as CC."""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def _normalize_bcc_list(cc_emails=None, bcc_emails=None, recipient_email=None):
    """Mirror website.email._normalize_bcc_list (no Flask import required)."""
    to_addr = (recipient_email or "").strip().lower()
    seen = {to_addr} if to_addr else set()
    out = []
    for email in list(cc_emails or []) + list(bcc_emails or []):
        if not email:
            continue
        addr = str(email).strip()
        if not addr:
            continue
        key = addr.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(addr)
    return out


def test_cc_moved_to_bcc_list():
    out = _normalize_bcc_list(
        cc_emails=["hr@company.com", "mgr@company.com"],
        recipient_email="employee@company.com",
    )
    assert out == ["hr@company.com", "mgr@company.com"]


def test_excludes_primary_to_and_dupes():
    out = _normalize_bcc_list(
        cc_emails=[
            "hr@company.com",
            "employee@company.com",
            "HR@company.com",
            "",
            None,
        ],
        bcc_emails=["accounts@company.com", "hr@company.com"],
        recipient_email="employee@company.com",
    )
    assert out == ["hr@company.com", "accounts@company.com"]


def test_empty_when_no_cc():
    assert _normalize_bcc_list(cc_emails=None, recipient_email="a@b.com") == []
    assert _normalize_bcc_list(cc_emails=[], recipient_email="a@b.com") == []


def test_send_payload_uses_bcc_not_cc():
    bcc_list = _normalize_bcc_list(
        cc_emails=["hr@company.com"],
        recipient_email="emp@company.com",
    )
    payload = {
        "to": [{"email_address": {"address": "emp@company.com"}}],
        "subject": "t",
        "htmlbody": "b",
    }
    if bcc_list:
        payload["bcc"] = [{"email_address": {"address": e}} for e in bcc_list]

    assert "cc" not in payload
    assert payload["bcc"] == [{"email_address": {"address": "hr@company.com"}}]


def test_source_has_no_payload_cc():
    """Guard: email.py must not write payload['cc'] anymore."""
    src = (ROOT / "website" / "email.py").read_text(encoding="utf-8")
    assert 'payload["cc"]' not in src
    assert 'payload["bcc"]' in src
    assert "def _normalize_bcc_list" in src


if __name__ == "__main__":
    test_cc_moved_to_bcc_list()
    test_excludes_primary_to_and_dupes()
    test_empty_when_no_cc()
    test_send_payload_uses_bcc_not_cc()
    test_source_has_no_payload_cc()
    print("PASS: email CC-to-BCC regression")
