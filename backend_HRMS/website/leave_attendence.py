from flask import Blueprint, request, current_app, jsonify,json
from .models.attendance import Punch, WorkFromHomeApplication
from flask_jwt_extended import jwt_required, get_jwt
from .models.expense import ExpenseClaimHeader, ExpenseLineItem
from .models.Admin_models import Admin
from .models.seperation import Resignation
from .models.query import Query, QueryReply
from .models.signup import Signup
from .models.manager_model import ManagerContact
from .email import send_wfh_approval_email_to_managers,send_claim_submission_email
from . import db
from flask import jsonify
from datetime import date, datetime, timedelta
import calendar
import os
from werkzeug.utils import secure_filename
import pytz


leave = Blueprint('leave', __name__)



@leave.route("/attendance/summary", methods=["GET"])
@jwt_required()
def attendance_summary():

    email = get_jwt().get("email")
    admin = Admin.query.filter_by(email=email).first()

    if not admin:
        return jsonify({"success": False, "message": "Employee not found"}), 404

    today = date.today()

    selected_month = request.args.get("month", today.month, type=int)
    selected_year = request.args.get("year", today.year, type=int)

    calendar.setfirstweekday(calendar.MONDAY)

    first_day = date(selected_year, selected_month, 1)
    last_day = date(
        selected_year,
        selected_month,
        calendar.monthrange(selected_year, selected_month)[1]
    )

    punches = Punch.query.filter(
        Punch.admin_id == admin.id,
        Punch.punch_date.between(first_day, last_day)
    ).all()

    punch_map = {p.punch_date: p for p in punches}

    # ---------------- SUMMARY DATA ----------------
    total_present_days = 0
    total_work_seconds = 0
    punch_in_seconds = []
    punch_out_seconds = []

    for p in punches:
        if p.punch_date.weekday() == 6:  # skip Sundays
            continue

        if p.punch_in and p.punch_out:
            total_present_days += 1

            if p.today_work:
                try:
                    h, m, s = map(int, str(p.today_work).split(":"))
                    total_work_seconds += h * 3600 + m * 60 + s
                except:
                    pass

            punch_in_seconds.append(
                p.punch_in.hour * 3600 +
                p.punch_in.minute * 60 +
                p.punch_in.second
            )

            punch_out_seconds.append(
                p.punch_out.hour * 3600 +
                p.punch_out.minute * 60 +
                p.punch_out.second
            )

    avg_punch_in = (
        str(timedelta(seconds=sum(punch_in_seconds) // len(punch_in_seconds)))
        if punch_in_seconds else None
    )

    avg_punch_out = (
        str(timedelta(seconds=sum(punch_out_seconds) // len(punch_out_seconds)))
        if punch_out_seconds else None
    )

    total_weekdays = sum(
        1 for day in range(1, last_day.day + 1)
        if date(selected_year, selected_month, day).weekday() < 5
    )

    expected_work_hours = total_weekdays * 9
    expected_work_seconds = expected_work_hours * 3600
    difference_seconds = total_work_seconds - expected_work_seconds

    # ---------------- CALENDAR DATA ----------------
    calendar_data = []

    current_day = first_day
    while current_day <= last_day:

        day_status = {
            "date": current_day.isoformat(),
            "day": current_day.day,
            "weekday": current_day.strftime("%A"),
            "status": None,
            "details": {}
        }

        if current_day.weekday() >= 5:
            day_status["status"] = "WEEKEND"

        else:
            punch = punch_map.get(current_day)

            if not punch:
                day_status["status"] = "LEAVE"

            else:
                if punch.punch_in and not punch.punch_out:
                    day_status["status"] = "PENDING_PUNCH_OUT"

                else:
                    work_seconds = 0
                    if punch.today_work:
                        try:
                            h, m, s = map(int, str(punch.today_work).split(":"))
                            work_seconds = h * 3600 + m * 60 + s
                        except:
                            pass

                    if work_seconds < (4.5 * 3600):
                        day_status["status"] = "HALF_DAY"
                    else:
                        day_status["status"] = "PRESENT"

                if punch.is_wfh:
                    day_status["details"]["wfh"] = True

                day_status["details"].update({
                    "punch_in": punch.punch_in.strftime("%H:%M:%S") if punch.punch_in else None,
                    "punch_out": punch.punch_out.strftime("%H:%M:%S") if punch.punch_out else None,
                    "work_hours": str(punch.today_work) if punch.today_work else None
                })

        calendar_data.append(day_status)
        current_day += timedelta(days=1)

    # ---------------- FINAL RESPONSE ----------------
    return jsonify({
        "success": True,
        "month": f"{calendar.month_name[selected_month]} {selected_year}",

        # 🔹 Existing summary (unchanged)
        "total_present_days": total_present_days,
        "average_punch_in": avg_punch_in,
        "average_punch_out": avg_punch_out,
        "actual_work_hours": str(timedelta(seconds=total_work_seconds)),
        "expected_work_hours": f"{expected_work_hours}:00:00",
        "difference": str(timedelta(seconds=difference_seconds)),

        # 🔹 NEW calendar data
        "calendar": calendar_data
    }), 200



@leave.route("/wfh", methods=["POST"])
@jwt_required()
def submit_wfh():
    email = get_jwt().get("email")
    admin = Admin.query.filter_by(email=email).first()

    if not admin:
        return jsonify({
            "success": False,
            "message": "Employee not found"
        }), 404

    data = request.get_json()

    start_date = data.get("start_date")
    end_date = data.get("end_date")
    reason = data.get("reason")

    if not start_date or not end_date or not reason:
        return jsonify({
            "success": False,
            "message": "Start date, end date and reason are required"
        }), 400

    wfh_application = WorkFromHomeApplication(
        admin_id=admin.id,
        start_date=datetime.strptime(start_date, "%Y-%m-%d").date(),
        end_date=datetime.strptime(end_date, "%Y-%m-%d").date(),
        reason=reason,
        status="Pending",
        created_at=datetime.now(pytz.timezone("Asia/Kolkata"))
    )

    db.session.add(wfh_application)
    db.session.commit()

    # 🔔 Send approval email
    email_sent = False
    try:
        email_sent = send_wfh_approval_email_to_managers(admin, wfh_application)
    except Exception as e:
        current_app.logger.error(f"WFH email error: {e}")

    return jsonify({
        "success": True,
        "message": "WFH request submitted successfully",
        "email_sent": email_sent,
        "wfh_id": wfh_application.id
    }), 201


@leave.route("/wfh", methods=["GET"])
@jwt_required()
def get_wfh_applications():
    email = get_jwt().get("email")
    admin = Admin.query.filter_by(email=email).first()

    if not admin:
        return jsonify({
            "success": False,
            "message": "Employee not found"
        }), 404

    applications = WorkFromHomeApplication.query.filter_by(
        admin_id=admin.id
    ).order_by(WorkFromHomeApplication.created_at.desc()).all()

    return jsonify({
        "success": True,
        "applications": [
            {
                "id": w.id,
                "start_date": w.start_date.isoformat(),
                "end_date": w.end_date.isoformat(),
                "reason": w.reason,
                "status": w.status,
                "created_at": w.created_at.isoformat()
            }
            for w in applications
        ]
    }), 200



@leave.route("/queries", methods=["POST"])
@jwt_required()
def create_query():
    email = get_jwt().get("email")
    admin = Admin.query.filter_by(email=email).first()

    if not admin:
        return jsonify({"success": False, "message": "Employee not found"}), 404

    data = request.form
    title = data.get("title")
    query_text = data.get("query_text")
    emp_type = data.getlist("emp_type")

    if not title or not query_text:
        return jsonify({
            "success": False,
            "message": "Title and query text are required"
        }), 400

    photo_filename = None

    if "photo" in request.files:
        file = request.files["photo"]

        if file.filename:
            if request.content_length and request.content_length > 1048576:
                return jsonify({
                    "success": False,
                    "message": "File size exceeds 1 MB"
                }), 400

            filename = secure_filename(file.filename)
            file.save(os.path.join(current_app.config["UPLOAD_FOLDER"], filename))
            photo_filename = filename

    new_query = Query(
        admin_id=admin.id,
        emp_type=", ".join(emp_type),
        title=title,
        query_text=query_text,
        photo=photo_filename
    )

    db.session.add(new_query)
    db.session.commit()

    return jsonify({
        "success": True,
        "message": "Query created successfully",
        "query_id": new_query.id
    }), 201


@leave.route("/queries", methods=["GET"])
@jwt_required()
def get_queries():
    email = get_jwt().get("email")
    admin = Admin.query.filter_by(email=email).first()

    if not admin:
        return jsonify({"success": False, "message": "Employee not found"}), 404

    queries = Query.query.filter_by(
        admin_id=admin.id
    ).order_by(Query.created_at.desc()).all()

    return jsonify({
        "success": True,
        "queries": [
            {
                "id": q.id,
                "title": q.title,
                "status": q.status,
                "created_at": q.created_at.isoformat()
            }
            for q in queries
        ]
    }), 200


@leave.route("/queries/<int:query_id>", methods=["GET"])
@jwt_required()
def get_query_chat(query_id):
    email = get_jwt().get("email")
    admin = Admin.query.filter_by(email=email).first()

    if not admin:
        return jsonify({"success": False, "message": "Employee not found"}), 404

    query = Query.query.get_or_404(query_id)

    if query.status == "New":
        query.status = "Open"
        db.session.commit()

    replies = QueryReply.query.filter_by(
        query_id=query.id
    ).order_by(QueryReply.created_at.asc()).all()

    return jsonify({
        "success": True,
        "query": {
            "id": query.id,
            "title": query.title,
            "query_text": query.query_text,
            "status": query.status,
            "photo": query.photo,
            "created_at": query.created_at.isoformat()
        },
        "replies": [
            {
                "id": r.id,
                "reply_text": r.reply_text,
                "user_type": r.user_type,
                "created_at": r.created_at.isoformat()
            }
            for r in replies
        ]
    }), 200



@leave.route("/claim-expense", methods=["POST"])
@jwt_required()
def submit_expense_claim():
    email = get_jwt().get("email")

    admin = Admin.query.filter_by(email=email).first()
    if not admin:
        return jsonify({
            "success": False,
            "message": "Employee not found"
        }), 404

    try:
        data = request.form
        expenses = json.loads(data.get("expenses", "[]"))

        header = ExpenseClaimHeader(
            admin_id=admin.id,
            employee_name=data.get("employee_name"),
            designation=data.get("designation"),
            emp_id=data.get("emp_id"),
            email=email,
            project_name=data.get("project_name"),
            country_state=data.get("country_state"),
            travel_from_date=data.get("travel_from_date"),
            travel_to_date=data.get("travel_to_date")
        )

        db.session.add(header)
        db.session.flush()

        upload_folder = os.path.join(
            current_app.root_path, "static/uploads"
        )
        os.makedirs(upload_folder, exist_ok=True)

        files = request.files.getlist("attachments")

        for index, exp in enumerate(expenses):
            filename = None

            if index < len(files):
                file = files[index]
                filename = secure_filename(
                    f"{data.get('emp_id')}_{index+1}_{file.filename}"
                )
                file.save(os.path.join(upload_folder, filename))

            item = ExpenseLineItem(
                claim_id=header.id,
                sr_no=exp.get("sr_no"),
                date=exp.get("date"),
                purpose=exp.get("purpose"),
                amount=exp.get("amount"),
                currency=exp.get("currency"),
                Attach_file=filename,
                status=exp.get("status", "Pending")
            )
            db.session.add(item)

        db.session.commit()

        try:
            send_claim_submission_email(header)
        except Exception as e:
            current_app.logger.warning(f"Email failed: {e}")

        return jsonify({
            "success": True,
            "message": "Expense claim submitted successfully",
            "claim_id": header.id
        }), 201

    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Expense Claim Error: {e}")
        return jsonify({
            "success": False,
            "message": str(e)
        }), 500


@leave.route("/claim-expense", methods=["GET"])
@jwt_required()
def get_expense_claims():
    email = get_jwt().get("email")

    admin = Admin.query.filter_by(email=email).first()
    if not admin:
        return jsonify({
            "success": False,
            "message": "Employee not found"
        }), 404

    claims = ExpenseClaimHeader.query.filter_by(
        admin_id=admin.id
    ).order_by(ExpenseClaimHeader.id.desc()).all()

    return jsonify({
        "success": True,
        "claims": [
            {
                "id": claim.id,
                "employee_name": claim.employee_name,
                "emp_id": claim.emp_id,
                "project_name": claim.project_name,
                "country_state": claim.country_state,
                "travel_from_date": claim.travel_from_date.isoformat(),
                "travel_to_date": claim.travel_to_date.isoformat(),
                "items": [
                    {
                        "sr_no": item.sr_no,
                        "date": item.date.isoformat(),
                        "purpose": item.purpose,
                        "amount": item.amount,
                        "currency": item.currency,
                        "file": item.Attach_file,
                        "status": item.status
                    }
                    for item in ExpenseLineItem.query.filter_by(
                        claim_id=claim.id
                    ).all()
                ]
            }
            for claim in claims
        ]
    }), 200



@leave.route("/seperation", methods=["POST"])
@jwt_required()
def submit_resignation():
    email = get_jwt().get("email")

    admin = Admin.query.filter_by(email=email).first()
    if not admin:
        return jsonify({
            "success": False,
            "message": "Employee not found"
        }), 404

    # Prevent duplicate resignation
    existing = Resignation.query.filter_by(
        admin_id=admin.id
    ).first()

    if existing:
        return jsonify({
            "success": False,
            "message": "You have already submitted a resignation request."
        }), 409

    data = request.get_json()
    resignation_date = data.get("resignation_date")
    reason = data.get("reason")

    if not resignation_date or not reason:
        return jsonify({
            "success": False,
            "message": "Resignation date and reason are required"
        }), 400

    signup = Signup.query.filter_by(email=email).first()
    manager = None

    if signup:
        manager = ManagerContact.query.filter_by(
            circle_name=signup.circle,
            user_type=signup.emp_type
        ).first()

    resignation = Resignation(
        admin_id=admin.id,
        resignation_date=resignation_date,
        reason=reason
    )

    # Send email BEFORE DB commit
    try:
        success, message = send_claim_submission_email(
            admin,
            resignation,
            signup,
            manager
        )

        if not success:
            return jsonify({
                "success": False,
                "message": message
            }), 500

        db.session.add(resignation)
        db.session.commit()

        return jsonify({
            "success": True,
            "message": "Resignation submitted successfully"
        }), 201

    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Resignation Error: {e}")
        return jsonify({
            "success": False,
            "message": "Unable to submit resignation. Please try again later."
        }), 500


@leave.route("/seperation", methods=["GET"])
@jwt_required()
def get_resignation_status():
    email = get_jwt().get("email")

    admin = Admin.query.filter_by(email=email).first()
    if not admin:
        return jsonify({
            "success": False,
            "message": "Employee not found"
        }), 404

    signup = Signup.query.filter_by(email=email).first()

    resignation = Resignation.query.filter_by(
        admin_id=admin.id
    ).first()

    if resignation:
        return jsonify({
            "success": True,
            "already_submitted": True,
            "resignation": {
                "id": resignation.id,
                "resignation_date": resignation.resignation_date.isoformat(),
                "reason": resignation.reason,
                "created_at": resignation.created_at.isoformat()
            }
        }), 200

    return jsonify({
        "success": True,
        "already_submitted": False,
        "today": date.today().isoformat(),
        "employee": {
            "name": admin.name,
            "email": admin.email,
            "circle": signup.circle if signup else None,
            "emp_type": signup.emp_type if signup else None
        }
    }), 200
