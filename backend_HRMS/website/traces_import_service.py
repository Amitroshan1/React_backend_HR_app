"""TRACES / manual Form 16 Part A data import (CSV)."""
from __future__ import annotations

import csv
import io
from typing import Any

from .models.Admin_models import Admin
from .models.news_feed import Form16
from . import db


# Common TRACES / TDS column aliases (case-insensitive)
_COLUMN_ALIASES = {
    "pan": ("pan", "employee pan", "deductee pan", "pan of employee"),
    "emp_id": ("emp_id", "employee id", "employee code", "emp id"),
    "financial_year": ("financial_year", "fy", "assessment year", "financial year"),
    "tds_deducted": ("tds_deducted", "tds", "tds deducted", "tax deducted", "total tds", "tds deposited"),
    "taxable_income": ("taxable_income", "taxable income", "income chargeable"),
    "annual_tax": ("annual_tax", "tax payable", "total tax"),
    "gross_salary": ("gross_salary", "gross", "gross salary", "salary paid"),
}


def _normalize_header(h: str) -> str:
    return (h or "").strip().lower().replace("_", " ")


def _map_headers(fieldnames: list[str] | None) -> dict[str, str]:
    if not fieldnames:
        return {}
    normalized = {_normalize_header(h): h for h in fieldnames if h}
    out: dict[str, str] = {}
    for key, aliases in _COLUMN_ALIASES.items():
        for alias in aliases:
            if alias in normalized:
                out[key] = normalized[alias]
                break
    return out


def _parse_float(val: Any) -> float | None:
    if val is None or val == "":
        return None
    try:
        return float(str(val).replace(",", "").strip())
    except (TypeError, ValueError):
        return None


def parse_traces_csv(content: bytes | str) -> list[dict]:
    """Parse CSV rows into normalized Form 16 figure dicts."""
    text = content.decode("utf-8-sig") if isinstance(content, bytes) else content
    reader = csv.DictReader(io.StringIO(text))
    header_map = _map_headers(reader.fieldnames)
    if "pan" not in header_map and "emp_id" not in header_map:
        raise ValueError(
            "CSV must include PAN or Employee ID column. "
            f"Found headers: {reader.fieldnames}"
        )

    rows = []
    for i, raw in enumerate(reader, start=2):
        pan = (raw.get(header_map.get("pan", ""), "") or "").strip().upper()
        emp_id = (raw.get(header_map.get("emp_id", ""), "") or "").strip()
        fy = (raw.get(header_map.get("financial_year", ""), "") or "").strip()
        if not pan and not emp_id:
            continue
        rows.append({
            "row_number": i,
            "pan": pan or None,
            "emp_id": emp_id or None,
            "financial_year": fy or None,
            "parsed_gross_salary": _parse_float(raw.get(header_map.get("gross_salary", ""))),
            "parsed_tds_deducted": _parse_float(raw.get(header_map.get("tds_deducted", ""))),
            "parsed_taxable_income": _parse_float(raw.get(header_map.get("taxable_income", ""))),
            "parsed_annual_tax": _parse_float(raw.get(header_map.get("annual_tax", ""))),
        })
    if not rows:
        raise ValueError("No data rows found in CSV")
    return rows


def _resolve_admin(row: dict) -> Admin | None:
    if row.get("emp_id"):
        admin = Admin.query.filter_by(emp_id=row["emp_id"]).first()
        if admin:
            return admin
    if row.get("pan"):
        from .models.employee_accounts import EmployeeAccounts
        acct = EmployeeAccounts.query.filter(
            EmployeeAccounts.pan.ilike(row["pan"])
        ).first()
        if acct and acct.admin_id:
            return Admin.query.get(acct.admin_id)
    return None


def import_traces_rows(
    rows: list[dict],
    *,
    financial_year: str,
    data_source: str = "traces",
) -> dict:
    """Attach parsed figures to latest Form16 upload per employee or create metadata-only row."""
    imported = 0
    skipped = 0
    errors: list[str] = []

    for row in rows:
        admin = _resolve_admin(row)
        if not admin:
            skipped += 1
            errors.append(f"Row {row.get('row_number')}: employee not found")
            continue

        fy = row.get("financial_year") or financial_year
        existing = (
            Form16.query.filter_by(admin_id=admin.id, financial_year=fy)
            .order_by(Form16.id.desc())
            .first()
        )
        if existing:
            rec = existing
        else:
            rec = Form16(
                admin_id=admin.id,
                financial_year=fy,
                file_path="",
                data_source=data_source,
            )
            db.session.add(rec)

        if row.get("parsed_gross_salary") is not None:
            rec.parsed_gross_salary = row["parsed_gross_salary"]
        if row.get("parsed_tds_deducted") is not None:
            rec.parsed_tds_deducted = row["parsed_tds_deducted"]
        if row.get("parsed_taxable_income") is not None:
            rec.parsed_taxable_income = row["parsed_taxable_income"]
        if row.get("parsed_annual_tax") is not None:
            rec.parsed_annual_tax = row["parsed_annual_tax"]
        rec.data_source = data_source
        imported += 1

    db.session.commit()
    return {"imported": imported, "skipped": skipped, "errors": errors[:50]}
