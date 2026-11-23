"""Public company KYB form APIs (token in query/body, no JWT)."""
from __future__ import annotations

import time
from collections import defaultdict

from flask import Blueprint, jsonify, request

from .commands.kyb_identity import INVALID_LINK_MESSAGE
from .tenant_kyb_service import (
    KybError,
    delete_document,
    public_context,
    save_document,
    save_profile,
    submit_kyb,
)

tenant_kyb_bp = Blueprint("tenant_kyb", __name__)

_RATE: dict[str, list[float]] = defaultdict(list)
_RATE_MAX = 40
_RATE_WINDOW = 60.0


def _rate_ok() -> bool:
    ip = (request.headers.get("X-Forwarded-For") or request.remote_addr or "0").split(",")[0].strip()
    now = time.monotonic()
    bucket = _RATE[ip]
    _RATE[ip] = [t for t in bucket if now - t < _RATE_WINDOW]
    if len(_RATE[ip]) >= _RATE_MAX:
        return False
    _RATE[ip].append(now)
    return True


def _token():
    if request.method == "GET":
        return (request.args.get("t") or request.args.get("token") or "").strip()
    if request.content_type and "multipart/form-data" in request.content_type:
        return (request.form.get("t") or request.form.get("token") or request.args.get("t") or "").strip()
    data = request.get_json(silent=True) or {}
    return (data.get("t") or data.get("token") or request.args.get("t") or "").strip()


def _fail(exc: KybError):
    return jsonify(success=False, message=exc.message), exc.status_code


@tenant_kyb_bp.before_request
def _public_kyb_rate_limit():
    if not _rate_ok():
        return jsonify(success=False, message="Too many attempts. Try again in a minute."), 429
    return None


@tenant_kyb_bp.route("", methods=["GET"])
@tenant_kyb_bp.route("/", methods=["GET"])
def kyb_get():
    token = _token()
    if not token:
        return jsonify(success=False, message=INVALID_LINK_MESSAGE), 404
    try:
        return jsonify(public_context(token)), 200
    except KybError as exc:
        return _fail(exc)


@tenant_kyb_bp.route("/profile", methods=["PUT"])
def kyb_profile():
    token = _token()
    if not token:
        return jsonify(success=False, message=INVALID_LINK_MESSAGE), 404
    data = request.get_json(silent=True) or {}
    data.pop("t", None)
    data.pop("token", None)
    data.pop("tenant_id", None)
    try:
        return jsonify(save_profile(token, data)), 200
    except KybError as exc:
        return _fail(exc)


@tenant_kyb_bp.route("/documents", methods=["POST"])
def kyb_upload():
    token = _token()
    if not token:
        return jsonify(success=False, message=INVALID_LINK_MESSAGE), 404
    doc_type = (request.form.get("doc_type") or request.args.get("doc_type") or "").strip()
    upload = request.files.get("file") or request.files.get("document")
    try:
        return jsonify(save_document(token, doc_type=doc_type, file_storage=upload)), 200
    except KybError as exc:
        return _fail(exc)


@tenant_kyb_bp.route("/documents/<int:doc_id>", methods=["DELETE"])
def kyb_delete_doc(doc_id):
    token = _token()
    if not token:
        return jsonify(success=False, message=INVALID_LINK_MESSAGE), 404
    try:
        return jsonify(delete_document(token, doc_id)), 200
    except KybError as exc:
        return _fail(exc)


@tenant_kyb_bp.route("/submit", methods=["POST"])
def kyb_submit():
    token = _token()
    if not token:
        return jsonify(success=False, message=INVALID_LINK_MESSAGE), 404
    try:
        body = submit_kyb(token)
        return jsonify(body), 200
    except KybError as exc:
        return _fail(exc)
