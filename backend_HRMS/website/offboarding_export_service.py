"""Offboarding analytics export — CSV and PDF for leadership."""
from __future__ import annotations

import csv
from datetime import date, timedelta
from io import BytesIO, StringIO

from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas

from .offboarding_service import build_exit_analytics


def build_exit_detail_rows(*, months: int = 12) -> list[dict]:
    from . import db
    from .models.Admin_models import Admin, EmployeeExitHistory

    cutoff = date.today() - timedelta(days=max(1, months) * 31)
    rows = (
        db.session.query(EmployeeExitHistory, Admin)
        .join(Admin, Admin.id == EmployeeExitHistory.admin_id)
        .filter(EmployeeExitHistory.exit_date >= cutoff)
        .order_by(EmployeeExitHistory.exit_date.desc(), EmployeeExitHistory.id.desc())
        .all()
    )
    out = []
    for hist, admin in rows:
        out.append(
            {
                "emp_id": admin.emp_id or "",
                "name": (admin.first_name or admin.user_name or "").strip(),
                "email": admin.email or "",
                "circle": admin.circle or "",
                "emp_type": admin.emp_type or "",
                "exit_date": hist.exit_date.isoformat() if hist.exit_date else "",
                "last_working_day": hist.last_working_day.isoformat() if hist.last_working_day else "",
                "exit_type": hist.exit_type or "",
                "notice_shortfall_days": int(hist.notice_shortfall_days or 0),
                "created_by": hist.created_by or "",
            }
        )
    return out


def generate_analytics_csv(*, months: int = 12) -> BytesIO:
    rows = build_exit_detail_rows(months=months)
    buf = StringIO()
    writer = csv.DictWriter(
        buf,
        fieldnames=[
            "emp_id",
            "name",
            "email",
            "circle",
            "emp_type",
            "exit_date",
            "last_working_day",
            "exit_type",
            "notice_shortfall_days",
            "created_by",
        ],
    )
    writer.writeheader()
    for row in rows:
        writer.writerow(row)
    out = BytesIO(buf.getvalue().encode("utf-8-sig"))
    out.seek(0)
    return out


def generate_analytics_pdf(*, months: int = 12) -> BytesIO:
    analytics = build_exit_analytics(months=months)
    rows = build_exit_detail_rows(months=months)
    buffer = BytesIO()
    c = canvas.Canvas(buffer, pagesize=A4)
    width, height = A4
    left = 42
    y = height - 42

    def line(text: str, *, bold: bool = False, size: int = 10):
        nonlocal y
        if y < 50:
            c.showPage()
            y = height - 42
        c.setFont("Helvetica-Bold" if bold else "Helvetica", size)
        c.drawString(left, y, str(text)[:95])
        y -= size + 4

    line("Offboarding & Attrition Report", bold=True, size=14)
    line(f"Period: last {months} months")
    line(f"Total exits: {analytics.get('total_exits', 0)}")
    line(f"Avg notice shortfall: {analytics.get('avg_notice_shortfall_days', 0)} days")
    y -= 6

    line("By exit type", bold=True)
    for item in analytics.get("by_exit_type") or []:
        line(f"  {item['exit_type']}: {item['count']}")
    y -= 4

    line("By circle (top 10)", bold=True)
    for item in (analytics.get("by_circle") or [])[:10]:
        line(f"  {item['circle']}: {item['count']}")
    y -= 8

    line("Recent exits", bold=True)
    for row in rows[:40]:
        line(
            f"{row['exit_date']} | {row['emp_id']} | {row['name']} | {row['circle']} | {row['exit_type']}"
        )

    c.showPage()
    c.save()
    buffer.seek(0)
    return buffer
