"""Subscription plan → feature flags (per customer server via CUSTOMER_PLAN in .env)."""
from functools import wraps
from typing import Optional

from flask import current_app, jsonify

CUSTOMER_PLANS = ("basic", "essential", "enterprise")

PLAN_LABELS = {
    "basic": "Basic",
    "essential": "Essential",
    "enterprise": "Enterprise",
}

ALL_FEATURES = frozenset({
    "hr_panel",
    "account_panel",
    "it_panel",
    "dashboard_payslip",
    "dashboard_my_assets",
    "dashboard_claims",
    "hr_assessment_invite",
    "hr_add_dept_circle",
    "hr_ex_employee_docs",
    "query_all_departments",
    "query_hr_and_accounts",
    "hr_employee_accounts",
    "payslip_payroll_history",
    "account_for_client",
    "account_payroll",
    "account_ctc_breakup",
    "account_full_employee_view",
})

BASIC_DISABLED = frozenset({
    "account_panel",
    "it_panel",
    "dashboard_payslip",
    "dashboard_my_assets",
    "dashboard_claims",
    "hr_assessment_invite",
    "hr_ex_employee_docs",
    "query_all_departments",
    "query_hr_and_accounts",
    "hr_employee_accounts",
    "payslip_payroll_history",
    "account_for_client",
    "account_payroll",
    "account_ctc_breakup",
    "account_full_employee_view",
})

ESSENTIAL_DISABLED = frozenset({
    "it_panel",
    "dashboard_my_assets",
    "hr_assessment_invite",
    "hr_ex_employee_docs",
    "query_all_departments",
    "hr_employee_accounts",
    "payslip_payroll_history",
    "account_for_client",
    "account_payroll",
    "account_ctc_breakup",
    "account_full_employee_view",
})

HR_DEPARTMENT_ALIASES = frozenset({
    "human resource",
    "human resources",
    "hr",
})

ACCOUNTS_DEPARTMENT_ALIASES = frozenset({
    "account",
    "accounts",
    "accountant",
})

IT_DEPARTMENT_ALIASES = frozenset({
    "it",
    "it department",
})

INVENTORY_DEPARTMENT_ALIASES = frozenset({
    "inventory",
})

QUERY_DEPARTMENT_CANONICAL = (
    "Human Resource",
    "IT",
    "Accounts",
    "Inventory",
)


def get_plan() -> str:
    p = (current_app.config.get("CUSTOMER_PLAN") or "essential").strip().lower()
    return p if p in CUSTOMER_PLANS else "essential"


def features_for_plan(plan: Optional[str] = None) -> list[str]:
    p = (plan or get_plan()).lower()
    if p == "enterprise":
        return sorted(ALL_FEATURES)
    if p == "basic":
        return sorted(ALL_FEATURES - BASIC_DISABLED)
    # essential (default)
    return sorted(ALL_FEATURES - ESSENTIAL_DISABLED)


def is_enterprise_plan(plan: Optional[str] = None) -> bool:
    return (plan or get_plan()).lower() == "enterprise"


def has_feature(feature: str, plan: Optional[str] = None) -> bool:
    if not feature:
        return True
    if is_enterprise_plan(plan):
        return True
    return feature in frozenset(features_for_plan(plan))


ADMIN_EMP_TYPES = frozenset({"admin", "administrator", "administration"})


def _norm_emp_type(value: str) -> str:
    return (value or "").strip().lower()


def is_org_admin(claims: Optional[dict] = None) -> bool:
    """Organization Admin / Super Admin — full operational access across modules."""
    if claims is None:
        try:
            from flask_jwt_extended import get_jwt

            claims = get_jwt() or {}
        except Exception:
            claims = {}
    emp_type = _norm_emp_type(claims.get("emp_type") or "")
    if emp_type in ADMIN_EMP_TYPES:
        return True
    return "super" in emp_type


def is_hr_role(claims: Optional[dict] = None) -> bool:
    if claims is None:
        try:
            from flask_jwt_extended import get_jwt

            claims = get_jwt() or {}
        except Exception:
            claims = {}
    emp_type = _norm_emp_type(claims.get("emp_type") or "").replace("-", " ")
    emp_type = " ".join(emp_type.split())
    if emp_type in {"human resource", "human resources", "hr"}:
        return True
    return is_hr_department(claims.get("emp_type") or "")


def can_access_hr_operations(claims: Optional[dict] = None) -> bool:
    """HR endpoints: HR role or org Admin."""
    return is_hr_role(claims) or is_org_admin(claims)


def can_access_it_panel(claims: Optional[dict] = None) -> bool:
    """IT module: subscription feature or org Admin / Super Admin."""
    if has_feature("it_panel"):
        return True
    if claims is None:
        try:
            from flask_jwt_extended import get_jwt

            claims = get_jwt() or {}
        except Exception:
            claims = {}
    if is_org_admin(claims):
        return True
    return False


def is_hr_department(name: str) -> bool:
    n = (name or "").strip().lower()
    if not n:
        return False
    if n in HR_DEPARTMENT_ALIASES:
        return True
    return "human resource" in n


def is_accounts_department(name: str) -> bool:
    n = (name or "").strip().lower()
    if not n:
        return False
    if n in ACCOUNTS_DEPARTMENT_ALIASES:
        return True
    return n.startswith("account") or "accounts" in n


def is_it_department(name: str) -> bool:
    n = (name or "").strip().lower()
    return bool(n) and n in IT_DEPARTMENT_ALIASES


def is_inventory_department(name: str) -> bool:
    n = (name or "").strip().lower()
    return bool(n) and n in INVENTORY_DEPARTMENT_ALIASES


def canonical_query_department(name: str) -> str | None:
    if is_hr_department(name):
        return "Human Resource"
    if is_it_department(name):
        return "IT"
    if is_accounts_department(name):
        return "Accounts"
    if is_inventory_department(name):
        return "Inventory"
    return None


def is_whitelisted_query_department(name: str) -> bool:
    return canonical_query_department(name) is not None


def _resolve_query_department_options(departments: list[str]) -> list[str]:
    """Raise-a-query dropdown: fixed set, preferring MasterData spellings when present."""
    out: list[str] = []
    for canonical in QUERY_DEPARTMENT_CANONICAL:
        matched = None
        for dept in departments or []:
            if canonical_query_department(dept) == canonical:
                matched = (dept or "").strip()
                break
        out.append(matched or canonical)
    return out


def is_allowed_query_department(name: str) -> bool:
    if not is_whitelisted_query_department(name):
        return False
    if has_feature("query_all_departments"):
        return True
    if has_feature("query_hr_and_accounts"):
        return is_hr_department(name) or is_accounts_department(name)
    return is_hr_department(name)


def filter_query_departments(departments: list[str]) -> list[str]:
    options = _resolve_query_department_options(departments)
    if has_feature("query_all_departments"):
        return options
    filtered = [d for d in options if is_allowed_query_department(d)]
    if filtered:
        return filtered
    if has_feature("query_hr_and_accounts"):
        return ["Human Resource", "Accounts"]
    return ["Human Resource"]


def plan_payload() -> dict:
    plan = get_plan()
    return {
        "plan": plan,
        "plan_label": PLAN_LABELS.get(plan, plan.title()),
        "features": features_for_plan(plan),
    }


def plan_forbidden_response(feature: str):
    return jsonify({
        "success": False,
        "message": "This module is not included in your subscription plan.",
        "required_feature": feature,
        "plan": get_plan(),
    }), 403


def requires_plan(feature: str):
    def decorator(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            if not has_feature(feature):
                return plan_forbidden_response(feature)
            return fn(*args, **kwargs)

        return wrapper

    return decorator
