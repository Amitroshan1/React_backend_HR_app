"""Form 16 variance detection and email alerts."""
from __future__ import annotations

from . import form16_service as form16_svc
from . import tds_settings as tds_cfg
from .models.Admin_models import Admin


def variance_tolerance_inr() -> float:
    return float(tds_cfg.load_tds_settings().get("form16_variance_tolerance_inr") or 100)


def check_form16_variance(admin_id: int, financial_year: str) -> dict:
    """Return reconciliation result or skip metadata."""
    try:
        summary = form16_svc.build_form16_summary(admin_id, financial_year)
    except ValueError as exc:
        return {"admin_id": admin_id, "skipped": True, "reason": str(exc)}

    recon = summary.get("reconciliation") or form16_svc.build_form16_reconciliation(
        admin_id, summary["financial_year"], summary
    )
    return {
        "admin_id": admin_id,
        "financial_year": summary["financial_year"],
        "skipped": False,
        "reconciliation": recon,
        "employee_name": summary.get("employee", {}).get("name"),
        "emp_id": summary.get("employee", {}).get("emp_id"),
    }


def notify_form16_variance_if_needed(admin_id: int, financial_year: str) -> dict:
    """Email employee and Accounts when uploaded vs computed figures differ beyond tolerance."""
    settings = tds_cfg.load_tds_settings()
    if not settings.get("form16_variance_alert_enabled", True):
        return {"notified": False, "reason": "alerts_disabled"}

    check = check_form16_variance(admin_id, financial_year)
    if check.get("skipped"):
        return {"notified": False, "reason": check.get("reason")}

    recon = check.get("reconciliation") or {}
    if not recon.get("has_uploaded_figures"):
        return {"notified": False, "reason": "no_uploaded_data"}
    if recon.get("match_status") != "variance":
        return {"notified": False, "reason": "within_tolerance"}

    admin = Admin.query.get(admin_id)
    if not admin:
        return {"notified": False, "reason": "employee_not_found"}

    from .email import send_form16_variance_alert_email
    ok, msg = send_form16_variance_alert_email(admin, financial_year, recon)
    return {
        "notified": bool(ok),
        "message": msg,
        "reconciliation": recon,
        "emp_id": check.get("emp_id"),
    }
