"""Rebuild and read encrypted department payroll totals for Finance."""
from __future__ import annotations

import json

from . import db
from .models.Admin_models import Admin
from .models.monthly_payroll import MonthlyPayroll
from .models.payroll_finance_fact import PayrollFinanceFact
from .pii_crypto import decrypt_with_tenant_deks, encrypt_bytes, get_or_create_dek, kek_is_ready
from .tenant_context import DEFAULT_TENANT_ID


def _aad(tenant_id: int, year: str, month_num: int, circle: str, emp_type: str) -> bytes:
    return (
        f"{int(tenant_id)}|payroll_finance_facts|{year}-{int(month_num)}|{circle}|{emp_type}"
    ).encode("utf-8")


def _pack_totals(tenant_id, year, month_num, circle, emp_type, totals: dict) -> bytes | None:
    dek = get_or_create_dek(tenant_id)
    if dek is None:
        return json.dumps(totals).encode("utf-8")
    return encrypt_bytes(
        dek,
        json.dumps(totals).encode("utf-8"),
        _aad(tenant_id, year, month_num, circle, emp_type),
    )


def _unpack_totals(row: PayrollFinanceFact) -> dict:
    if not row.totals_blob:
        return {}
    raw = bytes(row.totals_blob)
    if kek_is_ready() and raw and raw[:1] == b"\x01":
        try:
            raw = decrypt_with_tenant_deks(
                row.tenant_id,
                raw,
                _aad(row.tenant_id, row.year, row.month_num, row.circle or "", row.emp_type or ""),
            )
        except Exception:
            return {}
    try:
        data = json.loads(raw.decode("utf-8"))
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def rebuild_month_facts(tenant_id: int, year: str, month_num: int) -> int:
    """Own Session so after_commit hooks are not stuck in a committed transaction."""
    from sqlalchemy.orm import Session as SASession

    tid = int(tenant_id or DEFAULT_TENANT_ID)
    year_s = str(year)
    month = int(month_num)
    s = SASession(bind=db.engine)
    try:
        return _rebuild_month_facts_on(s, tid, year_s, month)
    finally:
        s.close()


def _rebuild_month_facts_on(s, tid: int, year_s: str, month: int) -> int:
    rows = (
        s.query(MonthlyPayroll, Admin)
        .join(Admin, Admin.id == MonthlyPayroll.admin_id)
        .filter(
            Admin.tenant_id == tid,
            MonthlyPayroll.year == year_s,
            MonthlyPayroll.month_num == month,
        )
        .all()
    )
    buckets: dict[tuple[str, str], dict] = {}
    for payroll, admin in rows:
        circle = (admin.circle or "").strip() or ""
        emp_type = (admin.emp_type or "").strip() or "Not assigned"
        key = (circle, emp_type)
        b = buckets.setdefault(
            key,
            {"headcount": 0, "gross": 0.0, "net": 0.0, "epf": 0.0, "tds": 0.0},
        )
        b["headcount"] += 1
        b["gross"] += float(payroll.gross_salary_for_month or 0)
        b["net"] += float(payroll.net_salary_final or 0)
        b["epf"] += float(payroll.epf_final or 0)
        b["tds"] += float(payroll.tds_final or 0)

    s.query(PayrollFinanceFact).filter_by(tenant_id=tid, year=year_s, month_num=month).delete()
    n = 0
    for (circle, emp_type), totals in buckets.items():
        blob = _pack_totals(tid, year_s, month, circle, emp_type, totals)
        s.add(
            PayrollFinanceFact(
                tenant_id=tid,
                year=year_s,
                month_num=month,
                circle=circle,
                emp_type=emp_type,
                headcount=int(totals["headcount"]),
                totals_blob=blob,
            )
        )
        n += 1
    s.commit()
    return n


def month_department_totals(tenant_id: int, year: str, month_num: int) -> list[dict]:
    tid = int(tenant_id or DEFAULT_TENANT_ID)
    facts = PayrollFinanceFact.query.filter_by(
        tenant_id=tid, year=str(year), month_num=int(month_num)
    ).all()
    if facts:
        out = []
        for row in facts:
            t = _unpack_totals(row)
            out.append(
                {
                    "department": row.emp_type or "Not assigned",
                    "circle": row.circle or "",
                    "employees": int(row.headcount or t.get("headcount") or 0),
                    "gross": float(t.get("gross") or 0),
                    "net": float(t.get("net") or 0),
                }
            )
        return out
    rows = (
        db.session.query(MonthlyPayroll, Admin)
        .join(Admin, Admin.id == MonthlyPayroll.admin_id)
        .filter(
            Admin.tenant_id == tid,
            MonthlyPayroll.year == str(year),
            MonthlyPayroll.month_num == int(month_num),
        )
        .all()
    )
    grouped: dict[str, dict] = {}
    for payroll, admin in rows:
        dept = (admin.emp_type if admin else None) or "Not assigned"
        bucket = grouped.setdefault(dept, {"department": dept, "employees": 0, "gross": 0.0, "net": 0.0})
        bucket["employees"] += 1
        bucket["gross"] += float(payroll.gross_salary_for_month or 0)
        bucket["net"] += float(payroll.net_salary_final or 0)
    return list(grouped.values())
