from .models.attendance import LeaveApplication
from datetime import date
from io import BytesIO
import xlsxwriter
import pandas as pd
from .models.attendance import Punch
import re

from .models.Admin_models import Admin



def is_on_leave(admin_id, today):
    return LeaveApplication.query.filter(
        LeaveApplication.admin_id == admin_id,
        LeaveApplication.status == "Approved",
        LeaveApplication.start_date <= today,
        LeaveApplication.end_date >= today
    ).first() is not None



def is_wfh_allowed(admin_id):
    # Example: reuse leave table with leave_type = 'WFH'
    return LeaveApplication.query.filter(
        LeaveApplication.admin_id == admin_id,
        LeaveApplication.leave_type == "WFH",
        LeaveApplication.status == "Approved",
        LeaveApplication.start_date <= date.today(),
        LeaveApplication.end_date >= date.today()
    ).first() is not None




def _empty_summary():
    return {
        "actual_fri_hours": 0,
        "actual_sat_hours": 0,
        "expected_fri_hours": 0,
        "expected_sat_hours": 0,
        "leave_days": 0,
        "extra_days": 0,
        "working_days_final": 0,
    }

from datetime import datetime, date, timedelta
import calendar
def calculate_month_summary(admin_id, year, month):
    """Returns complete monthly summary:
       - Working hours Mon–Fri
       - Working hours Mon–Sat
       - Leaves + Extra days
       - Expected hours
       - Accurate working_days_final using punch + leave logic (month based)
    """

    # -------------------------------------------------------
    # SAFE MONTH (avoid crashes)
    # -------------------------------------------------------
    try:
        num_days = calendar.monthrange(year, month)[1]
    except:
        today = datetime.today()
        year, month = today.year, today.month
        num_days = calendar.monthrange(year, month)[1]

    month_start = date(year, month, 1)
    month_end = date(year, month, num_days)

    # -------------------------------------------------------
    # FETCH PUNCHES FOR THE MONTH
    # -------------------------------------------------------
    punches = Punch.query.filter(
        Punch.admin_id == admin_id,
        Punch.punch_date >= month_start,
        Punch.punch_date <= month_end
    ).all()

    actual_fri_seconds = 0
    actual_sat_seconds = 0

    # Helper to calculate time difference
    def calc_work(p_in, p_out):
        if not p_in or not p_out:
            return 0
        # Punch model stores DateTime; compute direct delta safely.
        return max(0, int((p_out - p_in).total_seconds()))

    def parse_hms_to_seconds(val):
        if not val:
            return 0
        s = str(val).strip()
        m = re.match(r"^(\d{1,2}):(\d{2})(?::(\d{2}))?$", s)
        if not m:
            return 0
        h, mi, sec = int(m.group(1)), int(m.group(2)), int(m.group(3) or 0)
        return h * 3600 + mi * 60 + sec

    # -------------------------------------------------------
    # TOTAL WORKED HOURS
    # -------------------------------------------------------
    for p in punches:
        # Prefer today_work if available
        if getattr(p, "today_work", None):
            secs = parse_hms_to_seconds(p.today_work)
        else:
            secs = calc_work(p.punch_in, p.punch_out)

        weekday = p.punch_date.weekday()   # 0=Mon ... 6=Sun

        if weekday not in (5, 6):   # Mon–Fri
            actual_fri_seconds += secs

        if weekday != 6:            # Mon–Sat
            actual_sat_seconds += secs

    # -------------------------------------------------------
    # LEAVES & EXTRA DAYS
    # -------------------------------------------------------
    leave_days = 0
    extra_days = 0

    leaves = LeaveApplication.query.filter(
        LeaveApplication.admin_id == admin_id,
        LeaveApplication.status == "Approved",
        LeaveApplication.start_date <= month_end,
        LeaveApplication.end_date >= month_start
    ).all()

    for lv in leaves:

        # Overlap handling
        ls = max(lv.start_date, month_start)
        le = min(lv.end_date, month_end)

        if le >= ls:
            leave_days += (le - ls).days + 1

        # Extra days
        if getattr(lv, "extra_days", None):
            try:
                ed = float(lv.extra_days)
                if ed > 0:
                    extra_days += ed
            except:
                pass

    # -------------------------------------------------------
    # ADVANCED WORKING DAYS LOGIC (from your bulk function)
    # -------------------------------------------------------

    # Get admin profile to extract emp_type (source of truth)
    admin_obj = Admin.query.get(admin_id)
    emp_type = (admin_obj.emp_type or "").strip() if admin_obj else ""

    working_days = 0.0

    # Loop through each day of the selected month
    for d in range(1, num_days + 1):

        the_day = date(year, month, d)
        weekday = the_day.weekday()

        is_weekend = weekday in (5, 6)
        is_sunday = weekday == 6

        # ---- CHECK PUNCHES FOR THAT DAY ----
        punch = next((p for p in punches if p.punch_date == the_day), None)

        punch_value = 0
        if punch:
            in_present = bool(punch.punch_in)
            out_present = bool(punch.punch_out)

            if in_present and out_present:
                punch_value = 1
            elif in_present or out_present:
                punch_value = 0.5

        # ---- CHECK LEAVE FOR THE DAY ----
        leave_for_day = False
        for lv in leaves:
            if lv.start_date <= the_day <= lv.end_date:
                leave_for_day = True
                break

        # ---- APPLY SAME RULES AS BULK FUNCTION ----
        if emp_type in ("Engineering", "Software Development"):
            # Sat + Sun always counted as working
            if is_weekend:
                working_days += 1
            elif punch_value > 0 or leave_for_day:
                working_days += punch_value if punch_value > 0 else 1

        else:  # Accounts, HR, etc.
            if is_sunday:
                working_days += 1
            elif weekday == 5:  # Saturday
                if punch_value > 0 or leave_for_day:
                    working_days += punch_value if punch_value > 0 else 1
            else:  # Mon–Fri
                if punch_value > 0 or leave_for_day:
                    working_days += punch_value if punch_value > 0 else 1

    # Subtract extra days
    working_days -= extra_days
    if working_days < 0:
        working_days = 0

    # Round clean
    working_days_final = round(working_days, 1)

    # -------------------------------------------------------
    # CALENDAR WORKING DAYS (for expected hours only)
    # -------------------------------------------------------
    total_mon_fri = sum(1 for d in range(1, num_days + 1)
                        if date(year, month, d).weekday() not in (5, 6))

    total_mon_sat = sum(1 for d in range(1, num_days + 1)
                        if date(year, month, d).weekday() != 6)

    # -------------------------------------------------------
    # RETURN FINAL SUMMARY
    # -------------------------------------------------------
    return {
        "actual_fri_hours": round(actual_fri_seconds / 3600, 1),
        "actual_sat_hours": round(actual_sat_seconds / 3600, 1),
        "expected_fri_hours": round(total_mon_fri * 8.5, 1),
        "expected_sat_hours": round(total_mon_sat * 8.5, 1),
        "leave_days": leave_days,
        "extra_days": extra_days,
        "working_days_final": working_days_final,
    }



def generate_attendance_excel(admins, emp_type, circle, year, month, file_prefix):
    output = BytesIO()
    with pd.ExcelWriter(output, engine='xlsxwriter') as writer:

        workbook = writer.book
        worksheet = workbook.add_worksheet("Attendance")
        writer.sheets["Attendance"] = worksheet

        # Styles
        border_fmt = workbook.add_format({'border': 1})
        header_fmt = workbook.add_format({'border': 1, 'bold': True, 'align': 'center',
                                          'valign': 'vcenter', 'bg_color': '#D9E1F2'})
        absent_fmt = workbook.add_format({'border': 1, 'bg_color': '#FFD966'})
        bold_fmt = workbook.add_format({'bold': True})
        title_fmt = workbook.add_format({'bold': True, 'font_size': 12})

        # Summary Colors
        orange_fmt = workbook.add_format({'border': 1, 'bg_color': '#F4B183', 'bold': True})
        green_fmt  = workbook.add_format({'border': 1, 'bg_color': '#C6EFCE', 'bold': True})
        red_fmt    = workbook.add_format({'border': 1, 'bg_color': '#F8CBAD', 'bold': True})
        blue_fmt   = workbook.add_format({'border': 1, 'bg_color': '#BDD7EE', 'bold': True})

        # Dates
        num_days = calendar.monthrange(year, month)[1]
        start_date = date(year, month, 1)
        end_date = date(year, month, num_days)

        # Header Info
        worksheet.write(0, 0, "emp_type", bold_fmt)
        worksheet.write(0, 1, emp_type)
        worksheet.write(0, 3, "Circle", bold_fmt)
        worksheet.write(0, 4, circle)
        worksheet.write(0, 6, "Month", bold_fmt)
        worksheet.write(0, 7, f"{calendar.month_name[month]} {year}", title_fmt)

        # Day labels
        days = [f"{d} {calendar.day_abbr[date(year, month, d).weekday()][0]}"
                for d in range(1, num_days + 1)]

        # Fetch punches
        punches = Punch.query.filter(
            Punch.admin_id.in_([a.id for a in admins]),
            Punch.punch_date >= start_date,
            Punch.punch_date <= end_date
        ).all()

        punch_map = {}
        for p in punches:
            punch_map.setdefault(p.admin_id, {})[p.punch_date.day] = p

        # Resolve employee identity directly from Admin model (Signup removed).
        emp_ids = {a.email: (a.emp_id or "N/A") for a in admins}
        emp_names = {a.email: (a.first_name or "N/A") for a in admins}

        def parse_today_work_to_seconds(val):
            if not val:
                return 0
            s = str(val).strip()
            m = re.match(r"^(\d{1,2}):(\d{2})(?::(\d{2}))?$", s)
            if not m:
                return 0
            h = int(m.group(1))
            mi = int(m.group(2))
            sec = int(m.group(3) or 0)
            return h * 3600 + mi * 60 + sec

        # Start writing
        row = 2
        for admin in admins:

            emp_code = emp_ids.get(admin.email, "N/A")

            worksheet.write(row, 0, "Emp ID:", bold_fmt)
            worksheet.write(row, 1, emp_code)
            worksheet.write(row, 3, "Emp Name:", bold_fmt)
            emp_name = emp_names.get(admin.email, admin.first_name)
            worksheet.write(row, 4, emp_name)

            admin_punches = punch_map.get(admin.id, {})
            in_times = []
            out_times = []
            totals = []

            for d in range(1, num_days + 1):
                punch = admin_punches.get(d)
                if punch:
                    in_t = punch.punch_in.strftime("%I:%M %p") if punch.punch_in else ""
                    out_t = punch.punch_out.strftime("%I:%M %p") if punch.punch_out else ""

                    in_times.append(in_t)
                    out_times.append(out_t)

                    total_text = ""
                    secs = parse_today_work_to_seconds(punch.today_work)
                    if secs <= 0 and punch.punch_in and punch.punch_out:
                        secs = (punch.punch_out - punch.punch_in).total_seconds()
                        if secs < 0:
                            secs += 86400
                    if secs > 0:
                        h, rem = divmod(int(secs), 3600)
                        m, _ = divmod(rem, 60)
                        total_text = f"{h} hrs {m} min"
                    totals.append(total_text)
                else:
                    in_times.append("")
                    out_times.append("")
                    totals.append("")

            worksheet.write(row, 0, "Days", header_fmt)
            for col, dval in enumerate(days, start=1):
                worksheet.write(row, col, dval, header_fmt)
            row += 1

            for label, data in [("InTime", in_times), ("OutTime", out_times), ("Total", totals)]:
                worksheet.write(row, 0, label, header_fmt)
                for col, val in enumerate(data, start=1):
                    worksheet.write(row, col, val, absent_fmt if not val else border_fmt)
                row += 1

            row += 1

            # SUMMARY
            stats = calculate_month_summary(admin.id, year, month)
            mlabel = f"{calendar.month_name[month]} {year}"

            worksheet.write(row, 0, f"Total Working Days ({mlabel}):", orange_fmt)
            worksheet.write(row, 1, stats["working_days_final"], orange_fmt)
            row += 1

            worksheet.write(row, 0, "Total Approved Leaves (days):", green_fmt)
            worksheet.write(row, 1, stats["leave_days"], green_fmt)
            row += 1

            worksheet.write(row, 0, "Extra Days (non-working):", red_fmt)
            worksheet.write(row, 1, stats["extra_days"], red_fmt)
            row += 1

            worksheet.write(row, 0, f"Total Working Hours ({mlabel}) excluding Saturday :", blue_fmt)
            worksheet.write(row, 1,
                            f'{stats["actual_fri_hours"]} hrs (Expected: {stats["expected_fri_hours"]} hrs)',
                            blue_fmt)
            row += 1

            worksheet.write(row, 0, f"Total Working Hours ({mlabel}) including Saturday :", blue_fmt)
            worksheet.write(row, 1,
                            f'{stats["actual_sat_hours"]} hrs (Expected: {stats["expected_sat_hours"]} hrs)',
                            blue_fmt)
            row += 2

        worksheet.set_column(0, num_days + 1, 18)

    output.seek(0)
    return output




from flask import send_file as flask_send_file
from typing import BinaryIO, Union
import os


def send_excel_file(
    file_obj: Union[BinaryIO, os.PathLike, str],
    download_name: str,
    mimetype: str = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
):
    """
    Safe wrapper for sending Excel files (BytesIO or file path)
    """

    # Ensure file pointer is at start
    if hasattr(file_obj, "seek"):
        file_obj.seek(0)

    return flask_send_file(
        file_obj,
        mimetype=mimetype,
        as_attachment=True,
        download_name=download_name
    )

