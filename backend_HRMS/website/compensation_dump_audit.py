"""Phase 7: scan dumps/SQL text for leftover identity or rupee JSON."""
from __future__ import annotations

import re

PAN_RE = re.compile(rb"(?<![A-Z0-9])[A-Z]{5}\d{4}[A-Z](?![A-Z0-9])")
AADHAAR_RE = re.compile(rb"(?<!\d)\d{12}(?!\d)")
SEALED_OK = b'"_sealed"'


def findings_in_bytes(data: bytes) -> list[str]:
    hits: list[str] = []
    if PAN_RE.search(data or b""):
        hits.append("pan_pattern")
    if AADHAAR_RE.search(data or b""):
        hits.append("aadhaar_pattern")
    return hits


def dump_is_clean(data: bytes | str) -> bool:
    raw = data.encode("utf-8", "replace") if isinstance(data, str) else (data or b"")
    return not findings_in_bytes(raw)
