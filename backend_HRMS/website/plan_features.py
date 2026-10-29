"""Subscription plan → feature flags.

Resolution order (Phase 1+ shared-DB):
  1. `tenants.plan` for the explicit tenant_id, else the tenant in the request's login JWT
  2. `CUSTOMER_PLAN` in .env (no JWT: public routes, schedulers, CLI)
  3. essential
"""
from functools import wraps
from typing import Optional

from flask import current_app, has_request_context, jsonify, request

CUSTOMER_PLANS = ("basic", "essential", "enterprise")

PLAN_LABELS = {
    "basic": "Basic",
    "essential": "Essential",
    "enterprise": "Enterprise",
}

ALL_FEATURES = frozenset({
    "hr_panel",
    "account_panel",
    "finance_panel",
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
    "finance_panel",
    "it_panel",
    "dashboard_payslip",
    "dashboard_my_assets",
    "dashboard_claims",
    "hr_assessment_invite",
    "hr_ex_employee_docs",
    "query_all_departments",
    "query_hr_and_accounts",
    # hr_employee_accounts + account_for_client: available to HR and Accounts on all plans
    "payslip_payroll_history",
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
    # hr_employee_accounts + account_for_client: available to HR and Accounts on all plans
    # payslip_payroll_history: Account is in this plan, so employees can download slips
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

FINANCE_DEPARTMENT_ALIASES = frozenset({
    "finance",
    "finance department",
    "finance team",
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
)


_NO_TENANT = object()


def _request_cache() -> dict:
    # Stored on the request, not `g`: an app context can outlive several requests.
    if not has_request_context():
        return {}
    return request.environ.setdefault("hrms.plan_cache", {})


def _request_tenant_id() -> Optional[int]:
    """Tenant from the request's login JWT (verified here if the route has not done it yet)."""
    if not has_request_context():
        return None
    cache = _request_cache()
    cached = cache.get("tenant_id", _NO_TENANT)
    if cached is not _NO_TENANT:
        return cached
    tid = None
    try:
        from flask_jwt_extended import get_jwt, verify_jwt_in_request

        verify_jwt_in_request(optional=True)
        claims = get_jwt() or {}
        raw = claims.get("tenant_id")
        if not claims.get("token_type") and raw not in (None, ""):
            tid = int(raw)
    except Exception:
        tid = None
    cache["tenant_id"] = tid
    return tid


def _tenant_plan(tenant_id: int) -> Optional[str]:
    cache = _request_cache().setdefault("plans", {})
    if tenant_id in cache:
        return cache[tenant_id]
    plan = None
    try:
        from .cache import NS_PLAN, cached_json
        from .models.tenant import Tenant

        def load():
            from . import db

            t = db.session.get(Tenant, int(tenant_id))
            if t and (t.plan or "").strip():
                p = t.plan.strip().lower()
                if p in CUSTOMER_PLANS:
                    return p
            return ""

        stored = cached_json(NS_PLAN, int(tenant_id), "plan", load)
        plan = stored or None
    except Exception:
        plan = None
    cache[tenant_id] = plan
    return plan


def get_plan(tenant_id: Optional[int] = None) -> str:
    """Resolve subscription plan: tenant.plan → CUSTOMER_PLAN env → essential."""
    if tenant_id is None:
        from .tenant_context import scoped_tenant_id

        tenant_id = scoped_tenant_id()
    if tenant_id is None:
        tenant_id = _request_tenant_id()
    if tenant_id is not None:
        plan = _tenant_plan(tenant_id)
        if plan:
            return plan
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
PLATFORM_SUPER_ADMIN_NAMES = frozenset({
    "super admin",
    "superadmin",
    "super-admin",
    "super_admin",
})


def _norm_emp_type(value: str) -> str:
    return (value or "").strip().lower()


def _jwt_claims(claims: Optional[dict] = None) -> dict:
    if claims is not None:
        return claims
    try:
        from flask_jwt_extended import get_jwt

        return get_jwt() or {}
    except Exception:
        return {}


def _compact_emp_type(value: str) -> str:
    return " ".join(_norm_emp_type(value).replace("-", " ").replace("_", " ").split())


def is_super_admin_emp_type(emp_type: str) -> bool:
    """True only for the reserved Super Admin role name (not Supervisor, etc.)."""
    compact = _compact_emp_type(emp_type)
    return compact in PLATFORM_SUPER_ADMIN_NAMES or compact.replace(" ", "") == "superadmin"


def reserved_platform_role_error(tenant_id, name: str) -> Optional[str]:
    """Block company tenants from creating/assigning Super Admin as dept or circle."""
    if not is_super_admin_emp_type(name):
        return None
    from .tenant_context import DEFAULT_TENANT_ID

    try:
        tid = int(tenant_id)
    except (TypeError, ValueError):
        tid = None
    if tid == DEFAULT_TENANT_ID:
        return None
    return (
        "Super Admin is reserved for the application owner and cannot be used "
        "as a company department or circle."
    )


def is_platform_super_admin(claims: Optional[dict] = None) -> bool:
    """Application owner: tenant 1 + Super Admin emp_type only."""
    claims = _jwt_claims(claims)
    from .tenant_context import DEFAULT_TENANT_ID

    try:
        tid = int(claims.get("tenant_id"))
    except (TypeError, ValueError):
        return False
    if tid != DEFAULT_TENANT_ID:
        return False
    return is_super_admin_emp_type(claims.get("emp_type") or "")


def jwt_is_module_staff(role_fn, claims: Optional[dict] = None) -> bool:
    """Department owner, or platform Super Admin. JWT claims only (never UI flags)."""
    claims = _jwt_claims(claims)
    if is_platform_super_admin(claims):
        return True
    return bool(role_fn(claims))


def is_org_admin(claims: Optional[dict] = None) -> bool:
    """Company Admin, or the platform Super Admin on tenant 1."""
    claims = _jwt_claims(claims)
    emp_type = _norm_emp_type(claims.get("emp_type") or "")
    if emp_type in ADMIN_EMP_TYPES:
        return True
    return is_platform_super_admin(claims)


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
    """HR endpoints: HR role or org Admin (HR is on every plan)."""
    claims = _jwt_claims(claims)
    if is_platform_super_admin(claims) or is_org_admin(claims):
        return True
    return is_hr_role(claims)


def is_it_role(claims: Optional[dict] = None) -> bool:
    if claims is None:
        try:
            from flask_jwt_extended import get_jwt
            claims = get_jwt() or {}
        except Exception:
            claims = {}
    emp_type = _norm_emp_type(claims.get("emp_type") or "")
    return is_it_department(emp_type) or is_inventory_department(emp_type)


def is_finance_role(claims: Optional[dict] = None) -> bool:
    if claims is None:
        try:
            from flask_jwt_extended import get_jwt
            claims = get_jwt() or {}
        except Exception:
            claims = {}
    emp_type = _norm_emp_type(claims.get("emp_type") or "").replace("-", " ")
    emp_type = " ".join(emp_type.split())
    return is_finance_department(emp_type)


def is_accounts_role(claims: Optional[dict] = None) -> bool:
    if claims is None:
        try:
            from flask_jwt_extended import get_jwt
            claims = get_jwt() or {}
        except Exception:
            claims = {}
    emp_type = _norm_emp_type(claims.get("emp_type") or "")
    return is_accounts_department(emp_type)


def _can_access_plan_panel(feature: str, role_fn, claims: Optional[dict] = None) -> bool:
    """Platform Super Admin bypasses plan gates; company Admin follows the tenant plan."""
    claims = _jwt_claims(claims)
    if is_platform_super_admin(claims):
        return True
    tid = None
    try:
        tid = int(claims.get("tenant_id"))
    except (TypeError, ValueError):
        tid = None
    if not has_feature(feature, plan=get_plan(tenant_id=tid) if tid is not None else None):
        return False
    return bool(role_fn(claims) or is_org_admin(claims))


def can_access_it_panel(claims: Optional[dict] = None) -> bool:
    """IT / Inventory: plan must include it_panel, then IT role or company Admin."""
    return _can_access_plan_panel("it_panel", is_it_role, claims)


def can_access_finance_panel(claims: Optional[dict] = None) -> bool:
    """Finance: plan must include finance_panel, then Finance role or company Admin."""
    return _can_access_plan_panel("finance_panel", is_finance_role, claims)


def can_access_accounts_panel(claims: Optional[dict] = None) -> bool:
    """Accounts: plan must include account_panel, then Accounts role or company Admin."""
    return _can_access_plan_panel("account_panel", is_accounts_role, claims)


def can_access_hr_or_accounts_shared(claims: Optional[dict] = None) -> bool:
    """HR, Accounts, or org Admin — for the two shared modules only."""
    if claims is None:
        try:
            from flask_jwt_extended import get_jwt
            claims = get_jwt() or {}
        except Exception:
            claims = {}
    return is_org_admin(claims) or is_hr_role(claims) or is_accounts_role(claims)


def can_access_employee_accounts_module(claims: Optional[dict] = None) -> bool:
    """Employee Accounts profile — HR and Accounts (when feature enabled)."""
    if not has_feature("hr_employee_accounts"):
        return False
    return can_access_hr_or_accounts_shared(claims)


def can_access_for_client_export(claims: Optional[dict] = None) -> bool:
    """For Client attendance export — HR, Accounts, and Finance (when enabled)."""
    if claims is None:
        try:
            from flask_jwt_extended import get_jwt
            claims = get_jwt() or {}
        except Exception:
            claims = {}
    if not has_feature("account_for_client"):
        return False
    if can_access_hr_or_accounts_shared(claims):
        return True
    return is_finance_role(claims) and has_feature("finance_panel")


def is_hr_department(name: str) -> bool:
    n = (name or "").strip().lower()
    if not n:
        return False
    if n in HR_DEPARTMENT_ALIASES:
        return True
    return "human resource" in n


def is_finance_department(name: str) -> bool:
    n = (name or "").strip().lower().replace("-", " ")
    n = " ".join(n.split())
    if not n:
        return False
    if n in FINANCE_DEPARTMENT_ALIASES:
        return True
    return n.startswith("finance ")


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
    if is_it_department(name) or is_inventory_department(name):
        # Inventory staff use IT query inbox; Inventory is not a raise-query target.
        return "IT"
    if is_accounts_department(name):
        return "Accounts"
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


def plan_payload(tenant_id: Optional[int] = None, claims: Optional[dict] = None) -> dict:
    plan = get_plan(tenant_id=tenant_id)
    return {
        "plan": plan,
        "plan_label": PLAN_LABELS.get(plan, plan.title()),
        "features": features_for_plan(plan),
        "is_platform_super_admin": is_platform_super_admin(claims),
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
