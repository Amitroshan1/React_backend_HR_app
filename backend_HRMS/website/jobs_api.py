"""Status and download endpoints for Phase 6 background jobs."""
from __future__ import annotations

import json
import os

from flask import Blueprint, current_app, jsonify, send_file
from flask_jwt_extended import jwt_required

from . import db
from .jobs import STATUS_SUCCEEDED, job_to_dict
from .models.background_job import BackgroundJob
from .tenant_context import current_admin, get_current_tenant_id, tenant_id_for_admin

jobs_bp = Blueprint("jobs", __name__)


def _owned_job(job_id: int) -> tuple[BackgroundJob | None, tuple | None]:
    viewer = current_admin()
    if not viewer:
        return None, (jsonify({"success": False, "message": "Unauthorized"}), 401)
    job = db.session.get(BackgroundJob, int(job_id))
    if job is None:
        return None, (jsonify({"success": False, "message": "Job not found"}), 404)
    tid = get_current_tenant_id() or tenant_id_for_admin(viewer)
    if int(job.tenant_id) != int(tid):
        return None, (jsonify({"success": False, "message": "Job not found"}), 404)
    if job.requested_by_admin_id and int(job.requested_by_admin_id) != int(viewer.id):
        # Same company staff can poll jobs they did not start (Accounts/HR shared work).
        emp = (viewer.emp_type or "").strip().lower()
        allowed = emp in (
            "admin",
            "hr",
            "human resource",
            "accounts",
            "account",
            "finance",
        )
        if not allowed:
            return None, (jsonify({"success": False, "message": "Access denied"}), 403)
    return job, None


@jobs_bp.route("/<int:job_id>", methods=["GET"])
@jwt_required()
def get_job(job_id: int):
    job, err = _owned_job(job_id)
    if err:
        return err
    return jsonify({"success": True, "job": job_to_dict(job)}), 200


@jobs_bp.route("/<int:job_id>/download", methods=["GET"])
@jwt_required()
def download_job(job_id: int):
    job, err = _owned_job(job_id)
    if err:
        return err
    if job.status != STATUS_SUCCEEDED:
        return jsonify({"success": False, "message": "Job is not ready for download"}), 409
    try:
        result = json.loads(job.result_json or "{}")
    except Exception:
        result = {}
    if not isinstance(result, dict):
        result = {}
    rel = (result.get("download_path") or "").strip()
    if not rel:
        return jsonify({"success": False, "message": "This job has no downloadable file"}), 404
    root = current_app.config.get("UPLOADS_ROOT") or current_app.config.get("UPLOAD_FOLDER")
    if not root:
        root = os.path.join(current_app.root_path, "static", "uploads")
    abs_path = os.path.join(root, *rel.split("/"))
    if not os.path.isfile(abs_path):
        return jsonify({"success": False, "message": "Export file missing"}), 404
    filename = result.get("filename") or os.path.basename(abs_path)
    return send_file(abs_path, as_attachment=True, download_name=filename, mimetype="text/csv")
