# leave_page_summary,apply_leave_api,get_resignation_status,submit_resignation,submit_expense_claim,get_expense_claims,
# attendance_summary,submit_wfh,get_wfh_applications,


#https://solviotec.com/api/leave

from flask import Blueprint, request, current_app, jsonify, json, send_file
from .models.attendance import Punch, WorkFromHomeApplication, LeaveApplication, LeaveBalance
from flask_jwt_extended import jwt_required, get_jwt
from .models.expense import ExpenseClaimHeader, ExpenseLineItem
from .models.Admin_models import Admin
from .models.seperation import Resignation, Noc_Upload
from .models.holiday_calendar import HolidayCalendar
from .email import send_wfh_approval_email_to_managers,send_claim_submission_email,send_resignation_email,send_leave_applied_email
from .utility import generate_attendance_excel, send_excel_file
from . import db
from flask import jsonify
from datetime import date, datetime, timedelta
import calendar
import os
from werkzeug.utils import secure_filename
import pytz
import logging

leave = Blueprint('leave', __name__)
logger = logging.getLogger(__name__)

NOTICE_PERIOD_DAYS = 90


def _is_active_resignation_status(status):
    return (status or "").strip().lower() in {"pending", "approved"}


def _serialize_notice(resignation):
    if not resignation or not resignation.resignation_date:
        return {
            "notice_active": False,
            "notice_period_days": NOTICE_PERIOD_DAYS,
            "notice_start_date": None,
            "notice_end_date": None,
            "days_left": 0,
            "can_revoke": False,
        }

    notice_start = resignation.resignation_date
    notice_end = notice_start + timedelta(days=NOTICE_PERIOD_DAYS)
    days_left = max((notice_end - date.today()).days, 0)
    status = (resignation.status or "").strip()
    active = _is_active_resignation_status(status) and days_left > 0

    return {
        "notice_active": active,
        "notice_period_days": NOTICE_PERIOD_DAYS,
        "notice_start_date": notice_start.isoformat(),
        "notice_end_date": notice_end.isoformat(),
        "days_left": days_left,
        "can_revoke": _is_active_resignation_status(status),
    }



@leave.route("/attendance/summary", methods=["GET"])
@jwt_required()
def attendance_summary():
    try:
        return _attendance_summary_impl()
    except Exception:
        logger.exception("attendance_summary error")
        return jsonify(success=False, message="Failed to load attendance summary"), 500


def _attendance_summary_impl():
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

    # Fetch approved and pending leaves
    leaves = LeaveApplication.query.filter(
        LeaveApplication.admin_id == admin.id,
        LeaveApplication.status.in_(["Approved", "Pending"]),
        LeaveApplication.start_date <= last_day,
        LeaveApplication.end_date >= first_day
    ).all()

    # Fetch approved and pending WFH applications
    wfh_apps = WorkFromHomeApplication.query.filter(
        WorkFromHomeApplication.admin_id == admin.id,
        WorkFromHomeApplication.status.in_(["Approved", "Pending"]),
        WorkFromHomeApplication.start_date <= last_day,
        WorkFromHomeApplication.end_date >= first_day
    ).all()
    holidays = HolidayCalendar.query.filter(
        HolidayCalendar.year == selected_year,
        HolidayCalendar.is_active.is_(True),
        HolidayCalendar.holiday_date.between(first_day, last_day),
    ).all()
    holiday_map = {h.holiday_date: h for h in holidays}

    def is_on_leave(d):
        # Only check for APPROVED leave - pending leave will not show as "On Leave"
        return any(lv.start_date <= d <= lv.end_date for lv in leaves if lv.status == "Approved")

    def is_wfh_approved(d):
        return any(wfh.start_date <= d <= wfh.end_date for wfh in wfh_apps if wfh.status == "Approved")

    def is_wfh_pending(d):
        return any(wfh.start_date <= d <= wfh.end_date for wfh in wfh_apps if wfh.status == "Pending")

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

            def _to_seconds(dt):
                if dt is None:
                    return 0
                return getattr(dt, 'hour', 0) * 3600 + getattr(dt, 'minute', 0) * 60 + getattr(dt, 'second', 0)

            punch_in_seconds.append(_to_seconds(p.punch_in))
            punch_out_seconds.append(_to_seconds(p.punch_out))

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
    today = date.today()

    current_day = first_day
    while current_day <= last_day:

        day_status = {
            "date": current_day.isoformat(),
            "day": current_day.day,
            "weekday": current_day.strftime("%A"),
            "status": None,
            "details": {}
        }

        punch = punch_map.get(current_day)
        holiday = holiday_map.get(current_day)
        is_future = current_day > today

        # Priority: Punch record > Holiday > Weekend > WFH/Leave/Absent
        if punch:
                # Has punch record - use punch status
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
                
                # Mark WFH if punch has is_wfh or if there's an approved WFH application
                if getattr(punch, "is_wfh", False) or is_wfh_approved(current_day):
                    day_status["details"]["wfh"] = True
                # Only show pending WFH for past/current dates
                if not is_future and is_wfh_pending(current_day):
                    day_status["details"]["wfh_pending"] = True
                
                def _fmt_time(t):
                    if t is None:
                        return None
                    return t.strftime("%H:%M:%S") if hasattr(t, 'strftime') else str(t)
                
                day_status["details"].update({
                    "punch_in": _fmt_time(punch.punch_in),
                    "punch_out": _fmt_time(punch.punch_out),
                    "work_hours": str(punch.today_work) if punch.today_work else None
                })

        elif holiday:
            day_status["status"] = "HOLIDAY_OPTIONAL" if holiday.is_optional else "HOLIDAY"
            day_status["details"]["holiday_name"] = holiday.holiday_name
            day_status["details"]["is_optional"] = bool(holiday.is_optional)

        elif current_day.weekday() >= 5:
            day_status["status"] = "WEEKEND"

        # No punch record - check WFH and Leave applications
        elif is_future:
                # For future dates, only show APPROVED leave/WFH
                if is_wfh_approved(current_day):
                    day_status["status"] = "WFH_APPROVED"
                    day_status["details"]["wfh"] = True
                elif is_on_leave(current_day):
                    day_status["status"] = "LEAVE"
                else:
                    # Future dates without approved leave/WFH - keep blank (white background)
                    day_status["status"] = "ABSENT"
        else:
                # Past/current dates - only show APPROVED leave/WFH
                if is_wfh_approved(current_day):
                    day_status["status"] = "WFH_APPROVED"
                    day_status["details"]["wfh"] = True
                
                elif is_wfh_pending(current_day):
                    day_status["status"] = "WFH_PENDING"
                    day_status["details"]["wfh_pending"] = True
                
                elif is_on_leave(current_day):
                    # Only show approved leave as "LEAVE"
                    day_status["status"] = "LEAVE"
                
                else:
                    # Pending leave or no leave/WFH - show as ABSENT
                    day_status["status"] = "ABSENT"

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


@leave.route("/attendance/download", methods=["GET"])
@jwt_required()
def download_my_attendance_excel():
    email = get_jwt().get("email")
    admin = Admin.query.filter_by(email=email).first()

    if not admin:
        return jsonify({"success": False, "message": "Employee not found"}), 404

    month_str = (request.args.get("month") or "").strip()
    if month_str:
        try:
            year, month = map(int, month_str.split("-"))
        except ValueError:
            return jsonify({"success": False, "message": "Invalid month. Use YYYY-MM"}), 400
    else:
        now = datetime.now()
        year, month = now.year, now.month

    if month < 1 or month > 12:
        return jsonify({"success": False, "message": "Invalid month. Use YYYY-MM"}), 400

    output = generate_attendance_excel(
        admins=[admin],
        emp_type=admin.emp_type or "Employee",
        circle=admin.circle or "NHQ",
        year=year,
        month=month,
        file_prefix="Attendance",
    )
    filename = f"Attendance_{admin.emp_id or admin.id}_{calendar.month_name[month]}_{year}.xlsx"
    return send_excel_file(
        output,
        download_name=filename,
        mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )



@leave.route("/LeaveDetails", methods=["GET"])
@jwt_required()
def leave_page_summary():
    email = get_jwt().get("email")
    admin = Admin.query.filter_by(email=email).first()

    if not admin:
        return jsonify({
            "success": False,
            "message": "Employee not found"
        }), 404

    # -------- FETCH LEAVE BALANCE --------
    leave_balance = LeaveBalance.query.filter_by(
        admin_id=admin.id
    ).first()

    total_pl = leave_balance.privilege_leave_balance if leave_balance else 0.0
    total_cl = leave_balance.casual_leave_balance if leave_balance else 0.0
    total_compoff = leave_balance.compensatory_leave_balance if leave_balance else 0.0

    # -------- FETCH ALL LEAVE APPLICATIONS --------
    leave_applications = LeaveApplication.query.filter_by(
        admin_id=admin.id
    ).order_by(LeaveApplication.created_at.desc()).all()

    applications = []

    for leave in leave_applications:
        applications.append({
            "id": leave.id,
            "leave_type": leave.leave_type,
            "reason": leave.reason,
            "start_date": leave.start_date.strftime("%Y-%m-%d"),
            "end_date": leave.end_date.strftime("%Y-%m-%d"),
            "status": leave.status,
            "deducted_days": leave.deducted_days,
            "extra_days": leave.extra_days,
            "created_at": leave.created_at.strftime("%Y-%m-%d %H:%M:%S")
        })

    return jsonify({
        "success": True,
        "summary": {
            "PL": total_pl,
            "CL": total_cl,
            "COMPOFF": total_compoff
        },
        "applications": applications
    }), 200





@leave.route("/apply", methods=["POST"])
@jwt_required()
def apply_leave_api():
    email = get_jwt().get("email")

    # -------------------------
    # Fetch employee from Admin
    # -------------------------
    admin = Admin.query.filter_by(email=email).first()
    if not admin:
        return jsonify({
            "success": False,
            "message": "Employee not found"
        }), 404

    leave_balance = LeaveBalance.query.filter_by(
        admin_id=admin.id
    ).first()

    if not leave_balance:
        return jsonify({
            "success": False,
            "message": "Leave balance not configured"
        }), 400

    data = request.get_json(silent=True) or {}

    # -------------------------
    # Validate dates
    # -------------------------
    try:
        start_date = datetime.strptime(
            data.get("start_date"), "%Y-%m-%d"
        ).date()
        end_date = datetime.strptime(
            data.get("end_date"), "%Y-%m-%d"
        ).date()
    except Exception:
        return jsonify({
            "success": False,
            "message": "Invalid date format. Use YYYY-MM-DD"
        }), 400

    if end_date < start_date:
        return jsonify({
            "success": False,
            "message": "End date cannot be before start date"
        }), 400

    leave_type = data.get("leave_type")
    reason = data.get("reason")

    if not leave_type or not reason:
        return jsonify({
            "success": False,
            "message": "leave_type and reason are required"
        }), 400

    # -------------------------
    # 🚫 OPTIONAL LEAVE: Max 1 per year (check FIRST, before overlapping check)
    # -------------------------
    if leave_type == "Optional Leave":
        existing_optional = LeaveApplication.query.filter(
            LeaveApplication.admin_id == admin.id,
            LeaveApplication.leave_type == "Optional Leave",
            LeaveApplication.status.in_(["Pending", "Approved"])
        ).first()

        if existing_optional:
            return jsonify({
                "success": False,
                "message": "Optional Leave can only be used once per year. You have already applied for Optional Leave."
            }), 400

    # -------------------------
    # 🚫 DUPLICATE / SAME DATE CHECK (skip for Optional Leave - it's a special holiday)
    # -------------------------
    if leave_type != "Optional Leave":  # Optional Leave can overlap with other leaves
        overlapping_leave = LeaveApplication.query.filter(
            LeaveApplication.admin_id == admin.id,
            LeaveApplication.status.in_(["Pending", "Approved"]),
            LeaveApplication.start_date <= end_date,
            LeaveApplication.end_date >= start_date
        ).first()

        if overlapping_leave:
            return jsonify({
                "success": False,
                "message": (
                    f"Leave already applied from "
                    f"{overlapping_leave.start_date} to "
                    f"{overlapping_leave.end_date} "
                    f"(Status: {overlapping_leave.status})"
                )
            }), 409

    # -------------------------
    # Leave calculations
    # -------------------------
    leave_days = (end_date - start_date).days + 1
    deducted_days = 0.0
    extra_days = 0.0

    # Privilege Leave
    if leave_type == "Privilege Leave":
        if leave_days > leave_balance.privilege_leave_balance:
            extra_days = leave_days - leave_balance.privilege_leave_balance
            deducted_days = leave_balance.privilege_leave_balance
            leave_balance.privilege_leave_balance = 0
        else:
            deducted_days = leave_days
            leave_balance.privilege_leave_balance -= leave_days
        # Track used leave in DB (so frontend shows "used" after apply)
        leave_balance.used_privilege_leave += deducted_days

    # Casual Leave
    elif leave_type == "Casual Leave":
        if leave_days > 2:
            return jsonify({
                "success": False,
                "message": "Casual Leave cannot exceed 2 days"
            }), 400

        if leave_days > leave_balance.casual_leave_balance:
            return jsonify({
                "success": False,
                "message": "Insufficient Casual Leave balance"
            }), 400

        deducted_days = leave_days
        leave_balance.casual_leave_balance -= leave_days
        # Track used leave in DB (so frontend shows "used" after apply)
        leave_balance.used_casual_leave += deducted_days

    # Half Day Leave
    elif leave_type == "Half Day Leave":
        if leave_days > 1:
            return jsonify({
                "success": False,
                "message": "Half Day Leave can only be applied for one day"
            }), 400

        leave_days = 0.5
        deducted_days = 0.5

        if leave_balance.casual_leave_balance >= 0.5:
            leave_balance.casual_leave_balance -= 0.5
            leave_balance.used_casual_leave += 0.5
        elif leave_balance.privilege_leave_balance >= 0.5:
            leave_balance.privilege_leave_balance -= 0.5
            leave_balance.used_privilege_leave += 0.5
        else:
            extra_days = 0.5

    # Compensatory Leave
    elif leave_type == "Compensatory Leave":
        if leave_balance.compensatory_leave_balance <= 0:
            return jsonify({
                "success": False,
                "message": "No Compensatory Leave balance available"
            }), 400

        if leave_days > 2:
            return jsonify({
                "success": False,
                "message": "Maximum 2 Compensatory Leave days allowed"
            }), 400

        if leave_days > leave_balance.compensatory_leave_balance:
            return jsonify({
                "success": False,
                "message": "Insufficient Compensatory Leave balance"
            }), 400

        deducted_days = leave_days
        leave_balance.compensatory_leave_balance -= leave_days
        # Track used leave in DB (so frontend shows "used" after apply)
        leave_balance.used_comp_leave += deducted_days

    # Optional Leave (Optional Holiday) - doesn't deduct from any leave balance
    elif leave_type == "Optional Leave":
        # Optional Leave is a special holiday that doesn't count against leave balances
        # Max 1 per year (enforced by backend validation above)
        if leave_days > 1:
            return jsonify({
                "success": False,
                "message": "Optional Leave can only be applied for one day"
            }), 400

        # Optional Leave doesn't deduct from any balance, just records the application
        # Set deducted_days to 1 (or leave_days) for tracking purposes
        deducted_days = float(leave_days)
        extra_days = 0.0

    else:
        return jsonify({
            "success": False,
            "message": "Invalid leave type"
        }), 400

    # -------------------------
    # Save leave application
    # -------------------------
    leave_application = LeaveApplication(
        admin_id=admin.id,
        leave_type=leave_type,
        reason=reason,
        start_date=start_date,
        end_date=end_date,
        status="Pending",
        deducted_days=deducted_days,
        extra_days=extra_days
    )

    try:
        db.session.add(leave_application)
        db.session.commit()
        
        # Log for debugging
        current_app.logger.info(f"Leave application saved: ID={leave_application.id}, Type={leave_type}, Status={leave_application.status}")
        
        send_leave_applied_email(admin, leave_application)
        return jsonify({
            "success": True,
            "message": "Leave applied successfully",
            "leave_id": leave_application.id,
            "leave_type": leave_type,
            "deducted_days": deducted_days,
            "extra_days": extra_days
        }), 201

    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Leave Apply Error: {e}", exc_info=True)
        return jsonify({
            "success": False,
            "message": f"Unable to apply leave: {str(e)}"
        }), 500



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

    data = request.get_json() or {}

    start_date = data.get("start_date")
    end_date = data.get("end_date")
    reason = data.get("reason")

    if not start_date or not end_date or not reason:
        return jsonify({
            "success": False,
            "message": "Start date, end date and reason are required"
        }), 400

    if not isinstance(reason, str) or not reason.strip():
        return jsonify({
            "success": False,
            "message": "Reason is required"
        }), 400

    try:
        start_d = datetime.strptime(str(start_date).strip(), "%Y-%m-%d").date()
        end_d = datetime.strptime(str(end_date).strip(), "%Y-%m-%d").date()
    except ValueError:
        return jsonify({
            "success": False,
            "message": "Invalid date format. Use YYYY-MM-DD"
        }), 400

    if end_d < start_d:
        return jsonify({
            "success": False,
            "message": "End date must be on or after start date"
        }), 400

    wfh_application = WorkFromHomeApplication(
        admin_id=admin.id,
        start_date=start_d,
        end_date=end_d,
        reason=reason.strip(),
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

    def _iso(d):
        return d.isoformat() if d and hasattr(d, 'isoformat') else str(d)

    return jsonify({
        "success": True,
        "applications": [
            {
                "id": w.id,
                "start_date": _iso(w.start_date),
                "end_date": _iso(w.end_date),
                "reason": w.reason or "",
                "status": w.status or "Pending",
                "created_at": _iso(w.created_at)
            }
            for w in applications
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

        # -------------------------
        # Parse expenses safely
        # -------------------------
        try:
            expenses = json.loads(data.get("expenses", "[]"))
            if not isinstance(expenses, list) or not expenses:
                return jsonify({
                    "success": False,
                    "message": "At least one expense item is required"
                }), 400
        except json.JSONDecodeError:
            return jsonify({
                "success": False,
                "message": "Invalid expenses JSON"
            }), 400

        # -------------------------
        # Parse header dates
        # -------------------------
        try:
            travel_from_date = datetime.strptime(
                data.get("travel_from_date"), "%Y-%m-%d"
            ).date()
            travel_to_date = datetime.strptime(
                data.get("travel_to_date"), "%Y-%m-%d"
            ).date()
        except Exception:
            return jsonify({
                "success": False,
                "message": "Invalid travel date format (YYYY-MM-DD)"
            }), 400

        header = ExpenseClaimHeader(
            admin_id=admin.id,
            employee_name=data.get("employee_name"),
            designation=data.get("designation"),
            emp_id=data.get("emp_id"),
            email=email,
            project_name=data.get("project_name"),
            country_state=data.get("country_state"),
            travel_from_date=travel_from_date,
            travel_to_date=travel_to_date
        )

        db.session.add(header)
        db.session.flush()

        # -------------------------
        # File upload directory
        # -------------------------
        upload_folder = os.path.join(
            current_app.root_path, "static/uploads/expenses"
        )
        os.makedirs(upload_folder, exist_ok=True)

        files = request.files.getlist("attachments")

        # -------------------------
        # Save line items
        # -------------------------
        for index, exp in enumerate(expenses):
            filename = None

            if index < len(files):
                file = files[index]
                if file and file.filename:
                    filename = secure_filename(
                        f"{data.get('emp_id')}_{header.id}_{index+1}_{file.filename}"
                    )
                    file.save(os.path.join(upload_folder, filename))

            try:
                item_date = datetime.strptime(
                    exp.get("date"), "%Y-%m-%d"
                ).date()
            except Exception:
                return jsonify({
                    "success": False,
                    "message": f"Invalid expense date at item {index + 1}"
                }), 400

            item = ExpenseLineItem(
                claim_id=header.id,
                sr_no=exp.get("sr_no"),
                date=item_date,
                purpose=exp.get("purpose"),
                amount=exp.get("amount"),
                currency=exp.get("currency"),
                Attach_file=filename,
                status="Pending"
            )
            db.session.add(item)

        db.session.commit()

        # -------------------------
        # Email (NON-BLOCKING)
        # -------------------------
        try:
            send_claim_submission_email(header)
        except Exception as e:
            current_app.logger.warning(f"Expense email failed: {e}")

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
            "message": "Unable to submit expense claim"
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

    # Prevent duplicate active resignation, but allow re-apply after revoke/reject.
    latest_resignation = Resignation.query.filter_by(admin_id=admin.id).order_by(Resignation.id.desc()).first()
    if latest_resignation and _is_active_resignation_status(latest_resignation.status):
        return jsonify({
            "success": False,
            "message": "You have already submitted a resignation request."
        }), 409

    data = request.get_json() or {}

    resignation_date = data.get("resignation_date")
    reason = data.get("reason")

    if not resignation_date or not reason:
        return jsonify({
            "success": False,
            "message": "Resignation date and reason are required"
        }), 400

    try:
        resignation_date_obj = datetime.strptime(
            resignation_date, "%Y-%m-%d"
        ).date()
    except ValueError:
        return jsonify({
            "success": False,
            "message": "Invalid date format. Use YYYY-MM-DD"
        }), 400

    resignation = Resignation(
        admin_id=admin.id,
        resignation_date=resignation_date_obj,
        reason=reason,
        status="Pending"
    )

    try:
        db.session.add(resignation)
        db.session.commit()

        # 🔔 Email (NON-BLOCKING)
        success, _ = send_resignation_email(admin, resignation)

        return jsonify({
            "success": True,
            "message": "Resignation submitted successfully",
            "email_sent": success
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
    try:
        claims = get_jwt()
        email = claims.get("email")
        if not email:
            return jsonify({"success": False, "message": "Invalid token"}), 401

        admin = Admin.query.filter_by(email=email).first()
        if not admin:
            return jsonify({
                "success": False,
                "message": "Employee not found"
            }), 404

        resignation = Resignation.query.filter_by(admin_id=admin.id).order_by(Resignation.id.desc()).first()
        noc_upload = Noc_Upload.query.filter_by(admin_id=admin.id).order_by(Noc_Upload.id.desc()).first()

        if resignation:
            applied_on = getattr(resignation, 'applied_on', None)
            created_at_str = applied_on.isoformat() if applied_on and hasattr(applied_on, 'isoformat') else (str(applied_on) if applied_on else None)
            notice_info = _serialize_notice(resignation)
            return jsonify({
                "success": True,
                "already_submitted": True,
                "resignation": {
                    "id": resignation.id,
                    "resignation_date": resignation.resignation_date.isoformat(),
                    "reason": resignation.reason,
                    "status": resignation.status,
                    "created_at": created_at_str
                },
                "notice": notice_info,
                "noc": {
                    "uploaded": noc_upload is not None,
                    "filename": os.path.basename(noc_upload.file_path) if noc_upload and noc_upload.file_path else None
                }
            }), 200

        return jsonify({
            "success": True,
            "already_submitted": False,
            "notice": _serialize_notice(None),
            "today": date.today().isoformat(),
            "employee": {
                "name": admin.first_name,
                "email": admin.email,
                "circle": admin.circle or "",
                "emp_type": admin.emp_type or ""
            }
        }), 200

    except Exception as e:
        current_app.logger.exception("get_resignation_status error")
        return jsonify({
            "success": False,
            "message": str(e) or "Failed to fetch resignation status"
        }), 500


@leave.route("/seperation/revoke", methods=["POST"])
@jwt_required()
def revoke_resignation():
    try:
        claims = get_jwt()
        email = claims.get("email")
        if not email:
            return jsonify({"success": False, "message": "Invalid token"}), 401

        admin = Admin.query.filter_by(email=email).first()
        if not admin:
            return jsonify({"success": False, "message": "Employee not found"}), 404

        resignation = Resignation.query.filter_by(admin_id=admin.id).order_by(Resignation.id.desc()).first()
        if not resignation:
            return jsonify({"success": False, "message": "No resignation found"}), 404

        if not _is_active_resignation_status(resignation.status):
            return jsonify({
                "success": False,
                "message": f"Cannot revoke when status is {resignation.status}"
            }), 400

        resignation.status = "Revoked"
        db.session.commit()
        return jsonify({
            "success": True,
            "message": "Resignation revoked successfully",
            "notice": _serialize_notice(resignation),
        }), 200
    except Exception as e:
        db.session.rollback()
        current_app.logger.exception("revoke_resignation error")
        return jsonify({"success": False, "message": str(e) or "Failed to revoke resignation"}), 500


@leave.route("/noc-document", methods=["GET"])
@jwt_required()
def get_my_noc_document():
    """Let the logged-in employee download their NOC document (only their own)."""
    try:
        claims = get_jwt()
        email = claims.get("email")
        if not email:
            return jsonify({"success": False, "message": "Invalid token"}), 401

        admin = Admin.query.filter_by(email=email).first()
        if not admin:
            return jsonify({"success": False, "message": "Employee not found"}), 404

        noc_upload = Noc_Upload.query.filter_by(admin_id=admin.id).order_by(Noc_Upload.id.desc()).first()
        if not noc_upload or not noc_upload.file_path:
            return jsonify({"success": False, "message": "NOC document not available yet"}), 404

        full_path = os.path.join(current_app.root_path, "static", "uploads", noc_upload.file_path)
        if not os.path.isfile(full_path):
            return jsonify({"success": False, "message": "File not found"}), 404

        return send_file(
            full_path,
            as_attachment=True,
            download_name=os.path.basename(noc_upload.file_path),
            mimetype="application/octet-stream"
        )
    except Exception as e:
        current_app.logger.exception("noc-document download error")
        return jsonify({"success": False, "message": "Failed to download"}), 500

