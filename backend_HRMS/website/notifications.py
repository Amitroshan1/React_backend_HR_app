from flask import Blueprint, jsonify, request
from flask_jwt_extended import jwt_required, get_jwt

from . import db
from .models.Admin_models import Admin
from .models.notification import Notification


notifications = Blueprint("notifications", __name__)


def _current_admin():
    email = get_jwt().get("email")
    if not email:
        return None
    return Admin.query.filter_by(email=email).first()


@notifications.route("/", methods=["GET"])
@jwt_required()
def list_notifications():
    admin = _current_admin()
    if not admin:
        return jsonify({"success": False, "message": "Unauthorized user"}), 401

    limit = request.args.get("limit", type=int) or 20
    notif_type = (request.args.get("type") or "").strip()

    q = Notification.query.filter_by(recipient_admin_id=admin.id)
    if notif_type:
        q = q.filter(Notification.notif_type == notif_type)

    rows = q.order_by(Notification.created_at.desc(), Notification.id.desc()).limit(limit).all()

    data = [
        {
            "id": n.id,
            "type": n.notif_type,
            "title": n.title,
            "body": n.body,
            "entity_type": n.entity_type,
            "entity_id": n.entity_id,
            "is_read": bool(n.is_read),
            "created_at": n.created_at.isoformat() if n.created_at else None,
        }
        for n in rows
    ]

    return jsonify({"success": True, "notifications": data}), 200


@notifications.route("/unread-count", methods=["GET"])
@jwt_required()
def unread_count():
    admin = _current_admin()
    if not admin:
        return jsonify({"success": False, "message": "Unauthorized user"}), 401

    total = Notification.query.filter_by(recipient_admin_id=admin.id, is_read=False).count()
    query_count = Notification.query.filter_by(
        recipient_admin_id=admin.id, is_read=False, notif_type="query"
    ).count()

    return jsonify(
        {
            "success": True,
            "unread_count": total,
            "query_unread_count": query_count,
        }
    ), 200


@notifications.route("/mark-read", methods=["POST"])
@jwt_required()
def mark_read():
    admin = _current_admin()
    if not admin:
        return jsonify({"success": False, "message": "Unauthorized user"}), 401

    data = request.get_json(silent=True) or {}
    ids = data.get("ids") or []
    notif_type = (data.get("type") or "").strip()
    mark_all = bool(data.get("all"))

    q = Notification.query.filter_by(recipient_admin_id=admin.id, is_read=False)
    if notif_type:
        q = q.filter(Notification.notif_type == notif_type)

    if mark_all:
        rows = q.all()
    elif isinstance(ids, list) and ids:
        rows = q.filter(Notification.id.in_(ids)).all()
    else:
        return jsonify({"success": False, "message": "Provide ids or all=true"}), 400

    for row in rows:
        row.is_read = True

    db.session.commit()
    return jsonify({"success": True, "updated": len(rows)}), 200
