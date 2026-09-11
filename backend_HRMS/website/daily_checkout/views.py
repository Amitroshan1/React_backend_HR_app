"""Day-use Assets HTTP API — separate from long-term /assignments and /return-requests."""

from flask import Blueprint, jsonify, request, send_file
from flask_jwt_extended import get_jwt, jwt_required, verify_jwt_in_request

from ..datetime_utils import isoformat_api
from ..models.Admin_models import Admin
from ..models.daily_checkout import DailyCheckoutDocument, DailyCheckoutRequest
from ..models.it_models import ITAssetUnit
from ..plan_features import can_access_it_panel, has_feature, plan_forbidden_response
from . import service as svc
from .service import DailyCheckoutError, serialize_request, serialize_signature
from .state import DEFAULT_HW_TYPES, OPEN_STATUSES

daily_checkout_bp = Blueprint("daily_checkout", __name__)

EMPLOYEE_ENDPOINTS = {
    "daily_checkout.me",
    "daily_checkout.meta",
    "daily_checkout.upload_signature",
    "daily_checkout.create_request_view",
    "daily_checkout.list_mine",
    "daily_checkout.get_request",
    "daily_checkout.cancel_view",
    "daily_checkout.return_view",
    "daily_checkout.download_document",
    "daily_checkout.acknowledge_view",
}


def _current_admin():
    claims = get_jwt() or {}
    email = (claims.get("email") or "").strip()
    if email:
        admin = Admin.query.filter_by(email=email).first()
        if admin:
            return admin
    try:
        from flask_jwt_extended import get_jwt_identity

        return Admin.query.get(int(get_jwt_identity()))
    except Exception:
        return None


def _ok(payload=None, message="OK", code=200):
    body = {"success": True, "message": message}
    if payload:
        body.update(payload)
    return jsonify(body), code


def _err(message, code=400):
    return jsonify({"success": False, "message": message}), code


@daily_checkout_bp.before_request
def _guard():
    if request.method == "OPTIONS":
        return None
    try:
        verify_jwt_in_request()
    except Exception:
        return jsonify({"success": False, "message": "Unauthorized"}), 401
    claims = get_jwt() or {}
    if can_access_it_panel(claims):
        return None
    if not has_feature("dashboard_my_assets"):
        return plan_forbidden_response("dashboard_my_assets")
    endpoint = request.endpoint or ""
    if endpoint in EMPLOYEE_ENDPOINTS:
        return None
    return plan_forbidden_response("it_panel")


def _handle(fn):
    try:
        return fn()
    except DailyCheckoutError as exc:
        return _err(exc.message, exc.code)


@daily_checkout_bp.route("/meta", methods=["GET"])
@jwt_required()
def meta():
    admin = _current_admin()
    if not admin:
        return _err("Unauthorized", 401)
    sig = svc.current_signature(admin.id)
    expected = svc.default_expected_return_utc()
    return _ok(
        {
            "hw_types": svc.hardware_types() or list(DEFAULT_HW_TYPES),
            "needs_signature": sig is None,
            "signature": serialize_signature(sig),
            "default_expected_return_at": isoformat_api(expected),
            "open_request": None,
        }
    )


@daily_checkout_bp.route("/me", methods=["GET"])
@jwt_required()
def me():
    admin = _current_admin()
    if not admin:
        return _err("Unauthorized", 401)
    sig = svc.current_signature(admin.id)
    rows = svc.list_requests_for_employee(admin.id)
    open_rows = [r for r in rows if r.status in OPEN_STATUSES]
    open_row = open_rows[0] if open_rows else None
    return _ok(
        {
            "needs_signature": sig is None,
            "signature": serialize_signature(sig),
            "open_request": serialize_request(open_row) if open_row else None,
            "open_requests": [serialize_request(r) for r in open_rows],
            "requests": [serialize_request(r) for r in rows],
            "hw_types": svc.hardware_types() or list(DEFAULT_HW_TYPES),
            "default_expected_return_at": isoformat_api(svc.default_expected_return_utc()),
        }
    )


@daily_checkout_bp.route("/signature", methods=["POST"])
@jwt_required()
def upload_signature():
    admin = _current_admin()
    if not admin:
        return _err("Unauthorized", 401)

    def _run():
        row = svc.upload_signature(admin, request.files.get("signature") or request.files.get("file"))
        return _ok({"signature": serialize_signature(row)}, "Signature saved", 201)

    return _handle(_run)


@daily_checkout_bp.route("/requests", methods=["POST"])
@jwt_required()
def create_request_view():
    admin = _current_admin()
    if not admin:
        return _err("Unauthorized", 401)
    data = request.get_json(silent=True) or {}

    def _run():
        row = svc.create_request(
            admin,
            hw_type=data.get("hw_type") or data.get("requested_hw_type"),
            notes=data.get("notes") or data.get("requested_notes"),
            items=data.get("items"),
            expected_return_at=data.get("expected_return_at") or data.get("return_by"),
        )
        return _ok({"request": serialize_request(row, include_events=True)}, "Request created", 201)

    return _handle(_run)


@daily_checkout_bp.route("/requests", methods=["GET"])
@jwt_required()
def list_mine():
    admin = _current_admin()
    if not admin:
        return _err("Unauthorized", 401)
    claims = get_jwt() or {}
    if can_access_it_panel(claims):
        rows = svc.list_inbox(request.args.get("status"))
        return _ok({"requests": [serialize_request(r) for r in rows]})
    rows = svc.list_requests_for_employee(admin.id)
    return _ok({"requests": [serialize_request(r) for r in rows]})


@daily_checkout_bp.route("/inbox", methods=["GET"])
@jwt_required()
def inbox():
    rows = svc.list_inbox(request.args.get("status"))
    return _ok({"requests": [serialize_request(r) for r in rows]})


@daily_checkout_bp.route("/requests/<int:request_id>", methods=["GET"])
@jwt_required()
def get_request(request_id):
    admin = _current_admin()
    if not admin:
        return _err("Unauthorized", 401)
    row = DailyCheckoutRequest.query.get(request_id)
    if not row:
        return _err("Request not found", 404)
    claims = get_jwt() or {}
    if not can_access_it_panel(claims) and int(row.requester_admin_id) != int(admin.id):
        return _err("Access denied", 403)
    return _ok({"request": serialize_request(row, include_events=True)})


@daily_checkout_bp.route("/requests/<int:request_id>/cancel", methods=["POST"])
@jwt_required()
def cancel_view(request_id):
    admin = _current_admin()
    if not admin:
        return _err("Unauthorized", 401)
    data = request.get_json(silent=True) or {}

    def _run():
        row = svc.cancel_request(admin, request_id, data.get("reason"))
        return _ok({"request": serialize_request(row)}, "Request cancelled")

    return _handle(_run)


@daily_checkout_bp.route("/requests/<int:request_id>/approve", methods=["POST"])
@jwt_required()
def approve_view(request_id):
    actor = _current_admin()

    def _run():
        row = svc.approve_request(actor, request_id)
        return _ok({"request": serialize_request(row)}, "Request approved")

    return _handle(_run)


@daily_checkout_bp.route("/requests/<int:request_id>/reject", methods=["POST"])
@jwt_required()
def reject_view(request_id):
    actor = _current_admin()
    data = request.get_json(silent=True) or {}

    def _run():
        row = svc.reject_request(actor, request_id, data.get("reason"))
        return _ok({"request": serialize_request(row)}, "Request rejected")

    return _handle(_run)


@daily_checkout_bp.route("/available-units", methods=["GET"])
@jwt_required()
def available_units():
    from ..it import _serialize_asset_unit

    rows = svc.list_available_daily_units(
        request.args.get("hw_type"),
        search=request.args.get("q") or request.args.get("search"),
    )
    return _ok({"units": [_serialize_asset_unit(u) for u in rows]})


@daily_checkout_bp.route("/requests/<int:request_id>/assign", methods=["POST"])
@jwt_required()
def assign_view(request_id):
    actor = _current_admin()
    data = request.get_json(silent=True) or {}
    devices = data.get("devices")
    unit_id = data.get("asset_unit_id") or data.get("unit_id")
    if not devices and not unit_id:
        return _err("Select at least one inventory unit to assign")

    def _run():
        row = svc.assign_unit(
            actor,
            request_id,
            unit_id,
            data.get("condition_out"),
            accessory_comments=data.get("accessory_comments") or data.get("accessories"),
            remarks=data.get("remarks") or data.get("device_remarks"),
            devices=devices,
        )
        return _ok({"request": serialize_request(row, include_events=True)}, "Asset assigned")

    return _handle(_run)


@daily_checkout_bp.route("/requests/<int:request_id>/return", methods=["POST"])
@jwt_required()
def return_view(request_id):
    admin = _current_admin()
    if not admin:
        return _err("Unauthorized", 401)

    def _run():
        row = svc.request_return(admin, request_id)
        return _ok({"request": serialize_request(row)}, "Return requested")

    return _handle(_run)


@daily_checkout_bp.route("/requests/<int:request_id>/complete-return", methods=["POST"])
@jwt_required()
def complete_return_view(request_id):
    actor = _current_admin()
    data = request.get_json(silent=True) or {}
    walk_up = bool(data.get("walk_up"))

    def _run():
        row = svc.complete_return(
            actor,
            request_id,
            condition_in=data.get("condition_in"),
            remarks=data.get("remarks"),
            walk_up=walk_up,
        )
        return _ok({"request": serialize_request(row, include_events=True)}, "Return completed")

    return _handle(_run)


@daily_checkout_bp.route("/units/<int:unit_id>/daily-pool", methods=["PATCH"])
@jwt_required()
def daily_pool(unit_id):
    data = request.get_json(silent=True) or {}
    enabled = data.get("is_daily_pool")
    if enabled is None:
        enabled = data.get("enabled")

    def _run():
        unit = svc.set_daily_pool(unit_id, bool(enabled))
        from ..it import _serialize_asset_unit

        return _ok({"unit": _serialize_asset_unit(unit)}, "Day-use pool updated")

    return _handle(_run)


@daily_checkout_bp.route("/pool-units", methods=["GET"])
@jwt_required()
def pool_units():
    from .. import db
    from ..it import _serialize_asset_unit

    q = ITAssetUnit.query.filter(
        db.func.lower(db.func.coalesce(ITAssetUnit.category, "Hardware")) == "hardware",
        db.func.lower(db.func.coalesce(ITAssetUnit.status, "")) == "available",
    )
    rows = q.order_by(ITAssetUnit.asset_name.asc(), ITAssetUnit.id.asc()).limit(500).all()
    return _ok({"units": [_serialize_asset_unit(u) for u in rows]})


@daily_checkout_bp.route("/requests/<int:request_id>/acknowledge", methods=["POST"])
@jwt_required()
def acknowledge_view(request_id):
    actor = _current_admin()
    if not actor:
        return _err("Unauthorized", 401)
    claims = get_jwt() or {}
    row = DailyCheckoutRequest.query.get(request_id)
    if not row:
        return _err("Request not found", 404)
    if not can_access_it_panel(claims) and int(row.requester_admin_id) != int(actor.id):
        return _err("Access denied", 403)

    def _run():
        updated, created = svc.acknowledge_acceptance(actor, request_id)
        msg = "Acceptance PDF generated" if created else "Acceptance PDF ready"
        return _ok({"request": serialize_request(updated, include_events=True), "created": created}, msg)

    return _handle(_run)


@daily_checkout_bp.route("/requests/<int:request_id>/documents/<string:doc_type>", methods=["GET"])
@jwt_required()
def download_document(request_id, doc_type):
    import os

    admin = _current_admin()
    if not admin:
        return _err("Unauthorized", 401)
    row = DailyCheckoutRequest.query.get(request_id)
    if not row:
        return _err("Request not found", 404)
    claims = get_jwt() or {}
    if not can_access_it_panel(claims) and int(row.requester_admin_id) != int(admin.id):
        return _err("Access denied", 403)
    key = "acceptance" if str(doc_type).lower() in ("acceptance", "accept") else "return_ack"
    # Rebuild letter layout so downloads pick up the current acknowledgement template.
    try:
        from .pdf_service import generate_document

        generate_document(row.id, key, actor=admin, force=True)
    except Exception:
        pass
    doc = DailyCheckoutDocument.query.filter_by(request_id=row.id, doc_type=key).first()
    if not doc:
        return _err("Document not found", 404)
    from .pdf_service import _abs, document_download_name

    path = _abs(doc.file_path)
    if not os.path.isfile(path):
        return _err("File missing", 404)
    return send_file(
        path,
        mimetype="application/pdf",
        as_attachment=True,
        download_name=document_download_name(row, key),
    )
