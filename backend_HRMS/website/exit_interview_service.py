"""Exit interview and rehire policy helpers."""
from __future__ import annotations

from datetime import date, timedelta
from typing import Optional

REHIRE_COOLDOWN_DAYS = 90
NON_REHIRE_EXIT_TYPES = frozenset({"terminated", "absconded"})


def default_rehire_eligible(exit_type: str) -> bool:
    return (exit_type or "").strip().lower() not in NON_REHIRE_EXIT_TYPES


def default_rehire_cooldown_until(last_working_day: date) -> date:
    return last_working_day + timedelta(days=REHIRE_COOLDOWN_DAYS)


def get_latest_archive_row(admin_id: int):
    from .models.Admin_models import EmployeeArchive

    return (
        EmployeeArchive.query.filter_by(admin_id=admin_id)
        .order_by(EmployeeArchive.id.desc())
        .first()
    )


def serialize_rehire_policy(admin_id: int) -> dict:
    row = get_latest_archive_row(admin_id)
    today = date.today()
    if not row:
        return {
            "rehire_eligible": True,
            "rehire_cooldown_until": None,
            "rehire_notes": None,
            "can_rejoin_now": True,
            "rehire_block_reason": None,
        }
    eligible = True if row.rehire_eligible is None else bool(row.rehire_eligible)
    cooldown = getattr(row, "rehire_cooldown_until", None)
    can_rejoin = eligible
    block_reason = None
    if not eligible:
        can_rejoin = False
        block_reason = "Marked not eligible for rehire"
    elif cooldown and today < cooldown:
        can_rejoin = False
        block_reason = f"Rehire cooldown until {cooldown.isoformat()}"
    return {
        "rehire_eligible": eligible,
        "rehire_cooldown_until": cooldown.isoformat() if cooldown else None,
        "rehire_notes": getattr(row, "rehire_notes", None),
        "can_rejoin_now": can_rejoin,
        "rehire_block_reason": block_reason,
    }


def get_or_create_exit_interview(admin_id: int):
    from . import db
    from .models.exit_interview import ExitInterview

    row = ExitInterview.query.filter_by(admin_id=admin_id).first()
    if row:
        return row
    row = ExitInterview(admin_id=admin_id)
    db.session.add(row)
    db.session.flush()
    return row


def submit_exit_interview(
    admin_id: int,
    *,
    overall_rating: int,
    would_recommend: bool,
    feedback: str,
    reason_for_leaving: str | None = None,
) -> dict:
    from . import db
    from .datetime_utils import utc_now
    from .models.exit_interview import ExitInterview

    if overall_rating < 1 or overall_rating > 5:
        raise ValueError("overall_rating must be between 1 and 5")
    text = (feedback or "").strip()
    if len(text) < 20:
        raise ValueError("feedback must be at least 20 characters")

    row = ExitInterview.query.filter_by(admin_id=admin_id).first()
    if not row:
        row = ExitInterview(admin_id=admin_id)
        db.session.add(row)
    row.overall_rating = int(overall_rating)
    row.would_recommend = bool(would_recommend)
    row.feedback = text
    row.reason_for_leaving = (reason_for_leaving or "").strip() or None
    row.submitted_at = utc_now()
    db.session.flush()
    return row.to_dict()


def update_hr_exit_interview(
    admin_id: int,
    *,
    hr_interview_completed: bool,
    hr_interview_date: date | None,
    hr_notes: str | None,
    hr_email: str,
) -> dict:
    from . import db

    row = get_or_create_exit_interview(admin_id)
    row.hr_interview_completed = bool(hr_interview_completed)
    row.hr_interview_date = hr_interview_date
    row.hr_notes = (hr_notes or "").strip() or None
    row.hr_completed_by = hr_email if hr_interview_completed else row.hr_completed_by
    db.session.flush()
    return row.to_dict()


def send_fnf_paid_documents_to_employee(settlement_id: int, *, created_by_admin_id: int | None = None) -> bool:
    """Email F&F settlement PDF via secure ex-employee document link."""
    from .fnf_settlement_pdf_service import generate_fnf_settlement_pdf
    from .ex_employee_share_service import create_ex_employee_doc_share_and_email
    from .models.Admin_models import Admin
    from .models.fnf_settlement import FnfSettlement
    from .offboarding_service import resolve_ex_employee_recipient_email

    row = FnfSettlement.query.get(settlement_id)
    if not row:
        return False
    admin = Admin.query.get(row.admin_id)
    if not admin:
        return False
    recipient = resolve_ex_employee_recipient_email(admin)
    if not recipient:
        return False
    try:
        pdf_buffer = generate_fnf_settlement_pdf(settlement_id)
        pdf_bytes = pdf_buffer.getvalue()
    except Exception:
        return False
    if not pdf_bytes:
        return False
    display_name = f"FnF-Settlement-{admin.emp_id or settlement_id}.pdf"
    ok, _msg, _payload = create_ex_employee_doc_share_and_email(
        recipient_email=recipient,
        files=[(display_name, pdf_bytes)],
        created_by_admin_id=created_by_admin_id,
    )
    return ok
