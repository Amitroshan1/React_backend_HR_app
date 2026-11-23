"""Indian company identity format checks (pure functions, no Flask)."""
from __future__ import annotations

import re

PAN_RE = re.compile(r"^[A-Z]{5}[0-9]{4}[A-Z]$")
GSTIN_RE = re.compile(r"^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$")
_GSTIN_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"
CIN_RE = re.compile(r"^[UL][0-9]{5}[A-Z]{2}[0-9]{4}[A-Z]{3}[0-9]{6}$")
LLPIN_RE = re.compile(r"^[A-Z]{3}-[0-9]{4}$")

ENTITY_TYPES = (
    "pvt_ltd",
    "public_ltd",
    "opc",
    "llp",
    "partnership",
    "proprietorship",
    "other",
)

DOC_TYPES = (
    "coi",
    "gst_cert",
    "company_pan",
    "authorization",
    "cancelled_cheque",
)

ALLOWED_CONTENT_TYPES = frozenset({
    "application/pdf",
    "image/jpeg",
    "image/png",
})
ALLOWED_EXTENSIONS = frozenset({"pdf", "jpg", "jpeg", "png"})
MAX_FILE_BYTES = 8 * 1024 * 1024
MAX_FILES = 6

INVALID_LINK_MESSAGE = "This onboarding link is invalid or has expired."


def _clean_id(value) -> str:
    return re.sub(r"\s+", "", str(value or "")).upper()


def normalize_pan(value) -> str:
    return _clean_id(value)


def normalize_gstin(value) -> str:
    return _clean_id(value)


def normalize_cin(value) -> str:
    return _clean_id(value)


def normalize_llpin(value) -> str:
    raw = str(value or "").strip().upper().replace(" ", "")
    if re.match(r"^[A-Z]{3}[0-9]{4}$", raw):
        return f"{raw[:3]}-{raw[3:]}"
    return raw


def validate_pan(value) -> str | None:
    pan = normalize_pan(value)
    if not pan:
        return None
    if not PAN_RE.match(pan):
        raise ValueError("Enter a valid 10-character company PAN")
    return pan


def gstin_check_digit(first_fourteen: str) -> str:
    """GSTIN check digit (base-36 weighted sum over the first 14 characters)."""
    factor = 1
    total = 0
    for ch in (first_fourteen or "")[:14].upper():
        code = _GSTIN_CHARS.index(ch)
        prod = code * factor
        total += (prod // 36) + (prod % 36)
        factor = 2 if factor == 1 else 1
    return _GSTIN_CHARS[(36 - (total % 36)) % 36]


def make_gstin(state_code, pan, entity="1") -> str:
    """Build a checksum-valid GSTIN (no registry call)."""
    pan_n = normalize_pan(pan)
    entity_ch = str(entity or "1").strip().upper()[:1] or "1"
    body = f"{int(state_code):02d}{pan_n}{entity_ch}Z"
    return body + gstin_check_digit(body)


def gstin_checksum_ok(gstin: str) -> bool:
    raw = normalize_gstin(gstin)
    if len(raw) != 15:
        return False
    try:
        return gstin_check_digit(raw[:14]) == raw[14]
    except ValueError:
        return False


def validate_gstin(value) -> str | None:
    gstin = normalize_gstin(value)
    if not gstin:
        return None
    if not GSTIN_RE.match(gstin):
        raise ValueError("Enter a valid 15-character GSTIN")
    pan = gstin[2:12]
    if not PAN_RE.match(pan):
        raise ValueError("GSTIN must contain a valid PAN")
    if not gstin_checksum_ok(gstin):
        raise ValueError("GSTIN check digit is invalid")
    return gstin


def validate_cin(value) -> str | None:
    cin = normalize_cin(value)
    if not cin:
        return None
    if not CIN_RE.match(cin):
        raise ValueError("Enter a valid 21-character CIN")
    return cin


def validate_llpin(value) -> str | None:
    llpin = normalize_llpin(value)
    if not llpin:
        return None
    if not LLPIN_RE.match(llpin):
        raise ValueError("Enter a valid LLPIN (e.g. AAA-1234)")
    return llpin


def normalize_entity_type(value) -> str:
    raw = str(value or "").strip().lower().replace(" ", "_").replace("-", "_")
    aliases = {
        "private_limited": "pvt_ltd",
        "pvt": "pvt_ltd",
        "ltd": "pvt_ltd",
        "public": "public_ltd",
        "limited_liability_partnership": "llp",
        "sole_proprietor": "proprietorship",
        "prop": "proprietorship",
    }
    raw = aliases.get(raw, raw)
    if raw not in ENTITY_TYPES:
        raise ValueError("Select a valid entity type")
    return raw


def required_doc_types(entity_type: str, *, has_gstin: bool) -> tuple[str, ...]:
    entity = normalize_entity_type(entity_type)
    required = ["company_pan", "authorization"]
    if entity in ("pvt_ltd", "public_ltd", "opc", "llp", "partnership"):
        required.insert(0, "coi")
    if has_gstin:
        required.append("gst_cert")
    # unique, keep order
    seen = []
    for item in required:
        if item not in seen:
            seen.append(item)
    return tuple(seen)


def assert_identity_set(*, entity_type: str, pan, gstin, cin, llpin, gst_exempt_reason=""):
    entity = normalize_entity_type(entity_type)
    pan_n = validate_pan(pan)
    gstin_n = validate_gstin(gstin)
    cin_n = validate_cin(cin)
    llpin_n = validate_llpin(llpin)
    reason = str(gst_exempt_reason or "").strip()
    if not pan_n and not gstin_n and not cin_n and not llpin_n:
        raise ValueError("Provide at least one government ID: GSTIN, CIN/LLPIN, or PAN")
    if entity == "llp" and not llpin_n and not gstin_n and not pan_n:
        raise ValueError("LLP needs an LLPIN, GSTIN, or PAN")
    if entity in ("pvt_ltd", "public_ltd", "opc") and not cin_n and not gstin_n:
        raise ValueError("Companies need a CIN or GSTIN")
    if not gstin_n and not reason and entity != "other":
        raise ValueError("Enter GSTIN or a short reason if the entity is not GST-registered")
    if gstin_n and pan_n and gstin_n[2:12] != pan_n:
        raise ValueError("Company PAN must match the PAN inside GSTIN")
    return {
        "entity_type": entity,
        "pan": pan_n,
        "gstin": gstin_n,
        "cin": cin_n,
        "llpin": llpin_n,
        "gst_exempt_reason": reason[:200] if not gstin_n else "",
    }


def sniff_file_type(header: bytes, filename: str) -> str:
    name = (filename or "").rsplit(".", 1)
    ext = name[-1].lower() if len(name) == 2 else ""
    if ext not in ALLOWED_EXTENSIONS:
        raise ValueError("Upload PDF, JPG, or PNG only")
    head = header[:8] if header else b""
    if head.startswith(b"%PDF"):
        return "application/pdf"
    if head.startswith(b"\x89PNG"):
        return "image/png"
    if head[:2] == b"\xff\xd8":
        return "image/jpeg"
    raise ValueError("File content does not match PDF, JPG, or PNG")
