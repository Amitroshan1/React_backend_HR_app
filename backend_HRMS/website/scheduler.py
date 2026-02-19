"""
Daily HR jobs: probation reminder, compoff process, leave accrual.
Scheduled via APScheduler (no manual intervention).
"""
from datetime import datetime
from zoneinfo import ZoneInfo

# App reference set by __init__.py so the job runs inside app context
_app = None

IST = ZoneInfo("Asia/Kolkata")


def set_app(app):
    global _app
    _app = app


def run_daily_hr_jobs():
    """Run probation reminder, compoff process, and leave accrual for today (IST)."""
    if _app is None:
        return
    with _app.app_context():
        from . import db
        from .commands.probation import run_probation_reminder
        from .commands.compoff import run_compoff_process
        from .commands.leave_accrual import _run_leave_accrual_for_date

        today = datetime.now(IST).date()
        log = _app.logger

        try:
            run_probation_reminder(today)
        except Exception as e:
            log.exception("scheduler: probation-reminder failed: %s", e)

        try:
            run_compoff_process(today)
        except Exception as e:
            log.exception("scheduler: compoff-process failed: %s", e)

        try:
            _run_leave_accrual_for_date(today)
        except Exception as e:
            log.exception("scheduler: leave-accrual failed: %s", e)

        try:
            from .commands.leave_pending_reminder import run_leave_pending_reminder
            run_leave_pending_reminder(today)
        except Exception as e:
            log.exception("scheduler: leave-pending-reminder failed: %s", e)

        try:
            db.session.commit()
        except Exception as e:
            log.exception("scheduler: commit failed: %s", e)
            db.session.rollback()
