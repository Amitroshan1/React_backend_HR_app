"""
Punch + PunchSession rule:

- punch_sessions: detail (each in→out, repeat_reason, geo).
- punch: daily summary for reports (punch_date, roll-up in/out, today_work).

Employee flows in auth.py update sessions then call recompute_punch_aggregate.
HR manual edits call sync_punch_after_hr_manual_edit so both stay aligned.
"""
from datetime import datetime, timedelta

from . import db
from .models.attendance import Punch, PunchSession


def hms_to_seconds(hms):
    if not hms or not str(hms).strip():
        return 0
    parts = str(hms).strip().split(":")
    try:
        if len(parts) == 3:
            return int(parts[0]) * 3600 + int(parts[1]) * 60 + int(parts[2])
        if len(parts) == 2:
            return int(parts[0]) * 3600 + int(parts[1]) * 60
    except (TypeError, ValueError):
        return 0
    return 0


def seconds_to_hms_str(secs):
    secs = max(0, int(secs))
    h, rem = divmod(secs, 3600)
    m, s = divmod(rem, 60)
    return f"{h:d}:{m:02d}:{s:02d}"


def ensure_punch_sessions_backfill(punch):
    """Migrate legacy punch rows (no punch_sessions) into one segment row. Returns True if inserted."""
    if not punch or not punch.id:
        return False
    if PunchSession.query.filter_by(punch_id=punch.id).first():
        return False
    if not punch.punch_in:
        return False
    cin = punch.punch_in
    if not isinstance(cin, datetime):
        return False
    cout = punch.punch_out if isinstance(punch.punch_out, datetime) else None
    db.session.add(
        PunchSession(
            punch_id=punch.id,
            clock_in=cin,
            clock_out=cout,
            repeat_reason=None,
            is_wfh=bool(getattr(punch, "is_wfh", False)),
        )
    )
    return True


def recompute_punch_aggregate(punch):
    """Sync Punch.punch_in (earliest), punch_out (null if open else latest out), today_work (sum closed)."""
    if not punch or not punch.id:
        return
    sessions = (
        PunchSession.query.filter_by(punch_id=punch.id).order_by(PunchSession.clock_in.asc()).all()
    )
    if not sessions:
        return
    punch.punch_in = min(s.clock_in for s in sessions)
    closed = [s for s in sessions if s.clock_out]
    open_s = next((s for s in sessions if s.clock_out is None), None)
    total_secs = sum(int((s.clock_out - s.clock_in).total_seconds()) for s in closed)
    punch.today_work = seconds_to_hms_str(total_secs)
    if open_s:
        punch.punch_out = None
    elif closed:
        punch.punch_out = max(s.clock_out for s in closed)
    else:
        punch.punch_out = None


def open_punch_session_for_punch(punch_id):
    return PunchSession.query.filter_by(punch_id=punch_id, clock_out=None).first()


def open_punch_session_for_admin(admin_id):
    """
    Open segment for this employee on any calendar Punch row (night shift punch-out next calendar
    day still closes the session tied to shift-start punch_date).
    """
    if not admin_id:
        return None
    return (
        PunchSession.query.join(Punch, PunchSession.punch_id == Punch.id)
        .filter(Punch.admin_id == admin_id, PunchSession.clock_out.is_(None))
        .order_by(PunchSession.clock_in.desc())
        .first()
    )


def serialize_punch_sessions(punch_row):
    """Build JSON list for dashboard: each in→out segment with duration (closed) or is_open."""
    if not punch_row or not getattr(punch_row, "id", None):
        return []
    rows = (
        PunchSession.query.filter_by(punch_id=punch_row.id)
        .order_by(PunchSession.clock_in.asc())
        .all()
    )
    out = []
    for s in rows:
        dur = None
        if s.clock_out and s.clock_in:
            dur = seconds_to_hms_str(int((s.clock_out - s.clock_in).total_seconds()))
        out.append(
            {
                "id": s.id,
                "clock_in": s.clock_in.isoformat() if s.clock_in else None,
                "clock_out": s.clock_out.isoformat() if s.clock_out else None,
                "duration_hms": dur,
                "is_open": s.clock_out is None,
                "repeat_reason": (s.repeat_reason or "").strip() or None,
                "extended_hours_reason": (getattr(s, "extended_hours_reason", None) or "").strip()
                or None,
                "location_status": (getattr(s, "location_status", None) or "").strip() or None,
                "location_status_in": (getattr(s, "location_status_in", None) or "").strip() or None,
                "location_status_out": (getattr(s, "location_status_out", None) or "").strip() or None,
            }
        )
    return out


def sync_punch_after_hr_manual_edit(punch):
    """
    Replace all segments for this punch with one interval from punch.punch_in / punch.punch_out,
    then recompute roll-ups. If out time is earlier than in on the same calendar combine (night
    shift), extend clock_out by one day so duration stays positive (same as legacy HR math).
    """
    if not punch:
        return
    db.session.flush()
    if not punch.id:
        return
    PunchSession.query.filter_by(punch_id=punch.id).delete(synchronize_session=False)
    db.session.flush()
    cin = punch.punch_in
    if cin and isinstance(cin, datetime):
        cout = punch.punch_out if isinstance(getattr(punch, "punch_out", None), datetime) else None
        if cout is not None and cout < cin:
            cout = cout + timedelta(days=1)
            punch.punch_out = cout
        db.session.add(
            PunchSession(
                punch_id=punch.id,
                clock_in=cin,
                clock_out=cout,
                repeat_reason=None,
                is_wfh=False,
            )
        )
    recompute_punch_aggregate(punch)
