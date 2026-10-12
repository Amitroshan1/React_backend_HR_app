"""
Shared-DB multi-tenancy helpers (Phase 1 foundation).

Tenant id comes from the JWT claim set at login. Never trust a client-supplied
tenant_id for authorization.
"""
from __future__ import annotations

from contextlib import contextmanager
from contextvars import ContextVar
from typing import Optional

DEFAULT_TENANT_ID = 1

# Tenant for code running without a login JWT (scheduler jobs, CLI commands).
_SCOPED_TENANT: ContextVar[Optional[int]] = ContextVar("hrms_scoped_tenant", default=None)

# Tenants in these states cannot log in and their sessions are rejected.
BLOCKED_TENANT_STATUSES = frozenset({"suspended", "cancelled"})
TENANT_BLOCKED_CODE = "tenant_suspended"
TENANT_BLOCKED_MESSAGE = (
    "Your company's account is suspended. Please contact your administrator."
)

# URL parameters that always carry an Admin.id on HRMS routes.
ADMIN_ID_VIEW_ARGS = ("admin_id", "employee_id")


@contextmanager
def tenant_scope(tenant_id):
    """Act as one tenant inside the block (tenant helpers, plan checks, company mailboxes)."""
    token = _SCOPED_TENANT.set(int(tenant_id) if tenant_id not in (None, "") else DEFAULT_TENANT_ID)
    try:
        yield
    finally:
        _SCOPED_TENANT.reset(token)


def scoped_tenant_id() -> Optional[int]:
    """Tenant set by ``tenant_scope``, or None outside one."""
    return _SCOPED_TENANT.get()


def get_current_tenant_id(*, default: Optional[int] = DEFAULT_TENANT_ID) -> Optional[int]:
    """Return the ``tenant_scope`` tenant, else tenant_id from JWT claims, else default."""
    scoped = _SCOPED_TENANT.get()
    if scoped is not None:
        return scoped
    try:
        from flask_jwt_extended import get_jwt

        claims = get_jwt() or {}
        raw = claims.get("tenant_id")
        if raw is None or raw == "":
            return default
        return int(raw)
    except Exception:
        return default


def tenant_id_for_admin(admin) -> int:
    """Resolve tenant for an Admin row (login / token issue)."""
    if admin is None:
        return DEFAULT_TENANT_ID
    tid = getattr(admin, "tenant_id", None)
    try:
        if tid is not None:
            return int(tid)
    except (TypeError, ValueError):
        pass
    return DEFAULT_TENANT_ID


def is_session_token(jwt_data) -> bool:
    """Login JWTs carry no token_type; step-up and tenant-selection tokens do."""
    return not (jwt_data or {}).get("token_type")


def current_admin():
    """
    Admin for the authenticated request, loaded by JWT identity (admin id).

    Email claims must not be used to identify the caller: once emails are unique
    per tenant, the same address can belong to several Admin rows. Typed tokens
    (step-up "sensitive", post-OTP "tenant_select") are not login tokens and
    never resolve a caller.
    Returns None when there is no valid caller or the row is in another tenant.
    """
    try:
        from flask_jwt_extended import get_jwt, get_jwt_identity

        claims = get_jwt() or {}
        identity = get_jwt_identity()
    except Exception:
        return None

    if not is_session_token(claims) or identity is None:
        return None
    try:
        admin_id = int(identity)
    except (TypeError, ValueError):
        return None

    from .models.Admin_models import Admin

    admin = Admin.query.get(admin_id)
    if admin is None:
        return None

    claim_tid = claims.get("tenant_id")
    if claim_tid not in (None, "") and not require_same_tenant(
        tenant_id_for_admin(admin), claims_tenant_id=claim_tid
    ):
        return None
    return admin


def tenant_column_clause(column, tenant_id: Optional[int] = None):
    """
    SQL condition on a ``tenant_id`` column for one tenant (default: the caller's JWT tenant).

    Rows with NULL tenant_id count as the default tenant until the startup
    backfill assigns them.
    """
    from sqlalchemy import or_

    tid = tenant_id if tenant_id is not None else get_current_tenant_id()
    tid = int(tid) if tid is not None else DEFAULT_TENANT_ID
    if tid == DEFAULT_TENANT_ID:
        return or_(column == tid, column.is_(None))
    return column == tid


def admin_tenant_clause(tenant_id: Optional[int] = None):
    """SQL condition on Admin for one tenant (default: the caller's JWT tenant)."""
    from .models.Admin_models import Admin

    return tenant_column_clause(Admin.tenant_id, tenant_id)


def tenant_admin_query(tenant_id: Optional[int] = None):
    """Admin query limited to one tenant (default: the caller's JWT tenant)."""
    from .models.Admin_models import Admin

    return Admin.query.filter(admin_tenant_clause(tenant_id))


def tenant_admin_ids(tenant_id: Optional[int] = None):
    """SELECT of Admin ids in one tenant, for ``Model.admin_id.in_(tenant_admin_ids())``."""
    from sqlalchemy import select

    from .models.Admin_models import Admin

    return select(Admin.id).where(admin_tenant_clause(tenant_id))


def admin_owned_clause(column, tenant_id: Optional[int] = None):
    """
    SQL condition for rows owned through an admin id column. Rows without an owner
    (NULL) count as the default tenant.
    """
    from sqlalchemy import or_

    tid = tenant_id if tenant_id is not None else get_current_tenant_id()
    tid = int(tid) if tid is not None else DEFAULT_TENANT_ID
    clause = column.in_(tenant_admin_ids(tid))
    return or_(clause, column.is_(None)) if tid == DEFAULT_TENANT_ID else clause


def tenant_manager_contacts(tenant_id: Optional[int] = None):
    """ManagerContact query limited to one tenant (default: the caller's JWT tenant)."""
    from .models.manager_model import ManagerContact

    return ManagerContact.query.filter(tenant_column_clause(ManagerContact.tenant_id, tenant_id))


def admin_id_in_tenant(admin_id, tenant_id: Optional[int] = None) -> bool:
    """True when the Admin exists and belongs to the tenant (default: caller's)."""
    return get_admin_in_tenant(admin_id, tenant_id) is not None


def tenant_is_accessible(tenant_id) -> bool:
    """
    False when the tenant is suspended, cancelled or unknown.

    The default (platform) tenant is always accessible so the vendor can never
    lock itself out.
    """
    if tenant_id in (None, ""):
        tenant_id = DEFAULT_TENANT_ID
    try:
        tid = int(tenant_id)
    except (TypeError, ValueError):
        return False
    if tid == DEFAULT_TENANT_ID:
        return True
    try:
        from . import db
        from .models.tenant import Tenant

        tenant = db.session.get(Tenant, tid)
    except Exception:
        return False
    if tenant is None:
        return False
    return (tenant.status or "active").strip().lower() not in BLOCKED_TENANT_STATUSES


def get_admin_in_tenant(admin_id, tenant_id: Optional[int] = None):
    """Admin by id, or None when missing or in another tenant (default: caller's)."""
    try:
        aid = int(admin_id)
    except (TypeError, ValueError):
        return None
    from .models.Admin_models import Admin

    return tenant_admin_query(tenant_id).filter(Admin.id == aid).first()


def admin_url_id_outside_tenant(view_args) -> bool:
    """
    True when the URL names an employee (admin_id / employee_id) that belongs to
    another tenant than the caller's session. Requests without a valid session
    are left to the route's own @jwt_required.
    """
    raw_ids = [view_args[k] for k in ADMIN_ID_VIEW_ARGS if k in (view_args or {})]
    if not raw_ids:
        return False
    try:
        from flask_jwt_extended import get_jwt, verify_jwt_in_request

        verify_jwt_in_request(optional=True)
        claims = get_jwt() or {}
    except Exception:
        return False
    if not claims or not is_session_token(claims):
        return False

    from . import db
    from .models.Admin_models import Admin

    caller_tid = claims.get("tenant_id")
    for raw in raw_ids:
        try:
            admin = db.session.get(Admin, int(raw))
        except (TypeError, ValueError):
            continue
        if admin is not None and not require_same_tenant(
            tenant_id_for_admin(admin),
            claims_tenant_id=caller_tid if caller_tid not in (None, "") else DEFAULT_TENANT_ID,
        ):
            return True
    return False


def register_tenant_guards(app, jwt) -> None:
    """
    App-wide tenant checks:
    - only login tokens of accessible (not suspended / cancelled) tenants pass
      @jwt_required;
    - URLs naming an employee of another tenant answer 404.
    """
    from flask import jsonify, request

    @jwt.token_verification_loader
    def _jwt_is_login_token(_jwt_header, jwt_data):
        return is_session_token(jwt_data) and tenant_is_accessible(jwt_data.get("tenant_id"))

    @jwt.token_verification_failed_loader
    def _jwt_not_login_token(_jwt_header, jwt_payload):
        if is_session_token(jwt_payload):
            resp = jsonify(success=False, code=TENANT_BLOCKED_CODE, message=TENANT_BLOCKED_MESSAGE)
        else:
            resp = jsonify(success=False, message="Invalid session token")
        resp.status_code = 401
        return resp

    @app.before_request
    def _employee_url_ids_stay_in_tenant():
        if admin_url_id_outside_tenant(request.view_args):
            return jsonify(success=False, message="Employee not found"), 404


def require_same_tenant(resource_tenant_id, *, claims_tenant_id=None) -> bool:
    """True if resource belongs to the caller's tenant."""
    caller = claims_tenant_id
    if caller is None:
        caller = get_current_tenant_id()
    if caller is None or resource_tenant_id is None:
        return False
    try:
        return int(caller) == int(resource_tenant_id)
    except (TypeError, ValueError):
        return False
