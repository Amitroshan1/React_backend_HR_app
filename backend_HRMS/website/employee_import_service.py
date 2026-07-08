"""Bulk employee CSV import for HR signup."""
from __future__ import annotations

import csv
import io
from datetime import datetime
from typing import Any

from . import db
from .models.Admin_models import Admin, AuditLog
from .models.attendance import LeaveBalance
from .models.emp_detail_models import Employee
from .email import send_password_set_email, send_welcome_email

_COLUMN_ALIASES = {
    "email": ("email", "email id", "official email"),
    "first_name": ("first_name", "full name", "name", "employee name"),
    "user_name": ("user_name", "username", "user name", "login"),
    "mobile": ("mobile", "mobile number", "phone", "contact"),
    "emp_id": ("emp_id", "employee id", "employee code", "emp id"),
    "doj": ("doj", "date of joining", "joining date", "join date"),
    "emp_type": ("emp_type", "employee type", "department", "dept"),
    "circle": ("circle", "location circle", "office circle"),
    "designation": ("designation", "title", "job title"),
    "password": ("password", "temp password"),
}


def _normalize_header(h: str) -> str:
    return (h or "").strip().lower().replace("_", " ")


def _map_headers(fieldnames: list[str] | None) -> dict[str, str]:
    if not fieldnames:
        return {}
    normalized = {_normalize_header(h): h for h in fieldnames if h}
    out: dict[str, str] = {}
    for key, aliases in _COLUMN_ALIASES.items():
        for alias in aliases:
            if alias in normalized:
                out[key] = normalized[alias]
                break
    return out


def _cell(raw: dict, header_map: dict[str, str], key: str) -> str:
    col = header_map.get(key, "")
    return (raw.get(col, "") or "").strip() if col else ""


def parse_employee_csv(content: bytes | str) -> tuple[list[dict], list[dict]]:
    """Parse CSV into row dicts. Returns (rows, parse_errors)."""
    text = content.decode("utf-8-sig") if isinstance(content, bytes) else content
    reader = csv.DictReader(io.StringIO(text))
    header_map = _map_headers(reader.fieldnames)
    required = ["email", "first_name", "user_name", "mobile", "emp_id", "doj", "emp_type", "circle", "designation"]
    missing_cols = [k for k in required if k not in header_map]
    if missing_cols:
        raise ValueError(
            f"CSV missing required columns: {', '.join(missing_cols)}. "
            f"Found headers: {reader.fieldnames}"
        )

    rows: list[dict] = []
    errors: list[dict] = []
    for i, raw in enumerate(reader, start=2):
        row = {k: _cell(raw, header_map, k) for k in _COLUMN_ALIASES}
        if not any(row.values()):
            continue
        row["row_number"] = i
        rows.append(row)
    if not rows:
        raise ValueError("No data rows found in CSV")
    return rows, errors


def _validate_row(row: dict) -> list[str]:
    from .Human_resource import (
        MASTER_TYPE_CIRCLE,
        MASTER_TYPE_DEPARTMENT,
        _is_allowed_master_value,
        _is_valid_profile_designation,
    )

    errors: list[str] = []
    required = ["email", "first_name", "user_name", "mobile", "emp_id", "doj", "emp_type", "circle", "designation"]
    for field in required:
        if not row.get(field):
            errors.append(f"Missing {field}")

    mobile = (row.get("mobile") or "").replace(" ", "")
    if mobile and len(mobile) != 10:
        errors.append("Mobile must be 10 digits")

    try:
        datetime.fromisoformat(str(row.get("doj", "")).strip()[:10]).date()
    except (ValueError, TypeError):
        if row.get("doj"):
            errors.append("Invalid DOJ (use YYYY-MM-DD)")

    if row.get("emp_type") and not _is_allowed_master_value(MASTER_TYPE_DEPARTMENT, row["emp_type"]):
        errors.append(f"Invalid employee type: {row['emp_type']}")
    if row.get("circle") and not _is_allowed_master_value(MASTER_TYPE_CIRCLE, row["circle"]):
        errors.append(f"Invalid circle: {row['circle']}")
    if row.get("designation") and not _is_valid_profile_designation(row["designation"]):
        errors.append("Invalid designation (2–100 chars)")

    return errors


def preview_employee_import(rows: list[dict]) -> dict:
    """Validate rows without committing."""
    valid_rows: list[dict] = []
    errors: list[dict] = []
    for row in rows:
        row_errors = _validate_row(row)
        email = (row.get("email") or "").lower()
        emp_id = row.get("emp_id") or ""
        if email:
            existing = Admin.query.filter(
                (Admin.email == email) | (Admin.emp_id == emp_id)
            ).first()
            if existing and existing.password:
                row_errors.append("Email or Employee ID already exists")
        if row_errors:
            errors.append({"row": row.get("row_number"), "errors": row_errors, "email": row.get("email")})
        else:
            valid_rows.append(row)
    return {
        "total_rows": len(rows),
        "valid_count": len(valid_rows),
        "error_count": len(errors),
        "errors": errors[:100],
        "preview": valid_rows[:20],
    }


def commit_employee_import(rows: list[dict], *, hr_email: str) -> dict:
    """Create employees from validated rows."""
    from .Human_resource import (
        _log_initial_circle_assignment,
        _sync_probation_after_doj_change,
        _upsert_employee_designation_for_admin,
    )
    from sqlalchemy.exc import IntegrityError

    created = 0
    failed = 0
    errors: list[dict] = []

    for row in rows:
        row_errors = _validate_row(row)
        if row_errors:
            failed += 1
            errors.append({"row": row.get("row_number"), "errors": row_errors, "email": row.get("email")})
            continue

        email = str(row["email"]).strip()
        first_name = str(row["first_name"]).strip()[:150]
        user_name = str(row["user_name"]).strip()[:120]
        mobile = str(row["mobile"]).strip().replace(" ", "")[:15]
        emp_id = str(row["emp_id"]).strip()[:10]
        emp_type = str(row["emp_type"]).strip()[:50]
        circle = str(row["circle"]).strip()[:50]
        designation = str(row["designation"]).strip()
        doj = datetime.fromisoformat(str(row["doj"]).strip()[:10]).date()
        password = (row.get("password") or "").strip()

        existing_conflict = Admin.query.filter(
            (Admin.email == email)
            | (Admin.user_name == user_name)
            | (Admin.mobile == mobile)
            | (Admin.emp_id == emp_id)
        ).first()
        if existing_conflict and existing_conflict.password:
            failed += 1
            errors.append({
                "row": row.get("row_number"),
                "errors": ["Email, User name, Mobile or Employee ID already exists"],
                "email": email,
            })
            continue

        try:
            admin = Admin.query.filter_by(email=email).first()
            if admin:
                if admin.password:
                    failed += 1
                    errors.append({"row": row.get("row_number"), "errors": ["User already fully registered"], "email": email})
                    continue
                admin.first_name = first_name
                admin.user_name = user_name
                admin.mobile = mobile
                admin.emp_id = emp_id
                admin.doj = doj
                admin.emp_type = emp_type
                admin.circle = circle
                admin.is_active = True
                admin.is_exited = False
                if password:
                    admin.set_password(password)
                else:
                    send_password_set_email(admin)
                action = "UPGRADE_EXISTING_USER"
            else:
                admin = Admin(
                    email=email,
                    first_name=first_name,
                    user_name=user_name,
                    mobile=mobile,
                    emp_id=emp_id,
                    doj=doj,
                    emp_type=emp_type,
                    circle=circle,
                    is_active=True,
                    is_exited=False,
                )
                if password:
                    admin.set_password(password)
                else:
                    send_password_set_email(admin)
                db.session.add(admin)
                db.session.flush()
                leave_balance = LeaveBalance(
                    admin_id=admin.id,
                    privilege_leave_balance=0.0,
                    casual_leave_balance=0.0,
                    compensatory_leave_balance=0.0,
                    total_privilege_leave=0.0,
                    total_casual_leave=0.0,
                    total_compensatory_leave=0.0,
                    used_privilege_leave=0.0,
                    used_casual_leave=0.0,
                    used_comp_leave=0.0,
                )
                db.session.add(leave_balance)
                action = "CREATE_NEW_EMPLOYEE"
                _log_initial_circle_assignment(admin, hr_email)

            audit = AuditLog(action=action, performed_by=hr_email, target_email=admin.email)
            _upsert_employee_designation_for_admin(admin, designation)
            db.session.add(audit)
            _sync_probation_after_doj_change(admin)
            db.session.commit()

            try:
                send_welcome_email(admin, row)
            except Exception:
                pass
            created += 1
        except IntegrityError:
            db.session.rollback()
            failed += 1
            errors.append({
                "row": row.get("row_number"),
                "errors": ["Duplicate email, username, mobile or employee ID"],
                "email": email,
            })
        except Exception as exc:
            db.session.rollback()
            failed += 1
            errors.append({"row": row.get("row_number"), "errors": [str(exc)], "email": email})

    return {"created": created, "failed": failed, "errors": errors[:100]}


def employee_import_template_csv() -> str:
    return (
        "email,first_name,user_name,mobile,emp_id,doj,emp_type,circle,designation,password\n"
        "john.doe@company.com,John Doe,johndoe,9876543210,EMP001,2026-01-15,Permanent,NHQ,Software Engineer,\n"
    )
