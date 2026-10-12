"""
Which tenant owns an uploaded file.

New uploads of shared/company media are stored under ``tenants/{tenant_id}/...``;
legacy paths are traced to their owning record (payslip, NOC, claim, news post, …).
A file that cannot be traced belongs to the default tenant, unless a relocated copy
under ``tenants/{id}/`` shows which company it moved to.
"""
from __future__ import annotations

import os
import re
from typing import Optional

from .tenant_context import DEFAULT_TENANT_ID, get_current_tenant_id, tenant_id_for_admin

TENANT_UPLOAD_ROOT = "tenants"

_TENANT_PREFIX_RE = re.compile(rf"^{TENANT_UPLOAD_ROOT}/(\d+)/(.+)$")
_PROFILE_PHOTO_RE = re.compile(r"^profile_(\d+)_", re.IGNORECASE)
_PROFILE_DOC_RE = re.compile(r"^profile/(\d+)_", re.IGNORECASE)
_POLICY_RE = re.compile(r"^policies/policy_(\d+)_")
_ASSESSMENT_RE = re.compile(r"^assessment_(?:selfies|recordings)/assessment_(\d+)_")
_ID_DIR_RE = re.compile(r"^(signatures|daily_checkout|tax_declarations|ex_employee_docs)/(\d+)/")


def tenant_upload_rel(rel: str, tenant_id: Optional[int] = None) -> str:
    """Relative upload key for a new file of one tenant (default: the caller's)."""
    tid = tenant_id if tenant_id is not None else get_current_tenant_id()
    return f"{TENANT_UPLOAD_ROOT}/{int(tid or DEFAULT_TENANT_ID)}/{rel.lstrip('/')}"


def tenant_upload_path(root: str, rel: str, tenant_id: Optional[int] = None) -> tuple[str, str]:
    """(absolute path under ``root``, stored key) for a new tenant file; creates the folder."""
    key = tenant_upload_rel(rel, tenant_id)
    abs_path = os.path.join(root, *key.split("/"))
    os.makedirs(os.path.dirname(abs_path), exist_ok=True)
    return abs_path, key


def split_tenant_rel(rel: str) -> tuple[Optional[int], str]:
    """(tenant_id, path inside the tenant folder) for ``tenants/{id}/...``; (None, rel) otherwise."""
    m = _TENANT_PREFIX_RE.match(rel or "")
    if not m:
        return None, rel
    return int(m.group(1)), m.group(2)


def _admin_tenant(admin_id) -> Optional[int]:
    from . import db
    from .models.Admin_models import Admin

    try:
        admin = db.session.get(Admin, int(admin_id))
    except (TypeError, ValueError):
        return None
    return tenant_id_for_admin(admin) if admin else None


def _single_tenant(tenants: set) -> Optional[int]:
    tenants.discard(None)
    return tenants.pop() if len(tenants) == 1 else None


def _record_owner_tenant(rel: str) -> Optional[int]:
    from . import db

    base = rel.rsplit("/", 1)[-1]

    m = _ID_DIR_RE.match(rel)
    if m:
        kind, rid = m.group(1), int(m.group(2))
        if kind == "signatures":
            return _admin_tenant(rid)
        if kind == "daily_checkout":
            from .models.daily_checkout import DailyCheckoutRequest

            row = db.session.get(DailyCheckoutRequest, rid)
            return _admin_tenant(row.requester_admin_id) if row else None
        if kind == "tax_declarations":
            from .models.employee_tax_declaration import EmployeeTaxDeclaration

            row = db.session.get(EmployeeTaxDeclaration, rid)
            return _admin_tenant(row.admin_id) if row else None
        from .models.ex_employee_documents import ExEmployeeDocShare

        row = db.session.get(ExEmployeeDocShare, rid)
        return _admin_tenant(row.created_by_admin_id) if row and row.created_by_admin_id else None

    m = _PROFILE_DOC_RE.match(rel) or (_PROFILE_PHOTO_RE.match(rel) if "/" not in rel else None)
    if m:
        return _admin_tenant(m.group(1))

    m = _ASSESSMENT_RE.match(rel)
    if m:
        from .models.assessment import AssessmentInvite

        row = db.session.get(AssessmentInvite, int(m.group(1)))
        return int(row.tenant_id or DEFAULT_TENANT_ID) if row else None

    m = _POLICY_RE.match(rel)
    if m:
        from .models.hr_policy import HRPolicyDocument

        row = db.session.get(HRPolicyDocument, int(m.group(1)))
        return int(row.tenant_id or DEFAULT_TENANT_ID) if row else None

    if rel.startswith(("payslips/", "form16/")):
        from .models.news_feed import Form16, PaySlip

        model = PaySlip if rel.startswith("payslips/") else Form16
        row = model.query.filter_by(file_path=rel).first()
        return _admin_tenant(row.admin_id) if row else None

    if rel.startswith("noc/"):
        from .models.seperation import Noc_Upload

        row = Noc_Upload.query.filter_by(file_path=rel).first()
        return _admin_tenant(row.admin_id) if row else None

    if rel.startswith("noc_department/"):
        from .models.seperation import NocDepartmentRequest

        row = NocDepartmentRequest.query.filter_by(file_path=rel).first()
        return _admin_tenant(row.admin_id) if row else None

    if rel.startswith("expenses/"):
        from .models.expense import ExpenseClaimHeader, ExpenseLineItem

        item = ExpenseLineItem.query.filter(ExpenseLineItem.Attach_file.in_([rel, base])).first()
        header = db.session.get(ExpenseClaimHeader, item.claim_id) if item else None
        return _admin_tenant(header.admin_id) if header else None

    if rel.startswith("queries/"):
        from .models.query import Query

        rows = Query.query.filter(Query.photo.contains(base, autoescape=True)).all()
        return _single_tenant({_admin_tenant(r.admin_id) for r in rows})

    if rel.startswith("assets/"):
        from .models.emp_detail_models import Asset

        rows = Asset.query.filter(Asset.image_files.contains(rel, autoescape=True)).all()
        return _single_tenant({_admin_tenant(r.admin_id) for r in rows})

    if rel.startswith("family/") or "/" not in rel:
        from .models.family_models import FamilyDetails

        row = FamilyDetails.query.filter(FamilyDetails.photo_filename.in_([rel, base])).first()
        if row:
            return _admin_tenant(row.admin_id)

    if rel.startswith(("news/", "news_feed/")) or "/" not in rel:
        from .models.news_feed import NewsFeed

        rows = NewsFeed.query.filter(NewsFeed.file_path.in_([rel, base])).all()
        return _single_tenant({int(r.tenant_id or DEFAULT_TENANT_ID) for r in rows})

    return None


NO_TENANT = 0


def _copy_roots() -> list[str]:
    from flask import current_app

    from .secure_file_service import private_uploads_root, static_uploads_root

    roots = [private_uploads_root(), static_uploads_root()]
    extra = (current_app.config.get("UPLOAD_FOLDER") or "").strip()
    if extra:
        roots.append(os.path.abspath(extra))
    return list(dict.fromkeys(os.path.abspath(r) for r in roots))


def _relocated_copy_tenants(rel: str) -> set:
    """Tenants holding ``tenants/{id}/{rel}`` next to a legacy file (``flask uploads-relocate``)."""
    found = set()
    for root in _copy_roots():
        base = os.path.join(root, TENANT_UPLOAD_ROOT)
        try:
            names = os.listdir(base)
        except OSError:
            continue
        for name in names:
            if name.isdigit() and os.path.isfile(os.path.join(base, name, *rel.split("/"))):
                found.add(int(name))
    return found


def upload_owner_tenant(rel: str) -> int:
    """
    Tenant owning a normalized upload key. An old path whose rows were moved belongs to the
    tenant holding the copy (nobody when several do); anything else untraced is the default
    tenant's.
    """
    prefixed, _ = split_tenant_rel(rel)
    if prefixed is not None:
        return prefixed
    owner = _record_owner_tenant(rel)
    if owner is not None:
        return int(owner)
    copies = _relocated_copy_tenants(rel)
    if copies:
        return copies.pop() if len(copies) == 1 else NO_TENANT
    return DEFAULT_TENANT_ID


def upload_in_admin_tenant(admin, rel: str) -> bool:
    return upload_owner_tenant(rel) == tenant_id_for_admin(admin)
