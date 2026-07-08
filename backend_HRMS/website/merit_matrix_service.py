"""Merit matrix CRUD and CTC suggestion from rating + band."""
from __future__ import annotations

from . import db
from .models.merit_matrix import MeritMatrixEntry, RATING_OPTIONS
from .models.compensation_band import CompensationBand


def list_entries(*, circle: str | None = None, emp_type: str | None = None) -> list[dict]:
    q = MeritMatrixEntry.query.order_by(
        MeritMatrixEntry.circle.asc(),
        MeritMatrixEntry.emp_type.asc(),
        MeritMatrixEntry.rating.asc(),
    )
    if circle:
        q = q.filter(MeritMatrixEntry.circle == circle.strip())
    if emp_type:
        q = q.filter(MeritMatrixEntry.emp_type == emp_type.strip())
    return [r.to_dict() for r in q.all()]


def upsert_entry(data: dict, *, created_by: str) -> MeritMatrixEntry:
    circle = (data.get("circle") or "").strip()
    emp_type = (data.get("emp_type") or "").strip()
    rating = (data.get("rating") or "").strip()
    if not circle or not emp_type or not rating:
        raise ValueError("circle, emp_type, and rating are required")
    if rating not in RATING_OPTIONS:
        raise ValueError(f"rating must be one of: {', '.join(RATING_OPTIONS)}")
    pct_min = float(data.get("increment_pct_min") or 0)
    pct_max = float(data.get("increment_pct_max") or 0)
    if pct_max < pct_min:
        raise ValueError("increment_pct_max must be >= increment_pct_min")

    row = MeritMatrixEntry.query.filter_by(circle=circle, emp_type=emp_type, rating=rating).first()
    if not row:
        row = MeritMatrixEntry(circle=circle, emp_type=emp_type, rating=rating, created_by=created_by)
        db.session.add(row)
    row.increment_pct_min = pct_min
    row.increment_pct_max = pct_max
    row.notes = (data.get("notes") or "").strip() or None
    db.session.commit()
    return row


def entry_for_position(*, circle: str, emp_type: str, rating: str) -> MeritMatrixEntry | None:
    return MeritMatrixEntry.query.filter_by(
        circle=(circle or "").strip(),
        emp_type=(emp_type or "").strip(),
        rating=(rating or "").strip(),
    ).first()


def suggest_ctc_range(
    *,
    circle: str,
    emp_type: str,
    grade: str,
    current_annual_ctc: float | None,
    rating: str = "Good",
) -> dict | None:
    """Return suggested min/max CTC from band mid and merit % range."""
    if not current_annual_ctc:
        return None
    band = CompensationBand.query.filter_by(circle=circle.strip(), emp_type=emp_type.strip(), grade=(grade or "General").strip()).first()
    if not band:
        band = CompensationBand.query.filter_by(circle=circle.strip(), emp_type=emp_type.strip(), grade="General").first()
    entry = entry_for_position(circle=circle, emp_type=emp_type, rating=rating)
    if not entry:
        return None
    base = float(current_annual_ctc)
    return {
        "rating": rating,
        "increment_pct_min": float(entry.increment_pct_min),
        "increment_pct_max": float(entry.increment_pct_max),
        "suggested_min_ctc": round(base * (1 + entry.increment_pct_min / 100), 0),
        "suggested_max_ctc": round(base * (1 + entry.increment_pct_max / 100), 0),
        "band": band.to_dict() if band else None,
    }
