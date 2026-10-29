"""Inventory purchase / indent: Inventory raises, Manager confirms need, Finance funds."""
from __future__ import annotations

import html
import json
import os
import uuid
from decimal import Decimal, InvalidOperation

from flask import Blueprint, current_app, jsonify, request
from flask_jwt_extended import get_jwt, jwt_required
from werkzeug.utils import secure_filename

from . import db
from .datetime_utils import utc_now
from .manager_utils import (
    get_manager_emails,
    is_manager_in_contact,
    resolve_manager_contact_for_employee,
)
from .company_mailbox import company_mailbox
from .models.inventory_purchase_request import InventoryPurchaseRequest
from .plan_features import can_access_finance_panel, can_access_it_panel, is_org_admin
from .secure_file_service import build_signed_file_url
from .tenant_context import current_admin, get_admin_in_tenant, get_current_tenant_id
from .upload_tenancy import tenant_upload_path

purchase_bp = Blueprint("inventory_purchase", __name__)

ALLOWED_EXT = {".pdf", ".png", ".jpg", ".jpeg", ".webp", ".xlsx", ".xls", ".doc", ".docx", ".csv"}
MAX_FILES = 5
MAX_BYTES = 8 * 1024 * 1024

STATUSES = (
    "pending_manager",
    "pending_finance",
    "manager_rejected",
    "finance_rejected",
    "finance_approved",
    "received",
    "cancelled",
)

STATUS_LABEL = {
    "pending_manager": "Waiting on manager",
    "pending_finance": "Waiting on finance",
    "manager_rejected": "Manager rejected",
    "finance_rejected": "Finance rejected",
    "finance_approved": "Finance approved",
    "received": "Received",
    "cancelled": "Cancelled",
}

SOURCE_VALUES = ("it", "inventory")
SOURCE_LABEL = {"it": "IT", "inventory": "Inventory"}
FINANCE_VISIBLE = (
    "pending_manager",
    "pending_finance",
    "finance_approved",
    "received",
    "manager_rejected",
    "finance_rejected",
)


def _ok(payload, code=200):
    body = {"success": True}
    body.update(payload)
    return jsonify(body), code


def _err(message, code=400):
    return jsonify({"success": False, "message": message}), code


def _viewer():
    admin = current_admin()
    if not admin:
        return None, _err("Unauthorized user", 401)
    return admin, None


def _display_name(admin):
    if not admin:
        return ""
    name = (getattr(admin, "first_name", None) or "").strip()
    return name or (admin.email or "")


def _uploads_root():
    return current_app.config.get("UPLOAD_FOLDER") or os.path.join(
        current_app.static_folder or "static", "uploads"
    )


def _parse_attachments(raw):
    if not raw:
        return []
    try:
        data = json.loads(raw)
    except (TypeError, ValueError):
        return []
    return data if isinstance(data, list) else []


def _save_files(files, tenant_id):
    saved = []
    root = _uploads_root()
    for storage in files[:MAX_FILES]:
        if not storage or not getattr(storage, "filename", None):
            continue
        ext = os.path.splitext(storage.filename)[1].lower()
        if ext not in ALLOWED_EXT:
            raise ValueError(f"File type {ext or 'unknown'} is not allowed.")
        storage.stream.seek(0, os.SEEK_END)
        size = storage.stream.tell()
        storage.stream.seek(0)
        if size > MAX_BYTES:
            raise ValueError("Each attachment must be 8 MB or smaller.")
        safe = secure_filename(storage.filename) or f"file{ext}"
        rel = f"inventory_purchase/{uuid.uuid4().hex[:12]}/{safe}"
        abs_path, key = tenant_upload_path(root, rel, tenant_id)
        storage.save(abs_path)
        saved.append({"name": safe, "path": key})
    return saved


def _has_manager(admin):
    contact = resolve_manager_contact_for_employee(admin)
    emails = get_manager_emails(contact, exclude_email=(admin.email or "").strip())
    return bool(emails)


def _normalize_source(raw):
    value = (raw or "inventory").strip().lower()
    return value if value in SOURCE_VALUES else "inventory"


def _source_label(value):
    return SOURCE_LABEL.get(_normalize_source(value), "Inventory")


def _finance_mailbox():
    return (company_mailbox("EMAIL_FINANCE") or company_mailbox("ZEPTO_CC_FINANCE") or "").strip()


def _it_mailbox():
    return (company_mailbox("ZEPTO_CC_IT") or company_mailbox("EMAIL_IT") or "").strip()


def _unique_emails(*groups):
    seen = set()
    out = []
    for group in groups:
        for raw in group or []:
            addr = (raw or "").strip()
            key = addr.lower()
            if addr and key not in seen:
                seen.add(key)
                out.append(addr)
    return out


def _purchase_mail_body(row, intro):
    amount = f"{row.estimated_amount}" if row.estimated_amount is not None else "Not given"
    why = html.escape(row.justification or "").replace("\n", "<br>")
    return (
        f"<p>{html.escape(intro)}</p>"
        f"<p><strong>Request:</strong> {html.escape(row.request_no or '')}<br>"
        f"<strong>Raised from:</strong> {html.escape(_source_label(row.source))}<br>"
        f"<strong>Title:</strong> {html.escape(row.title or '')}<br>"
        f"<strong>Item:</strong> {html.escape(row.item_name or row.category or '-')}<br>"
        f"<strong>Quantity:</strong> {html.escape(str(row.quantity))} {html.escape(row.unit or '')}<br>"
        f"<strong>Estimated amount:</strong> {html.escape(amount)}<br>"
        f"<strong>Requested by:</strong> {html.escape(row.requested_by_name or row.requested_by_email or '-')}<br>"
        f"<strong>Status:</strong> {html.escape(STATUS_LABEL.get(row.status, row.status))}</p>"
        f"<p><strong>Justification:</strong><br>{why}</p>"
        f"<p>Sign in to Manager, Finance, or IT / Inventory to review this request.</p>"
    )


def _send_purchase_mail(subject, body, recipients):
    from .email import send_email_via_zeptomail

    sender = current_app.config.get("ZEPTO_SENDER_EMAIL")
    from_name = (current_app.config.get("ZEPTO_SENDER_NAME") or "SaffoPeople").strip()
    for addr in _unique_emails(recipients):
        try:
            send_email_via_zeptomail(
                sender_email=sender,
                subject=subject,
                body=body,
                recipient_email=addr,
                from_name=from_name,
            )
        except Exception:
            current_app.logger.exception("purchase request email failed to %s", addr)


def _notify_created(row, requester):
    contact = resolve_manager_contact_for_employee(requester)
    managers = get_manager_emails(contact, exclude_email=(requester.email or "").strip())
    recipients = _unique_emails(managers, [_finance_mailbox()])
    _send_purchase_mail(
        f"Purchase request {row.request_no} waiting on manager",
        _purchase_mail_body(row, "A purchase request was raised and needs manager confirmation first."),
        recipients,
    )


def _notify_status(row, subject, intro, extra=None):
    recipients = _unique_emails(
        [row.requested_by_email, _finance_mailbox(), _it_mailbox()],
        extra or [],
    )
    _send_purchase_mail(subject, _purchase_mail_body(row, intro), recipients)


def _can_it(admin):
    claims = get_jwt() or {}
    return can_access_it_panel(claims) or is_org_admin(claims)


def _can_finance(admin):
    claims = get_jwt() or {}
    return can_access_finance_panel(claims)


def _can_manager_act(viewer, row):
    requester = get_admin_in_tenant(row.requested_by_admin_id, row.tenant_id)
    if not requester:
        return False
    contact = resolve_manager_contact_for_employee(requester)
    return is_manager_in_contact(contact, viewer)


def _serialize(row):
    attachments = []
    for item in _parse_attachments(row.attachments_json):
        path = (item.get("path") or "").strip()
        attachments.append({
            "name": item.get("name") or os.path.basename(path),
            "url": build_signed_file_url(path) if path else "",
        })
    return {
        "id": row.id,
        "request_no": row.request_no,
        "title": row.title,
        "source": _normalize_source(row.source),
        "source_label": _source_label(row.source),
        "category": row.category,
        "item_name": row.item_name,
        "quantity": row.quantity,
        "unit": row.unit,
        "estimated_amount": float(row.estimated_amount) if row.estimated_amount is not None else None,
        "vendor_hint": row.vendor_hint,
        "needed_by": row.needed_by,
        "justification": row.justification,
        "status": row.status,
        "status_label": STATUS_LABEL.get(row.status, row.status),
        "requested_by_name": row.requested_by_name,
        "requested_by_email": row.requested_by_email,
        "manager_name": row.manager_name,
        "manager_remarks": row.manager_remarks,
        "manager_acted_at": row.manager_acted_at.isoformat() if row.manager_acted_at else None,
        "finance_name": row.finance_name,
        "finance_remarks": row.finance_remarks,
        "finance_acted_at": row.finance_acted_at.isoformat() if row.finance_acted_at else None,
        "received_at": row.received_at.isoformat() if row.received_at else None,
        "receive_notes": row.receive_notes,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "attachments": attachments,
    }


def _tenant_query():
    return InventoryPurchaseRequest.query.filter_by(tenant_id=get_current_tenant_id())


def _next_request_no(tenant_id):
    count = InventoryPurchaseRequest.query.filter_by(tenant_id=tenant_id).count()
    return f"PR-{tenant_id}-{count + 1:04d}"


def ensure_purchase_table():
    try:
        InventoryPurchaseRequest.__table__.create(bind=db.engine, checkfirst=True)
    except Exception:
        current_app.logger.exception("inventory purchase table create")
    try:
        from sqlalchemy import inspect, text

        insp = inspect(db.engine)
        table = InventoryPurchaseRequest.__tablename__
        if table not in insp.get_table_names():
            return
        existing = {c["name"] for c in insp.get_columns(table)}
        if "source" in existing:
            return
        dialect = db.engine.dialect.name
        col = 'ADD COLUMN source VARCHAR(20) DEFAULT \'inventory\''
        stmt = text(f'ALTER TABLE "{table}" {col}') if dialect == "postgresql" else text(f"ALTER TABLE {table} {col}")
        with db.engine.begin() as conn:
            conn.execute(stmt)
    except Exception:
        current_app.logger.exception("inventory purchase source column")


@purchase_bp.route("/", methods=["GET"], strict_slashes=False)
@jwt_required()
def list_requests():
    ensure_purchase_table()
    viewer, err = _viewer()
    if err:
        return err
    inbox = (request.args.get("inbox") or "mine").strip().lower()
    status = (request.args.get("status") or "").strip().lower()
    q = _tenant_query()

    if inbox == "manager":
        rows = q.filter(InventoryPurchaseRequest.status == "pending_manager").order_by(
            InventoryPurchaseRequest.id.desc()
        ).all()
        rows = [row for row in rows if _can_manager_act(viewer, row)]
    elif inbox == "finance":
        if not _can_finance(viewer):
            return _err("Finance access required", 403)
        if status:
            q = q.filter(InventoryPurchaseRequest.status == status)
        else:
            q = q.filter(InventoryPurchaseRequest.status.in_(FINANCE_VISIBLE))
        rows = q.order_by(InventoryPurchaseRequest.id.desc()).all()
    else:
        if not _can_it(viewer):
            return _err("Inventory access required", 403)
        if status:
            q = q.filter(InventoryPurchaseRequest.status == status)
        rows = q.order_by(InventoryPurchaseRequest.id.desc()).limit(200).all()

    return _ok({"requests": [_serialize(row) for row in rows]})


@purchase_bp.route("/", methods=["POST"], strict_slashes=False)
@jwt_required()
def create_request():
    ensure_purchase_table()
    viewer, err = _viewer()
    if err:
        return err
    if not _can_it(viewer):
        return _err("Inventory access required", 403)

    title = (request.form.get("title") or "").strip()
    justification = (request.form.get("justification") or "").strip()
    if not title:
        return _err("Add a short title for this purchase.")
    if not justification:
        return _err("Explain why this purchase is needed.")
    if not _has_manager(viewer):
        return _err("Assign a manager for this employee before raising a purchase request.")

    qty_raw = (request.form.get("quantity") or "1").strip()
    try:
        quantity = max(1, int(qty_raw))
    except ValueError:
        return _err("Quantity must be a whole number.")

    amount = None
    amount_raw = (request.form.get("estimated_amount") or "").strip()
    if amount_raw:
        try:
            amount = Decimal(amount_raw)
        except InvalidOperation:
            return _err("Estimated amount is not a valid number.")

    tid = get_current_tenant_id()
    try:
        files = request.files.getlist("files") or request.files.getlist("file")
        attachments = _save_files(files, tid)
    except ValueError as exc:
        return _err(str(exc))

    row = InventoryPurchaseRequest(
        tenant_id=tid,
        request_no=_next_request_no(tid),
        requested_by_admin_id=viewer.id,
        requested_by_name=_display_name(viewer),
        requested_by_email=(viewer.email or "").strip(),
        title=title[:200],
        source=_normalize_source(request.form.get("source") or request.args.get("source")),
        category=(request.form.get("category") or "").strip()[:80] or None,
        item_name=(request.form.get("item_name") or "").strip()[:200] or None,
        quantity=quantity,
        unit=(request.form.get("unit") or "").strip()[:40] or None,
        estimated_amount=amount,
        vendor_hint=(request.form.get("vendor_hint") or "").strip()[:200] or None,
        needed_by=(request.form.get("needed_by") or "").strip()[:20] or None,
        justification=justification,
        attachments_json=json.dumps(attachments) if attachments else None,
        status="pending_manager",
    )
    db.session.add(row)
    db.session.commit()
    try:
        _notify_created(row, viewer)
    except Exception:
        current_app.logger.exception("purchase create notify")
    return _ok({"request": _serialize(row), "message": "Request submitted."}, 201)


@purchase_bp.route("/<int:request_id>/manager-action", methods=["POST"])
@jwt_required()
def manager_action(request_id):
    viewer, err = _viewer()
    if err:
        return err
    row = _tenant_query().filter_by(id=request_id).first()
    if not row:
        return _err("Request not found", 404)
    if row.status != "pending_manager":
        return _err("This request is not waiting on a manager.")
    if viewer.id == row.requested_by_admin_id:
        return _err("You cannot approve your own purchase request.", 403)
    if not _can_manager_act(viewer, row):
        return _err("You are not the manager for this request.", 403)

    data = request.get_json(silent=True) or {}
    action = (data.get("action") or "").strip().lower()
    remarks = (data.get("remarks") or "").strip()
    if action not in ("approve", "reject"):
        return _err("action must be approve or reject.")
    if action == "reject" and not remarks:
        return _err("Add a remark when rejecting.")

    row.manager_admin_id = viewer.id
    row.manager_name = _display_name(viewer)
    row.manager_remarks = remarks or None
    row.manager_acted_at = utc_now()
    row.status = "pending_finance" if action == "approve" else "manager_rejected"
    db.session.commit()
    try:
        if action == "approve":
            _notify_status(
                row,
                f"Purchase request {row.request_no} approved by manager",
                "The manager confirmed this purchase. Finance can now approve the budget.",
            )
        else:
            _notify_status(
                row,
                f"Purchase request {row.request_no} rejected by manager",
                "The manager rejected this purchase request.",
            )
    except Exception:
        current_app.logger.exception("purchase manager notify")
    return _ok({"request": _serialize(row)})


@purchase_bp.route("/<int:request_id>/finance-action", methods=["POST"])
@jwt_required()
def finance_action(request_id):
    viewer, err = _viewer()
    if err:
        return err
    if not _can_finance(viewer):
        return _err("Finance access required", 403)
    row = _tenant_query().filter_by(id=request_id).first()
    if not row:
        return _err("Request not found", 404)
    if row.status != "pending_finance":
        return _err("This request is not waiting on finance.")

    data = request.get_json(silent=True) or {}
    action = (data.get("action") or "").strip().lower()
    remarks = (data.get("remarks") or "").strip()
    if action not in ("approve", "reject"):
        return _err("action must be approve or reject.")
    if action == "reject" and not remarks:
        return _err("Add a remark when rejecting.")

    row.finance_admin_id = viewer.id
    row.finance_name = _display_name(viewer)
    row.finance_remarks = remarks or None
    row.finance_acted_at = utc_now()
    row.status = "finance_approved" if action == "approve" else "finance_rejected"
    db.session.commit()
    try:
        if action == "approve":
            _notify_status(
                row,
                f"Purchase request {row.request_no} approved by finance",
                "Finance approved the budget. IT or Inventory can receive the goods.",
            )
        else:
            _notify_status(
                row,
                f"Purchase request {row.request_no} rejected by finance",
                "Finance rejected this purchase request.",
            )
    except Exception:
        current_app.logger.exception("purchase finance notify")
    return _ok({"request": _serialize(row)})


@purchase_bp.route("/<int:request_id>/receive", methods=["POST"])
@jwt_required()
def receive_request(request_id):
    viewer, err = _viewer()
    if err:
        return err
    if not _can_it(viewer):
        return _err("Inventory access required", 403)
    row = _tenant_query().filter_by(id=request_id).first()
    if not row:
        return _err("Request not found", 404)
    if row.status != "finance_approved":
        return _err("Receive goods only after finance approval.")
    data = request.get_json(silent=True) or {}
    row.received_by_admin_id = viewer.id
    row.received_at = utc_now()
    row.receive_notes = (data.get("notes") or "").strip() or None
    row.status = "received"
    db.session.commit()
    return _ok({"request": _serialize(row)})


@purchase_bp.route("/<int:request_id>/cancel", methods=["POST"])
@jwt_required()
def cancel_request(request_id):
    viewer, err = _viewer()
    if err:
        return err
    row = _tenant_query().filter_by(id=request_id).first()
    if not row:
        return _err("Request not found", 404)
    if row.requested_by_admin_id != viewer.id and not is_org_admin(get_jwt() or {}):
        return _err("Only the requester can cancel this.", 403)
    if row.status not in ("pending_manager", "pending_finance"):
        return _err("This request can no longer be cancelled.")
    row.status = "cancelled"
    db.session.commit()
    return _ok({"request": _serialize(row)})
