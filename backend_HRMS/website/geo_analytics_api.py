"""HR Geo Analytics / Monitoring API routes (registered on HumanResource blueprint)."""
from __future__ import annotations

from flask import Response, jsonify, request
from flask_jwt_extended import get_jwt, get_jwt_identity, jwt_required

from . import geo_analytics_service as gas


def register_geo_analytics_routes(hr, hr_required):
    """Attach /geo-analytics/* routes to the HR blueprint."""

    def _range_args():
        return gas.resolve_date_range(
            request.args.get("preset"),
            request.args.get("from") or request.args.get("date_from"),
            request.args.get("to") or request.args.get("date_to"),
        )

    @hr.route("/geo-analytics/summary", methods=["GET"])
    @jwt_required()
    @hr_required
    def geo_analytics_summary():
        start, end = _range_args()
        return jsonify({"success": True, **gas.build_summary(start, end)}), 200

    @hr.route("/geo-analytics/breakdowns", methods=["GET"])
    @jwt_required()
    @hr_required
    def geo_analytics_breakdowns():
        start, end = _range_args()
        dim = request.args.get("dimension") or "office"
        return jsonify({"success": True, **gas.build_breakdown(start, end, dim)}), 200

    @hr.route("/geo-analytics/office-health", methods=["GET"])
    @jwt_required()
    @hr_required
    def geo_analytics_office_health():
        start, end = _range_args()
        return jsonify({"success": True, **gas.build_office_health(start, end)}), 200

    @hr.route("/geo-analytics/browser-health", methods=["GET"])
    @jwt_required()
    @hr_required
    def geo_analytics_browser_health():
        start, end = _range_args()
        return jsonify({"success": True, **gas.build_browser_health(start, end)}), 200

    @hr.route("/geo-analytics/audit", methods=["GET"])
    @jwt_required()
    @hr_required
    def geo_analytics_audit():
        page = request.args.get("page", 1)
        page_size = request.args.get("page_size", 50)
        data = gas.search_audit(dict(request.args), page=page, page_size=page_size)
        return jsonify({"success": True, **data}), 200

    @hr.route("/geo-analytics/audit/export", methods=["GET"])
    @jwt_required()
    @hr_required
    def geo_analytics_audit_export():
        csv_text = gas.export_audit_csv(dict(request.args))
        return Response(
            csv_text,
            mimetype="text/csv",
            headers={
                "Content-Disposition": "attachment; filename=geo-audit-export.csv",
            },
        )

    @hr.route("/geo-analytics/attempt/<string:attempt_id>", methods=["GET"])
    @jwt_required()
    @hr_required
    def geo_analytics_attempt_detail(attempt_id):
        data = gas.explain_attempt(attempt_id)
        if not data:
            return jsonify({"success": False, "message": "Attempt not found"}), 404
        return jsonify({"success": True, **data}), 200

    @hr.route("/geo-analytics/monitoring", methods=["GET"])
    @jwt_required()
    @hr_required
    def geo_analytics_monitoring():
        start, end = _range_args()
        return jsonify({"success": True, **gas.build_monitoring(start, end)}), 200

    @hr.route("/geo-analytics/alerts", methods=["GET"])
    @jwt_required()
    @hr_required
    def geo_analytics_alerts():
        start, end = _range_args()
        return jsonify({"success": True, **gas.build_alerts(start, end)}), 200

    @hr.route("/geo-analytics/recommendations", methods=["GET"])
    @jwt_required()
    @hr_required
    def geo_analytics_recommendations():
        start, end = _range_args()
        return jsonify({"success": True, **gas.build_recommendations(start, end)}), 200

    @hr.route("/geo-analytics/security", methods=["GET"])
    @jwt_required()
    @hr_required
    def geo_analytics_security():
        start, end = _range_args()
        return jsonify({"success": True, **gas.build_security(start, end)}), 200

    @hr.route("/geo-analytics/config", methods=["GET"])
    @jwt_required()
    @hr_required
    def geo_analytics_config_get():
        return jsonify({"success": True, **gas.get_config_for_admin()}), 200

    @hr.route("/geo-analytics/config", methods=["PUT", "PATCH"])
    @jwt_required()
    @hr_required
    def geo_analytics_config_put():
        body = request.get_json() or {}
        updates = body.get("updates") or body.get("config") or {}
        reason = body.get("reason") or ""
        claims = get_jwt() or {}
        try:
            identity = get_jwt_identity()
            admin_id = int(identity) if identity is not None else None
        except (TypeError, ValueError):
            admin_id = claims.get("admin_id")
        try:
            result = gas.apply_config_updates(
                updates,
                reason=reason,
                admin_id=admin_id,
                admin_email=claims.get("email"),
            )
            return jsonify({"success": True, **result}), 200
        except ValueError as e:
            return jsonify({"success": False, "message": str(e)}), 400
        except Exception as e:
            return jsonify({"success": False, "message": str(e) or "Config update failed"}), 500

    @hr.route("/geo-analytics/config/history", methods=["GET"])
    @jwt_required()
    @hr_required
    def geo_analytics_config_history():
        limit = request.args.get("limit", 100)
        try:
            limit = int(limit)
        except (TypeError, ValueError):
            limit = 100
        return jsonify({"success": True, "rows": gas.config_history(limit)}), 200

    # ----- Phase 6: Shadow comparison & rollout (does not change punch math) -----
    from . import geo_shadow_analytics as gsa

    @hr.route("/geo-analytics/comparison/summary", methods=["GET"])
    @jwt_required()
    @hr_required
    def geo_comparison_summary():
        start, end = _range_args()
        return jsonify({"success": True, **gsa.build_comparison_summary(start, end)}), 200

    @hr.route("/geo-analytics/comparison/disagreements", methods=["GET"])
    @jwt_required()
    @hr_required
    def geo_comparison_disagreements():
        data = gsa.search_disagreements(
            dict(request.args),
            page=request.args.get("page", 1),
            page_size=request.args.get("page_size", 50),
        )
        return jsonify({"success": True, **data}), 200

    @hr.route("/geo-analytics/comparison/disagreements/export", methods=["GET"])
    @jwt_required()
    @hr_required
    def geo_comparison_disagreements_export():
        csv_text = gsa.export_disagreements_csv(dict(request.args))
        return Response(
            csv_text,
            mimetype="text/csv",
            headers={"Content-Disposition": "attachment; filename=geo-engine-disagreements.csv"},
        )

    @hr.route("/geo-analytics/comparison/offices", methods=["GET"])
    @jwt_required()
    @hr_required
    def geo_comparison_offices():
        start, end = _range_args()
        return jsonify({"success": True, **gsa.build_office_comparison(start, end)}), 200

    @hr.route("/geo-analytics/rollout", methods=["GET"])
    @jwt_required()
    @hr_required
    def geo_rollout_status():
        start, end = _range_args()
        return jsonify({"success": True, **gsa.build_rollout_status(start, end)}), 200

    @hr.route("/geo-analytics/engine-mode", methods=["GET"])
    @jwt_required()
    @hr_required
    def geo_engine_mode_get():
        from .geo_mode_orchestrator import get_engine_mode

        return jsonify({
            "success": True,
            "mode": get_engine_mode(),
            "config": gas.get_config_for_admin(),
        }), 200

    @hr.route("/geo-analytics/engine-mode", methods=["PUT", "PATCH"])
    @jwt_required()
    @hr_required
    def geo_engine_mode_put():
        """Instant mode switch via versioned config (no deploy)."""
        body = request.get_json() or {}
        mode = str(body.get("mode") or "").strip().upper()
        reason = body.get("reason") or f"Set GEO_ENGINE_MODE={mode}"
        if mode not in {"LEGACY", "SHADOW", "V2"}:
            return jsonify({"success": False, "message": "mode must be LEGACY, SHADOW, or V2"}), 400
        claims = get_jwt() or {}
        try:
            identity = get_jwt_identity()
            admin_id = int(identity) if identity is not None else None
        except (TypeError, ValueError):
            admin_id = None
        try:
            result = gas.apply_config_updates(
                {"GEO_ENGINE_MODE": mode},
                reason=reason,
                admin_id=admin_id,
                admin_email=claims.get("email"),
            )
            return jsonify({"success": True, "mode": mode, **result}), 200
        except ValueError as e:
            return jsonify({"success": False, "message": str(e)}), 400
