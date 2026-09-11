"""Frozen Day-use acceptance / return acknowledgement letters."""

from __future__ import annotations

import hashlib
import os
import re
from datetime import datetime, timezone
from io import BytesIO

from reportlab.lib.pagesizes import A4
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas

from .. import db
from ..datetime_utils import IST, format_ist_display, utc_now
from ..models.Admin_models import Admin
from ..models.daily_checkout import DailyCheckoutDocument, DailyCheckoutRequest
from ..pdf_watermark import install_page_watermark
from .service import DOC_ACCEPTANCE, DOC_RETURN, _add_event, _uploads_root, current_signature

COMPANY_NAME = "Saffo Solution Technology LLP"
COMPANY_ADDRESS_LINES = (
    "405, A Wing, 4th Floor",
    "Technocity TTC Indl Area, Mhape",
    "Navi Mumbai",
)
COMPANY_CONTACT_LINES = (
    "CIN: AAP-6504",
    "E-Mail : finance@saffotech.com",
)


def document_download_name(row, doc_type) -> str:
    """Browser download name: acknowledgement type + request date + employee id."""
    key = "acceptance" if str(doc_type).lower() in ("acceptance", "accept") else "return_ack"
    label = "acceptance-acknowledgement" if key == "acceptance" else "return-acknowledgement"
    when = getattr(row, "created_at", None)
    if isinstance(when, datetime):
        if when.tzinfo is None:
            when = when.replace(tzinfo=timezone.utc)
        date_part = when.astimezone(IST).strftime("%Y-%m-%d")
    else:
        date_part = "unknown-date"
    emp = re.sub(r"[^A-Za-z0-9_-]+", "", str(getattr(row, "requester_emp_id_snapshot", None) or "emp")) or "emp"
    return f"{label}-{date_part}-{emp}.pdf"


def _abs(rel):
    return os.path.join(_uploads_root(), str(rel).replace("/", os.sep))


def _admin_name(admin):
    if not admin:
        return "—"
    return (admin.first_name or admin.user_name or "—").strip() or "—"


def _dash(value):
    text = str(value or "").strip()
    return text or "—"


def _fmt_dt(value):
    if not value:
        return "—"
    try:
        return format_ist_display(value)
    except Exception:
        return str(value)


def _device_rows(assignment):
    if not assignment:
        return []
    fulfillment = getattr(assignment, "fulfillment_json", None) or {}
    devices = fulfillment.get("devices") if isinstance(fulfillment, dict) else None
    rows = []
    if isinstance(devices, list) and devices:
        for dev in devices:
            if not isinstance(dev, dict):
                continue
            rows.append({
                "hw_type": _dash(dev.get("hw_type") or "Device"),
                "asset_name": _dash(dev.get("asset_name")),
                "brand": _dash(dev.get("brand")),
                "model": _dash(dev.get("make") or dev.get("model")),
                "code": _dash(dev.get("unit_code") or dev.get("model")),
                "serial": _dash(dev.get("serial")),
                "project": _dash(dev.get("project_code")),
                "imei": " / ".join(
                    p for p in (str(dev.get("imei1") or "").strip(), str(dev.get("imei2") or "").strip()) if p
                ) or "—",
                "remarks": (dev.get("remarks") or "").strip(),
            })
        return rows
    return [{
        "hw_type": "Device",
        "asset_name": _dash(assignment.asset_name_snapshot),
        "brand": _dash(assignment.brand_snapshot),
        "model": _dash(assignment.model_snapshot),
        "code": _dash(assignment.unit_code_snapshot),
        "serial": _dash(assignment.serial_snapshot),
        "project": "—",
        "imei": "—",
        "remarks": "",
    }]


def _accessory_rows(assignment):
    if not assignment:
        return []
    fulfillment = getattr(assignment, "fulfillment_json", None) or {}
    accessories = fulfillment.get("accessories") if isinstance(fulfillment, dict) else None
    rows = []
    if not isinstance(accessories, list):
        return rows
    for acc in accessories:
        if not isinstance(acc, dict):
            continue
        rows.append({
            "description": _dash(acc.get("description") or "Accessory"),
            "quantity": acc.get("quantity") or 1,
            "comment": (acc.get("comment") or "").strip() or "—",
        })
    return rows


def _draw_header(c, width, left, right, *, include_contact=True):
    y = A4[1] - 36
    c.setFillColorRGB(0.06, 0.16, 0.32)
    c.setFont("Helvetica-Bold", 15)
    c.drawCentredString(width / 2, y, COMPANY_NAME)
    c.setFillColorRGB(0.25, 0.30, 0.36)
    c.setFont("Helvetica", 9)
    lines = COMPANY_ADDRESS_LINES + (COMPANY_CONTACT_LINES if include_contact else ())
    for line in lines:
        y -= 12
        c.drawCentredString(width / 2, y, line)
    y -= 8
    c.setStrokeColorRGB(0.06, 0.16, 0.32)
    c.setLineWidth(1.2)
    c.line(left, y, right, y)
    c.setLineWidth(0.4)
    c.line(left, y - 3, right, y - 3)
    return y - 22


def _wrap(c, text, font, size, max_w):
    words = str(text or "").split()
    if not words:
        return [""]
    lines = []
    current = ""
    for word in words:
        trial = f"{current} {word}".strip()
        if c.stringWidth(trial, font, size) <= max_w:
            current = trial
        else:
            if current:
                lines.append(current)
            current = word
    if current:
        lines.append(current)
    return lines


def _draw_signatures(c, *, left, right, y, employee_sig, employee_name, emp_id, it_sig, it_name):
    box_w = 220
    img_h = 52
    y -= 8
    if y < 150:
        c.showPage()
        install_page_watermark(c, A4)
        y = A4[1] - 72

    c.setStrokeColorRGB(0.85, 0.88, 0.92)
    c.setFillColorRGB(0.97, 0.98, 0.99)
    c.roundRect(left, y - 118, box_w, 118, 6, stroke=1, fill=1)
    c.roundRect(right - box_w, y - 118, box_w, 118, 6, stroke=1, fill=1)

    def _block(x, title, name, extra, sig):
        c.setFillColorRGB(0.06, 0.16, 0.32)
        c.setFont("Helvetica-Bold", 8)
        c.drawString(x + 10, y - 14, title)
        if sig and os.path.isfile(_abs(sig.file_path)):
            try:
                c.drawImage(
                    ImageReader(_abs(sig.file_path)),
                    x + 10,
                    y - 74,
                    width=box_w - 24,
                    height=img_h,
                    preserveAspectRatio=True,
                    mask="auto",
                )
            except Exception:
                c.setFillColorRGB(0.4, 0.45, 0.5)
                c.setFont("Helvetica-Oblique", 8)
                c.drawString(x + 10, y - 52, "Signature on file")
        else:
            c.setStrokeColorRGB(0.7, 0.74, 0.78)
            c.line(x + 10, y - 58, x + box_w - 12, y - 58)
        c.setFillColorRGB(0.15, 0.18, 0.22)
        c.setFont("Helvetica-Bold", 9)
        c.drawString(x + 10, y - 92, str(name)[:32])
        c.setFont("Helvetica", 8)
        c.setFillColorRGB(0.35, 0.40, 0.46)
        c.drawString(x + 10, y - 106, str(extra)[:36])

    _block(left, "EMPLOYEE", employee_name, f"Emp ID {emp_id}", employee_sig)
    _block(right - box_w, "IT DEPARTMENT", it_name, "Issued and acknowledged", it_sig)
    return y - 132


def generate_document(request_id, doc_type, actor=None, *, force=False):
    row = DailyCheckoutRequest.query.get(request_id)
    if not row:
        raise ValueError("Request not found")
    existing = DailyCheckoutDocument.query.filter_by(request_id=row.id, doc_type=doc_type).first()
    if existing and not force:
        return existing

    employee_sig = None
    if existing and existing.signature_id:
        from ..models.daily_checkout import EmployeeSignature

        employee_sig = EmployeeSignature.query.get(existing.signature_id)
    if not employee_sig:
        employee_sig = current_signature(row.requester_admin_id)
    if not employee_sig:
        raise ValueError("Employee signature is missing")

    assignment = row.assignment
    ret = row.return_row
    it_admin_id = None
    if assignment and assignment.assigned_by_admin_id:
        it_admin_id = assignment.assigned_by_admin_id
    elif actor:
        it_admin_id = actor.id
    it_admin = Admin.query.get(it_admin_id) if it_admin_id else None
    it_sig = current_signature(it_admin_id) if it_admin_id else None
    if not it_sig and actor and getattr(actor, "id", None):
        actor_sig = current_signature(actor.id)
        if actor_sig:
            it_sig = actor_sig
            it_admin = actor

    buf = BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    width, height = A4
    install_page_watermark(c, A4)
    left = 46
    right = width - 46
    max_w = right - left

    is_acceptance = doc_type == DOC_ACCEPTANCE
    y = _draw_header(c, width, left, right, include_contact=not is_acceptance)
    title = "Day-use Asset Acknowledgement" if is_acceptance else "Day-use Asset Return Acknowledgement"
    c.setFillColorRGB(0.06, 0.16, 0.32)
    c.setFont("Helvetica-Bold", 14)
    c.drawCentredString(width / 2, y, title)
    y -= 16
    c.setFillColorRGB(0.35, 0.40, 0.46)
    c.setFont("Helvetica", 9)
    c.drawCentredString(
        width / 2,
        y,
        f"Request {row.request_code}    ·    Date: {_fmt_dt(utc_now())}",
    )
    y -= 18
    c.setStrokeColorRGB(0.82, 0.86, 0.90)
    c.setLineWidth(0.6)
    c.line(left, y, right, y)
    y -= 18

    emp_name = _dash(row.requester_name_snapshot)
    emp_id = _dash(row.requester_emp_id_snapshot)
    dept = _dash(row.requester_dept_snapshot)
    circle = _dash(row.requester_circle_snapshot)
    expected = _fmt_dt(row.expected_return_at)
    assigned_at = _fmt_dt(assignment.assigned_at) if assignment else "—"

    def paragraph(text, *, size=10, gap=8, bold=False):
        nonlocal y
        font = "Helvetica-Bold" if bold else "Helvetica"
        for line in _wrap(c, text, font, size, max_w):
            if y < 170:
                c.showPage()
                install_page_watermark(c, A4)
                y = height - 56
            c.setFillColorRGB(0.12, 0.16, 0.20)
            c.setFont(font, size)
            c.drawString(left, y, line)
            y -= size + 3
        y -= gap

    if is_acceptance:
        paragraph(f"To,")
        paragraph(f"{emp_name}", bold=True, gap=2)
        paragraph(f"Employee ID: {emp_id}    ·    {dept} / {circle}")
        paragraph(f"Email: {_dash(row.requester_email_snapshot)}")
        y -= 4
        paragraph("Subject: Acknowledgement of day-use assets issued", bold=True)
        paragraph(
            f"Dear {emp_name},"
        )
        paragraph(
            f"This is to acknowledge that the assets listed below have been issued to you by "
            f"{COMPANY_NAME} for day-use / temporary official use against request {row.request_code}. "
            f"You confirm receipt in good working condition and agree to return the items by {expected}."
        )
        paragraph(
            "The items remain the property of the company. You shall take reasonable care of them, "
            "use them only for official purposes, and return them to the IT Department in the same "
            "condition, except for normal wear. Loss or damage must be reported immediately."
        )
    else:
        paragraph(f"Dear {emp_name},")
        paragraph(
            f"This is to acknowledge that the day-use assets issued against request {row.request_code} "
            f"have been returned to the IT Department and received on {_fmt_dt(ret.completed_at if ret else None)}."
        )
        if ret and (ret.remarks or "").strip():
            paragraph(f"IT return remarks: {(ret.remarks or '').strip()}")
        if ret and ret.condition_in:
            paragraph(f"Condition on return: {_dash(ret.condition_in)}")

    y -= 4
    c.setFillColorRGB(0.06, 0.16, 0.32)
    c.setFont("Helvetica-Bold", 10)
    c.drawString(left, y, "Assets issued")
    y -= 8

    devices = _device_rows(assignment)
    accessories = _accessory_rows(assignment)

    def section_row(label, value):
        nonlocal y
        if y < 150:
            c.showPage()
            install_page_watermark(c, A4)
            y = height - 56
        c.setFillColorRGB(0.35, 0.40, 0.46)
        c.setFont("Helvetica", 8)
        c.drawString(left + 8, y, label)
        c.setFillColorRGB(0.12, 0.16, 0.20)
        c.setFont("Helvetica", 9)
        c.drawString(left + 110, y, str(value)[:78])
        y -= 13

    for idx, dev in enumerate(devices, start=1):
        box_top = y
        y -= 16
        c.setFillColorRGB(0.06, 0.16, 0.32)
        c.setFont("Helvetica-Bold", 9)
        c.drawString(left + 8, y, f"{idx}. {dev['hw_type']}  —  {dev['asset_name']}")
        y -= 14
        section_row("Brand / Model", f"{dev['brand']}  /  {dev['model']}")
        section_row("Asset code", dev["code"])
        section_row("Serial", dev["serial"])
        if dev["project"] != "—" or dev["imei"] != "—":
            section_row("Project / IMEI", f"{dev['project']}    {dev['imei']}")
        if dev["remarks"]:
            section_row("IT remarks", dev["remarks"])
        y -= 6
        c.setStrokeColorRGB(0.86, 0.89, 0.92)
        c.roundRect(left, y, max_w, box_top - y, 4, stroke=1, fill=0)
        y -= 10

    if accessories:
        c.setFillColorRGB(0.06, 0.16, 0.32)
        c.setFont("Helvetica-Bold", 10)
        c.drawString(left, y, "Accessories issued")
        y -= 14
        for acc in accessories:
            section_row(f"{acc['description']} ×{acc['quantity']}", acc["comment"])
        y -= 6

    paragraph(f"Assigned on: {assigned_at}", size=9, gap=2)
    paragraph(f"Expected return: {expected}", size=9, gap=10)
    if is_acceptance:
        paragraph(
            "By signing below, the employee acknowledges receipt of the above items, and the "
            "IT Department confirms that the items have been handed over.",
            size=9,
        )

    y = _draw_signatures(
        c,
        left=left,
        right=right,
        y=y,
        employee_sig=employee_sig,
        employee_name=emp_name,
        emp_id=emp_id,
        it_sig=it_sig,
        it_name=_admin_name(it_admin) if it_admin else "IT Department",
    )

    c.setFillColorRGB(0.45, 0.48, 0.52)
    c.setFont("Helvetica", 7.5)
    c.drawCentredString(
        width / 2,
        28,
        "System-generated acknowledgement. Signature images are frozen with this copy and are not altered by later uploads.",
    )

    c.save()
    pdf_bytes = buf.getvalue()

    rel_dir = f"daily_checkout/{row.id}"
    os.makedirs(os.path.join(_uploads_root(), "daily_checkout", str(row.id)), exist_ok=True)
    fname = "acceptance.pdf" if is_acceptance else "return_ack.pdf"
    rel = f"{rel_dir}/{fname}"
    with open(_abs(rel), "wb") as fh:
        fh.write(pdf_bytes)

    if existing:
        existing.file_path = rel
        existing.sha256 = hashlib.sha256(pdf_bytes).hexdigest()
        existing.signature_id = employee_sig.id
        existing.generated_by_admin_id = actor.id if actor else existing.generated_by_admin_id
        existing.generated_at = utc_now()
        doc = existing
    else:
        doc = DailyCheckoutDocument(
            request_id=row.id,
            doc_type=doc_type,
            file_path=rel,
            sha256=hashlib.sha256(pdf_bytes).hexdigest(),
            signature_id=employee_sig.id,
            generated_by_admin_id=actor.id if actor else None,
        )
        db.session.add(doc)
    code = "ACCEPTANCE_GENERATED" if is_acceptance else "RETURN_ACK_GENERATED"
    _add_event(
        row.id,
        code,
        actor=actor,
        role="it" if actor else "system",
        payload={"signature_id": employee_sig.id, "signature_version": employee_sig.version, "file_path": rel},
    )
    db.session.commit()
    return doc
