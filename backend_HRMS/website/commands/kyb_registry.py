"""GST / MCA registry checks that need no paid API key.

Live government lookup is not used (no scrape, no paid vendor). Local checks:
GSTIN check digit, CIN structure, PAN-inside-GSTIN, name similarity.
Optional KYB_REGISTRY_PROVIDER=mock for tests.
"""
from __future__ import annotations

import os
import re
from difflib import SequenceMatcher

from .kyb_identity import (
    gstin_checksum_ok,
    normalize_cin,
    normalize_gstin,
    normalize_pan,
    validate_cin,
)

_STATE_CODES = {f"{i:02d}" for i in range(1, 39)} | {"97"}


def _name_score(a: str, b: str) -> float:
    left = re.sub(r"[^a-z0-9]+", " ", (a or "").lower()).strip()
    right = re.sub(r"[^a-z0-9]+", " ", (b or "").lower()).strip()
    if not left or not right:
        return 0.0
    return round(SequenceMatcher(None, left, right).ratio(), 3)


def lookup_gstin(gstin: str, *, legal_name: str = "") -> dict:
    raw = normalize_gstin(gstin)
    if not raw:
        return {"attempted": False, "source": "local", "message": "No GSTIN"}
    checksum_ok = gstin_checksum_ok(raw)
    state = raw[:2] if len(raw) >= 2 else ""
    pan = raw[2:12] if len(raw) >= 12 else ""
    out = {
        "attempted": True,
        "source": "local_checksum",
        "gstin": raw,
        "checksum_ok": checksum_ok,
        "state_code": state,
        "state_code_ok": state in _STATE_CODES,
        "pan": pan,
        "live_status": None,
        "legal_name": None,
        "name_match": None,
        "message": (
            "GSTIN check digit is valid. Live GST registration status is not queried (no registry API configured)."
            if checksum_ok
            else "GSTIN check digit failed. This number is not a valid GSTIN."
        ),
    }
    if os.getenv("KYB_REGISTRY_PROVIDER", "").strip().lower() == "mock":
        out["source"] = "mock"
        out["live_status"] = "Active" if checksum_ok else "Invalid"
        out["legal_name"] = (legal_name or "").strip() or "MOCK COMPANY PRIVATE LIMITED"
        out["name_match"] = _name_score(legal_name, out["legal_name"]) if legal_name else 1.0
        out["message"] = "Mock GST registry (KYB_REGISTRY_PROVIDER=mock)."
    return out


def lookup_cin(cin: str) -> dict:
    raw = normalize_cin(cin)
    if not raw:
        return {"attempted": False, "source": "local", "message": "No CIN"}
    format_ok = True
    year_ok = False
    listing = raw[0] if raw else ""
    try:
        validate_cin(raw)
        year = int(raw[8:12])
        year_ok = 1950 <= year <= 2035
    except (TypeError, ValueError):
        format_ok = False
    out = {
        "attempted": True,
        "source": "local_format",
        "cin": raw,
        "format_ok": format_ok,
        "listing": "Listed" if listing == "L" else "Unlisted" if listing == "U" else None,
        "year": raw[8:12] if len(raw) >= 12 else None,
        "year_ok": year_ok,
        "live_status": None,
        "message": (
            "CIN format is valid. MCA company status is not queried (no registry API configured)."
            if format_ok and year_ok
            else "CIN is not a valid MCA company number."
        ),
    }
    if os.getenv("KYB_REGISTRY_PROVIDER", "").strip().lower() == "mock" and format_ok:
        out["source"] = "mock"
        out["live_status"] = "Active"
        out["message"] = "Mock MCA registry (KYB_REGISTRY_PROVIDER=mock)."
    return out


def enrich_registry(profile) -> dict:
    gstin = getattr(profile, "gstin", None) or ""
    cin = getattr(profile, "cin", None) or ""
    pan = normalize_pan(getattr(profile, "pan", None) or "")
    legal = getattr(profile, "legal_name", None) or ""
    trade = getattr(profile, "trade_name", None) or ""
    gst = lookup_gstin(gstin, legal_name=legal)
    mca = lookup_cin(cin)
    pan_gst_match = bool(gst.get("pan") and pan and gst["pan"] == pan)
    return {
        "provider": (os.getenv("KYB_REGISTRY_PROVIDER") or "local").strip().lower() or "local",
        "gst": gst,
        "mca": mca,
        "pan_matches_gstin": pan_gst_match if gstin and pan else None,
        "legal_vs_trade_name": _name_score(legal, trade) if legal and trade else None,
        "live_gst_queried": gst.get("source") == "mock",
        "live_mca_queried": mca.get("source") == "mock",
        "auto_approve_eligible": False,
    }
