"""Versioned Indian statutory packs (EPFO / ESI / bonus). No live government scrape."""
from __future__ import annotations

import json
from calendar import monthrange
from datetime import date, datetime
from pathlib import Path

_PACKS_DIR = Path(__file__).resolve().parents[1] / "data" / "statutory_packs"

PF_CEILING_CUTOVER = date(2026, 9, 17)

_FALLBACKS = (
    {
        "id": "in_epfo_2014-09",
        "label": "EPFO wage ceiling ₹15,000 (from Sep 2014)",
        "effective_from": "2014-09-01",
        "effective_to": "2026-09-16",
        "source": "EPFO statutory wage ceiling (pre S.O. 5109(E))",
        "pf_wage_cap_monthly": 15000.0,
        "pf_rate": 12.0,
        "eps_rate": 8.33,
        "eps_contrib_max": 1250.0,
        "pf_admin_pct": 0.5,
        "edli_pct": 0.5,
        "esic_gross_cap": 21001.0,
        "esic_employee_pct": 0.75,
        "esic_employer_pct": 3.25,
        "statutory_bonus_wage_cap": 21000.0,
        "statutory_bonus_pct": 8.33,
    },
    {
        "id": "in_epfo_2026-09-17",
        "label": "EPFO wage ceiling ₹25,000 (from 17 Sep 2026)",
        "effective_from": "2026-09-17",
        "effective_to": None,
        "source": "S.O. 5109(E) dated 17 September 2026, Code on Social Security 2020",
        "pf_wage_cap_monthly": 25000.0,
        "pf_rate": 12.0,
        "eps_rate": 8.33,
        "eps_contrib_max": 2082.5,
        "pf_admin_pct": 0.5,
        "edli_pct": 0.5,
        "esic_gross_cap": 21001.0,
        "esic_employee_pct": 0.75,
        "esic_employer_pct": 3.25,
        "statutory_bonus_wage_cap": 21000.0,
        "statutory_bonus_pct": 8.33,
    },
)


def _parse_iso_date(value) -> date | None:
    if value is None or str(value).strip() == "":
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    s = str(value).strip()[:10]
    try:
        return date.fromisoformat(s)
    except ValueError:
        return None


def parse_as_of(value=None) -> date:
    """
    Resolve a calculation date.

    YYYY-MM (payroll month) uses the last day of that month so Sep 2026
    picks the post-17-Sep ceiling for monthly CTC.
    """
    if value is None or str(value).strip() == "":
        return date.today()
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    s = str(value).strip()
    if len(s) >= 10 and s[4] == "-" and s[7] == "-":
        parsed = _parse_iso_date(s[:10])
        if parsed:
            return parsed
    if len(s) >= 7 and s[4] == "-" and s[:4].isdigit() and s[5:7].isdigit():
        y = int(s[:4])
        m = int(s[5:7])
        if 1 <= m <= 12:
            return date(y, m, monthrange(y, m)[1])
    return date.today()


def _normalize_pack(raw: dict) -> dict:
    return {
        "id": str(raw.get("id") or ""),
        "label": str(raw.get("label") or raw.get("id") or ""),
        "effective_from": str(raw.get("effective_from") or ""),
        "effective_to": raw.get("effective_to"),
        "source": str(raw.get("source") or ""),
        "pf_wage_cap_monthly": float(raw.get("pf_wage_cap_monthly") or 15000),
        "pf_rate": float(raw.get("pf_rate") or 12),
        "eps_rate": float(raw.get("eps_rate") or 8.33),
        "eps_contrib_max": float(raw.get("eps_contrib_max") or 1250),
        "pf_admin_pct": float(raw.get("pf_admin_pct") or 0.5),
        "edli_pct": float(raw.get("edli_pct") or 0.5),
        "esic_gross_cap": float(raw.get("esic_gross_cap") or 21001),
        "esic_employee_pct": float(raw.get("esic_employee_pct") or 0.75),
        "esic_employer_pct": float(raw.get("esic_employer_pct") or 3.25),
        "statutory_bonus_wage_cap": float(raw.get("statutory_bonus_wage_cap") or 21000),
        "statutory_bonus_pct": float(raw.get("statutory_bonus_pct") or 8.33),
    }


def list_statutory_packs() -> list[dict]:
    packs = []
    if _PACKS_DIR.is_dir():
        for path in sorted(_PACKS_DIR.glob("*.json")):
            try:
                with open(path, encoding="utf-8") as fh:
                    data = json.load(fh)
                if isinstance(data, dict) and data.get("id"):
                    packs.append(_normalize_pack(data))
            except (json.JSONDecodeError, OSError, TypeError, ValueError):
                continue
    if not packs:
        packs = [_normalize_pack(p) for p in _FALLBACKS]
    packs.sort(key=lambda p: p.get("effective_from") or "")
    return packs


def pack_for_date(as_of=None) -> dict:
    day = parse_as_of(as_of)
    chosen = None
    for pack in list_statutory_packs():
        start = _parse_iso_date(pack.get("effective_from")) or date(2014, 9, 1)
        end = _parse_iso_date(pack.get("effective_to"))
        if start <= day and (end is None or day <= end):
            chosen = pack
    if chosen is None:
        packs = list_statutory_packs()
        chosen = packs[-1] if packs else _normalize_pack(_FALLBACKS[-1])
    return chosen


def current_pack() -> dict:
    return pack_for_date(date.today())


def pf_wage_cap_monthly(as_of=None, *, unrestricted: bool = False) -> float:
    if unrestricted:
        return float("inf")
    return float(pack_for_date(as_of)["pf_wage_cap_monthly"])


def eps_contrib_max(as_of=None) -> float:
    return float(pack_for_date(as_of)["eps_contrib_max"])


def epf_employee_rules(as_of=None) -> dict:
    pack = pack_for_date(as_of)
    cap = float(pack["pf_wage_cap_monthly"])
    rate = float(pack["pf_rate"])
    return {
        "mandatory_pct": rate,
        "basic_threshold": cap,
        "min_amount_if_above_threshold": round(cap * rate / 100.0, 2),
        "pf_wage_cap_monthly": cap,
        "eps_contrib_max": float(pack["eps_contrib_max"]),
        "pack_id": pack["id"],
        "pack_label": pack["label"],
        "effective_from": pack["effective_from"],
        "source": pack["source"],
    }


def statutory_public_payload(as_of=None) -> dict:
    pack = pack_for_date(as_of)
    epf = epf_employee_rules(as_of)
    return {
        "as_of": parse_as_of(as_of).isoformat(),
        "active_pack": pack,
        "packs": list_statutory_packs(),
        "epf": epf,
        "esic": {
            "gross_threshold": pack["esic_gross_cap"],
            "employee_pct": pack["esic_employee_pct"],
            "employer_pct": pack["esic_employer_pct"],
        },
        "cutover_pf_ceiling": PF_CEILING_CUTOVER.isoformat(),
    }
