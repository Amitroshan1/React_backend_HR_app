from .models.attendance import LeaveApplication
from datetime import date
from io import BytesIO
import xlsxwriter
import pandas as pd
from .models.attendance import Punch

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
    """
    Returns complete monthly summary:
    - Working hours (Mon–Fri, Mon–Sat)
    - Leave days & extra days
    - Expected hours
    - Accurate working_days_final
    """

    # ---------------- SAFE MONTH ----------------
    try:
        num_days = calendar.monthrange(year, month)[1]
    except ValueError:
        today = date.today()
        year, month = today.year, today.month
        num_days = calendar.monthrange(year, month)[1]

    month_start = date(year, month, 1)
    month_end = date(year, month, num_days)

    # ---------------- FETCH DATA ----------------
    punches = Punch.query.filter(
        Punch.admin_id == admin_id,
        Punch.punch_date.between(month_start, month_end)
    ).all()

    leaves = LeaveApplication.query.filter(
        LeaveApplication.admin_id == admin_id,
        LeaveApplication.status == "Approved",
        LeaveApplication.start_date <= month_end,
        LeaveApplication.end_date >= month_start
    ).all()

    admin = Admin.query.get(admin_id)
    if not admin:
        return {
            "actual_fri_hours": 0,
            "actual_sat_hours": 0,
            "expected_fri_hours": 0,
            "expected_sat_hours": 0,
            "leave_days": 0,
            "extra_days": 0,
            "working_days_final": 0,
        }

    emp_type = admin.emp_type or ""

    punch_map = {p.punch_date: p for p in punches}

    # ---------------- WORK HOURS ----------------
    actual_fri_seconds = 0
    actual_sat_seconds = 0

    def calc_work(p_in, p_out):
        if not p_in or not p_out:
            return 0
        base = date(2000, 1, 1)
        start = datetime.combine(base, p_in)
        end = datetime.combine(base, p_out)
        if end < start:
            end += timedelta(days=1)
        return int((end - start).total_seconds())

    for p in punches:
        if p.today_work:
            tw = str(p.today_work)
            parts = tw.split(":")
            h = int(parts[0]) if len(parts) > 0 else 0
            m = int(parts[1]) if len(parts) > 1 else 0
            s = int(parts[2]) if len(parts) > 2 else 0
            secs = h * 3600 + m * 60 + s
        else:
            secs = calc_work(p.punch_in, p.punch_out)

        weekday = p.punch_date.weekday()

        if weekday not in (5, 6):  # Mon–Fri
            actual_fri_seconds += secs

        if weekday != 6:  # Mon–Sat
            actual_sat_seconds += secs

    # ---------------- LEAVES ----------------
    leave_days = 0
    extra_days = 0.0

    for lv in leaves:
        ls = max(lv.start_date, month_start)
        le = min(lv.end_date, month_end)
        if le >= ls:
            leave_days += (le - ls).days + 1
        extra_days += float(lv.extra_days or 0)

    # ---------------- WORKING DAYS ----------------
    working_days = 0.0

    for d in range(1, num_days + 1):
        the_day = date(year, month, d)
        weekday = the_day.weekday()

        punch = punch_map.get(the_day)
        punch_value = (
            1 if punch and punch.punch_in and punch.punch_out
            else 0.5 if punch and (punch.punch_in or punch.punch_out)
            else 0
        )

        leave_for_day = any(
            lv.start_date <= the_day <= lv.end_date for lv in leaves
        )

        if emp_type in ("Engineering", "Software Development"):
            if weekday in (5, 6):
                working_days += 1
            elif punch_value or leave_for_day:
                working_days += punch_value or 1
        else:
            if weekday == 6:
                working_days += 1
            elif weekday == 5:
                if punch_value or leave_for_day:
                    working_days += punch_value or 1
            else:
                if punch_value or leave_for_day:
                    working_days += punch_value or 1

    working_days_final = round(max(0, working_days - extra_days), 1)

    # ---------------- EXPECTED HOURS ----------------
    total_mon_fri = sum(
        1 for d in range(1, num_days + 1)
        if date(year, month, d).weekday() not in (5, 6)
    )

    total_mon_sat = sum(
        1 for d in range(1, num_days + 1)
        if date(year, month, d).weekday() != 6
    )

    return {
        "actual_fri_hours": round(actual_fri_seconds / 3600, 1),
        "actual_sat_hours": round(actual_sat_seconds / 3600, 1),
        "expected_fri_hours": round(total_mon_fri * 8.5, 1),
        "expected_sat_hours": round(total_mon_sat * 8.5, 1),
        "leave_days": leave_days,
        "extra_days": round(extra_days, 1),
        "working_days_final": working_days_final,
    }


def generate_attendance_excel(admins, emp_type, circle, year, month, file_prefix):
    output = BytesIO()

    workbook = xlsxwriter.Workbook(output, {'in_memory': True})
    worksheet = workbook.add_worksheet("Attendance")

    # Formats
    border_fmt = workbook.add_format({'border': 1})
    header_fmt = workbook.add_format({
        'border': 1, 'bold': True, 'align': 'center',
        'valign': 'vcenter', 'bg_color': '#D9E1F2'
    })
    absent_fmt = workbook.add_format({'border': 1, 'bg_color': '#FFD966'})
    bold_fmt = workbook.add_format({'bold': True})
    title_fmt = workbook.add_format({'bold': True, 'font_size': 12})

    orange_fmt = workbook.add_format({'border': 1, 'bg_color': '#F4B183', 'bold': True})
    green_fmt  = workbook.add_format({'border': 1, 'bg_color': '#C6EFCE', 'bold': True})
    red_fmt    = workbook.add_format({'border': 1, 'bg_color': '#F8CBAD', 'bold': True})
    blue_fmt   = workbook.add_format({'border': 1, 'bg_color': '#BDD7EE', 'bold': True})

    # Dates
    num_days = calendar.monthrange(year, month)[1]
    start_date = date(year, month, 1)
    end_date = date(year, month, num_days)

    # Header info
    worksheet.write(0, 0, "Emp Type", bold_fmt)
    worksheet.write(0, 1, emp_type)
    worksheet.write(0, 3, "Circle", bold_fmt)
    worksheet.write(0, 4, circle)
    worksheet.write(0, 6, "Month", bold_fmt)
    worksheet.write(0, 7, f"{calendar.month_name[month]} {year}", title_fmt)

    days = [
        f"{d} {calendar.day_abbr[date(year, month, d).weekday()][0]}"
        for d in range(1, num_days + 1)
    ]

    # Fetch punches
    admin_ids = [a.id for a in admins]

    punches = Punch.query.filter(
        Punch.admin_id.in_(admin_ids),
        Punch.punch_date.between(start_date, end_date)
    ).all()

    punch_map = {}
    for p in punches:
        punch_map.setdefault(p.admin_id, {})[p.punch_date.day] = p

    row = 2

    for admin in admins:
        worksheet.write(row, 0, "Emp ID:", bold_fmt)
        worksheet.write(row, 1, admin.emp_id)
        worksheet.write(row, 3, "Emp Name:", bold_fmt)
        worksheet.write(row, 4, admin.first_name)
        row += 1

        in_times, out_times, totals = [], [], []
        admin_punches = punch_map.get(admin.id, {})

        for d in range(1, num_days + 1):
            punch = admin_punches.get(d)
            if punch:
                in_t = punch.punch_in.strftime("%I:%M %p") if punch.punch_in else ""
                out_t = punch.punch_out.strftime("%I:%M %p") if punch.punch_out else ""

                total_text = ""
                if punch.punch_in and punch.punch_out:
                    start = datetime.combine(date(2000, 1, 1), punch.punch_in)
                    end = datetime.combine(date(2000, 1, 1), punch.punch_out)
                    secs = (end - start).total_seconds()
                    if secs < 0:
                        secs += 86400
                    h, rem = divmod(int(secs), 3600)
                    m, _ = divmod(rem, 60)
                    total_text = f"{h} hrs {m} min"

                in_times.append(in_t)
                out_times.append(out_t)
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

        worksheet.write(row, 0, f"Total Working Hours ({mlabel}) excluding Saturday:", blue_fmt)
        worksheet.write(
            row, 1,
            f'{stats["actual_fri_hours"]} hrs (Expected: {stats["expected_fri_hours"]} hrs)',
            blue_fmt
        )
        row += 1

        worksheet.write(row, 0, f"Total Working Hours ({mlabel}) including Saturday:", blue_fmt)
        worksheet.write(
            row, 1,
            f'{stats["actual_sat_hours"]} hrs (Expected: {stats["expected_sat_hours"]} hrs)',
            blue_fmt
        )
        row += 2

    worksheet.set_column(0, 0, 15)
    worksheet.set_column(1, num_days + 1, 18)

    workbook.close()
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

