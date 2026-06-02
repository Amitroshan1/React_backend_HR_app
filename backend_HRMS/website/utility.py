from .models.attendance import (
    CompOffGain,
    LeaveApplication,
    LeaveBalance,
    Punch,
    PunchSession,
    WorkFromHomeApplication,
)
from datetime import date
from io import BytesIO
import calendar
import xlsxwriter
import pandas as pd
import re

from .models.Admin_models import Admin
from .models.emp_detail_models import Employee
from . import db
from .models.holiday_calendar import HolidayCalendar
from collections import defaultdict
from sqlalchemy.orm import joinedload

from .circle_transfer_utils import (
    any_transfer_in_month_for_admins,
    circle_on_date,
    circle_transfer_export_rows,
    fmt_short_date,
    month_circle_note,
    preload_circle_history,
)


def add_circle_transfers_worksheet(workbook, admins, emp_type, circle, year, month, history_by_admin=None):
    """Add 'Circle Transfers' sheet with circle change details for the export month."""
    from .circle_transfer_utils import _fmt_dt

    history_by_admin = history_by_admin or preload_circle_history([a.id for a in admins])
    ws = workbook.add_worksheet("Circle Transfers")
    title_fmt = workbook.add_format({"bold": True, "font_size": 12})
    header_fmt = workbook.add_format(
        {"bold": True, "border": 1, "align": "center", "valign": "vcenter", "bg_color": "#D9E1F2", "text_wrap": True}
    )
    cell_fmt = workbook.add_format({"border": 1, "valign": "top", "text_wrap": True})
    yes_fmt = workbook.add_format({"border": 1, "bg_color": "#C6EFCE", "align": "center"})
    note_fmt = workbook.add_format({"italic": True, "font_color": "#475569", "text_wrap": True})

    month_label = f"{calendar.month_name[month]} {year}"
    headers = [
        "S.No",
        "Emp ID",
        "Employee Name",
        "Email",
        "Current Circle",
        "Month summary",
        "Change type",
        "From Circle",
        "To Circle",
        "Effective From",
        "Effective To",
        "Active in month (from)",
        "Active in month (to)",
        "Days in month",
        "In this export",
        "Recorded by (HR)",
        "Recorded at (system)",
        "HR notes",
    ]
    last_col = len(headers) - 1
    ws.merge_range(0, 0, 0, last_col, f"Circle transfer details — {month_label}", title_fmt)
    ws.merge_range(1, 0, 1, last_col, f"Export filter: Circle = {circle}  |  Employee type = {emp_type}", title_fmt)
    ws.merge_range(
        2,
        0,
        2,
        last_col,
        "Effective From/To = business dates (when the employee actually worked in that circle). "
        "Recorded At = when HR saved the change in the system.",
        note_fmt,
    )
    start_row = 4
    for col, h in enumerate(headers):
        ws.write(start_row, col, h, header_fmt)

    detail_rows = circle_transfer_export_rows(
        admins, circle, year, month, history_by_admin
    )
    row = start_row + 1
    for idx, item in enumerate(detail_rows, start=1):
        eff_from = item["effective_from"]
        eff_to = item["effective_to"]
        in_export = "Yes" if item.get("in_export_circle") else "No"
        values = [
            idx,
            item.get("emp_id", ""),
            item.get("employee_name", ""),
            item.get("email", ""),
            item.get("current_circle", ""),
            item.get("month_summary", ""),
            item.get("change_type", ""),
            item.get("from_circle", ""),
            item.get("to_circle", ""),
            fmt_short_date(eff_from) if eff_from else "—",
            fmt_short_date(eff_to) if eff_to else "Open",
            fmt_short_date(item["active_in_month_from"]),
            fmt_short_date(item["active_in_month_to"]),
            item.get("days_in_month", ""),
            in_export,
            item.get("recorded_by", ""),
            _fmt_dt(item.get("recorded_at")),
            item.get("notes", ""),
        ]
        for col, val in enumerate(values):
            fmt = yes_fmt if col == 14 and val == "Yes" else cell_fmt
            ws.write(row, col, val, fmt)
        row += 1

    if not detail_rows:
        ws.merge_range(row, 0, row, last_col, "No employees in this export.", note_fmt)

    widths = [6, 12, 22, 28, 14, 36, 14, 12, 12, 14, 14, 16, 16, 10, 12, 18, 20, 32]
    for col, w in enumerate(widths):
        ws.set_column(col, col, w)
    ws.freeze_panes(start_row + 1, 0)



def is_on_leave(admin_id, today):
    rows = LeaveApplication.query.filter(
        LeaveApplication.admin_id == admin_id,
        LeaveApplication.status == "Approved",
        LeaveApplication.start_date <= today,
        LeaveApplication.end_date >= today
    ).all()
    # Allow punch-in when only Half Day Leave is approved for the day.
    for lv in rows:
        leave_type = (getattr(lv, "leave_type", None) or "").strip().lower()
        if leave_type != "half day leave":
            return True
    return False



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



def _excel_session_geo_in(sess):
    if not sess:
        return ""
    v = (getattr(sess, "location_status_in", None) or "").strip()
    if v:
        return v
    if sess.clock_out is None:
        return (getattr(sess, "location_status", None) or "").strip()
    return ""


def _excel_session_geo_out(sess):
    if not sess:
        return ""
    v = (getattr(sess, "location_status_out", None) or "").strip()
    if v:
        return v
    if sess.clock_out is not None:
        return (getattr(sess, "location_status", None) or "").strip()
    return ""


def _excel_punch_location_in_out(punch):
    if not punch:
        return "", ""
    sessions = getattr(punch, "sessions", None) or []
    if not sessions:
        return "", ""
    ordered = sorted(sessions, key=lambda s: s.clock_in)
    first, last = ordered[0], ordered[-1]
    return _excel_session_geo_in(first), _excel_session_geo_out(last)


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
        note_fmt   = workbook.add_format({'italic': True, 'font_color': '#1e40af', 'text_wrap': True})
        circle_other_fmt = workbook.add_format({'border': 1, 'bg_color': '#FEF3C7', 'align': 'center'})

        # Dates
        num_days = calendar.monthrange(year, month)[1]
        start_date = date(year, month, 1)
        end_date = date(year, month, num_days)
        filter_circle_lower = (circle or "").strip().lower()
        history_by_admin = preload_circle_history([a.id for a in admins])

        # Header Info
        worksheet.write(0, 0, "emp_type", bold_fmt)
        worksheet.write(0, 1, emp_type)
        worksheet.write(0, 3, "Circle", bold_fmt)
        worksheet.write(0, 4, circle)
        worksheet.write(0, 6, "Month", bold_fmt)
        worksheet.write(0, 7, f"{calendar.month_name[month]} {year}", title_fmt)

        data_start_row = 2
        if any_transfer_in_month_for_admins(admins, year, month, history_by_admin):
            worksheet.merge_range(
                1, 0, 1, min(num_days + 2, 12),
                "Note: Some employees changed circle during this month. "
                "See 'Circle during month' and daily 'Circle' row under each employee.",
                note_fmt,
            )
            data_start_row = 3

        # Day labels
        days = [f"{d} {calendar.day_abbr[date(year, month, d).weekday()][0]}"
                for d in range(1, num_days + 1)]

        # Fetch punches (sessions for per-day location in/out)
        punches = (
            Punch.query.options(joinedload(Punch.sessions))
            .filter(
                Punch.admin_id.in_([a.id for a in admins]),
                Punch.punch_date >= start_date,
                Punch.punch_date <= end_date,
            )
            .all()
        )

        punch_map = {}
        for p in punches:
            punch_map.setdefault(p.admin_id, {})[p.punch_date.day] = p
        # Resolve employee identity, preferring Employee table and falling back to Admin.
        admin_ids = [a.id for a in admins]
        employee_rows = Employee.query.filter(Employee.admin_id.in_(admin_ids)).all()
        employees_by_admin_id = {e.admin_id: e for e in employee_rows}

        # Approved leave calendar days per admin (matches HR Attendance API)
        leave_days_by_admin = defaultdict(set)
        leaves_in_month = LeaveApplication.query.filter(
            LeaveApplication.admin_id.in_(admin_ids),
            LeaveApplication.status == "Approved",
            LeaveApplication.start_date <= end_date,
            LeaveApplication.end_date >= start_date,
        ).all()
        for lv in leaves_in_month:
            cur = lv.start_date
            while cur <= lv.end_date:
                if start_date <= cur <= end_date:
                    leave_days_by_admin[lv.admin_id].add(cur)
                cur += timedelta(days=1)

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
        row = data_start_row
        for admin in admins:
            admin_history = history_by_admin.get(admin.id)

            employee = employees_by_admin_id.get(admin.id)
            if employee:
                emp_code = employee.emp_id or (admin.emp_id or "N/A")
                emp_name = employee.name or (admin.first_name or "N/A")
            else:
                emp_code = admin.emp_id or "N/A"
                emp_name = admin.first_name or "N/A"

            worksheet.write(row, 0, "Emp ID:", bold_fmt)
            worksheet.write(row, 1, emp_code)
            worksheet.write(row, 3, "Emp Name:", bold_fmt)
            worksheet.write(row, 4, emp_name)

            # Move to next row for the day headers so the name row remains visible
            row += 1

            circle_note = month_circle_note(admin, year, month, admin_history)
            if circle_note:
                worksheet.write(row, 0, "Circle during month:", bold_fmt)
                worksheet.merge_range(row, 1, row, min(num_days + 1, 10), circle_note, border_fmt)
                row += 1

            # Punch rows
            in_times = []
            out_times = []
            loc_in_times = []
            loc_out_times = []
            totals = []
            circle_days = []

            # Per-admin punches mapped by day (1..num_days)
            admin_punches = punch_map.get(admin.id, {})

            for d in range(1, num_days + 1):
                current_day_date = date(year, month, d)
                day_circle = circle_on_date(admin, current_day_date, admin_history) or ""
                circle_days.append(day_circle)
                on_leave_day = current_day_date in leave_days_by_admin.get(admin.id, set())
                punch = admin_punches.get(d)

                loc_in, loc_out = "", ""
                if punch:
                    loc_in, loc_out = _excel_punch_location_in_out(punch)
                    legacy_loc = (getattr(punch, "location_status", None) or "").strip()
                    if not loc_in and not loc_out and legacy_loc:
                        loc_in = loc_out = legacy_loc

                if on_leave_day:
                    in_times.append("On leave")
                    out_times.append("On leave")
                    totals.append("–")
                    loc_in_times.append(loc_in or "–")
                    loc_out_times.append(loc_out or "–")
                elif punch:
                    in_t = punch.punch_in.strftime("%I:%M %p") if punch.punch_in else ""
                    out_t = punch.punch_out.strftime("%I:%M %p") if punch.punch_out else ""

                    in_times.append(in_t)
                    out_times.append(out_t)
                    loc_in_times.append(loc_in)
                    loc_out_times.append(loc_out)

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
                    loc_in_times.append("")
                    loc_out_times.append("")
                    totals.append("")

            worksheet.write(row, 0, "Days", header_fmt)
            for col, dval in enumerate(days, start=1):
                worksheet.write(row, col, dval, header_fmt)
            row += 1

            for label, data in [
                ("InTime", in_times),
                ("OutTime", out_times),
                ("Location (In)", loc_in_times),
                ("Location (Out)", loc_out_times),
                ("Total", totals),
            ]:
                worksheet.write(row, 0, label, header_fmt)
                for col, val in enumerate(data, start=1):
                    worksheet.write(row, col, val, absent_fmt if not val else border_fmt)
                row += 1

            worksheet.write(row, 0, "Circle", header_fmt)
            for col, val in enumerate(circle_days, start=1):
                c_lower = (val or "").strip().lower()
                fmt = circle_other_fmt if c_lower and c_lower != filter_circle_lower else border_fmt
                worksheet.write(row, col, val or "", fmt)
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

        add_circle_transfers_worksheet(
            workbook, admins, emp_type, circle, year, month, history_by_admin
        )

        # -----------------------------
        # Session Details
        # -----------------------------
        session_ws = workbook.add_worksheet("Session Details")
        session_headers = [
            "Date",
            "Emp ID",
            "Employee Name",
            "Session #",
            "Clock In",
            "Clock Out",
            "Duration",
            "Repeat Reason",
            "Extended Hours Reason",
            "Is Open",
        ]
        for c, h in enumerate(session_headers):
            session_ws.write(0, c, h, header_fmt)

        admins_by_id = {a.id: a for a in admins}
        sessions = (
            PunchSession.query.join(Punch, PunchSession.punch_id == Punch.id)
            .filter(
                Punch.admin_id.in_(admin_ids),
                Punch.punch_date >= start_date,
                Punch.punch_date <= end_date,
            )
            .order_by(Punch.admin_id.asc(), Punch.punch_date.asc(), PunchSession.clock_in.asc())
            .all()
        )

        seq_map = {}  # (admin_id, punch_date) -> session number
        r = 1
        for s in sessions:
            p = getattr(s, "punch", None)
            if not p:
                continue
            a = admins_by_id.get(p.admin_id)
            if not a:
                continue

            employee = employees_by_admin_id.get(a.id)
            emp_code = (employee.emp_id if employee and getattr(employee, "emp_id", None) else None) or a.emp_id or ""
            emp_name = (employee.name if employee and getattr(employee, "name", None) else None) or a.first_name or ""

            key = (p.admin_id, p.punch_date)
            seq_map[key] = seq_map.get(key, 0) + 1
            seq = seq_map[key]

            cin = s.clock_in.strftime("%H:%M:%S") if s.clock_in else ""
            cout = s.clock_out.strftime("%H:%M:%S") if s.clock_out else ""
            if s.clock_in and s.clock_out:
                secs = max(0, int((s.clock_out - s.clock_in).total_seconds()))
                h, rem = divmod(secs, 3600)
                m, sec = divmod(rem, 60)
                dur = f"{h:02d}:{m:02d}:{sec:02d}"
            else:
                dur = ""

            session_ws.write(r, 0, p.punch_date.isoformat() if p.punch_date else "", border_fmt)
            session_ws.write(r, 1, emp_code, border_fmt)
            session_ws.write(r, 2, emp_name, border_fmt)
            session_ws.write(r, 3, seq, border_fmt)
            session_ws.write(r, 4, cin, border_fmt)
            session_ws.write(r, 5, cout, border_fmt)
            session_ws.write(r, 6, dur, border_fmt)
            session_ws.write(r, 7, (s.repeat_reason or ""), border_fmt)
            session_ws.write(r, 8, (getattr(s, "extended_hours_reason", None) or ""), border_fmt)
            session_ws.write(r, 9, "Yes" if s.clock_out is None else "No", border_fmt)
            r += 1

        session_ws.set_column(0, 0, 12)
        session_ws.set_column(1, 2, 18)
        session_ws.set_column(3, 3, 10)
        session_ws.set_column(4, 6, 14)
        session_ws.set_column(7, 8, 30)
        session_ws.set_column(9, 9, 10)

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


def calculate_sundays_in_span(year: int, month: int) -> int:
    """
    Count Sundays (weekday==6) within the same span your Excel generator uses:
      - If (year, month) is the current month, count Sundays up to today's date.
      - Otherwise count Sundays for the full month.
    """
    month_start = date(year, month, 1)
    month_end = date(year, month, calendar.monthrange(year, month)[1])

    today = datetime.now(ZoneInfo("Asia/Kolkata")).date()
    end_date = today if (year == today.year and month == today.month) else month_end

    sundays_in_span = 0
    for i in range((end_date - month_start).days + 1):
        d = month_start + timedelta(days=i)
        if d.weekday() == 6:
            sundays_in_span += 1
    return sundays_in_span


def calculate_weekend_continuous_absence_penalty(admin_id: int, emp_type: str, year: int, month: int) -> int:
    """
    Sandwich / continuous-block rule (Fri–Sat–Sun–Mon):
    If employee is "blocked" on all 4 days (approved leave OR no punch/WFH),
    then weekend should NOT be credited as present.

    Penalty logic:
      - Always remove the Sunday credit (penalty +1) for that Sunday.
      - If Saturday is normally NON-working for this emp_type, also apply an extra penalty (+1)
        so Saturday+Sunday both get treated as absent for that block.

    Notes:
      - Uses the same month span behavior as calculate_attendance_Accounts:
        current month is capped to today's date (IST).
      - "Blocked" here means: NOT a full-day punch and NOT approved WFH. Approved leave makes a day blocked.
        Half-day leave is treated as blocked for this rule.
    """
    start_date = date(year, month, 1)
    month_end = date(year, month, calendar.monthrange(year, month)[1])
    today = datetime.now(ZoneInfo("Asia/Kolkata")).date()
    end_date = today if (year == today.year and month == today.month) else month_end

    if end_date < start_date:
        return 0

    # Holidays (needed for Optional Leave tracking)
    holiday_rows = HolidayCalendar.query.filter(
        HolidayCalendar.year == year,
        HolidayCalendar.is_active.is_(True),
        HolidayCalendar.holiday_date.between(start_date, end_date),
    ).all()
    optional_holidays = {h.holiday_date for h in holiday_rows if getattr(h, "is_optional", False)}

    # Punches (full-day only for "presence")
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
        Punch.punch_date.between(start_date, end_date),
    ).all()
    worked_full_dates = set()
    for p in punches:
        if not p.punch_in or not p.punch_out:
            continue
        secs = _punch_work_seconds(p)
        if secs >= FULL_DAY_WORK_SECONDS:
            worked_full_dates.add(p.punch_date)

    # WFH (approved)
    wfh_apps = WorkFromHomeApplication.query.filter(
        WorkFromHomeApplication.admin_id == admin_id,
        WorkFromHomeApplication.status == "Approved",
        WorkFromHomeApplication.start_date <= end_date,
        WorkFromHomeApplication.end_date >= start_date,
    ).all()
    wfh_dates = set()
    for wfh in wfh_apps:
        d = max(wfh.start_date, start_date)
        d_end = min(wfh.end_date, end_date)
        while d <= d_end:
            wfh_dates.add(d)
            d += timedelta(days=1)

    # Leaves (approved) – capture full-day coverage and optional leave taken on optional holidays.
    leaves = LeaveApplication.query.filter(
        LeaveApplication.admin_id == admin_id,
        LeaveApplication.status == "Approved",
        LeaveApplication.start_date <= end_date,
        LeaveApplication.end_date >= start_date,
    ).all()

    leave_full_dates = set()
    optional_leave_taken = set()
    for leave in leaves:
        d_start = max(leave.start_date, start_date)
        d_end = min(leave.end_date, end_date)

        if leave.leave_type == "Optional Leave":
            d = d_start
            while d <= d_end:
                if d in optional_holidays:
                    optional_leave_taken.add(d)
                d += timedelta(days=1)
            continue

        if leave.leave_type == "Half Day Leave":
            # Half day is NOT treated as "presence" for this continuous-absence rule.
            continue

        # Other leave types cover each day fully.
        d = d_start
        while d <= d_end:
            leave_full_dates.add(d)
            d += timedelta(days=1)

    def _is_blocked(d: date) -> bool:
        # Full-day punch or WFH breaks the block.
        if d in worked_full_dates or d in wfh_dates:
            return False
        # Any approved leave (including Optional Leave on optional holidays) counts as blocked.
        if d in leave_full_dates or d in optional_leave_taken:
            return True
        # No punch/WFH/leave => blocked (continuous absence)
        return True

    # Saturday is considered "working" only for HR/Accounts (same as calculate_attendance_Accounts)
    emp_type_clean = (emp_type or "").strip()
    saturday_is_working = emp_type_clean in ["Human Resource", "Accounts"]

    penalty = 0
    current = start_date
    while current <= end_date:
        if current.weekday() != 6:  # only Sundays
            current += timedelta(days=1)
            continue

        sun = current
        fri = sun - timedelta(days=2)
        sat = sun - timedelta(days=1)
        mon = sun + timedelta(days=1)

        # Need all four days within span
        if fri < start_date or mon > end_date:
            current += timedelta(days=1)
            continue

        if _is_blocked(fri) and _is_blocked(sat) and _is_blocked(sun) and _is_blocked(mon):
            # Remove Sunday credit
            penalty += 1
            # If Saturday is normally off, also count Saturday as absent in this continuous block
            if not saturday_is_working:
                penalty += 1

        current += timedelta(days=1)

    return penalty


def calculate_actual_working_days_Accounts(admin_id: int, emp_type: str, year: int, month_num: int) -> float:
    """
    Actual working days (Accounts Excel style) with continuous weekend-absence penalty.
    """
    working_days_expected, absent_days = calculate_attendance_Accounts(
        admin_id=admin_id,
        emp_type=emp_type,
        year=year,
        month=month_num,
    )
    sundays_in_span = calculate_sundays_in_span(year=year, month=month_num)
    penalty = calculate_weekend_continuous_absence_penalty(
        admin_id=admin_id,
        emp_type=emp_type,
        year=year,
        month=month_num,
    )
    return float(working_days_expected) - float(absent_days) + float(sundays_in_span) - float(penalty)


def calculate_actual_working_days_for_payroll(admin_id: int, year: int, month_num: int) -> float:
    """
    Excel-style "actual working days":
      actual = working_days_expected - absent_days + sundays_in_span
    where:
      - working_days_expected and absent_days come from calculate_attendance_Accounts()
      - sundays_in_span is added like your Accounts Excel generator does.
    """
    admin = Admin.query.get(admin_id)
    emp_type = (admin.emp_type or "").strip() if admin else ""

    return calculate_actual_working_days_Accounts(
        admin_id=admin_id,
        emp_type=emp_type,
        year=year,
        month_num=month_num,
    )


def calculate_monthly_payroll_from_ctc_and_attendance(*, admin_id: int, year: int, month_num: int):
    """
    Compute monthly payroll gross and CTC-based deductions (computed values).
    Deductions totals and final net are meant to be finalized/overridden by Accounts.
    """
    # Local import to avoid circular imports
    from .models.ctc_breakup import CTCBreakup

    admin = Admin.query.get(admin_id)
    emp_type = (admin.emp_type or "").strip() if admin else ""

    ctc = CTCBreakup.query.filter_by(admin_id=admin_id).first()
    ctc_gross_salary = float(ctc.gross_salary or 0.0) if ctc else 0.0
    epf_amount = float(ctc.epf or 0.0) if ctc else 0.0
    esic_amount = float(ctc.esic or 0.0) if ctc else 0.0
    ptax_amount = float(ctc.ptax or 0.0) if ctc else 0.0

    calendar_days = calendar.monthrange(year, month_num)[1]
    one_day_salary = (ctc_gross_salary / float(calendar_days)) if calendar_days > 0 else 0.0

    # Step: gross = one_day_salary * actual_working_days
    actual_working_days = calculate_actual_working_days_for_payroll(
        admin_id=admin_id,
        year=year,
        month_num=month_num,
    )
    gross_salary_for_month = one_day_salary * float(actual_working_days)

    return {
        "admin_id": admin_id,
        "year": str(year),
        "month_num": int(month_num),
        "month": calendar.month_name[int(month_num)],
        "ctc_gross_salary": ctc_gross_salary,
        "calendar_days": int(calendar_days),
        "one_day_salary": one_day_salary,
        "actual_working_days": actual_working_days,
        "gross_salary_for_month": gross_salary_for_month,
        "epf_computed": epf_amount,
        "esic_computed": esic_amount,
        "ptax_computed": ptax_amount,
        "deductions_total_computed": epf_amount + esic_amount + ptax_amount,
        "net_salary_computed": gross_salary_for_month - (epf_amount + esic_amount + ptax_amount),
    }



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
    note_fmt = workbook.add_format({'italic': True, 'font_color': '#1e40af', 'text_wrap': True})
    wrap_fmt = workbook.add_format({'border': 1, 'text_wrap': True, 'valign': 'top'})

    history_by_admin = preload_circle_history([a.id for a in admins])
    last_col_letter = "N"

    # -------- HEADER --------
    worksheet.merge_range(f'A1:{last_col_letter}1', f"Employee Domain: {emp_type}", title_fmt)
    worksheet.merge_range(f'A2:{last_col_letter}2', f"Circle: {circle}", title_fmt)
    worksheet.merge_range(f'A3:{last_col_letter}3', f"Month: {calendar.month_name[month]} {year}", title_fmt)

    row = 3
    if any_transfer_in_month_for_admins(admins, year, month, history_by_admin):
        worksheet.merge_range(
            f'A4:{last_col_letter}4',
            "Note: Some employees changed circle during this month. See column 'Circle during month'.",
            note_fmt,
        )
        row = 4

    # -------- TABLE HEADER --------
    row += 1
    headers = [
        "S.No",
        "Month",
        "Employee Name",
        "Circle during month",
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

    # -------- DATA --------
    row += 1
    for idx, admin in enumerate(admins, start=1):

        # Employee name (Admin model; no Signup)
        emp_name = admin.first_name or "N/A"
        circle_note = month_circle_note(admin, year, month, history_by_admin.get(admin.id)) or (admin.circle or "")

        # Attendance totals (Accounts HRMS logic) + continuous weekend-absence penalty
        working_days_expected, absent_days = calculate_attendance_Accounts(admin.id, emp_type, year, month)
        actual_working_days = calculate_actual_working_days_Accounts(admin.id, emp_type, year, month)

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
        worksheet.write(row, 0, idx, cell_fmt)
        worksheet.write(row, 1, f"{calendar.month_name[month]} {year}", cell_fmt)
        worksheet.write(row, 2, emp_name, cell_fmt)
        worksheet.write(row, 3, circle_note, wrap_fmt)
        worksheet.write_row(row, 4, [
            total_days,
            actual_working_days,
            absent_days,
            balance_cl,
            balance_pl,
            balance_comp,
            applied_cl,
            applied_pl,
            applied_comp,
            total_applied_leave,
        ], cell_fmt)

        row += 1

    worksheet.set_column(0, 13, 22)
    worksheet.set_column(3, 3, 36)
    add_circle_transfers_worksheet(
        workbook, admins, emp_type, circle, year, month, history_by_admin
    )
    workbook.close()
    output.seek(0)

    return output


def _month_date_bounds(year, month):
    num_days = calendar.monthrange(year, month)[1]
    return date(year, month, 1), date(year, month, num_days)


def _calendar_dates_inclusive(start_d, end_d):
    """Sorted list of calendar dates from start_d to end_d inclusive."""
    if start_d > end_d:
        return []
    out = []
    cur = start_d
    while cur <= end_d:
        out.append(cur)
        cur += timedelta(days=1)
    return out


def _format_day_month(d):
    if not d:
        return ""
    return f"{d.day} {calendar.month_abbr[d.month]}"


def _format_date_run(dates):
    """Format sorted date list as '6 Apr', '6–8 Apr', or '6, 15 Apr'."""
    if not dates:
        return ""
    dates = sorted(set(dates))
    groups = []
    span_start = span_end = dates[0]
    for d in dates[1:]:
        if (d - span_end).days == 1:
            span_end = d
        else:
            groups.append((span_start, span_end))
            span_start = span_end = d
    groups.append((span_start, span_end))
    bits = []
    for a, b in groups:
        if a == b:
            bits.append(_format_day_month(a))
        else:
            mo = calendar.month_abbr[a.month]
            if a.month == b.month:
                bits.append(f"{a.day}–{b.day} {mo}")
            else:
                bits.append(f"{_format_day_month(a)} – {_format_day_month(b)}")
    return ", ".join(bits)


def _simulate_comp_off_fifo(admin_id):
    """
    Replay compensatory leave deductions in approval/start order, assigning each
    deducted slice to CompOffGain rows ordered by expiry_date (same as deduct_comp_leave).
    Returns list of (leave_application, gain_date, amount).
    """
    gains = (
        CompOffGain.query.filter_by(admin_id=admin_id)
        .order_by(CompOffGain.expiry_date.asc(), CompOffGain.id.asc())
        .all()
    )
    remaining = {g.id: 1.0 for g in gains}
    leaves = (
        LeaveApplication.query.filter(
            LeaveApplication.admin_id == admin_id,
            LeaveApplication.leave_type == "Compensatory Leave",
            LeaveApplication.status == "Approved",
        )
        .order_by(LeaveApplication.start_date.asc(), LeaveApplication.id.asc())
        .all()
    )
    rows = []
    for lv in leaves:
        need = float(lv.deducted_days or 0)
        if need <= 1e-9:
            continue
        for g in gains:
            if need <= 1e-9:
                break
            if remaining[g.id] <= 1e-9:
                continue
            if g.expiry_date < lv.start_date:
                continue
            take = min(need, remaining[g.id])
            remaining[g.id] -= take
            need -= take
            rows.append((lv, g.gain_date, take))
    return rows


def _fmt_take_days(t):
    if abs(t - round(t)) < 1e-6:
        return str(int(round(t)))
    return f"{t:.1f}".rstrip("0").rstrip(".")


def _client_leave_row_summary(admin_id, year, month):
    """Casual + Privilege approved days in month — count | dates pairs."""
    ms, me = _month_date_bounds(year, month)
    parts = []
    for lt in ("Casual Leave", "Privilege Leave"):
        leaves = (
            LeaveApplication.query.filter(
                LeaveApplication.admin_id == admin_id,
                LeaveApplication.leave_type == lt,
                LeaveApplication.status == "Approved",
                LeaveApplication.start_date <= me,
                LeaveApplication.end_date >= ms,
            )
            .order_by(LeaveApplication.start_date.asc(), LeaveApplication.id.asc())
            .all()
        )
        for lv in leaves:
            block = _calendar_dates_inclusive(
                max(lv.start_date, ms), min(lv.end_date, me)
            )
            if not block:
                continue
            n = len(block)
            parts.append(f"{n} | {_format_date_run(block)}")
    return "; ".join(parts)


def _client_half_day_row_summary(admin_id, year, month):
    ms, me = _month_date_bounds(year, month)
    leaves = (
        LeaveApplication.query.filter(
            LeaveApplication.admin_id == admin_id,
            LeaveApplication.leave_type == "Half Day Leave",
            LeaveApplication.status == "Approved",
            LeaveApplication.start_date <= me,
            LeaveApplication.end_date >= ms,
        )
        .order_by(LeaveApplication.start_date.asc(), LeaveApplication.id.asc())
        .all()
    )
    parts = []
    for lv in leaves:
        for d in _calendar_dates_inclusive(
            max(lv.start_date, ms), min(lv.end_date, me)
        ):
            parts.append(f"0.5 | {_format_day_month(d)}")
    return "; ".join(parts)


def _client_comp_off_row_summary(admin_id, year, month):
    """Comp off taken in month with earned-on (gain) date per FIFO slice."""
    ms, me = _month_date_bounds(year, month)
    alloc_rows = _simulate_comp_off_fifo(admin_id)
    grouped = defaultdict(list)
    for lv, gain_date, take in alloc_rows:
        grouped[lv.id].append((gain_date, float(take)))

    parts = []
    for lv_id, chunk_list in grouped.items():
        lv = next((l for l, _, _ in alloc_rows if l.id == lv_id), None)
        if not lv:
            continue
        dates_full = _calendar_dates_inclusive(lv.start_date, lv.end_date)
        di = 0
        for gain_date, take in chunk_list:
            need = float(take)
            got = []
            while need > 1e-9 and di < len(dates_full):
                step = min(1.0, need)
                got.append(dates_full[di])
                need -= step
                di += 1
            in_month = [d for d in got if ms <= d <= me]
            if not in_month:
                continue
            ratio = (len(in_month) / len(got)) if got else 1.0
            shown_take = take * ratio
            tk = _fmt_take_days(shown_take)
            earned = _format_day_month(gain_date)
            parts.append(f"{tk} | {_format_date_run(in_month)} — earned {earned}")
    return "; ".join(parts)


def generate_client_attendance_excel(admins, year, month, project_name=None, place=None, circle=None, emp_type=None):
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
    legend_leave_pending_fmt = workbook.add_format({"border": 1, "bg_color": "#FFD966"})
    sunday_row_fmt = workbook.add_format({"border": 1, "bg_color": "#D9D9D9"})

    def _session_geo_in(sess):
        if not sess:
            return None
        v = (getattr(sess, "location_status_in", None) or "").strip()
        if v:
            return v
        if sess.clock_out is None:
            return ((getattr(sess, "location_status", None) or "").strip() or None)
        return None

    def _session_geo_out(sess):
        if not sess:
            return None
        v = (getattr(sess, "location_status_out", None) or "").strip()
        if v:
            return v
        if sess.clock_out is not None:
            return ((getattr(sess, "location_status", None) or "").strip() or None)
        return None

    # Date range for the month
    num_days = calendar.monthrange(year, month)[1]
    month_start = date(year, month, 1)
    month_end = date(year, month, num_days)

    # Non-optional, active holidays for this month
    holidays = HolidayCalendar.query.filter(
        HolidayCalendar.year == year,
        HolidayCalendar.holiday_date >= month_start,
        HolidayCalendar.holiday_date <= month_end,
        HolidayCalendar.is_optional == False,
        HolidayCalendar.is_active == True,
    ).all()
    holiday_dates = {h.holiday_date: h for h in holidays}

    # Single worksheet for all employees
    worksheet = workbook.add_worksheet("Attendance")

    # Legend rows (top of sheet)
    worksheet.write(0, 0, "SUNDAY / HOLIDAY", legend_holiday_fmt)
    worksheet.write(1, 0, "COMP OFF", legend_comp_off_fmt)
    worksheet.write(2, 0, "HALF DAY", legend_half_day_fmt)
    worksheet.write(3, 0, "LEAVE", legend_leave_fmt)
    worksheet.write(4, 0, "LEAVE PENDING / NOT APPROVED", legend_leave_pending_fmt)

    HEADER_START_ROW = 5   # First header row after legend block
    LABEL_COL = 0          # Column A
    FIRST_EMP_COL = 1      # First employee starts at column B
    TIME_COLUMNS_PER_PAIR = 2

    labels = [
        "Name",
        "Month/Year",
        "Project Name",
        "Place",
        "Circle during month",
        "Date of Joining",
        "Date of Deputation",
    ]
    TABLE_HEADER_ROW = HEADER_START_ROW + len(labels) + 1

    history_by_admin = preload_circle_history([a.id for a in admins])
    if any_transfer_in_month_for_admins(admins, year, month, history_by_admin):
        transfer_note_fmt = workbook.add_format(
            {"italic": True, "font_color": "#1e40af", "text_wrap": True, "border": 1}
        )
        worksheet.merge_range(
            5, 0, 5, 6,
            "Note: Some employees changed circle during this month. See 'Circle during month' for date ranges.",
            transfer_note_fmt,
        )
        HEADER_START_ROW = 6
        TABLE_HEADER_ROW = HEADER_START_ROW + len(labels) + 1

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

    # Build a leave map for all employees: {admin_id: {date: [LeaveApplication,...]}}
    leave_map = {}
    leave_qs = LeaveApplication.query.filter(
        LeaveApplication.admin_id.in_(admin_ids),
        LeaveApplication.start_date <= month_end,
        LeaveApplication.end_date >= month_start,
    ).all()
    for la in leave_qs:
        current = la.start_date
        while current <= la.end_date:
            if month_start <= current <= month_end:
                leave_map.setdefault(la.admin_id, {}).setdefault(current, []).append(la)
            current += timedelta(days=1)

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
        doj = getattr(admin, "doj", None)
        circle_note = month_circle_note(
            admin, year, month, history_by_admin.get(admin.id)
        ) or (admin.circle or "")

        header_values = [
            admin.first_name or "N/A",
            month_label,
            project_name or "",
            place or (admin.circle or ""),
            circle_note,
            doj.strftime("%d-%m-%Y") if doj and hasattr(doj, "strftime") else "",
            "",
        ]
        for idx, val in enumerate(header_values):
            worksheet.merge_range(
                HEADER_START_ROW + idx,
                base_col,
                HEADER_START_ROW + idx,
                base_col + 1,
                val,
                border_fmt,
            )

        # Single-row table header directly under header block for this employee
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

            is_sunday = current.weekday() == 6
            is_weekend = current.weekday() in (5, 6)
            is_holiday = current in holiday_dates

            # Only write the Day_Date once (for the first employee)
            if emp_index == 0:
                label = f"{current.strftime('%A')}, {day} {calendar.month_name[month]}, {year}"
                if is_holiday:
                    fmt_day = legend_holiday_fmt
                else:
                    fmt_day = sunday_row_fmt if is_sunday else border_fmt
                worksheet.write(row, LABEL_COL, label, fmt_day)

            # Employee-specific punch and leave data
            pmap = punch_map.get(admin.id, {})
            lmap = leave_map.get(admin.id, {})
            punch = pmap.get(current)
            leaves_for_day = lmap.get(current, [])

            base_fmt = sunday_row_fmt if is_sunday else border_fmt

            if is_holiday:
                # Show holiday name (or generic label) for all employees
                holiday_name = holiday_dates[current].holiday_name
                text = holiday_name or "Holiday"
                worksheet.write(row, base_col,     text, legend_holiday_fmt)
                worksheet.write(row, base_col + 1, "",   legend_holiday_fmt)
            elif leaves_for_day:
                # Decide coloring and text based on leave status, and include leave type(s)
                statuses = { (la.status or "").lower() for la in leaves_for_day }

                # Collect leave types for the day (e.g. "Privilege Leave", "Casual Leave")
                leave_types = {
                    (getattr(la, "leave_type", "") or "").strip()
                    for la in leaves_for_day
                    if getattr(la, "leave_type", None)
                }
                type_label = ", ".join(sorted(t for t in leave_types if t)) or "Leave"

                has_pending_only = "pending" in statuses and not any(
                    s in statuses for s in ("approved", "approved by manager", "approved by hr")
                )

                if has_pending_only:
                    cell_text = f"Leave not approved ({type_label})"
                    fmt = legend_leave_pending_fmt
                else:
                    cell_text = f"Leave ({type_label})"
                    fmt = legend_leave_fmt

                worksheet.write(row, base_col,     cell_text, fmt)
                worksheet.write(row, base_col + 1, "",        fmt)
            elif is_weekend:
                has_punch = punch and (punch.punch_in or punch.punch_out)
                if has_punch:
                    time_in_str = (
                        punch.punch_in.strftime("%H:%M") if punch.punch_in else ""
                    )
                    time_out_str = (
                        punch.punch_out.strftime("%H:%M") if punch.punch_out else ""
                    )
                    worksheet.write(row, base_col, time_in_str, base_fmt)
                    worksheet.write(row, base_col + 1, time_out_str, base_fmt)
                else:
                    worksheet.write(row, base_col, "Weekend Off", legend_holiday_fmt)
                    worksheet.write(row, base_col + 1, "Weekend Off", legend_holiday_fmt)
            else:
                time_in_str = (
                    punch.punch_in.strftime("%H:%M") if punch and punch.punch_in else ""
                )
                time_out_str = (
                    punch.punch_out.strftime("%H:%M") if punch and punch.punch_out else ""
                )

                worksheet.write(row, base_col, time_in_str, base_fmt)
                worksheet.write(row, base_col + 1, time_out_str, base_fmt)

    # ----- Summary rows (Leave / Comp off / Half day) per employee -----
    TABLE_HEADER_ROW_FIXED = TABLE_HEADER_ROW
    first_day_row_fixed = TABLE_HEADER_ROW_FIXED + 1
    summary_leave_row = first_day_row_fixed + num_days
    summary_comp_row = summary_leave_row + 1
    summary_half_row = summary_comp_row + 1

    summary_label_fmt = workbook.add_format(
        {
            "bold": True,
            "border": 1,
            "bg_color": "#D9D9D9",
            "align": "left",
            "valign": "vcenter",
        }
    )
    summary_body_fmt = workbook.add_format(
        {"border": 1, "text_wrap": True, "valign": "top"}
    )

    worksheet.write(summary_leave_row, LABEL_COL, "Leave", summary_label_fmt)
    worksheet.write(summary_comp_row, LABEL_COL, "Comp off", summary_label_fmt)
    worksheet.write(summary_half_row, LABEL_COL, "Half day", summary_label_fmt)

    for emp_index, admin in enumerate(admins):
        base_col = FIRST_EMP_COL + emp_index * TIME_COLUMNS_PER_PAIR
        leave_txt = _client_leave_row_summary(admin.id, year, month)
        comp_txt = _client_comp_off_row_summary(admin.id, year, month)
        half_txt = _client_half_day_row_summary(admin.id, year, month)
        worksheet.merge_range(
            summary_leave_row,
            base_col,
            summary_leave_row,
            base_col + 1,
            leave_txt or "—",
            summary_body_fmt,
        )
        worksheet.merge_range(
            summary_comp_row,
            base_col,
            summary_comp_row,
            base_col + 1,
            comp_txt or "—",
            summary_body_fmt,
        )
        worksheet.merge_range(
            summary_half_row,
            base_col,
            summary_half_row,
            base_col + 1,
            half_txt or "—",
            summary_body_fmt,
        )

    # Adjust column widths
    worksheet.set_column(0, 0, 32)
    last_col = FIRST_EMP_COL + TIME_COLUMNS_PER_PAIR * max(len(admins), 1)
    worksheet.set_column(1, last_col, 14)

    export_circle = circle or (admins[0].circle if admins else "")
    export_emp_type = emp_type or (admins[0].emp_type if admins else "")
    add_circle_transfers_worksheet(
        workbook, admins, export_emp_type, export_circle, year, month, history_by_admin
    )

    # -----------------------------
    # Session Details
    # -----------------------------
    session_ws = workbook.add_worksheet("Session Details")
    session_headers = [
        "Date",
        "Emp ID",
        "Employee Name",
        "Session #",
        "Clock In",
        "Clock Out",
        "Duration",
        "Geo (in)",
        "Geo (out)",
        "Repeat Reason",
        "Extended Hours Reason",
        "Is Open",
    ]
    for c, h in enumerate(session_headers):
        session_ws.write(0, c, h, header_fmt)

    admins_by_id = {a.id: a for a in admins}
    session_rows = (
        PunchSession.query.join(Punch, PunchSession.punch_id == Punch.id)
        .filter(
            Punch.admin_id.in_(admin_ids),
            Punch.punch_date >= month_start,
            Punch.punch_date <= month_end,
        )
        .order_by(Punch.admin_id.asc(), Punch.punch_date.asc(), PunchSession.clock_in.asc())
        .all()
    )

    seq_map = {}  # (admin_id, punch_date) -> session sequence
    r = 1
    for s in session_rows:
        p = getattr(s, "punch", None)
        if not p:
            continue
        a = admins_by_id.get(p.admin_id)
        if not a:
            continue

        key = (p.admin_id, p.punch_date)
        seq_map[key] = seq_map.get(key, 0) + 1
        seq = seq_map[key]

        cin = s.clock_in.strftime("%H:%M") if s.clock_in else ""
        cout = s.clock_out.strftime("%H:%M") if s.clock_out else ""
        if s.clock_in and s.clock_out:
            secs = max(0, int((s.clock_out - s.clock_in).total_seconds()))
            h, rem = divmod(secs, 3600)
            m, _ = divmod(rem, 60)
            dur = f"{h:02d}:{m:02d}"
        else:
            dur = ""

        session_ws.write(r, 0, p.punch_date.isoformat() if p.punch_date else "", border_fmt)
        session_ws.write(r, 1, a.emp_id or "", border_fmt)
        session_ws.write(r, 2, a.first_name or "", border_fmt)
        session_ws.write(r, 3, seq, border_fmt)
        geo_in = _session_geo_in(s) or ""
        geo_out = _session_geo_out(s) or ""

        session_ws.write(r, 4, cin, border_fmt)
        session_ws.write(r, 5, cout, border_fmt)
        session_ws.write(r, 6, dur, border_fmt)
        session_ws.write(r, 7, geo_in, border_fmt)
        session_ws.write(r, 8, geo_out, border_fmt)
        session_ws.write(r, 9, (s.repeat_reason or ""), border_fmt)
        session_ws.write(r, 10, (getattr(s, "extended_hours_reason", None) or ""), border_fmt)
        session_ws.write(r, 11, "Yes" if s.clock_out is None else "No", border_fmt)
        r += 1

    session_ws.set_column(0, 0, 12)
    session_ws.set_column(1, 2, 18)
    session_ws.set_column(3, 3, 10)
    session_ws.set_column(4, 6, 14)
    session_ws.set_column(7, 8, 18)
    session_ws.set_column(9, 10, 30)
    session_ws.set_column(11, 11, 10)

    workbook.close()
    output.seek(0)
    return output


def generate_expense_claim_excel(header, line_items, *, circle=None, emp_type=None, claim_status=None):
    """Re-export for backward compatibility."""
    from .expense_utils import generate_expense_claim_excel as _gen

    return _gen(header, line_items, circle=circle, emp_type=emp_type, claim_status=claim_status)
