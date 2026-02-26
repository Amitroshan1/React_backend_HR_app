from .models.attendance import LeaveApplication, LeaveBalance, Punch, WorkFromHomeApplication
from datetime import date
from io import BytesIO
import xlsxwriter
import pandas as pd
import re

from .models.Admin_models import Admin
from . import db
from .models.holiday_calendar import HolidayCalendar



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

            # Punch rows
            in_times = []
            out_times = []
            totals = []

            # Per-admin punches mapped by day (1..num_days)
            admin_punches = punch_map.get(admin.id, {})

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



from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo
import calendar
from sqlalchemy import func


def calculate_attendance_Accounts(admin_id, emp_type, year, month):
    """
    HRMS-friendly monthly totals (Accounts view).

    Returns:
      - expected_working_days: calendar working days for this employee (weekends + mandatory holidays excluded,
        optional holidays excluded only if the employee has an approved Optional Leave on that date).
      - absent_days: only counts absence on expected working days (float, supports 0.5 for half-day leave without punch).

    Notes:
      - Mandatory holidays are loaded from HolidayCalendar (DB).
      - Optional holidays are NOT treated as non-working unless Optional Leave is approved for that date.
      - Approved WFH counts as present on a working day.
      - Approved leaves count as paid leave days on working days; leave.extra_days (LWP/LOP) is approximated into absences.
    """

    # -------- DATE RANGE --------
    start_date = date(year, month, 1)
    month_end = date(year, month, calendar.monthrange(year, month)[1])

    today = datetime.now(ZoneInfo("Asia/Kolkata")).date()
    end_date = today if (year == today.year and month == today.month) else month_end

    # -------- HOLIDAYS (DB) --------
    holiday_rows = HolidayCalendar.query.filter(
        HolidayCalendar.year == year,
        HolidayCalendar.is_active.is_(True),
        HolidayCalendar.holiday_date.between(start_date, end_date),
    ).all()
    mandatory_holidays = {h.holiday_date for h in holiday_rows if not getattr(h, "is_optional", False)}
    optional_holidays = {h.holiday_date for h in holiday_rows if getattr(h, "is_optional", False)}

    # -------- PUNCHES (WORKED DAYS: >= 8h full present, < 8h half day → 0.5 absent) --------
    FULL_DAY_WORK_SECONDS = 8 * 3600

    def _punch_work_seconds(p):
        if getattr(p, "today_work", None) and str(p.today_work).strip():
            s = str(p.today_work).strip()
            parts = s.split(":")
            try:
                h = int(parts[0]) if len(parts) > 0 else 0
                m = int(parts[1]) if len(parts) > 1 else 0
                sec = int(parts[2]) if len(parts) > 2 else 0
                return h * 3600 + m * 60 + sec
            except (ValueError, IndexError):
                pass
        if p.punch_in and p.punch_out:
            delta = p.punch_out - p.punch_in
            return max(0, int(delta.total_seconds()))
        return 0

    punches = Punch.query.filter(
        Punch.admin_id == admin_id,
        Punch.punch_date.between(start_date, end_date)
    ).all()
    worked_full_dates = set()
    worked_half_dates = set()
    for p in punches:
        if not p.punch_in or not p.punch_out:
            continue
        secs = _punch_work_seconds(p)
        if secs >= FULL_DAY_WORK_SECONDS:
            worked_full_dates.add(p.punch_date)
        else:
            worked_half_dates.add(p.punch_date)

    # -------- WFH (APPROVED) --------
    wfh_apps = WorkFromHomeApplication.query.filter(
        WorkFromHomeApplication.admin_id == admin_id,
        WorkFromHomeApplication.status == "Approved",
        WorkFromHomeApplication.start_date <= end_date,
        WorkFromHomeApplication.end_date >= start_date
    ).all()
    wfh_dates = set()
    for wfh in wfh_apps:
        d = max(wfh.start_date, start_date)
        d_end = min(wfh.end_date, end_date)
        while d <= d_end:
            wfh_dates.add(d)
            d += timedelta(days=1)

    # -------- LEAVES (APPROVED) --------
    leaves = LeaveApplication.query.filter(
        LeaveApplication.admin_id == admin_id,
        LeaveApplication.status == "Approved",
        LeaveApplication.start_date <= end_date,
        LeaveApplication.end_date >= start_date
    ).all()

    # Day -> leave units (1.0 or 0.5) for working-day coverage (excluding Optional Leave)
    leave_units = {}
    optional_leave_taken = set()
    lop_total = 0.0  # approximated LWP/LOP days within this month range

    for leave in leaves:
        d_start = max(leave.start_date, start_date)
        d_end = min(leave.end_date, end_date)

        # Approximate LOP allocation into this month slice (best effort; extra_days is stored at application level).
        span_days = (leave.end_date - leave.start_date).days + 1
        overlap_days = (d_end - d_start).days + 1 if d_end >= d_start else 0
        if span_days > 0 and overlap_days > 0 and float(getattr(leave, "extra_days", 0) or 0) > 0:
            lop_total += float(leave.extra_days or 0) * (overlap_days / span_days)

        # Optional Leave: treat as a day-off only if the date is an optional holiday.
        if leave.leave_type == "Optional Leave":
            d = d_start
            while d <= d_end:
                if d in optional_holidays:
                    optional_leave_taken.add(d)
                d += timedelta(days=1)
            continue

        # Half Day Leave: count as 0.5 on its start date (common case)
        if leave.leave_type == "Half Day Leave":
            if d_start <= d_end:
                leave_units[d_start] = max(leave_units.get(d_start, 0.0), 0.5)
            continue

        # Other leave types: cover each day in the overlapping range
        d = d_start
        while d <= d_end:
            leave_units[d] = max(leave_units.get(d, 0.0), 1.0)
            d += timedelta(days=1)

    # -------- DAY-WISE TOTALS --------
    expected_working_days = 0.0
    absent_days = 0.0

    current = start_date
    while current <= end_date:
        weekday = current.weekday()  # Mon=0 ... Sun=6

        # Weekend rules (company calendar)
        is_weekend_non_working = (
            weekday == 6 or
            (weekday == 5 and emp_type not in ["Human Resource", "Accounts"])
        )
        is_mandatory_holiday = current in mandatory_holidays

        # Base calendar working day (optional holidays remain working unless taken)
        is_calendar_working_day = (not is_weekend_non_working) and (not is_mandatory_holiday)

        # If it's not a working day, it doesn't affect expected/absent.
        if not is_calendar_working_day:
            current += timedelta(days=1)
            continue

        # Optional holiday taken (approved Optional Leave) becomes a day-off for this employee.
        if current in optional_leave_taken:
            current += timedelta(days=1)
            continue

        expected_working_days += 1.0

        # Present if worked full day (>= 8h) or approved WFH
        if current in worked_full_dates or current in wfh_dates:
            current += timedelta(days=1)
            continue

        # Half day: punch in+out but < 8 hours → 0.5 absent
        if current in worked_half_dates:
            absent_days += 0.5
            current += timedelta(days=1)
            continue

        # Approved leave covers the day (full or half)
        units = float(leave_units.get(current, 0.0) or 0.0)
        if units >= 1.0:
            current += timedelta(days=1)
            continue
        if units == 0.5:
            absent_days += 0.5
            current += timedelta(days=1)
            continue

        # No punch, no WFH, no approved leave => absent
        absent_days += 1.0
        current += timedelta(days=1)

    # Apply approximated LOP days (from leave.extra_days) into absences, capped by expected_working_days
    if lop_total > 0:
        absent_days = min(expected_working_days, absent_days + float(lop_total))

    return expected_working_days, absent_days



def get_leave_balance_Accounts(admin):
    balance = LeaveBalance.query.filter_by(admin_id=admin.id).first()
    if not balance:
        return 0, 0
    return (
        float(balance.privilege_leave_balance or 0),
        float(balance.casual_leave_balance or 0)
    )


def applied_leave_days_in_month(admin_id, leave_type, month_start, month_end):
    """
    Sum applied (approved) leave days for a given type in a month, prorated by
    calendar overlap so multi-month leaves are not double-counted.
    """
    leaves = LeaveApplication.query.filter(
        LeaveApplication.admin_id == admin_id,
        LeaveApplication.leave_type == leave_type,
        LeaveApplication.status == "Approved",
        LeaveApplication.start_date <= month_end,
        LeaveApplication.end_date >= month_start
    ).all()
    total = 0.0
    for leave in leaves:
        overlap_start = max(leave.start_date, month_start)
        overlap_end = min(leave.end_date, month_end)
        overlap_days = (overlap_end - overlap_start).days + 1
        span_days = (leave.end_date - leave.start_date).days + 1
        if span_days <= 0:
            continue
        deducted = float(leave.deducted_days or 0)
        total += (overlap_days / span_days) * deducted
    return total


from io import BytesIO
import calendar
import xlsxwriter
from sqlalchemy import func


def generate_attendance_excel_Accounts(admins, emp_type, circle, year, month):
    from .compoff_utils import get_effective_comp_balance
    output = BytesIO()
    workbook = xlsxwriter.Workbook(output)
    worksheet = workbook.add_worksheet("Attendance")

    # -------- FORMATS --------
    header_fmt = workbook.add_format({
        'bold': True,
        'border': 1,
        'align': 'center',
        'valign': 'vcenter',
        'bg_color': '#D9E1F2'
    })
    cell_fmt = workbook.add_format({'border': 1})
    title_fmt = workbook.add_format({'bold': True, 'font_size': 12})

    # -------- HEADER --------
    worksheet.merge_range('A1:M1', f"Employee Domain: {emp_type}", title_fmt)
    worksheet.merge_range('A2:M2', f"Circle: {circle}", title_fmt)
    worksheet.merge_range('A3:M3', f"Month: {calendar.month_name[month]} {year}", title_fmt)

    # -------- TABLE HEADER --------
    row = 4
    headers = [
        "S.No",
        "Month",
        "Employee Name",
        "Total Days in Month",
        "Actual Working Days",
        "Total Absent Days",
        "Balance CL",
        "Balance PL",
        "Balance Comp Off",
        "Applied CL",
        "Applied PL",
        "Applied Comp Off",
        "Total Applied Leave"
    ]

    for col, h in enumerate(headers):
        worksheet.write(row, col, h, header_fmt)

    # -------- DATE RANGE FOR MONTH --------
    month_start = date(year, month, 1)
    month_end = date(year, month, calendar.monthrange(year, month)[1])
    today = datetime.now(ZoneInfo("Asia/Kolkata")).date()
    end_date = today if (year == today.year and month == today.month) else month_end

    # Sundays in period (office closed = present; add to actual, do not reduce absent)
    sundays_in_span = 0
    if end_date >= month_start:
        for i in range((end_date - month_start).days + 1):
            d = month_start + timedelta(days=i)
            if d.weekday() == 6:
                sundays_in_span += 1

    # -------- DATA --------
    row += 1
    for idx, admin in enumerate(admins, start=1):

        # Employee name (Admin model; no Signup)
        emp_name = admin.first_name or "N/A"

        # Attendance totals (Accounts HRMS logic): absent is Mon-Sat only; actual = present on weekdays + Sundays
        working_days_expected, absent_days = calculate_attendance_Accounts(admin.id, emp_type, year, month)
        actual_working_days = working_days_expected - absent_days + sundays_in_span

        # Total days in month
        total_days = calendar.monthrange(year, month)[1]

        # Leave balances (by admin_id)
        balance = LeaveBalance.query.filter_by(admin_id=admin.id).first()
        balance_cl = float(balance.casual_leave_balance) if balance else 0
        balance_pl = float(balance.privilege_leave_balance) if balance else 0
        balance_comp = get_effective_comp_balance(admin.id)

        # -------- APPLIED LEAVES (MONTH-WISE, PRORATED BY OVERLAP) --------
        applied_cl = applied_leave_days_in_month(admin.id, "Casual Leave", month_start, month_end)
        applied_pl = applied_leave_days_in_month(admin.id, "Privilege Leave", month_start, month_end)
        applied_comp = applied_leave_days_in_month(admin.id, "Compensatory Leave", month_start, month_end)
        total_applied_leave = applied_cl + applied_pl + applied_comp

        # -------- WRITE ROW --------
        worksheet.write_row(row, 0, [
            idx,
            f"{calendar.month_name[month]} {year}",
            emp_name,
            total_days,
            actual_working_days,
            absent_days,
            balance_cl,
            balance_pl,
            balance_comp,
            applied_cl,
            applied_pl,
            applied_comp,
            total_applied_leave
        ], cell_fmt)

        row += 1

    worksheet.set_column(0, 12, 22)
    workbook.close()
    output.seek(0)

    return output


def generate_client_attendance_excel(admins, year, month, project_name=None, place=None):
    """
    Generate a client-facing attendance sheet with multiple employees
    laid out horizontally on a single worksheet.

    Layout:
      - Column A: Day_Date
      - For each employee i:
          columns (B,C) for employee 1, (D,E) for employee 2, etc.
          header block rows (Name, Month/Year, ...) merged across the two columns
          then a header row with "Punch In" / "Punch Out" under each employee.
    """
    output = BytesIO()
    workbook = xlsxwriter.Workbook(output)

    # Common formats
    header_fmt = workbook.add_format(
        {"bold": True, "border": 1, "align": "left", "valign": "vcenter", "bg_color": "#9BC2E6"}
    )
    border_fmt = workbook.add_format({"border": 1})
    legend_holiday_fmt = workbook.add_format({"border": 1, "bg_color": "#D9D9D9"})
    legend_comp_off_fmt = workbook.add_format({"border": 1, "bg_color": "#FFF2CC"})
    legend_half_day_fmt = workbook.add_format({"border": 1, "bg_color": "#C6E0B4"})
    legend_leave_fmt = workbook.add_format({"border": 1, "bg_color": "#F8CBAD"})
    sunday_row_fmt = workbook.add_format({"border": 1, "bg_color": "#D9D9D9"})

    # Date range for the month
    num_days = calendar.monthrange(year, month)[1]
    month_start = date(year, month, 1)
    month_end = date(year, month, num_days)

    # Single worksheet for all employees
    worksheet = workbook.add_worksheet("Attendance")

    # Legend rows (top of sheet)
    worksheet.write(0, 0, "SUNDAY / HOLIDAY", legend_holiday_fmt)
    worksheet.write(1, 0, "COMP OFF", legend_comp_off_fmt)
    worksheet.write(2, 0, "HALF DAY", legend_half_day_fmt)
    worksheet.write(3, 0, "LEAVE", legend_leave_fmt)

    HEADER_START_ROW = 6   # Row 7 (1‑based) in Excel
    LABEL_COL = 0          # Column A
    FIRST_EMP_COL = 1      # First employee starts at column B
    TIME_COLUMNS_PER_PAIR = 2

    labels = [
        "Name",
        "Month/Year",
        "Project Name",
        "Place",
        "Date of Joining",
        "Date of Deputation",
    ]

    # Left label band
    for idx, label in enumerate(labels):
        r = HEADER_START_ROW + idx
        worksheet.write(r, LABEL_COL, label, header_fmt)

    # Build a punch map for all employees: {admin_id: {date: punch}}
    admin_ids = [a.id for a in admins]
    punches = Punch.query.filter(
        Punch.admin_id.in_(admin_ids),
        Punch.punch_date >= month_start,
        Punch.punch_date <= month_end,
    ).all()
    punch_map = {}
    for p in punches:
        punch_map.setdefault(p.admin_id, {})[p.punch_date] = p

    # Header block and per-employee columns
    for emp_index, admin in enumerate(admins):
        base_col = FIRST_EMP_COL + emp_index * TIME_COLUMNS_PER_PAIR  # B,C for first, D,E for second, etc.

        # Fill band for this employee so there are borders under the labels
        for idx in range(len(labels)):
            r = HEADER_START_ROW + idx
            # Set a default bordered cell which will be overwritten by merge_range
            worksheet.write(r, base_col, "", border_fmt)
            worksheet.write(r, base_col + 1, "", border_fmt)

        month_label = f"{calendar.month_name[month]} {year}"

        # Merge the two columns for each label row and write the employee-specific values
        worksheet.merge_range(
            HEADER_START_ROW + 0,
            base_col,
            HEADER_START_ROW + 0,
            base_col + 1,
            admin.first_name or "N/A",
            border_fmt,
        )
        worksheet.merge_range(
            HEADER_START_ROW + 1,
            base_col,
            HEADER_START_ROW + 1,
            base_col + 1,
            month_label,
            border_fmt,
        )
        worksheet.merge_range(
            HEADER_START_ROW + 2,
            base_col,
            HEADER_START_ROW + 2,
            base_col + 1,
            project_name or "",
            border_fmt,
        )
        worksheet.merge_range(
            HEADER_START_ROW + 3,
            base_col,
            HEADER_START_ROW + 3,
            base_col + 1,
            place or (admin.circle or ""),
            border_fmt,
        )
        doj = getattr(admin, "doj", None)
        worksheet.merge_range(
            HEADER_START_ROW + 4,
            base_col,
            HEADER_START_ROW + 4,
            base_col + 1,
            doj.isoformat() if doj and hasattr(doj, "isoformat") else "",
            border_fmt,
        )
        worksheet.merge_range(
            HEADER_START_ROW + 5,
            base_col,
            HEADER_START_ROW + 5,
            base_col + 1,
            "",
            border_fmt,
        )

        # Single-row table header directly under header block for this employee
        TABLE_HEADER_ROW = HEADER_START_ROW + 7
        if emp_index == 0:
            # Only once for Day_Date
            worksheet.write(TABLE_HEADER_ROW, LABEL_COL, "Day_Date", header_fmt)

        worksheet.write(TABLE_HEADER_ROW, base_col,     "Punch In",  header_fmt)
        worksheet.write(TABLE_HEADER_ROW, base_col + 1, "Punch Out", header_fmt)

        # Per-day rows, exactly one row per date, starting below the header row
        first_day_row = TABLE_HEADER_ROW + 1
        for day in range(1, num_days + 1):
            current = date(year, month, day)
            row = first_day_row + (day - 1)

            # Only write the Day_Date once (for the first employee)
            if emp_index == 0:
                label = f"{current.strftime('%A')}, {day} {calendar.month_name[month]}, {year}"
                fmt_day = sunday_row_fmt if current.weekday() == 6 else border_fmt
                worksheet.write(row, LABEL_COL, label, fmt_day)

            # Employee-specific punch
            pmap = punch_map.get(admin.id, {})
            punch = pmap.get(current)
            time_in_str = punch.punch_in.strftime("%I:%M %p") if punch and punch.punch_in else ""
            time_out_str = punch.punch_out.strftime("%I:%M %p") if punch and punch.punch_out else ""

            fmt = sunday_row_fmt if current.weekday() == 6 else border_fmt

            worksheet.write(row, base_col,     time_in_str,  fmt)
            worksheet.write(row, base_col + 1, time_out_str, fmt)

    # Adjust column widths
    worksheet.set_column(0, 0, 32)
    last_col = FIRST_EMP_COL + TIME_COLUMNS_PER_PAIR * max(len(admins), 1)
    worksheet.set_column(1, last_col, 14)

    workbook.close()
    output.seek(0)
    return output
