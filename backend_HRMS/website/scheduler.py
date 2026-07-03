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
            from .Human_resource import purge_expired_assessment_recordings

            purged = purge_expired_assessment_recordings()
            if purged:
                log.info("scheduler: purged %s expired assessment recording(s)", purged)
        except Exception as e:
            log.exception("scheduler: assessment-recording-purge failed: %s", e)

        try:
            from .offboarding_service import run_lwd_deactivation_job

            deactivated = run_lwd_deactivation_job(today)
            if deactivated:
                log.info("scheduler: LWD deactivation disabled login for %s employee(s)", deactivated)
        except Exception as e:
            log.exception("scheduler: offboarding-LWD failed: %s", e)

        try:
            from .commands.offboarding_reminders import run_offboarding_reminders

            reminder_summary = run_offboarding_reminders(today)
            if reminder_summary.get("lwd_reminders_sent") or reminder_summary.get("noc_sla_reminders_sent"):
                log.info("scheduler: offboarding reminders %s", reminder_summary)
        except Exception as e:
            log.exception("scheduler: offboarding-reminders failed: %s", e)

        try:
            db.session.commit()
        except Exception as e:
            log.exception("scheduler: commit failed: %s", e)
            db.session.rollback()


def run_auto_punch_out_job():
    """Every few minutes: auto punch-out when punch-day total work reaches 10h."""
    if _app is None:
        return
    with _app.app_context():
        from . import db
        from .punch_auto_close import process_auto_punch_outs

        log = _app.logger
        try:
            n = process_auto_punch_outs()
            if n:
                log.info("scheduler: auto punch-out closed %s session(s)", n)
        except Exception as e:
            log.exception("scheduler: auto-punch-out failed: %s", e)
            db.session.rollback()
