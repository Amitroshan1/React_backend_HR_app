"""Employee tax declaration — schema, CRUD, documents, HR review."""
from __future__ import annotations

import copy
import json
import os
import uuid
from datetime import date
from pathlib import Path

from flask import current_app, jsonify, request
from flask_jwt_extended import get_jwt, jwt_required
from werkzeug.utils import secure_filename

from . import db
from .commands.tds_logic import financial_year_for_date, load_tax_rules, normalize_regime
from .datetime_utils import isoformat_api, utc_now
from .models.Admin_models import Admin
from .models.ctc_breakup import CTCBreakup
from .models.emp_detail_models import Employee
from .models.employee_accounts import EmployeeAccounts
from .models.employee_tax_declaration import (
    EmployeeTaxDeclaration,
    TaxDeclarationApprovalHistory,
    TaxDeclarationDocument,
    TaxDeclarationItem,
)
from .plan_features import has_feature, plan_forbidden_response
from . import tds_settings as tds_cfg

_FORMS_DIR = Path(__file__).resolve().parent / "data" / "tax_declaration_forms"
_BLOCKED_DOC_EXT = frozenset({
    ".exe", ".bat", ".cmd", ".com", ".msi", ".scr", ".ps1", ".vbs", ".wsf",
    ".js", ".jar", ".sh", ".bash", ".php", ".py", ".rb", ".pl", ".cgi",
    ".html", ".htm", ".svg", ".dll", ".so", ".apk", ".app", ".deb", ".rpm",
})
_MAX_DOC_BYTES = 5 * 1024 * 1024
_SECTION_80C_CODES = frozenset({
    "PPF", "ELSS", "LIC", "NSC", "SSY", "FD", "TUITION", "HOME_LOAN_PRINCIPAL", "80C_OTHER",
})


def _validate_upload_filename(filename: str) -> str | None:
    ext = os.path.splitext(filename)[1].lower()
    if not ext:
        return "File must have an extension (e.g. .pdf, .docx, .jpg)"
    if ext in _BLOCKED_DOC_EXT:
        return f"File type {ext} is not allowed"
    return None


def parse_amount(val):
    if val is None or val == "":
        return None
    try:
        return float(val)
    except (TypeError, ValueError):
        return None


def normalize_financial_year(value):
    raw = (value or "").strip().replace(" ", "")
    if not raw:
        return financial_year_for_date()
    digits = "".join(ch for ch in raw if ch.isdigit())
    if len(digits) >= 8:
        start = int(digits[:4])
        return f"{start}-{start + 1}"
    if len(digits) == 4:
        y = int(digits)
        return f"{y}-{y + 1}"
    return raw


def _fy_file_key(financial_year: str) -> str:
    fy = normalize_financial_year(financial_year)
    parts = fy.split("-")
    if len(parts) == 2 and len(parts[1]) == 4:
        return f"{parts[0]}-{parts[1][-2:]}"
    return fy


def load_form_schema(financial_year: str | None = None) -> dict:
    fy_key = _fy_file_key(financial_year or financial_year_for_date())
    path = _FORMS_DIR / f"{fy_key}.json"
    if not path.is_file():
        candidates = sorted(_FORMS_DIR.glob("*.json"), reverse=True)
        if not candidates:
            return {}
        path = candidates[0]
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def enrich_schema_with_caps(schema: dict, rules: dict) -> dict:
    """Attach resolved cap amounts from tax rules onto schema sections/items."""
    if not schema:
        return {}
    enriched = copy.deepcopy(schema)
    for sec in enriched.get("sections") or []:
        sec_key = sec.get("cap_key")
        if sec_key and sec_key in rules:
            sec["cap_amount"] = float(rules.get(sec_key) or 0)
        for item in sec.get("items") or []:
            item_key = item.get("cap_key")
            if item.get("cap_scope") == "item" and item_key and item_key in rules:
                item["cap_amount"] = float(rules.get(item_key) or 0)
            elif item.get("cap_scope") == "section" and sec_key and sec_key in rules:
                item["cap_amount"] = float(rules.get(sec_key) or 0)
                item["cap_shared"] = True
    return enriched


def _section_amount_total(
    sec: dict,
    item_map: dict,
    *,
    epf_annual: float = 0,
) -> float:
    total = 0.0
    section_id = (sec.get("id") or "").upper()
    for item_def in sec.get("items") or []:
        if item_def.get("type") != "amount":
            continue
        code = (item_def.get("code") or "").upper()
        if code == "EPF":
            total += epf_annual
        else:
            total += _amount_from_items(item_map, section_id, code)
    return total


def validate_declaration_caps(
    *,
    items_payload: list | None,
    schema: dict,
    rules: dict,
    regime_norm: str,
    epf_annual: float = 0,
    documents: list | None = None,
    submit: bool = False,
) -> list[str]:
    """Return list of validation error messages (empty if valid)."""
    if regime_norm != "old":
        return []

    errors: list[str] = []
    item_map = _item_map(items_payload)
    doc_links = {
        (
            (d.get("section_code") or "").upper(),
            (d.get("item_code") or "").upper(),
        )
        for d in (documents or [])
        if d.get("section_code") and d.get("item_code")
    }

    for sec in schema.get("sections") or []:
        if sec.get("visible_when", {}).get("regime") != "old":
            continue
        section_id = (sec.get("id") or "").upper()
        sec_cap_key = sec.get("cap_key")
        if sec_cap_key:
            cap = float(rules.get(sec_cap_key) or 0)
            if cap > 0:
                total = _section_amount_total(sec, item_map, epf_annual=epf_annual)
                if total > cap + 0.01:
                    errors.append(
                        f"{sec.get('title', section_id)}: total ₹{total:,.0f} exceeds maximum ₹{cap:,.0f}"
                    )

        for item_def in sec.get("items") or []:
            if item_def.get("type") != "amount":
                continue
            code = (item_def.get("code") or "").upper()
            if item_def.get("readonly"):
                continue

            amount = _amount_from_items(item_map, section_id, code)
            if code == "EPF":
                amount = epf_annual
            if amount <= 0:
                continue

            if item_def.get("cap_scope") == "section" and sec_cap_key:
                cap = float(rules.get(sec_cap_key) or 0)
                if cap > 0:
                    others = 0.0
                    for other_def in sec.get("items") or []:
                        if other_def.get("type") != "amount":
                            continue
                        other_code = (other_def.get("code") or "").upper()
                        if other_code == code:
                            continue
                        if other_code == "EPF":
                            others += epf_annual
                        else:
                            others += _amount_from_items(item_map, section_id, other_code)
                    max_allowed = cap - others
                    if amount > max_allowed + 0.01:
                        errors.append(
                            f"{item_def.get('label', code)}: ₹{amount:,.0f} exceeds "
                            f"remaining section limit of ₹{max(0, max_allowed):,.0f}"
                        )

            if item_def.get("cap_scope") == "item" and item_def.get("cap_key"):
                cap = float(rules.get(item_def["cap_key"]) or 0)
                if cap > 0 and amount > cap + 0.01:
                    errors.append(
                        f"{item_def.get('label', code)}: ₹{amount:,.0f} exceeds maximum ₹{cap:,.0f}"
                    )

            if submit and item_def.get("proof_required"):
                if (section_id, code) not in doc_links:
                    errors.append(
                        f"{item_def.get('label', code)}: supporting document is required"
                    )

    return errors


def _fy_display(financial_year: str) -> str:
    """Normalize any FY string to YYYY-YYYY for the frontend."""
    normalized = normalize_financial_year(financial_year)
    parts = normalized.split("-")
    if len(parts) != 2 or not parts[0].isdigit():
        return normalized
    start = int(parts[0])
    end_part = parts[1]
    if len(end_part) == 2:
        end = start + 1
    elif end_part.isdigit():
        end = int(end_part)
    else:
        return normalized
    return f"{start}-{end}"


def _fy_start_year_from_date(d: date | None = None) -> int:
    d = d or date.today()
    return d.year if d.month >= 4 else d.year - 1


def _financial_years_from_schemas() -> set[str]:
    years: set[str] = set()
    for path in _FORMS_DIR.glob("*.json"):
        stem = path.stem
        if "-" not in stem:
            continue
        left, right = stem.split("-", 1)
        if not left.isdigit():
            continue
        start = int(left)
        if len(right) == 2 and right.isdigit():
            years.add(f"{start}-{start + 1}")
        elif len(right) == 4 and right.isdigit():
            years.add(f"{start}-{int(right)}")
    return years


def _build_financial_year_list(
    *,
    years_back: int = 10,
    years_forward: int = 0,
    extra_years: set[str] | None = None,
) -> list[str]:
    start = _fy_start_year_from_date()
    years: set[str] = set(extra_years or set())
    years |= _financial_years_from_schemas()

    for offset in range(-years_forward, years_back + 1):
        y = start - offset
        years.add(f"{y}-{y + 1}")

    return sorted(years, key=lambda fy: int(fy.split("-")[0]), reverse=True)


@jwt_required()
def list_tax_declaration_financial_years():
    blocked = _payslip_feature_required()
    if blocked:
        return blocked

    email = get_jwt().get("email")
    viewer = Admin.query.filter_by(email=email).first()
    if not viewer:
        return jsonify({"success": False, "message": "Unauthorized user"}), 401

    blocked = _require_employee_sensitive(viewer)
    if blocked:
        return blocked

    years_back = max(1, min(int(request.args.get("years_back", 10) or 10), 30))
    years_forward = max(0, min(int(request.args.get("years_forward", 0) or 0), 2))

    extra: set[str] = set()
    if _accounts_reviewer(viewer):
        rows = db.session.query(EmployeeTaxDeclaration.financial_year).distinct().all()
        for (fy,) in rows:
            if fy:
                extra.add(_fy_display(fy))
    else:
        rows = EmployeeTaxDeclaration.query.filter_by(admin_id=viewer.id).all()
        for row in rows:
            if row.financial_year:
                extra.add(_fy_display(row.financial_year))

    financial_years = _build_financial_year_list(
        years_back=years_back,
        years_forward=years_forward,
        extra_years=extra,
    )
    current = _fy_display(financial_year_for_date())

    return jsonify({
        "success": True,
        "current_financial_year": current,
        "financial_years": financial_years,
        "years_back": years_back,
    }), 200


def tax_declaration_for_admin(admin_id, financial_year):
    fy = normalize_financial_year(financial_year)
    return EmployeeTaxDeclaration.query.filter_by(
        admin_id=admin_id,
        financial_year=fy,
    ).first()


def _notify_declaration_tds_impact(admin: Admin, financial_year: str, status: str) -> None:
    """Email employee that payroll TDS was recalculated (best-effort)."""
    try:
        from datetime import date as date_cls

        from .email import send_tax_declaration_tds_updated_email
        from . import payroll_tds_service as payroll_tds

        today = date_cls.today()
        tds_result = payroll_tds.compute_monthly_tds_for_payroll(
            admin.id, today.year, today.month
        )
        send_tax_declaration_tds_updated_email(
            admin,
            financial_year,
            status=status,
            monthly_tds=tds_result.get("monthly_tds"),
        )
    except Exception as exc:
        current_app.logger.warning(
            "Tax declaration TDS notification skipped for admin %s: %s",
            getattr(admin, "id", None),
            exc,
        )


def _sync_regime_to_profile(admin_id: int, tax_regime: str | None) -> None:
    """Keep EmployeeAccounts tax regime aligned with submitted/approved declaration."""
    regime = (tax_regime or "").strip()
    if not regime:
        return
    acct = EmployeeAccounts.query.filter_by(admin_id=admin_id).first()
    if not acct:
        acct = EmployeeAccounts(admin_id=admin_id)
        db.session.add(acct)
    acct.tax_regime = regime


def _declaration_status_label(status: str | None) -> str:
    labels = {
        "approved": "Approved tax declaration",
        "submitted": "Submitted tax declaration (pending Finance review)",
        "draft": "Draft tax declaration (not submitted)",
        "rejected": "Rejected tax declaration — update and resubmit",
    }
    return labels.get((status or "").lower(), status or "Unknown")


def resolved_tds_inputs_for_projection(
    admin_id: int,
    financial_year: str,
    profile: dict | None,
    request_data: dict | None = None,
    *,
    use_declaration: bool = True,
) -> dict:
    """
    Merge tax declaration rollup with profile / request overrides for TDS projection.
    When use_declaration is True, declaration values take precedence over empty request fields.
    """
    request_data = request_data or {}
    profile = profile or {}

    def _parse_override(key: str, default=0):
        if key not in request_data:
            return default
        val = request_data.get(key)
        if val is None or val == "":
            return default
        try:
            return float(val)
        except (TypeError, ValueError):
            return default

    def _parse_bool_override(key: str, default: bool = False) -> bool:
        if key not in request_data:
            return default
        return bool(request_data.get(key))

    inputs = {
        "tax_regime": profile.get("tax_regime"),
        "rent_paid_annual": 0.0,
        "is_metro": False,
        "section_80c_extra": 0.0,
        "section_80d": 0.0,
        "previous_employer_taxable": 0.0,
        "previous_employer_tds": 0.0,
        "section_80ccd1b": 0.0,
        "section_24_interest": 0.0,
        "lta_exemption": 0.0,
        "section_80e": 0.0,
        "section_80g": 0.0,
        "other_deductions": 0.0,
        "other_income": 0.0,
        "new_regime_deductions": 0.0,
    }
    declaration_source = {
        "found": False,
        "status": None,
        "declaration_id": None,
        "label": "No tax declaration found for this financial year.",
        "payroll_ready": False,
        "tds_basis": None,
        "submitted_at": None,
        "financial_year": normalize_financial_year(financial_year),
    }

    row = None
    profile_row = EmployeeAccounts.query.filter_by(admin_id=admin_id).first()
    if use_declaration:
        row = tax_declaration_for_admin(admin_id, financial_year)
        if row:
            regime_for_rules = normalize_regime(row.tax_regime or inputs["tax_regime"])
            try:
                rules = load_tax_rules(financial_year, regime_for_rules)
            except ValueError:
                rules = {}
            ctc = _ctc_hints(admin_id)
            decl_inputs = declaration_tds_inputs_for_row(
                row,
                monthly_epf=float(ctc.get("monthly_epf") or 0),
                rules=rules,
            )
            inputs.update(decl_inputs)
            inputs["tax_regime"] = row.tax_regime or inputs["tax_regime"]
            status = (row.status or "draft").lower()
            declaration_source = {
                "found": True,
                "status": status,
                "declaration_id": row.id,
                "label": _declaration_status_label(status),
                "payroll_ready": status == "approved",
                "tds_basis": _tds_basis_from_row(row),
                "declaration_phase": getattr(row, "declaration_phase", None) or "provisional",
                "final_proof_status": getattr(row, "final_proof_status", None),
                "submitted_at": isoformat_api(row.submitted_at),
                "financial_year": row.financial_year,
            }

    if not use_declaration or request_data.get("override_declaration"):
        if request_data.get("tax_regime"):
            inputs["tax_regime"] = request_data.get("tax_regime")
        if "rent_paid_annual" in request_data:
            inputs["rent_paid_annual"] = _parse_override("rent_paid_annual", inputs["rent_paid_annual"])
        if "is_metro" in request_data:
            inputs["is_metro"] = _parse_bool_override("is_metro", inputs["is_metro"])
        if "section_80c_extra" in request_data:
            inputs["section_80c_extra"] = _parse_override("section_80c_extra", inputs["section_80c_extra"])
        if "section_80d" in request_data:
            inputs["section_80d"] = _parse_override("section_80d", inputs["section_80d"])
        if "previous_employer_taxable" in request_data:
            inputs["previous_employer_taxable"] = _parse_override(
                "previous_employer_taxable", inputs["previous_employer_taxable"]
            )
        if "previous_employer_tds" in request_data:
            inputs["previous_employer_tds"] = _parse_override(
                "previous_employer_tds", inputs["previous_employer_tds"]
            )

    from . import tax_regime_service as regime_svc
    regime_info = regime_svc.effective_tax_regime(profile_row, declaration=row)
    if regime_info.get("tax_regime"):
        inputs["tax_regime"] = regime_info["tax_regime"]

    return {
        **inputs,
        "declaration_source": declaration_source,
        "tax_regime_source": regime_info,
        "regime_norm": normalize_regime(inputs.get("tax_regime")),
    }


def _payslip_feature_required():
    if not has_feature("dashboard_payslip"):
        return plan_forbidden_response("dashboard_payslip")
    return None


def _accounts_reviewer(admin) -> bool:
    emp = (getattr(admin, "emp_type", None) or "").strip().lower()
    return emp in ("account", "accounts", "accountant", "hr", "human resource", "admin")


def _require_employee_sensitive(viewer):
    if _accounts_reviewer(viewer):
        return None
    from .sensitive_data_auth import require_sensitive_for_employee
    return require_sensitive_for_employee(viewer, viewer.id)


def _employee_info(admin: Admin) -> dict:
    emp = Employee.query.filter_by(admin_id=admin.id).first()
    acct = EmployeeAccounts.query.filter_by(admin_id=admin.id).first()
    return {
        "employee_id": admin.emp_id or "",
        "employee_name": (emp.name if emp else None) or admin.first_name or admin.email,
        "department": admin.emp_type or "",
        "designation": (emp.designation if emp else None) or (acct.designation if acct else "") or "",
        "pan": (acct.pan if acct else None) or "",
        "tax_regime": (acct.tax_regime if acct else None) or "",
    }


def _ctc_hints(admin_id: int) -> dict:
    ctc = CTCBreakup.query.filter_by(admin_id=admin_id).first()
    if not ctc:
        return {"has_ctc": False}
    monthly_epf = float(ctc.epf or 0)
    return {
        "epf_annual": monthly_epf * 12,
        "monthly_epf": monthly_epf,
        "monthly_hra": float(ctc.hra or 0),
        "monthly_basic": float(ctc.basic_salary or 0),
        "monthly_gross": float(ctc.gross_salary or 0),
        "has_ctc": bool(float(ctc.gross_salary or 0) > 0),
    }


def _item_map(items_payload: list | None) -> dict:
    out = {}
    for raw in items_payload or []:
        section = (raw.get("section_code") or "").strip().upper()
        code = (raw.get("item_code") or "").strip().upper()
        if section and code:
            out[(section, code)] = raw
    return out


def _amount_from_items(item_map: dict, section: str, code: str) -> float:
    raw = item_map.get((section.upper(), code.upper())) or {}
    return parse_amount(raw.get("amount")) or 0.0


def _bool_from_items(item_map: dict, section: str, code: str) -> bool:
    raw = item_map.get((section.upper(), code.upper())) or {}
    if raw.get("value") is not None:
        return bool(raw.get("value"))
    tv = (raw.get("text_value") or "").strip().lower()
    return tv in ("true", "1", "yes")


def rollup_items_to_tds_inputs(
    items_payload: list | None,
    monthly_epf: float = 0,
    rules: dict | None = None,
) -> dict:
    """Map declaration line items to all TDS projection inputs."""
    rules = rules or {}
    item_map = _item_map(items_payload)
    manual_80c = sum(_amount_from_items(item_map, "80C", c) for c in _SECTION_80C_CODES)
    rent_monthly = _amount_from_items(item_map, "HRA", "RENT_MONTHLY")
    section_80d_self = _amount_from_items(item_map, "80D", "SELF_HEALTH")
    section_80d_parents = _amount_from_items(item_map, "80D", "PARENTS_HEALTH")

    section_80tta = _amount_from_items(item_map, "OTHER_DED", "80TTA")
    section_80ttb = _amount_from_items(item_map, "OTHER_DED", "80TTB")
    if rules:
        section_80tta = min(section_80tta, float(rules.get("section_80tta_cap", 10000)))
        section_80ttb = min(section_80ttb, float(rules.get("section_80ttb_cap", 50000)))

    other_deductions = (
        section_80tta
        + section_80ttb
        + _amount_from_items(item_map, "OTHER_DED", "80U")
        + _amount_from_items(item_map, "OTHER_DED", "80DD")
        + _amount_from_items(item_map, "OTHER_DED", "OTHER")
    )

    section_80ccd1b = _amount_from_items(item_map, "80CCD1B", "NPS_ADDITIONAL")
    if rules:
        section_80ccd1b = min(section_80ccd1b, float(rules.get("section_80ccd1b_cap", 50000)))

    section_24_interest = _amount_from_items(item_map, "SEC24", "HOME_LOAN_INTEREST")
    if rules:
        section_24_interest = min(section_24_interest, float(rules.get("section_24_cap", 200000)))

    lta_exemption = _amount_from_items(item_map, "LTA", "LTA_CLAIMED")
    lta_cap = float(rules.get("section_lta_cap", 0) or 0)
    if lta_cap > 0:
        lta_exemption = min(lta_exemption, lta_cap)

    section_80g = _amount_from_items(item_map, "80G", "DONATION_AMOUNT")
    other_income = sum(
        _amount_from_items(item_map, "OTHER_INCOME", c)
        for c in ("BANK_INTEREST", "FD_INTEREST", "RENTAL_INCOME", "OTHER_INCOME")
    )
    new_regime_deductions = (
        _amount_from_items(item_map, "NEW_REGIME_DED", "EMPLOYER_NPS")
        + _amount_from_items(item_map, "NEW_REGIME_DED", "OTHER_ELIGIBLE")
    )

    return {
        "rent_paid_annual": rent_monthly * 12,
        "is_metro": _bool_from_items(item_map, "HRA", "IS_METRO"),
        "section_80c_extra": manual_80c,
        "section_80d": section_80d_self + section_80d_parents,
        "section_80d_self": section_80d_self,
        "section_80d_parents": section_80d_parents,
        "previous_employer_taxable": _amount_from_items(item_map, "PREV_EMPLOYER", "GROSS_INCOME"),
        "previous_employer_tds": _amount_from_items(item_map, "PREV_EMPLOYER", "TAX_DEDUCTED"),
        "section_80ccd1b": section_80ccd1b,
        "section_24_interest": section_24_interest,
        "lta_exemption": lta_exemption,
        "section_80e": _amount_from_items(item_map, "80E", "EDU_LOAN_INTEREST"),
        "section_80g": section_80g,
        "other_deductions": other_deductions,
        "other_income": other_income,
        "new_regime_deductions": new_regime_deductions,
        "epf_annual": monthly_epf * 12,
    }


def rollup_items_to_legacy(items_payload: list | None, monthly_epf: float = 0) -> dict:
    full = rollup_items_to_tds_inputs(items_payload, monthly_epf=monthly_epf)
    return {
        "rent_paid_annual": full["rent_paid_annual"],
        "is_metro": full["is_metro"],
        "section_80c_extra": full["section_80c_extra"],
        "section_80d": full["section_80d"],
        "previous_employer_taxable": full["previous_employer_taxable"],
        "previous_employer_tds": full["previous_employer_tds"],
        "epf_annual": full["epf_annual"],
    }


def items_payload_from_declaration(
    row: EmployeeTaxDeclaration,
    *,
    use_final: bool | None = None,
) -> list[dict]:
    if use_final is None:
        use_final = _use_final_amounts_for_row(row)
    out = []
    for it in row.items.all():
        amount = it.amount
        if use_final and it.final_amount is not None:
            amount = it.final_amount
        out.append({
            "section_code": it.section_code,
            "item_code": it.item_code,
            "amount": amount,
            "text_value": it.text_value,
            "declared_amount": it.amount,
            "final_amount": it.final_amount,
        })
    return out


def _use_final_amounts_for_row(row: EmployeeTaxDeclaration) -> bool:
    return (
        (getattr(row, "declaration_phase", None) or "provisional") == "final"
        and (getattr(row, "final_proof_status", None) or "").lower() == "approved"
    )


def declaration_tds_inputs_for_row(
    row: EmployeeTaxDeclaration,
    *,
    monthly_epf: float = 0,
    rules: dict | None = None,
) -> dict:
    """Full TDS inputs from declaration items, falling back to header rollup fields."""
    items = items_payload_from_declaration(row)
    if items:
        return rollup_items_to_tds_inputs(items, monthly_epf=monthly_epf, rules=rules)
    return {
        "rent_paid_annual": float(row.rent_paid_annual or 0),
        "is_metro": bool(row.is_metro),
        "section_80c_extra": float(row.section_80c_extra or 0),
        "section_80d": float(row.section_80d or 0),
        "section_80d_self": float(row.section_80d or 0),
        "section_80d_parents": 0.0,
        "previous_employer_taxable": float(row.previous_employer_taxable or 0),
        "previous_employer_tds": float(row.previous_employer_tds or 0),
        "section_80ccd1b": 0.0,
        "section_24_interest": 0.0,
        "lta_exemption": 0.0,
        "section_80e": 0.0,
        "section_80g": 0.0,
        "other_deductions": 0.0,
        "other_income": 0.0,
        "new_regime_deductions": 0.0,
        "epf_annual": monthly_epf * 12,
    }


def _tds_basis_from_status(status: str | None) -> str | None:
    s = (status or "").lower()
    if s == "approved":
        return "provisional"
    if s == "submitted":
        return "provisional"
    return None


def _tds_basis_from_row(row: EmployeeTaxDeclaration | None) -> str | None:
    if not row:
        return None
    if _use_final_amounts_for_row(row):
        return "final"
    return _tds_basis_from_status(row.status)


def backfill_tax_regime_from_approved_declarations() -> dict:
    """
    One-time sync: copy tax_regime from approved declarations into EmployeeAccounts.
    Uses the latest updated declaration per employee when multiple FY rows exist.
    """
    rows = (
        EmployeeTaxDeclaration.query.filter_by(status="approved")
        .order_by(
            EmployeeTaxDeclaration.admin_id.asc(),
            EmployeeTaxDeclaration.updated_at.desc(),
        )
        .all()
    )
    seen_admin: set[int] = set()
    updated = 0
    skipped = 0
    for row in rows:
        if row.admin_id in seen_admin:
            continue
        seen_admin.add(row.admin_id)
        regime = (row.tax_regime or "").strip()
        if not regime:
            skipped += 1
            continue
        acct = EmployeeAccounts.query.filter_by(admin_id=row.admin_id).first()
        if not acct:
            acct = EmployeeAccounts(admin_id=row.admin_id, tax_regime=regime)
            db.session.add(acct)
            updated += 1
            continue
        if (acct.tax_regime or "").strip() != regime:
            acct.tax_regime = regime
            updated += 1
    db.session.commit()
    return {
        "scanned_approved": len(rows),
        "employees_considered": len(seen_admin),
        "profiles_updated": updated,
        "skipped_no_regime": skipped,
    }


@jwt_required()
def backfill_tax_regime_route():
    email = get_jwt().get("email")
    viewer = Admin.query.filter_by(email=email).first()
    if not viewer or not _accounts_reviewer(viewer):
        return jsonify({"success": False, "message": "Access denied"}), 403
    result = backfill_tax_regime_from_approved_declarations()
    return jsonify({"success": True, **result}), 200


def _sync_items(row: EmployeeTaxDeclaration, items_payload: list | None):
    """Upsert line items; keep existing rows not present in payload (e.g. after doc-only upload)."""
    if not items_payload:
        return

    existing_by_key = {
        (it.section_code.upper(), it.item_code.upper()): it
        for it in row.items.all()
    }

    for raw in items_payload or []:
        section = (raw.get("section_code") or "").strip().upper()
        code = (raw.get("item_code") or "").strip().upper()
        if not section or not code:
            continue
        amount = parse_amount(raw.get("amount"))
        text_value = (raw.get("text_value") or "").strip() or None
        if raw.get("type") == "boolean":
            text_value = "true" if raw.get("value") else "false"

        key = (section, code)
        existing = existing_by_key.get(key)
        meta = raw.get("meta_json") if isinstance(raw.get("meta_json"), dict) else None
        if existing:
            existing.amount = amount
            existing.text_value = text_value
            if meta is not None:
                existing.meta_json = meta
        else:
            row.items.append(
                TaxDeclarationItem(
                    section_code=section,
                    item_code=code,
                    amount=amount,
                    text_value=text_value,
                    meta_json=meta,
                )
            )


def _record_history(row, action, from_status, to_status, actor_id, comment=None):
    row.approval_history.append(
        TaxDeclarationApprovalHistory(
            action=action,
            from_status=from_status,
            to_status=to_status,
            actor_admin_id=actor_id,
            comment=comment,
        )
    )


def _declaration_upload_dir(declaration_id: int) -> tuple[str, str]:
    rel = os.path.join("tax_declarations", str(declaration_id))
    root = current_app.config.get("UPLOADS_ROOT") or os.path.join(
        current_app.root_path, "static", "uploads"
    )
    abs_dir = os.path.join(root, rel)
    os.makedirs(abs_dir, exist_ok=True)
    return rel, abs_dir


@jwt_required()
def get_tax_declaration_form_schema():
    blocked = _payslip_feature_required()
    if blocked:
        return blocked
    email = get_jwt().get("email")
    viewer = Admin.query.filter_by(email=email).first()
    if not viewer:
        return jsonify({"success": False, "message": "Unauthorized user"}), 401
    blocked = _require_employee_sensitive(viewer)
    if blocked:
        return blocked
    fy = normalize_financial_year(request.args.get("financial_year"))
    schema = enrich_schema_with_caps(load_form_schema(fy), load_tax_rules(fy, "old"))
    return jsonify({
        "success": True,
        "financial_year": fy,
        "schema": schema,
        "rules": {
            "old": load_tax_rules(fy, "old"),
            "new": load_tax_rules(fy, "new"),
        },
    }), 200


@jwt_required()
def get_tax_declaration_self():
    blocked = _payslip_feature_required()
    if blocked:
        return blocked

    email = get_jwt().get("email")
    viewer = Admin.query.filter_by(email=email).first()
    if not viewer:
        return jsonify({"success": False, "message": "Unauthorized user"}), 401

    blocked = _require_employee_sensitive(viewer)
    if blocked:
        return blocked

    financial_year = normalize_financial_year(request.args.get("financial_year"))
    row = tax_declaration_for_admin(viewer.id, financial_year)
    employee = _employee_info(viewer)
    ctc = _ctc_hints(viewer.id)
    rules_old = load_tax_rules(financial_year, "old")
    rules_new = load_tax_rules(financial_year, "new")

    decl_payload = None
    if row:
        decl_payload = row.to_dict(include_items=True, include_documents=True)
        decl_payload["approval_history"] = [h.to_dict() for h in row.approval_history]

    return jsonify({
        "success": True,
        "declaration": decl_payload,
        "financial_year": financial_year,
        "employee": employee,
        "ctc": ctc,
        "schema": enrich_schema_with_caps(load_form_schema(financial_year), rules_old),
        "rules": {"old": rules_old, "new": rules_new},
        "profile": {"tax_regime": employee.get("tax_regime"), "pan": employee.get("pan")},
        "submission_deadline": tds_cfg.declaration_deadline_payload(financial_year),
    }), 200


@jwt_required()
def save_tax_declaration_self():
    blocked = _payslip_feature_required()
    if blocked:
        return blocked

    email = get_jwt().get("email")
    viewer = Admin.query.filter_by(email=email).first()
    if not viewer:
        return jsonify({"success": False, "message": "Unauthorized user"}), 401

    blocked = _require_employee_sensitive(viewer)
    if blocked:
        return blocked

    data = request.get_json(silent=True) or {}
    financial_year = normalize_financial_year(data.get("financial_year"))
    submit = bool(data.get("submit"))

    row = tax_declaration_for_admin(viewer.id, financial_year)
    if row and row.status in ("submitted", "approved"):
        return jsonify({
            "success": False,
            "message": "Declaration is locked after submission. Contact Finance to amend.",
        }), 400

    profile_row = EmployeeAccounts.query.filter_by(admin_id=viewer.id).first()
    tax_regime = (data.get("tax_regime") or "").strip() or (
        profile_row.tax_regime if profile_row else None
    )

    from . import tax_regime_service as regime_svc
    if tax_regime and profile_row:
        prev_regime = (row.tax_regime if row else profile_row.tax_regime) or ""
        if normalize_regime(tax_regime) != normalize_regime(prev_regime):
            allowed, lock_msg = regime_svc.employee_may_change_regime(viewer.id, financial_year)
            if not allowed:
                return jsonify({"success": False, "message": lock_msg}), 400

    regime_norm = normalize_regime(tax_regime)

    if submit:
        deadline_info = tds_cfg.declaration_deadline_payload(financial_year)
        if not deadline_info.get("is_open"):
            return jsonify({
                "success": False,
                "message": (
                    f"Tax declaration submission closed on {deadline_info.get('deadline_display')}. "
                    f"Contact Finance."
                ),
                "submission_deadline": deadline_info,
            }), 400
        if not data.get("regime_declaration_accepted"):
            return jsonify({"success": False, "message": "Please accept the tax regime declaration."}), 400
        if regime_norm == "new" and not data.get("new_regime_acknowledged"):
            return jsonify({"success": False, "message": "Please acknowledge the New Tax Regime terms."}), 400
        if not data.get("final_declaration_accepted"):
            return jsonify({"success": False, "message": "Please accept the final employee declaration."}), 400

    ctc = _ctc_hints(viewer.id)
    if submit and not ctc.get("has_ctc"):
        return jsonify({"success": False, "message": "CTC breakup is required before submission."}), 400

    if not row:
        row = EmployeeTaxDeclaration(admin_id=viewer.id, financial_year=financial_year)
        db.session.add(row)

    items_payload = data.get("items") or []
    schema = load_form_schema(financial_year)
    rules = load_tax_rules(financial_year, regime_norm)
    epf_annual = float(ctc.get("epf_annual") or 0)
    existing_docs = []
    if row.id:
        existing_docs = [d.to_dict() for d in row.documents.all()]

    cap_errors = validate_declaration_caps(
        items_payload=items_payload,
        schema=schema,
        rules=rules,
        regime_norm=regime_norm,
        epf_annual=epf_annual,
        documents=existing_docs,
        submit=submit,
    )
    if cap_errors:
        return jsonify({
            "success": False,
            "message": cap_errors[0],
            "errors": cap_errors,
        }), 400

    rollup = rollup_items_to_legacy(items_payload, monthly_epf=float(ctc.get("monthly_epf") or 0))

    row.tax_regime = tax_regime
    row.rent_paid_annual = rollup["rent_paid_annual"]
    row.is_metro = rollup["is_metro"]
    row.section_80c_extra = rollup["section_80c_extra"]
    row.section_80d = rollup["section_80d"]
    row.previous_employer_taxable = rollup["previous_employer_taxable"]
    row.previous_employer_tds = rollup["previous_employer_tds"]
    row.regime_declaration_accepted = bool(data.get("regime_declaration_accepted"))
    row.new_regime_acknowledged = bool(data.get("new_regime_acknowledged"))
    row.final_declaration_accepted = bool(data.get("final_declaration_accepted"))
    row.declaration_place = (data.get("declaration_place") or "").strip() or None

    signed = (data.get("declaration_signed_at") or "").strip()
    if signed:
        try:
            row.declaration_signed_at = date.fromisoformat(signed.split("T")[0])
        except ValueError:
            row.declaration_signed_at = date.today()
    elif submit:
        row.declaration_signed_at = date.today()

    _sync_items(row, items_payload)

    prev_status = row.status or "draft"
    if submit:
        row.status = "submitted"
        row.submitted_at = utc_now()
        _record_history(row, "submit", prev_status, "submitted", viewer.id)
        _sync_regime_to_profile(viewer.id, tax_regime)
    else:
        row.status = "draft"
        row.submitted_at = None

    row.updated_at = utc_now()
    db.session.commit()

    if submit:
        from . import payroll_tds_service as payroll_tds
        payroll_tds.recalculate_payroll_tds_for_financial_year(viewer.id, financial_year)
        db.session.commit()
        _notify_declaration_tds_impact(viewer, financial_year, "submitted")

    return jsonify({
        "success": True,
        "message": "Tax declaration submitted." if submit else "Tax declaration saved as draft.",
        "declaration": row.to_dict(include_items=True, include_documents=True),
        "rollup": rollup,
        "submission_deadline": tds_cfg.declaration_deadline_payload(financial_year),
    }), 200


@jwt_required()
def upload_tax_declaration_document():
    blocked = _payslip_feature_required()
    if blocked:
        return blocked

    email = get_jwt().get("email")
    viewer = Admin.query.filter_by(email=email).first()
    if not viewer:
        return jsonify({"success": False, "message": "Unauthorized user"}), 401

    blocked = _require_employee_sensitive(viewer)
    if blocked:
        return blocked

    financial_year = normalize_financial_year(request.form.get("financial_year"))
    doc_type = (request.form.get("doc_type") or "").strip().lower()
    section_code = (request.form.get("section_code") or "").strip().upper() or None
    item_code = (request.form.get("item_code") or "").strip().upper() or None
    upload = request.files.get("file")

    if not doc_type:
        return jsonify({"success": False, "message": "doc_type is required"}), 400
    if not upload or not upload.filename:
        return jsonify({"success": False, "message": "file is required"}), 400

    ext_err = _validate_upload_filename(upload.filename)
    if ext_err:
        return jsonify({"success": False, "message": ext_err}), 400

    upload.seek(0, os.SEEK_END)
    size = upload.tell()
    upload.seek(0)
    if size > _MAX_DOC_BYTES:
        return jsonify({"success": False, "message": "Max file size is 5 MB"}), 400

    row = tax_declaration_for_admin(viewer.id, financial_year)
    if not row:
        row = EmployeeTaxDeclaration(admin_id=viewer.id, financial_year=financial_year)
        db.session.add(row)
        db.session.flush()

    allowed, msg = _document_upload_allowed(row, doc_type)
    if not allowed:
        return jsonify({"success": False, "message": msg}), 400

    if section_code and item_code:
        for old in row.documents.filter_by(
            section_code=section_code,
            item_code=item_code,
            doc_type=doc_type,
        ).all():
            root = current_app.config.get("UPLOADS_ROOT") or os.path.join(
                current_app.root_path, "static", "uploads"
            )
            abs_path = os.path.join(root, old.file_path)
            if os.path.isfile(abs_path):
                try:
                    os.remove(abs_path)
                except OSError:
                    pass
            db.session.delete(old)

    rel_dir, abs_dir = _declaration_upload_dir(row.id)
    stored = f"{uuid.uuid4().hex}_{secure_filename(upload.filename)}"
    upload.save(os.path.join(abs_dir, stored))

    doc = TaxDeclarationDocument(
        declaration_id=row.id,
        doc_type=doc_type,
        section_code=section_code,
        item_code=item_code,
        file_path=os.path.join(rel_dir, stored).replace("\\", "/"),
        original_name=upload.filename,
        mime_type=upload.mimetype,
        size_bytes=size,
    )
    db.session.add(doc)
    db.session.commit()

    return jsonify({"success": True, "document": doc.to_dict()}), 200


@jwt_required()
def delete_tax_declaration_document(doc_id: int):
    blocked = _payslip_feature_required()
    if blocked:
        return blocked

    email = get_jwt().get("email")
    viewer = Admin.query.filter_by(email=email).first()
    if not viewer:
        return jsonify({"success": False, "message": "Unauthorized user"}), 401

    blocked = _require_employee_sensitive(viewer)
    if blocked:
        return blocked

    doc = TaxDeclarationDocument.query.get_or_404(doc_id)
    row = EmployeeTaxDeclaration.query.get_or_404(doc.declaration_id)
    if row.admin_id != viewer.id:
        return jsonify({"success": False, "message": "Access denied"}), 403
    allowed, msg = _document_delete_allowed(row, doc)
    if not allowed:
        return jsonify({"success": False, "message": msg}), 400

    root = current_app.config.get("UPLOADS_ROOT") or os.path.join(
        current_app.root_path, "static", "uploads"
    )
    abs_path = os.path.join(root, doc.file_path)
    if os.path.isfile(abs_path):
        try:
            os.remove(abs_path)
        except OSError:
            pass
    db.session.delete(doc)
    db.session.commit()
    return jsonify({"success": True, "message": "Document deleted"}), 200


@jwt_required()
def list_tax_declarations_review():
    email = get_jwt().get("email")
    viewer = Admin.query.filter_by(email=email).first()
    if not viewer or not _accounts_reviewer(viewer):
        return jsonify({"success": False, "message": "Access denied"}), 403

    status = (request.args.get("status") or "submitted").strip().lower()
    fy = request.args.get("financial_year")
    q = EmployeeTaxDeclaration.query
    if status and status != "all":
        q = q.filter(EmployeeTaxDeclaration.status == status)
    if fy:
        q = q.filter(EmployeeTaxDeclaration.financial_year == normalize_financial_year(fy))

    rows = q.order_by(
        EmployeeTaxDeclaration.submitted_at.desc(),
        EmployeeTaxDeclaration.id.desc(),
    ).limit(200).all()

    out = []
    for row in rows:
        admin = Admin.query.get(row.admin_id)
        payload = row.to_dict()
        payload["employee"] = _employee_info(admin) if admin else {}
        out.append(payload)

    return jsonify({"success": True, "declarations": out}), 200


@jwt_required()
def review_tax_declaration(decl_id: int):
    email = get_jwt().get("email")
    viewer = Admin.query.filter_by(email=email).first()
    if not viewer or not _accounts_reviewer(viewer):
        return jsonify({"success": False, "message": "Access denied"}), 403

    data = request.get_json(silent=True) or {}
    action = (data.get("action") or "").strip().lower()
    if action not in ("approve", "reject"):
        return jsonify({"success": False, "message": "action must be approve or reject"}), 400

    row = EmployeeTaxDeclaration.query.get_or_404(decl_id)
    if row.status != "submitted":
        return jsonify({"success": False, "message": "Only submitted declarations can be reviewed."}), 400

    prev = row.status
    if action == "approve":
        row.status = "approved"
        row.declaration_phase = row.declaration_phase or "provisional"
        row.rejection_reason = None
    else:
        row.status = "rejected"
        row.rejection_reason = (data.get("comment") or data.get("rejection_reason") or "").strip() or None

    row.reviewed_by_admin_id = viewer.id
    row.reviewed_at = utc_now()
    _record_history(row, action, prev, row.status, viewer.id, data.get("comment"))
    if action == "approve" and row.tax_regime:
        _sync_regime_to_profile(row.admin_id, row.tax_regime)
    db.session.commit()

    if action in ("approve", "reject"):
        from . import payroll_tds_service as payroll_tds
        payroll_tds.recalculate_payroll_tds_for_financial_year(row.admin_id, row.financial_year)
        db.session.commit()
        if action == "approve":
            emp = Admin.query.get(row.admin_id)
            if emp:
                _notify_declaration_tds_impact(emp, row.financial_year, "approved")

    return jsonify({
        "success": True,
        "message": f"Declaration {row.status}.",
        "declaration": row.to_dict(include_items=True, include_documents=True),
    }), 200


def _count_amend_unlocks(row: EmployeeTaxDeclaration) -> int:
    return sum(
        1
        for h in row.approval_history.all()
        if (h.action or "").lower() == "amend_unlock"
    )


@jwt_required()
def amend_tax_declaration(decl_id: int):
    """Unlock an approved declaration so the employee can edit and resubmit."""
    email = get_jwt().get("email")
    viewer = Admin.query.filter_by(email=email).first()
    if not viewer or not _accounts_reviewer(viewer):
        return jsonify({"success": False, "message": "Access denied"}), 403

    data = request.get_json(silent=True) or {}
    comment = (data.get("comment") or data.get("reason") or "").strip()
    if not comment:
        return jsonify({
            "success": False,
            "message": "Reason is required to unlock a declaration for amendment.",
        }), 400

    row = EmployeeTaxDeclaration.query.get_or_404(decl_id)
    if (row.status or "").lower() != "approved":
        return jsonify({
            "success": False,
            "message": "Only approved declarations can be unlocked for amendment.",
        }), 400
    if (row.final_proof_status or "").lower() == "submitted":
        return jsonify({
            "success": False,
            "message": "Resolve pending final proof review before unlocking the declaration.",
        }), 400

    from . import tds_settings as tds_cfg
    max_amends = tds_cfg.max_declaration_amendments_per_fy()
    amend_count = _count_amend_unlocks(row)
    if max_amends > 0 and amend_count >= max_amends:
        return jsonify({
            "success": False,
            "message": (
                f"Amendment limit reached for this FY ({amend_count}/{max_amends}). "
                "Contact system admin to increase the limit in TDS settings."
            ),
            "amendments_used": amend_count,
            "amendments_limit": max_amends,
        }), 400

    prev = row.status
    row.status = "draft"
    row.submitted_at = None
    row.reviewed_at = None
    row.reviewed_by_admin_id = None
    row.rejection_reason = None
    row.declaration_phase = "provisional"
    row.final_proof_status = None
    row.final_proof_submitted_at = None
    row.final_proof_reviewed_at = None
    row.final_proof_rejection_reason = None
    row.updated_at = utc_now()
    _record_history(row, "amend_unlock", prev, "draft", viewer.id, comment)
    db.session.commit()

    from . import payroll_tds_service as payroll_tds
    payroll_tds.recalculate_payroll_tds_for_financial_year(row.admin_id, row.financial_year)
    db.session.commit()

    emp = Admin.query.get(row.admin_id)
    if emp:
        try:
            from .email import send_tax_declaration_amendment_unlocked_email
            send_tax_declaration_amendment_unlocked_email(emp, row.financial_year, comment)
        except Exception:
            pass

    return jsonify({
        "success": True,
        "message": "Declaration unlocked for amendment. Employee can edit and resubmit.",
        "declaration": row.to_dict(include_items=True, include_documents=True),
        "amendments_used": amend_count + 1,
        "amendments_limit": max_amends,
    }), 200


@jwt_required()
def list_tax_declaration_self_history():
    blocked = _payslip_feature_required()
    if blocked:
        return blocked

    email = get_jwt().get("email")
    viewer = Admin.query.filter_by(email=email).first()
    if not viewer:
        return jsonify({"success": False, "message": "Unauthorized user"}), 401

    blocked = _require_employee_sensitive(viewer)
    if blocked:
        return blocked

    rows = (
        EmployeeTaxDeclaration.query.filter_by(admin_id=viewer.id)
        .order_by(
            EmployeeTaxDeclaration.financial_year.desc(),
            EmployeeTaxDeclaration.updated_at.desc(),
        )
        .all()
    )

    out = []
    for row in rows:
        items = row.items.all()
        total_amount = sum(float(i.amount or 0) for i in items if i.amount is not None)
        payload = row.to_dict()
        payload["item_count"] = len(items)
        payload["document_count"] = row.documents.count()
        payload["total_declared_amount"] = round(total_amount, 2)
        out.append(payload)

    return jsonify({"success": True, "declarations": out}), 200


@jwt_required()
def get_tax_declaration_detail(decl_id: int):
    email = get_jwt().get("email")
    viewer = Admin.query.filter_by(email=email).first()
    if not viewer:
        return jsonify({"success": False, "message": "Unauthorized"}), 401

    row = EmployeeTaxDeclaration.query.get_or_404(decl_id)
    if row.admin_id != viewer.id and not _accounts_reviewer(viewer):
        return jsonify({"success": False, "message": "Access denied"}), 403

    if row.admin_id == viewer.id and not _accounts_reviewer(viewer):
        blocked = _require_employee_sensitive(viewer)
        if blocked:
            return blocked

    admin = Admin.query.get(row.admin_id)
    rules_old = load_tax_rules(row.financial_year, "old")
    from . import tds_settings as tds_cfg
    amend_limit = tds_cfg.max_declaration_amendments_per_fy()
    amend_used = _count_amend_unlocks(row)
    return jsonify({
        "success": True,
        "declaration": row.to_dict(include_items=True, include_documents=True),
        "employee": _employee_info(admin) if admin else {},
        "schema": enrich_schema_with_caps(load_form_schema(row.financial_year), rules_old),
        "rules": {"old": rules_old, "new": load_tax_rules(row.financial_year, "new")},
        "history": [h.to_dict() for h in row.approval_history],
        "amendment_policy": {
            "used": amend_used,
            "limit": amend_limit,
            "remaining": max(0, amend_limit - amend_used) if amend_limit > 0 else None,
        },
    }), 200


def _sync_final_amounts(row: EmployeeTaxDeclaration, items_payload: list | None):
    item_map = {
        ((it.section_code or "").upper(), (it.item_code or "").upper()): it
        for it in row.items.all()
    }
    for raw in items_payload or []:
        section = (raw.get("section_code") or "").strip().upper()
        code = (raw.get("item_code") or "").strip().upper()
        if not section or not code:
            continue
        item = item_map.get((section, code))
        if not item:
            continue
        if "final_amount" in raw:
            item.final_amount = parse_amount(raw.get("final_amount"))


def _final_proof_editable(row: EmployeeTaxDeclaration) -> bool:
    if (row.status or "").lower() != "approved":
        return False
    fps = (row.final_proof_status or "").lower()
    return fps in ("", "draft", "rejected")


def _document_upload_allowed(row: EmployeeTaxDeclaration, doc_type: str) -> tuple[bool, str]:
    dt = (doc_type or "").strip().lower()
    if dt == "final_proof":
        if (row.status or "").lower() != "approved":
            return False, "Final proof uploads require an approved declaration."
        if not _final_proof_editable(row):
            return False, "Final proof documents are locked while under Finance review."
        return True, ""
    if row.is_locked():
        return False, "Cannot upload documents after submission."
    return True, ""


def _document_delete_allowed(row: EmployeeTaxDeclaration, doc: TaxDeclarationDocument) -> tuple[bool, str]:
    if (doc.doc_type or "").strip().lower() == "final_proof":
        if not _final_proof_editable(row):
            return False, "Cannot delete final proof documents while locked."
        return True, ""
    if row.is_locked():
        return False, "Cannot delete documents after submission."
    return True, ""


def _schema_item_def(schema: dict, section_code: str, item_code: str) -> dict | None:
    section_id = (section_code or "").upper()
    code = (item_code or "").upper()
    for sec in schema.get("sections") or []:
        if (sec.get("id") or "").upper() != section_id:
            continue
        for item_def in sec.get("items") or []:
            if (item_def.get("code") or "").upper() == code:
                return item_def
    return None


def validate_final_proof_submit(
    *,
    row: EmployeeTaxDeclaration,
    items_payload: list | None,
    schema: dict,
    regime_norm: str,
) -> list[str]:
    """Require final_proof documents for line items with actual amounts when proof_required."""
    if regime_norm != "old":
        return []

    errors: list[str] = []
    final_by_key: dict[tuple[str, str], float] = {}
    for raw in items_payload or []:
        section = (raw.get("section_code") or "").strip().upper()
        code = (raw.get("item_code") or "").strip().upper()
        if not section or not code:
            continue
        amt = parse_amount(raw.get("final_amount"))
        if amt is not None:
            final_by_key[(section, code)] = float(amt)

    declared_by_key = {
        ((it.section_code or "").upper(), (it.item_code or "").upper()): float(it.amount or 0)
        for it in row.items.all()
    }

    final_proof_docs = {
        ((d.section_code or "").upper(), (d.item_code or "").upper())
        for d in row.documents.all()
        if (d.doc_type or "").strip().lower() == "final_proof"
        and d.section_code
        and d.item_code
    }
    provisional_docs = {
        ((d.section_code or "").upper(), (d.item_code or "").upper())
        for d in row.documents.all()
        if (d.doc_type or "").strip().lower() != "final_proof"
        and d.section_code
        and d.item_code
    }

    for sec in schema.get("sections") or []:
        if sec.get("visible_when", {}).get("regime") != "old":
            continue
        section_id = (sec.get("id") or "").upper()
        for item_def in sec.get("items") or []:
            if item_def.get("type") != "amount" or item_def.get("readonly"):
                continue
            code = (item_def.get("code") or "").upper()
            if code == "EPF":
                continue
            declared = declared_by_key.get((section_id, code), 0.0)
            final_amt = final_by_key.get((section_id, code), declared)
            if final_amt <= 0 and declared <= 0:
                continue
            if not item_def.get("proof_required"):
                continue
            key = (section_id, code)
            if key not in final_proof_docs and key not in provisional_docs:
                errors.append(
                    f"{item_def.get('label', code)}: supporting document is required "
                    f"(provisional proof from declaration or upload year-end proof)"
                )
    return errors


@jwt_required()
def get_final_proof_self():
    blocked = _payslip_feature_required()
    if blocked:
        return blocked

    email = get_jwt().get("email")
    viewer = Admin.query.filter_by(email=email).first()
    if not viewer:
        return jsonify({"success": False, "message": "Unauthorized user"}), 401

    blocked = _require_employee_sensitive(viewer)
    if blocked:
        return blocked

    financial_year = normalize_financial_year(request.args.get("financial_year"))
    row = tax_declaration_for_admin(viewer.id, financial_year)
    if not row or (row.status or "").lower() != "approved":
        return jsonify({
            "success": False,
            "message": "Year-end final proof is available after your declaration is approved.",
        }), 400

    regime_norm = normalize_regime(row.tax_regime)
    rules_old = load_tax_rules(financial_year, regime_norm)
    schema = enrich_schema_with_caps(load_form_schema(financial_year), rules_old)

    return jsonify({
        "success": True,
        "declaration": row.to_dict(include_items=True, include_documents=True),
        "schema": schema,
        "regime": regime_norm,
        "editable": _final_proof_editable(row),
        "financial_year": financial_year,
    }), 200


@jwt_required()
def save_final_proof_self():
    blocked = _payslip_feature_required()
    if blocked:
        return blocked

    email = get_jwt().get("email")
    viewer = Admin.query.filter_by(email=email).first()
    if not viewer:
        return jsonify({"success": False, "message": "Unauthorized user"}), 401

    blocked = _require_employee_sensitive(viewer)
    if blocked:
        return blocked

    data = request.get_json(silent=True) or {}
    financial_year = normalize_financial_year(data.get("financial_year"))
    submit = bool(data.get("submit"))
    row = tax_declaration_for_admin(viewer.id, financial_year)

    if not row or (row.status or "").lower() != "approved":
        return jsonify({
            "success": False,
            "message": "Year-end final proof requires an approved declaration.",
        }), 400
    if not _final_proof_editable(row):
        return jsonify({
            "success": False,
            "message": "Final proof is locked while under Finance review or already approved.",
        }), 400

    items_payload = data.get("items") or []
    regime_norm = normalize_regime(row.tax_regime)
    schema = enrich_schema_with_caps(
        load_form_schema(financial_year),
        load_tax_rules(financial_year, regime_norm),
    )

    if submit:
        proof_errors = validate_final_proof_submit(
            row=row,
            items_payload=items_payload,
            schema=schema,
            regime_norm=regime_norm,
        )
        if proof_errors:
            return jsonify({
                "success": False,
                "message": proof_errors[0],
                "errors": proof_errors,
            }), 400

    _sync_final_amounts(row, items_payload)

    prev_fps = row.final_proof_status
    if submit:
        row.final_proof_status = "submitted"
        row.final_proof_submitted_at = utc_now()
        row.final_proof_rejection_reason = None
        _record_history(row, "final_proof_submit", prev_fps, "submitted", viewer.id)
    else:
        row.final_proof_status = "draft"
        _record_history(row, "final_proof_save", prev_fps, "draft", viewer.id)

    row.updated_at = utc_now()
    db.session.commit()

    if submit:
        from . import payroll_tds_service as payroll_tds
        payroll_tds.recalculate_payroll_tds_for_financial_year(viewer.id, financial_year)
        db.session.commit()

    return jsonify({
        "success": True,
        "message": "Final proof submitted for Finance review." if submit else "Final proof saved.",
        "declaration": row.to_dict(include_items=True, include_documents=True),
    }), 200


@jwt_required()
def review_final_proof(decl_id: int):
    email = get_jwt().get("email")
    viewer = Admin.query.filter_by(email=email).first()
    if not viewer or not _accounts_reviewer(viewer):
        return jsonify({"success": False, "message": "Access denied"}), 403

    data = request.get_json(silent=True) or {}
    action = (data.get("action") or "").strip().lower()
    if action not in ("approve", "reject"):
        return jsonify({"success": False, "message": "action must be approve or reject"}), 400

    row = EmployeeTaxDeclaration.query.get_or_404(decl_id)
    if (row.status or "").lower() != "approved":
        return jsonify({"success": False, "message": "Declaration must be approved first."}), 400
    if (row.final_proof_status or "").lower() != "submitted":
        return jsonify({"success": False, "message": "No final proof pending review."}), 400

    prev = row.final_proof_status
    if action == "approve":
        row.declaration_phase = "final"
        row.final_proof_status = "approved"
        row.final_proof_rejection_reason = None
    else:
        row.final_proof_status = "rejected"
        row.final_proof_rejection_reason = (
            (data.get("comment") or data.get("rejection_reason") or "").strip() or None
        )

    row.final_proof_reviewed_at = utc_now()
    _record_history(
        row,
        f"final_proof_{action}",
        prev,
        row.final_proof_status,
        viewer.id,
        data.get("comment"),
    )
    db.session.commit()

    from . import payroll_tds_service as payroll_tds
    payroll_tds.recalculate_payroll_tds_for_financial_year(row.admin_id, row.financial_year)
    db.session.commit()

    return jsonify({
        "success": True,
        "message": f"Final proof {row.final_proof_status}.",
        "declaration": row.to_dict(include_items=True, include_documents=True),
    }), 200


@jwt_required()
def set_tax_regime_override_route(admin_id: int):
    email = get_jwt().get("email")
    viewer = Admin.query.filter_by(email=email).first()
    if not viewer or not _accounts_reviewer(viewer):
        return jsonify({"success": False, "message": "Access denied"}), 403

    data = request.get_json(silent=True) or {}
    from . import tax_regime_service as regime_svc
    try:
        acct = regime_svc.set_tax_regime_override(
            admin_id,
            data.get("tax_regime") or "",
            data.get("reason") or "",
            viewer.id,
        )
    except ValueError as e:
        return jsonify({"success": False, "message": str(e)}), 400

    return jsonify({
        "success": True,
        "message": "Tax regime override saved.",
        "profile": acct.to_dict(),
        "tax_regime_source": regime_svc.effective_tax_regime(acct),
    }), 200


@jwt_required()
def clear_tax_regime_override_route(admin_id: int):
    email = get_jwt().get("email")
    viewer = Admin.query.filter_by(email=email).first()
    if not viewer or not _accounts_reviewer(viewer):
        return jsonify({"success": False, "message": "Access denied"}), 403

    from . import tax_regime_service as regime_svc
    acct = regime_svc.clear_tax_regime_override(admin_id)
    if not acct:
        return jsonify({"success": False, "message": "Profile not found"}), 404
    return jsonify({
        "success": True,
        "message": "Tax regime override cleared.",
        "profile": acct.to_dict(),
    }), 200


@jwt_required()
def get_declaration_deadline_route():
    blocked = _payslip_feature_required()
    if blocked:
        return blocked

    email = get_jwt().get("email")
    viewer = Admin.query.filter_by(email=email).first()
    if viewer:
        blocked = _require_employee_sensitive(viewer)
        if blocked:
            return blocked

    financial_year = normalize_financial_year(request.args.get("financial_year"))
    return jsonify({
        "success": True,
        "submission_deadline": tds_cfg.declaration_deadline_payload(financial_year),
    }), 200


@jwt_required()
def update_declaration_deadline_route():
    email = get_jwt().get("email")
    viewer = Admin.query.filter_by(email=email).first()
    if not viewer or not _accounts_reviewer(viewer):
        return jsonify({"success": False, "message": "Access denied"}), 403

    data = request.get_json(silent=True) or {}
    financial_year = normalize_financial_year(data.get("financial_year"))
    if not financial_year:
        return jsonify({"success": False, "message": "financial_year is required"}), 400

    raw_date = (data.get("deadline_date") or data.get("deadline") or "").strip()
    clear = data.get("clear") is True or raw_date.lower() in ("", "default", "reset")

    if clear:
        tds_cfg.set_declaration_deadline_override(financial_year, None)
        payload = tds_cfg.declaration_deadline_payload(financial_year)
        return jsonify({
            "success": True,
            "message": f"Deadline reset to default ({payload.get('deadline_display')}).",
            "submission_deadline": payload,
        }), 200

    try:
        deadline = date.fromisoformat(raw_date.split("T")[0])
    except ValueError:
        return jsonify({"success": False, "message": "Invalid deadline_date (use YYYY-MM-DD)"}), 400

    tds_cfg.set_declaration_deadline_override(financial_year, deadline)
    payload = tds_cfg.declaration_deadline_payload(financial_year)
    return jsonify({
        "success": True,
        "message": f"Submission deadline updated to {payload.get('deadline_display')}.",
        "submission_deadline": payload,
    }), 200
