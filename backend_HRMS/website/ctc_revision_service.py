"""CTC revision snapshots and payroll-month resolution."""
from __future__ import annotations

import calendar
import json
from datetime import date, datetime

from . import db
from .models.ctc_breakup import CTCBreakup
from .models.ctc_breakup_revision import CTCBreakupRevision


def snapshot_from_row(row: CTCBreakup) -> dict:
    data = row.to_dict()
    data["effective_from"] = (
        row.effective_from.isoformat() if getattr(row, "effective_from", None) else None
    )
    return data


def save_ctc_revision(
    *,
    admin_id: int,
    effective_from: date,
    snapshot: dict,
    note: str | None = None,
    created_by_admin_id: int | None = None,
) -> CTCBreakupRevision:
    rev = CTCBreakupRevision(
        admin_id=admin_id,
        effective_from=effective_from,
        snapshot=snapshot,
        note=(note or "").strip() or None,
        created_by_admin_id=created_by_admin_id,
    )
    db.session.add(rev)
    return rev


def list_ctc_revisions(admin_id: int) -> list[dict]:
    rows = (
        CTCBreakupRevision.query.filter_by(admin_id=admin_id)
        .order_by(CTCBreakupRevision.effective_from.desc(), CTCBreakupRevision.id.desc())
        .all()
    )
    return [r.to_dict() for r in rows]


def resolve_ctc_snapshot_for_month(admin_id: int, year: int, month_num: int) -> dict | None:
    """CTC snapshot effective on the last day of the given payroll month."""
    last_day = calendar.monthrange(int(year), int(month_num))[1]
    target = date(int(year), int(month_num), last_day)

    rev = (
        CTCBreakupRevision.query.filter_by(admin_id=admin_id)
        .filter(CTCBreakupRevision.effective_from <= target)
        .order_by(CTCBreakupRevision.effective_from.desc(), CTCBreakupRevision.id.desc())
        .first()
    )
    if rev and rev.snapshot:
        return dict(rev.snapshot)

    row = CTCBreakup.query.filter_by(admin_id=admin_id).first()
    if not row:
        return None
    eff = getattr(row, "effective_from", None)
    if eff is None or eff <= target:
        return snapshot_from_row(row)
    return None


def previous_revision_before(admin_id: int, effective_from: date) -> dict | None:
    rev = (
        CTCBreakupRevision.query.filter_by(admin_id=admin_id)
        .filter(CTCBreakupRevision.effective_from < effective_from)
        .order_by(CTCBreakupRevision.effective_from.desc(), CTCBreakupRevision.id.desc())
        .first()
    )
    if rev and rev.snapshot:
        return dict(rev.snapshot)
    row = CTCBreakup.query.filter_by(admin_id=admin_id).first()
    if row and float(row.gross_salary or 0) > 0:
        return snapshot_from_row(row)
    return None


def parse_effective_from(val) -> date:
    if val is None:
        return date.today()
    if isinstance(val, date) and not isinstance(val, datetime):
        return val
    if isinstance(val, datetime):
        return val.date()
    s = str(val).strip()[:10]
    try:
        return date.fromisoformat(s)
    except ValueError:
        return date.today()
