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


def run_biometric_last_scan_sync_job():
    """
    Every 5s during 18:00–21:00 IST: keep NHQ biometric OUT = latest device scan.
    Replaces the former 20:00 finalize + 22:00 late-scan cron jobs (option A).
    Outside the window the sync returns immediately.
    Does not close single-scan days (waits for catch-up at 21:05 / morning).
    """
    if _app is None:
        return
    with _app.app_context():
        from . import db
        from .biometric.finalization import sync_all_nhq_biometric_last_scans

        log = _app.logger
        try:
            summary = sync_all_nhq_biometric_last_scans(include_catchup=True)
            if summary.get("skipped") == "outside_sync_window":
                return
            if summary.get("synced_count"):
                log.info(
                    "scheduler: biometric last-scan sync synced=%s skipped=%s "
                    "errors=%s dates=%s",
                    summary.get("synced_count"),
                    summary.get("skipped_count"),
                    summary.get("error_count"),
                    summary.get("dates"),
                )
        except Exception as e:
            log.exception("scheduler: biometric-last-scan-sync failed: %s", e)
            db.session.rollback()


def run_biometric_last_scan_catchup_job():
    """
    Fix #2: force NHQ last-scan sync outside the 5s window.
    Runs after 21:00 and in the morning so stale opens (including single-scan
    days — fix #1) still get punch-out.
    """
    if _app is None:
        return
    with _app.app_context():
        from . import db
        from .biometric.finalization import sync_all_nhq_biometric_last_scans

        log = _app.logger
        try:
            summary = sync_all_nhq_biometric_last_scans(
                include_catchup=True,
                force=True,
                allow_single_scan_out=True,
            )
            if summary.get("synced_count") or summary.get("error_count"):
                log.info(
                    "scheduler: biometric last-scan catch-up synced=%s skipped=%s "
                    "errors=%s dates=%s",
                    summary.get("synced_count"),
                    summary.get("skipped_count"),
                    summary.get("error_count"),
                    summary.get("dates"),
                )
        except Exception as e:
            log.exception("scheduler: biometric-last-scan-catchup failed: %s", e)
            db.session.rollback()


def run_biometric_mapping_reprocess_job():
    """
    Daily: retry mapping-failure biometric logs after emp_id / map fixes.
    Exhausted ghost PINs become unmapped_permanent (no invented punch).
    """
    if _app is None:
        return
    with _app.app_context():
        from . import db
        from .biometric.reprocess import reprocess_mapping_failure_logs

        log = _app.logger
        try:
            summary = reprocess_mapping_failure_logs()
            if (
                summary.get("resolved_count")
                or summary.get("exhausted_count")
                or summary.get("error_count")
            ):
                log.info(
                    "scheduler: biometric mapping reprocess resolved=%s still=%s "
                    "exhausted=%s errors=%s candidates=%s",
                    summary.get("resolved_count"),
                    summary.get("still_unmapped_count"),
                    summary.get("exhausted_count"),
                    summary.get("error_count"),
                    summary.get("candidate_count"),
                )
        except Exception as e:
            log.exception("scheduler: biometric-mapping-reprocess failed: %s", e)
            db.session.rollback()


def run_daily_checkout_job():
    """Overdue day-use holds, PDF retries, and pending email outbox."""
    if _app is None:
        return
    with _app.app_context():
        log = _app.logger
        try:
            from .daily_checkout.service import flush_outbox, mark_overdue_and_notify, retry_pending_pdfs

            n = mark_overdue_and_notify()
            if n:
                log.info("scheduler: day-use marked overdue=%s", n)
            retry_pending_pdfs()
            flush_outbox()
        except Exception as e:
            log.exception("scheduler: day-use checkout job failed: %s", e)
            from . import db

            db.session.rollback()
