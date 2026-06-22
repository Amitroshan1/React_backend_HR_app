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
from .datetime_utils import utc_now
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

_FORMS_DIR = Path(__file__).resolve().parent / "data" / "tax_declaration_forms"
_ALLOWED_DOC_EXT = frozenset({".pdf", ".jpg", ".jpeg", ".png"})
_MAX_DOC_BYTES = 5 * 1024 * 1024
_SECTION_80C_CODES = frozenset({
    "PPF", "ELSS", "LIC", "NSC", "SSY", "FD", "TUITION", "HOME_LOAN_PRINCIPAL", "80C_OTHER",
})


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


def _payslip_feature_required():
    if not has_feature("dashboard_payslip"):
        return plan_forbidden_response("dashboard_payslip")
    return None


def _accounts_reviewer(admin) -> bool:
    emp = (getattr(admin, "emp_type", None) or "").strip().lower()
    return emp in ("account", "accounts", "accountant", "hr", "human resource", "admin")


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


def rollup_items_to_legacy(items_payload: list | None, monthly_epf: float = 0) -> dict:
    item_map = _item_map(items_payload)
    manual_80c = sum(_amount_from_items(item_map, "80C", c) for c in _SECTION_80C_CODES)
    rent_monthly = _amount_from_items(item_map, "HRA", "RENT_MONTHLY")
    section_80d = (
        _amount_from_items(item_map, "80D", "SELF_HEALTH")
        + _amount_from_items(item_map, "80D", "PARENTS_HEALTH")
    )
    return {
        "rent_paid_annual": rent_monthly * 12,
        "is_metro": _bool_from_items(item_map, "HRA", "IS_METRO"),
        "section_80c_extra": manual_80c,
        "section_80d": section_80d,
        "previous_employer_taxable": _amount_from_items(item_map, "PREV_EMPLOYER", "GROSS_INCOME"),
        "previous_employer_tds": _amount_from_items(item_map, "PREV_EMPLOYER", "TAX_DEDUCTED"),
        "epf_annual": monthly_epf * 12,
    }


def _sync_items(row: EmployeeTaxDeclaration, items_payload: list | None):
    row.items.delete()
    for raw in items_payload or []:
        section = (raw.get("section_code") or "").strip().upper()
        code = (raw.get("item_code") or "").strip().upper()
        if not section or not code:
            continue
        amount = parse_amount(raw.get("amount"))
        text_value = (raw.get("text_value") or "").strip() or None
        if raw.get("type") == "boolean":
            text_value = "true" if raw.get("value") else "false"
        row.items.append(
            TaxDeclarationItem(
                section_code=section,
                item_code=code,
                amount=amount,
                text_value=text_value,
                meta_json=raw.get("meta_json") if isinstance(raw.get("meta_json"), dict) else None,
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

    financial_year = normalize_financial_year(request.args.get("financial_year"))
    row = tax_declaration_for_admin(viewer.id, financial_year)
    employee = _employee_info(viewer)
    ctc = _ctc_hints(viewer.id)
    rules_old = load_tax_rules(financial_year, "old")
    rules_new = load_tax_rules(financial_year, "new")

    return jsonify({
        "success": True,
        "declaration": row.to_dict(include_items=True, include_documents=True) if row else None,
        "financial_year": financial_year,
        "employee": employee,
        "ctc": ctc,
        "schema": enrich_schema_with_caps(load_form_schema(financial_year), rules_old),
        "rules": {"old": rules_old, "new": rules_new},
        "profile": {"tax_regime": employee.get("tax_regime"), "pan": employee.get("pan")},
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

    data = request.get_json(silent=True) or {}
    financial_year = normalize_financial_year(data.get("financial_year"))
    submit = bool(data.get("submit"))

    row = tax_declaration_for_admin(viewer.id, financial_year)
    if row and row.status in ("submitted", "approved"):
        return jsonify({
            "success": False,
            "message": "Declaration is locked after submission. Contact Accounts/HR to amend.",
        }), 400

    profile_row = EmployeeAccounts.query.filter_by(admin_id=viewer.id).first()
    tax_regime = (data.get("tax_regime") or "").strip() or (
        profile_row.tax_regime if profile_row else None
    )
    regime_norm = normalize_regime(tax_regime)

    if submit:
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
    else:
        row.status = "draft"
        row.submitted_at = None

    row.updated_at = utc_now()
    db.session.commit()

    return jsonify({
        "success": True,
        "message": "Tax declaration submitted." if submit else "Tax declaration saved as draft.",
        "declaration": row.to_dict(include_items=True, include_documents=True),
        "rollup": rollup,
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

    financial_year = normalize_financial_year(request.form.get("financial_year"))
    doc_type = (request.form.get("doc_type") or "").strip().lower()
    section_code = (request.form.get("section_code") or "").strip().upper() or None
    item_code = (request.form.get("item_code") or "").strip().upper() or None
    upload = request.files.get("file")

    if not doc_type:
        return jsonify({"success": False, "message": "doc_type is required"}), 400
    if not upload or not upload.filename:
        return jsonify({"success": False, "message": "file is required"}), 400

    ext = os.path.splitext(upload.filename)[1].lower()
    if ext not in _ALLOWED_DOC_EXT:
        return jsonify({"success": False, "message": "Allowed formats: PDF, JPG, JPEG, PNG"}), 400

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
    if row.is_locked():
        return jsonify({"success": False, "message": "Cannot upload documents after submission."}), 400

    if section_code and item_code:
        for old in row.documents.filter_by(section_code=section_code, item_code=item_code).all():
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

    doc = TaxDeclarationDocument.query.get_or_404(doc_id)
    row = EmployeeTaxDeclaration.query.get_or_404(doc.declaration_id)
    if row.admin_id != viewer.id:
        return jsonify({"success": False, "message": "Access denied"}), 403
    if row.is_locked():
        return jsonify({"success": False, "message": "Cannot delete documents after submission."}), 400

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
        row.rejection_reason = None
    else:
        row.status = "rejected"
        row.rejection_reason = (data.get("comment") or data.get("rejection_reason") or "").strip() or None

    row.reviewed_by_admin_id = viewer.id
    row.reviewed_at = utc_now()
    _record_history(row, action, prev, row.status, viewer.id, data.get("comment"))
    db.session.commit()

    return jsonify({
        "success": True,
        "message": f"Declaration {row.status}.",
        "declaration": row.to_dict(include_items=True, include_documents=True),
    }), 200


@jwt_required()
def get_tax_declaration_detail(decl_id: int):
    email = get_jwt().get("email")
    viewer = Admin.query.filter_by(email=email).first()
    if not viewer:
        return jsonify({"success": False, "message": "Unauthorized"}), 401

    row = EmployeeTaxDeclaration.query.get_or_404(decl_id)
    if row.admin_id != viewer.id and not _accounts_reviewer(viewer):
        return jsonify({"success": False, "message": "Access denied"}), 403

    admin = Admin.query.get(row.admin_id)
    rules_old = load_tax_rules(row.financial_year, "old")
    return jsonify({
        "success": True,
        "declaration": row.to_dict(include_items=True, include_documents=True),
        "employee": _employee_info(admin) if admin else {},
        "schema": enrich_schema_with_caps(load_form_schema(row.financial_year), rules_old),
        "rules": {"old": rules_old, "new": load_tax_rules(row.financial_year, "new")},
        "history": [h.to_dict() for h in row.approval_history],
    }), 200
