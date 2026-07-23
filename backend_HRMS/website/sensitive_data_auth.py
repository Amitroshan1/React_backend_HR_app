"""Step-up authentication for employee salary and tax data."""
from __future__ import annotations

from datetime import timedelta

from flask import jsonify, request
from flask_jwt_extended import create_access_token, decode_token

SENSITIVE_TOKEN_HEADER = "X-Sensitive-Token"
SENSITIVE_AUTH_CODE = "SENSITIVE_AUTH_REQUIRED"
SENSITIVE_SESSION_MINUTES = 10

_PRIVILEGED_EMP_TYPES = frozenset({
    "account",
    "accounts",
    "accountant",
    "hr",
    "human resource",
    "human resources",
    "admin",
})


def is_privileged_salary_viewer(admin) -> bool:
    emp_type = (getattr(admin, "emp_type", None) or "").strip().lower()
    return emp_type in _PRIVILEGED_EMP_TYPES


def create_sensitive_access_token(admin_id: int) -> str:
    return create_access_token(
        identity=str(admin_id),
        additional_claims={
            "token_type": "sensitive",
            "admin_id": int(admin_id),
        },
        expires_delta=timedelta(minutes=SENSITIVE_SESSION_MINUTES),
    )


def validate_sensitive_token(token: str, expected_admin_id: int) -> bool:
    if not token:
        return False
    try:
        decoded = decode_token(token)
    except Exception:
        return False

    if decoded.get("token_type") != "sensitive":
        return False

    admin_id = decoded.get("admin_id")
    if admin_id is None:
        try:
            admin_id = int(decoded.get("sub"))
        except (TypeError, ValueError):
            return False

    try:
        return int(admin_id) == int(expected_admin_id)
    except (TypeError, ValueError):
        return False


def sensitive_access_response():
    return jsonify({
        "success": False,
        "message": "OTP verification required to view salary and tax data.",
        "code": SENSITIVE_AUTH_CODE,
    }), 403


def require_sensitive_for_employee(admin, target_admin_id: int | None = None):
    """
    Return a Flask response when salary/tax data requires OTP verification.

    - Own data: every role (including HR / Accounts / Admin) must present a valid
      sensitive OTP session token.
    - Another employee's data: only privileged salary viewers may access; they do
      not need the employee OTP session (Accounts / HR payroll workflows).
    """
    if admin is None:
        return jsonify({"success": False, "message": "Unauthorized user"}), 401

    viewing_other = (
        target_admin_id is not None
        and int(target_admin_id) != int(admin.id)
    )
    if viewing_other:
        if is_privileged_salary_viewer(admin):
            return None
        return jsonify({"success": False, "message": "Access denied"}), 403

    token = (request.headers.get(SENSITIVE_TOKEN_HEADER) or "").strip()
    if validate_sensitive_token(token, admin.id):
        return None

    return sensitive_access_response()


def sensitive_session_payload(admin_id: int) -> dict:
    return {
        "sensitive_token": create_sensitive_access_token(admin_id),
        "expires_in": SENSITIVE_SESSION_MINUTES * 60,
        "expires_minutes": SENSITIVE_SESSION_MINUTES,
    }
