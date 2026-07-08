"""Compensation band CRUD and CTC validation."""
from __future__ import annotations

from . import db
from .models.compensation_band import CompensationBand
from .models.Admin_models import Admin
from .models.emp_detail_models import Employee


def list_bands(*, circle: str | None = None, emp_type: str | None = None) -> list[dict]:
    q = CompensationBand.query.order_by(
        CompensationBand.circle.asc(),
        CompensationBand.emp_type.asc(),
        CompensationBand.grade.asc(),
    )
    if circle:
        q = q.filter(CompensationBand.circle == circle.strip())
    if emp_type:
        q = q.filter(CompensationBand.emp_type == emp_type.strip())
    return [r.to_dict() for r in q.all()]


def upsert_band(data: dict, *, created_by: str) -> CompensationBand:
    circle = (data.get("circle") or "").strip()
    emp_type = (data.get("emp_type") or "").strip()
    grade = (data.get("grade") or "General").strip() or "General"
    if not circle or not emp_type:
        raise ValueError("circle and emp_type are required")
    min_ctc = float(data.get("min_annual_ctc") or 0)
    max_ctc = float(data.get("max_annual_ctc") or 0)
    if max_ctc and min_ctc and max_ctc < min_ctc:
        raise ValueError("max_annual_ctc must be >= min_annual_ctc")

    row = CompensationBand.query.filter_by(circle=circle, emp_type=emp_type, grade=grade).first()
    if not row:
        row = CompensationBand(circle=circle, emp_type=emp_type, grade=grade, created_by=created_by)
        db.session.add(row)
    row.min_annual_ctc = min_ctc
    row.mid_annual_ctc = float(data["mid_annual_ctc"]) if data.get("mid_annual_ctc") is not None else None
    row.max_annual_ctc = max_ctc
    row.notes = (data.get("notes") or "").strip() or None
    db.session.commit()
    return row


def _grade_for_admin(admin: Admin) -> str:
    emp = Employee.query.filter_by(admin_id=admin.id).first()
    designation = (emp.designation if emp else None) or ""
    return designation.strip() or "General"


def band_for_admin(admin: Admin) -> CompensationBand | None:
    if not admin:
        return None
    grade = _grade_for_admin(admin)
    circle = (admin.circle or "").strip()
    emp_type = (admin.emp_type or "").strip()
    if not circle or not emp_type:
        return None
    row = CompensationBand.query.filter_by(circle=circle, emp_type=emp_type, grade=grade).first()
    if row:
        return row
    return CompensationBand.query.filter_by(circle=circle, emp_type=emp_type, grade="General").first()


def validate_proposed_ctc(admin: Admin, proposed_annual_ctc: float) -> str | None:
    """Return error message if CTC is outside band; None if OK or no band."""
    band = band_for_admin(admin)
    if not band:
        return None
    ctc = float(proposed_annual_ctc)
    if band.min_annual_ctc and ctc < float(band.min_annual_ctc):
        return (
            f"Proposed CTC ₹{ctc:,.0f} is below band minimum "
            f"₹{float(band.min_annual_ctc):,.0f} ({band.grade})"
        )
    if band.max_annual_ctc and ctc > float(band.max_annual_ctc):
        return (
            f"Proposed CTC ₹{ctc:,.0f} exceeds band maximum "
            f"₹{float(band.max_annual_ctc):,.0f} ({band.grade})"
        )
    return None


def band_for_position(*, circle: str, emp_type: str, grade: str | None = None) -> CompensationBand | None:
    circle = (circle or "").strip()
    emp_type = (emp_type or "").strip()
    grade = (grade or "General").strip() or "General"
    if not circle or not emp_type:
        return None
    row = CompensationBand.query.filter_by(circle=circle, emp_type=emp_type, grade=grade).first()
    if row:
        return row
    return CompensationBand.query.filter_by(circle=circle, emp_type=emp_type, grade="General").first()


def validate_ctc_for_position(
    circle: str,
    emp_type: str,
    grade: str | None,
    proposed_annual_ctc: float,
) -> str | None:
    """Validate CTC against band without an Admin record (offers/signup)."""
    band = band_for_position(circle=circle, emp_type=emp_type, grade=grade)
    if not band:
        return None
    ctc = float(proposed_annual_ctc)
    if band.min_annual_ctc and ctc < float(band.min_annual_ctc):
        return (
            f"Annual CTC ₹{ctc:,.0f} is below band minimum "
            f"₹{float(band.min_annual_ctc):,.0f} ({band.grade})"
        )
    if band.max_annual_ctc and ctc > float(band.max_annual_ctc):
        return (
            f"Annual CTC ₹{ctc:,.0f} exceeds band maximum "
            f"₹{float(band.max_annual_ctc):,.0f} ({band.grade})"
        )
    return None


def _latest_performance_rating(admin_id: int) -> str:
    from .models.Performance import EmployeePerformance, ManagerReview
    from .models.merit_matrix import RATING_OPTIONS

    row = (
        db.session.query(ManagerReview.rating)
        .join(EmployeePerformance, ManagerReview.performance_id == EmployeePerformance.id)
        .filter(EmployeePerformance.admin_id == admin_id)
        .filter(ManagerReview.rating.isnot(None))
        .order_by(ManagerReview.reviewed_at.desc())
        .limit(1)
        .first()
    )
    if row and row[0]:
        rating = str(row[0]).strip()
        if rating in RATING_OPTIONS:
            return rating
    return "Good"


def band_hint_for_admin_id(admin_id: int) -> dict | None:
    admin = Admin.query.get(admin_id)
    if not admin:
        return None
    band = band_for_admin(admin)
    grade = _grade_for_admin(admin)
    hint = {"grade": grade, "band": band.to_dict() if band else None}
    try:
        from .models.ctc_breakup import CTCBreakup
        ctc_row = CTCBreakup.query.filter_by(admin_id=admin_id).first()
        current_ctc = None
        if ctc_row:
            current_ctc = getattr(ctc_row, "annual_ctc_computed", None) or getattr(ctc_row, "annual_ctc", None)
        if current_ctc:
            from .merit_matrix_service import suggest_ctc_range
            rating = _latest_performance_rating(admin_id)
            merit = suggest_ctc_range(
                circle=admin.circle or "",
                emp_type=admin.emp_type or "",
                grade=grade,
                current_annual_ctc=float(current_ctc),
                rating=rating,
            )
            if merit:
                hint["merit_suggestion"] = merit
                hint["performance_rating"] = rating
    except Exception:
        pass
    return hint
