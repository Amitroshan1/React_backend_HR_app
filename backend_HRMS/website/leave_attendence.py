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
