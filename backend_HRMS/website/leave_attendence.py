from flask import Blueprint, request, redirect, url_for, current_app, session, jsonify
from .models.attendance import Punch
from flask_jwt_extended import jwt_required, get_jwt_identity, get_jwt
from .models.Admin_models import Admin
from . import db
from flask import jsonify
from datetime import date, datetime, timedelta
import calendar


leave = Blueprint('leave', __name__)



@leave.route("/attendance/summary", methods=["GET"])
@jwt_required()
def attendance_summary():

    # ✅ Always use Admin
    email = get_jwt().get("email")
    admin = Admin.query.filter_by(email=email).first()

    if not admin:
        return jsonify({"success": False, "message": "Employee not found"}), 404

    today = date.today()

    # ✅ Same logic as attendance page
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
        Punch.punch_date.between(first_day, last_day),
        Punch.punch_in.isnot(None),
        Punch.punch_out.isnot(None)
    ).all()

    total_present_days = 0
    total_work_seconds = 0
    punch_in_seconds = []
    punch_out_seconds = []

    for p in punches:
        # ❌ Skip Sundays (same behavior as calendar logic)
        if p.punch_date.weekday() == 6:
            continue

        total_present_days += 1

        # ---- Work duration ----
        if p.today_work:
            try:
                h, m, s = map(int, str(p.today_work).split(":"))
                total_work_seconds += h * 3600 + m * 60 + s
            except:
                pass

        # ---- Punch in ----
        punch_in_seconds.append(
            p.punch_in.hour * 3600 +
            p.punch_in.minute * 60 +
            p.punch_in.second
        )

        # ---- Punch out ----
        punch_out_seconds.append(
            p.punch_out.hour * 3600 +
            p.punch_out.minute * 60 +
            p.punch_out.second
        )

    # -------- AVERAGE TIMES --------
    avg_punch_in = None
    avg_punch_out = None

    if punch_in_seconds:
        avg_punch_in = str(
            timedelta(seconds=sum(punch_in_seconds) // len(punch_in_seconds))
        )

    if punch_out_seconds:
        avg_punch_out = str(
            timedelta(seconds=sum(punch_out_seconds) // len(punch_out_seconds))
        )

    # -------- EXPECTED WORK HOURS --------
    total_weekdays = sum(
        1 for day in range(1, last_day.day + 1)
        if date(selected_year, selected_month, day).weekday() < 5  # Mon–Fri
    )

    expected_work_hours = total_weekdays * 9   # 9 hours/day
    expected_work_seconds = expected_work_hours * 3600

    difference_seconds = total_work_seconds - expected_work_seconds

    return jsonify({
        "success": True,
        "month": f"{calendar.month_name[selected_month]} {selected_year}",

        "total_present_days": total_present_days,

        "average_punch_in": avg_punch_in,
        "average_punch_out": avg_punch_out,

        "actual_work_hours": str(timedelta(seconds=total_work_seconds)),
        "expected_work_hours": f"{expected_work_hours}:00:00",

        "difference": str(timedelta(seconds=difference_seconds))
    }), 200




