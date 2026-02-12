# create query,my query, view queries,department_queries,reply_query,close_query_api,etc
# search_managers_api,get_manager_contact_api,upsert_manager_contact_api


#https://solviotec.com/api/query



from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt
from . import db
from .models.Admin_models import Admin
from .models.query import Query, QueryReply
from .email import notify_query_event, send_query_closed_email
from .models.manager_model import ManagerContact
from werkzeug.utils import secure_filename
import json
import os
import uuid




query = Blueprint('query', __name__)

MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024
UPLOAD_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'uploads', 'queries'))





@query.route("/queries", methods=["POST"])
@jwt_required()
def create_query_api():
    claims = get_jwt()
    email = claims.get("email")

    admin = Admin.query.filter_by(email=email).first()
    if not admin:
        return jsonify({"success": False, "message": "User not found"}), 404

    data = request.form if request.form else (request.get_json() or {})
    title = data.get("title")
    department = data.get("department")
    query_text = data.get("query_text")

    if not title or not department or not query_text:
        return jsonify({
            "success": False,
            "message": "title, department and query_text are required"
        }), 400

    files = request.files.getlist("files") if request.files else []
    saved_files = []

    if files:
        os.makedirs(UPLOAD_DIR, exist_ok=True)
        for file in files:
            if not file or not file.filename:
                continue
            file.seek(0, os.SEEK_END)
            size = file.tell()
            file.seek(0)
            if size > MAX_FILE_SIZE_BYTES:
                return jsonify({
                    "success": False,
                    "message": f"{file.filename} exceeds 2MB limit"
                }), 413

            safe_name = secure_filename(file.filename)
            unique_name = f"{uuid.uuid4().hex}_{safe_name}"
            file.save(os.path.join(UPLOAD_DIR, unique_name))
            saved_files.append(unique_name)

    query_obj = Query(
        admin_id=admin.id,
        title=title,
        department=department,
        query_text=query_text,
        photo=json.dumps(saved_files) if saved_files else None
    )

    db.session.add(query_obj)
    db.session.commit()

    return jsonify({
        "success": True,
        "message": "Query created successfully",
        "query_id": query_obj.id
    }), 201





#for employee to view all queries
@query.route("/queries/my", methods=["GET"])
@jwt_required()
def my_queries():
    email = get_jwt().get("email")
    admin = Admin.query.filter_by(email=email).first()

    page = int(request.args.get("page", 1))
    limit = int(request.args.get("limit", 10))

    pagination = Query.query.filter_by(
        admin_id=admin.id
    ).order_by(Query.created_at.desc()).paginate(
        page=page, per_page=limit, error_out=False
    )

    return jsonify({
        "success": True,
        "total": pagination.total,
        "queries": [
            {
                "id": q.id,
                "title": q.title,
                "department": q.department,
                "query_text": q.query_text,
                "status": q.status,
                "created_at": q.created_at
            } for q in pagination.items
        ]
    }), 200





#department to view all queries
@query.route("/queries", methods=["GET"])
@jwt_required()
def department_queries():
    claims = get_jwt()
    emp_type = claims.get("emp_type")

    if emp_type not in ["Human Resource", "Accounts"]:
        return jsonify({"success": False, "message": "Unauthorized"}), 403

    department = request.args.get("department")
    if not department:
        return jsonify({"success": False, "message": "department required"}), 400

    queries = Query.query.filter_by(
        department=department
    ).order_by(Query.created_at.desc()).all()

    return jsonify({
        "success": True,
        "queries": [
            {
                "id": q.id,
                "title": q.title,
                "employee": q.admin.email,
                "status": q.status,
                "created_at": q.created_at
            } for q in queries
        ]
    }), 200





#chat history for a query
@query.route("/queries/<int:query_id>", methods=["GET"])
@jwt_required()
def query_details(query_id):
    query_obj = Query.query.get_or_404(query_id)
    attachments = []
    if query_obj.photo:
        try:
            attachments = json.loads(query_obj.photo)
        except json.JSONDecodeError:
            attachments = []

    chat_messages = [
        {
            "text": query_obj.query_text,
            "user_type": "EMPLOYEE",
            "created_at": query_obj.created_at,
            "by": query_obj.admin.first_name or query_obj.admin.email
        }
    ]
    chat_messages.extend([
        {
            "text": r.reply_text,
            "user_type": r.user_type,
            "created_at": r.created_at,
            "by": r.admin.first_name or r.admin.email
        } for r in query_obj.replies
    ])

    return jsonify({
        "success": True,
        "query": {
            "id": query_obj.id,
            "title": query_obj.title,
            "department": query_obj.department,
            "status": query_obj.status,
            "created_at": query_obj.created_at,
            "attachments": attachments
        },
        "chat_messages": chat_messages
    }), 200





#reply to a query
@query.route("/queries/<int:query_id>/reply", methods=["POST"])
@jwt_required()
def reply_query(query_id):
    claims = get_jwt()
    email = claims.get("email")
    emp_type = claims.get("emp_type")

    admin = Admin.query.filter_by(email=email).first()
    query_obj = Query.query.get_or_404(query_id)

    data = request.get_json() or {}
    reply_text = data.get("reply_text")

    if not reply_text:
        return jsonify({"success": False, "message": "reply_text required"}), 400

    user_type = "EMPLOYEE" if emp_type not in ["Human Resource", "Accounts"] else "DEPARTMENT"

    reply = QueryReply(
        query_id=query_id,
        admin_id=admin.id,
        reply_text=reply_text,
        user_type=user_type
    )

    if query_obj.status == "New":
        query_obj.status = "Open"

    db.session.add(reply)
    db.session.commit()

    return jsonify({
        "success": True,
        "message": "Reply added"
    }), 201





#close a query by employee

@query.route("/queries/<int:query_id>/close", methods=["POST"])
@jwt_required()
def close_query_api(query_id):

    claims = get_jwt()
    emp_type = claims.get("emp_type")
    closed_by_email = claims.get("email")

    if emp_type not in ["Human Resource", "Accounts", "Engineering", "IT Department"]:
        return jsonify({
            "success": False,
            "message": "Unauthorized"
        }), 403

    query_obj = Query.query.get_or_404(query_id)

    query_obj.status = "Closed"
    db.session.commit()

    # 🔔 Send compiled chat email
    notify_query_event(query_obj, action="closed")
    summary_text = " ".join((query_obj.query_text or "").split()[:20])
    attachments = []
    if query_obj.photo:
        try:
            attachments = json.loads(query_obj.photo)
        except json.JSONDecodeError:
            attachments = []
    send_query_closed_email(
        query_obj=query_obj,
        closed_by_email=closed_by_email,
        summary_text=summary_text,
        attachments=attachments
    )

    return jsonify({
        "success": True,
        "message": "Query closed and notification sent"
    }), 200





@query.route("/api/managers/search", methods=["GET"])
@jwt_required()
def search_managers_api():

    circle = request.args.get("circle")
    emp_type = request.args.get("emp_type")
    identifier = request.args.get("identifier")

    admins = []

    if circle and emp_type:
        if identifier:
            admins = Admin.query.filter(
                Admin.circle == circle,
                Admin.emp_type == emp_type,
                (Admin.email == identifier) | (Admin.emp_id == identifier)
            ).all()
        else:
            admins = Admin.query.filter_by(
                circle=circle,
                emp_type=emp_type
            ).all()

    elif identifier:
        admins = Admin.query.filter(
            (Admin.email == identifier) | (Admin.emp_id == identifier)
        ).all()

    if not admins:
        return jsonify({
            "success": False,
            "message": "No matching employees found"
        }), 404

    return jsonify({
        "success": True,
        "count": len(admins),
        "employees": [
            {
                "id": a.id,
                "name": a.first_name,
                "email": a.email,
                "emp_id": a.emp_id,
                "circle": a.circle,
                "emp_type": a.emp_type
            } for a in admins
        ]
    }), 200



@query.route("/api/managers/contact", methods=["GET"])
@jwt_required()
def get_manager_contact_api():

    circle = request.args.get("circle")
    emp_type = request.args.get("emp_type")
    user_email = request.args.get("user_email")

    if not circle or not emp_type:
        return jsonify({
            "success": False,
            "message": "circle and emp_type are required"
        }), 400

    contact = ManagerContact.query.filter_by(
        circle_name=circle,
        user_type=emp_type,
        user_email=user_email
    ).first()

    if not contact:
        return jsonify({
            "success": True,
            "exists": False,
            "data": None
        }), 200

    return jsonify({
        "success": True,
        "exists": True,
        "data": {
            "circle_name": contact.circle_name,
            "user_type": contact.user_type,
            "user_email": contact.user_email,
            "l1": {
                "name": contact.l1_name,
                "mobile": contact.l1_mobile,
                "email": contact.l1_email
            },
            "l2": {
                "name": contact.l2_name,
                "mobile": contact.l2_mobile,
                "email": contact.l2_email
            },
            "l3": {
                "name": contact.l3_name,
                "mobile": contact.l3_mobile,
                "email": contact.l3_email
            }
        }
    }), 200



@query.route("/api/managers/contact", methods=["POST"])
@jwt_required()
def upsert_manager_contact_api():

    data = request.get_json() or {}

    circle = data.get("circle_name")
    emp_type = data.get("user_type")
    user_email = data.get("user_email")

    if not circle or not emp_type:
        return jsonify({
            "success": False,
            "message": "circle_name and user_type are required"
        }), 400

    contact = ManagerContact.query.filter_by(
        circle_name=circle,
        user_type=emp_type,
        user_email=user_email
    ).first()

    if not contact:
        contact = ManagerContact(
            circle_name=circle,
            user_type=emp_type,
            user_email=user_email
        )
        db.session.add(contact)

    contact.l1_name = data.get("l1_name")
    contact.l1_mobile = data.get("l1_mobile")
    contact.l1_email = data.get("l1_email")

    contact.l2_name = data.get("l2_name")
    contact.l2_mobile = data.get("l2_mobile")
    contact.l2_email = data.get("l2_email")

    contact.l3_name = data.get("l3_name")
    contact.l3_mobile = data.get("l3_mobile")
    contact.l3_email = data.get("l3_email")

    try:
        db.session.commit()
        return jsonify({
            "success": True,
            "message": "Manager contact saved successfully"
        }), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({
            "success": False,
            "message": str(e)
        }), 500
