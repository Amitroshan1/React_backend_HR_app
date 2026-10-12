"""
One-off move of pre-tenancy uploads into ``tenants/{company id}/`` (rollout step 8).

Three commands, all dry runs unless ``apply=True``:

* ``relocate``  copies every legacy file next to itself (same storage root) under
  ``tenants/{owner company}/<same path>``, then points the database rows at the new key in
  one transaction. Old files are kept; a JSON manifest records every copy and row change.
* ``rollback``  points the rows back at the old keys and removes the copies (only before
  cleanup).
* ``cleanup``   deletes old files whose copy is identical and that no row still uses.

The owner company of each file is the same one ``upload_tenancy`` traces for legacy paths,
so nobody gains or loses access by the move. Files that cannot be traced to a company, are
missing on disk, or whose new path is taken by a different file are left untouched.
"""
from __future__ import annotations

import hashlib
import json
import os
import shutil
from collections import Counter, defaultdict
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Callable, Iterable, Optional

from flask import current_app

from . import db
from .tenant_context import DEFAULT_TENANT_ID, tenant_id_for_admin
from .upload_tenancy import split_tenant_rel, tenant_upload_rel

MANIFEST_VERSION = 1
QUERY_KIND = "query_attachments"


@dataclass
class DbChange:
    kind: str
    model: str
    pk: int
    column: str
    old: str
    new: str


@dataclass
class FileCopy:
    kind: str
    src: str
    dst: str
    created: bool = False


@dataclass
class Plan:
    changes: list[DbChange] = field(default_factory=list)
    copies: list[FileCopy] = field(default_factory=list)
    skipped: Counter = field(default_factory=Counter)
    # Absolute paths of old files that rows (of any company) still point at.
    legacy_refs: set[str] = field(default_factory=set)

    def summary(self) -> dict:
        rows = Counter(c.kind for c in self.changes)
        files = Counter(c.kind for c in self.copies)
        size = Counter()
        for c in self.copies:
            size[c.kind] += os.path.getsize(c.src) if os.path.isfile(c.src) else 0
        kinds = sorted(set(rows) | set(files) | {k for k, _ in self.skipped})
        return {
            "kinds": {
                k: {
                    "rows": rows[k],
                    "files": files[k],
                    "bytes": size[k],
                    "skipped": {r: n for (kk, r), n in sorted(self.skipped.items()) if kk == k},
                }
                for k in kinds
            },
            "total_rows": len(self.changes),
            "total_files": len(self.copies),
            "total_bytes": sum(size.values()),
        }


@dataclass
class _Spec:
    kind: str
    model: type
    columns: tuple[str, ...]
    owner: Callable[[object], Optional[int]]
    to_rel: Callable[[str], str] = None
    multi: bool = False


# ---------------------------------------------------------------- helpers


def _sha256(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def _same_file(a: str, b: str) -> bool:
    return os.path.getsize(a) == os.path.getsize(b) and _sha256(a) == _sha256(b)


def _storage_roots() -> list[str]:
    from .secure_file_service import private_uploads_root, static_uploads_root

    roots = [private_uploads_root(), static_uploads_root()]
    extra = (current_app.config.get("UPLOAD_FOLDER") or "").strip()
    if extra:
        roots.append(os.path.abspath(extra))
    return list(dict.fromkeys(os.path.abspath(r) for r in roots))


def _join_inside(root: str, rel: str) -> Optional[str]:
    path = os.path.abspath(os.path.join(root, *rel.split("/")))
    return path if path.startswith(root + os.sep) else None


def _legacy_rel(value, to_rel=None) -> Optional[str]:
    """Normalized old key of a stored value; None when empty or already per company."""
    from .secure_file_service import normalize_upload_rel

    raw = (value or "").strip() if isinstance(value, str) else ""
    if not raw:
        return None
    rel = normalize_upload_rel(to_rel(raw) if to_rel else raw)
    if not rel or split_tenant_rel(rel)[0] is not None:
        return None
    return rel


class _Owners:
    def __init__(self):
        self._cache: dict = {}

    def admin(self, admin_id) -> Optional[int]:
        from .models.Admin_models import Admin

        if admin_id is None:
            return None
        if admin_id not in self._cache:
            row = db.session.get(Admin, int(admin_id))
            self._cache[admin_id] = tenant_id_for_admin(row) if row else None
        return self._cache[admin_id]


def _specs(owners: _Owners) -> list[_Spec]:
    from .expense_utils import claim_attach_storage_name
    from .models.assessment import AssessmentInvite
    from .models.daily_checkout import DailyCheckoutDocument, DailyCheckoutRequest, EmployeeSignature
    from .models.education import Education, UploadDoc
    from .models.emp_detail_models import Asset, Employee
    from .models.family_models import FamilyDetails
    from .models.employee_tax_declaration import EmployeeTaxDeclaration, TaxDeclarationDocument
    from .models.ex_employee_documents import ExEmployeeDocFile, ExEmployeeDocShare
    from .models.expense import ExpenseClaimHeader, ExpenseLineItem
    from .models.hr_policy import HRPolicyDocument
    from .models.news_feed import Form16, NewsFeed, PaySlip
    from .models.seperation import Noc_Upload, NocDepartmentRequest

    def by_admin(row):
        return owners.admin(row.admin_id)

    def by_tenant_column(row):
        return int(row.tenant_id or DEFAULT_TENANT_ID)

    def parent_admin(model, fk, admin_attr):
        def owner(row):
            parent = db.session.get(model, getattr(row, fk)) if getattr(row, fk) else None
            return owners.admin(getattr(parent, admin_attr)) if parent else None

        return owner

    return [
        _Spec("payslips", PaySlip, ("file_path",), by_admin),
        _Spec("form16", Form16, ("file_path",), by_admin),
        _Spec("tax_proofs", TaxDeclarationDocument, ("file_path",),
              parent_admin(EmployeeTaxDeclaration, "declaration_id", "admin_id")),
        _Spec("expenses", ExpenseLineItem, ("Attach_file",),
              parent_admin(ExpenseClaimHeader, "claim_id", "admin_id"), to_rel=claim_attach_storage_name),
        _Spec("profile_photos", Employee, ("photo_filename",), by_admin),
        _Spec("family_photos", FamilyDetails, ("photo_filename",), by_admin),
        _Spec("profile_docs", UploadDoc,
              ("aadhaar_front", "aadhaar_back", "pan_front", "pan_back", "appointment_letter", "passbook_front"),
              by_admin),
        _Spec("education_docs", Education, ("doc_file",), by_admin),
        _Spec("noc", Noc_Upload, ("file_path",), by_admin),
        _Spec("noc_department", NocDepartmentRequest, ("file_path",), by_admin),
        _Spec("policies", HRPolicyDocument, ("file_path",), by_tenant_column),
        _Spec("signatures", EmployeeSignature, ("file_path",), by_admin),
        _Spec("day_use_pdfs", DailyCheckoutDocument, ("file_path",),
              parent_admin(DailyCheckoutRequest, "request_id", "requester_admin_id")),
        _Spec("ex_employee_docs", ExEmployeeDocFile, ("stored_rel_path",),
              parent_admin(ExEmployeeDocShare, "share_id", "created_by_admin_id")),
        _Spec("assessment_media", AssessmentInvite, ("selfie_path", "recording_path"), by_tenant_column),
        _Spec("news", NewsFeed, ("file_path",), by_tenant_column),
        _Spec("legacy_assets", Asset, ("image_files",), by_admin, multi=True),
    ]


def relocation_kinds() -> list[str]:
    return [s.kind for s in _specs(_Owners())] + [QUERY_KIND]


def _model_registry() -> dict[str, type]:
    return {s.model.__name__: s.model for s in _specs(_Owners())}


# ---------------------------------------------------------------- planning


class _Planner:
    def __init__(self, kinds: Optional[Iterable[str]], tenants: Optional[Iterable[int]]):
        self.kinds = set(kinds) if kinds else None
        self.tenants = {int(t) for t in tenants} if tenants else None
        self.roots = _storage_roots()
        self.owners = _Owners()
        self.plan = Plan()
        self._copy_keys: set[tuple[str, str]] = set()

    def _wanted(self, kind: str) -> bool:
        return self.kinds is None or kind in self.kinds

    def _add_copy(self, kind: str, src: str, dst: str):
        if (src, dst) not in self._copy_keys:
            self._copy_keys.add((src, dst))
            self.plan.copies.append(FileCopy(kind, src, dst))

    def _move_value(self, kind: str, rel: str, tenant_id: int, max_len: Optional[int]):
        """New key for one old key and the copies it needs; (None, reason) when it must stay."""
        new_key = tenant_upload_rel(rel, tenant_id)
        if max_len and len(new_key) > max_len:
            return None, "new path longer than the column"
        copies = []
        for root in self.roots:
            src = _join_inside(root, rel)
            dst = _join_inside(root, new_key)
            if not src or not dst or not os.path.isfile(src):
                continue
            if os.path.exists(dst) and not (os.path.isfile(dst) and _same_file(src, dst)):
                return None, "a different file already sits at the new path"
            copies.append((src, dst))
        if not copies:
            return None, "file not found on disk"
        for src, dst in copies:
            self._add_copy(kind, src, dst)
        return new_key, None

    def _note_legacy(self, rel: str):
        for root in self.roots:
            path = _join_inside(root, rel)
            if path:
                self.plan.legacy_refs.add(path)

    def _plan_spec(self, spec: _Spec):
        table = spec.model.__table__
        for row in spec.model.query.order_by(*table.primary_key.columns).all():
            owner = None
            owner_known = False
            for column in spec.columns:
                stored = getattr(row, column)
                values = [v.strip() for v in (stored or "").split(",")] if spec.multi else [stored]
                rels = [_legacy_rel(v, spec.to_rel) for v in values]
                if not any(rels):
                    continue
                for rel in filter(None, rels):
                    self._note_legacy(rel)
                if not self._wanted(spec.kind):
                    continue
                if not owner_known:
                    owner, owner_known = spec.owner(row), True
                if owner is None:
                    self.plan.skipped[(spec.kind, "owner company unknown")] += sum(1 for r in rels if r)
                    continue
                if self.tenants is not None and owner not in self.tenants:
                    continue
                max_len = None if spec.multi else getattr(table.c[column].type, "length", None)
                new_values = []
                for value, rel in zip(values, rels):
                    if not rel:
                        new_values.append(value)
                        continue
                    new_key, reason = self._move_value(spec.kind, rel, owner, max_len)
                    if reason:
                        self.plan.skipped[(spec.kind, reason)] += 1
                        new_values.append(value)
                    else:
                        new_values.append(new_key)
                new = ",".join(new_values) if spec.multi else new_values[0]
                if spec.multi:
                    col_len = getattr(table.c[column].type, "length", None)
                    if col_len and len(new) > col_len:
                        self.plan.skipped[(spec.kind, "new path longer than the column")] += 1
                        continue
                if new != stored:
                    pk = int(getattr(row, table.primary_key.columns.keys()[0]))
                    self.plan.changes.append(DbChange(spec.kind, spec.model.__name__, pk, column, stored, new))

    def _plan_queries(self):
        """Query attachments keep bare names in ``Query.photo``; only the folder changes."""
        from . import query as query_mod
        from .models.query import Query

        for row in Query.query.order_by(Query.id).all():
            try:
                names = json.loads(row.photo) if row.photo else []
            except (TypeError, ValueError):
                continue
            names = [n for n in names if isinstance(n, str) and n and "/" not in n and "\\" not in n and n != ".."]
            if not names:
                continue
            owner = self.owners.admin(row.admin_id)
            for name in names:
                src = os.path.join(query_mod.UPLOAD_DIR, name)
                if owner is None:
                    if os.path.isfile(src):
                        self.plan.legacy_refs.add(os.path.abspath(src))
                        if self._wanted(QUERY_KIND):
                            self.plan.skipped[(QUERY_KIND, "owner company unknown")] += 1
                    continue
                dst = os.path.join(query_mod._query_upload_dir(owner), name)
                if os.path.isfile(dst):
                    if os.path.isfile(src) and not _same_file(src, dst):
                        self.plan.legacy_refs.add(os.path.abspath(src))
                        if self._wanted(QUERY_KIND):
                            self.plan.skipped[(QUERY_KIND, "a different file already sits at the new path")] += 1
                    continue
                if not os.path.isfile(src):
                    if self._wanted(QUERY_KIND):
                        self.plan.skipped[(QUERY_KIND, "file not found on disk")] += 1
                    continue
                self.plan.legacy_refs.add(os.path.abspath(src))
                if self._wanted(QUERY_KIND) and (self.tenants is None or owner in self.tenants):
                    self._add_copy(QUERY_KIND, os.path.abspath(src), os.path.abspath(dst))

    def build(self) -> Plan:
        for spec in _specs(self.owners):
            self._plan_spec(spec)
        self._plan_queries()
        return self.plan


def plan_relocation(kinds: Optional[Iterable[str]] = None, tenants: Optional[Iterable[int]] = None) -> Plan:
    """What ``relocate`` would do (no writes)."""
    return _Planner(kinds, tenants).build()


# ---------------------------------------------------------------- manifest


def default_manifest_path() -> str:
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    return os.path.join(current_app.instance_path, "upload_relocation", f"relocate_{stamp}.json")


def _write_manifest(path: str, data: dict):
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    tmp = f"{path}.tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(data, fh, indent=2)
    os.replace(tmp, path)


def load_manifest(path: str) -> dict:
    with open(path, encoding="utf-8") as fh:
        data = json.load(fh)
    if data.get("version") != MANIFEST_VERSION:
        raise ValueError("Unsupported manifest version")
    return data


# ---------------------------------------------------------------- relocate


def _copy_file(copy: FileCopy):
    if os.path.isfile(copy.dst):
        return
    os.makedirs(os.path.dirname(copy.dst), exist_ok=True)
    tmp = f"{copy.dst}.relocating"
    shutil.copy2(copy.src, tmp)
    if not _same_file(copy.src, tmp):
        os.remove(tmp)
        raise OSError(f"Copy verification failed for {copy.src}")
    os.replace(tmp, copy.dst)
    copy.created = True


def _remove_created(copies: list[FileCopy]):
    for c in copies:
        if c.created and os.path.isfile(c.dst):
            os.remove(c.dst)


def relocate_uploads(
    *,
    apply: bool = False,
    kinds: Optional[Iterable[str]] = None,
    tenants: Optional[Iterable[int]] = None,
    manifest_path: Optional[str] = None,
) -> dict:
    """Plan (default) or copy files + repoint rows; returns the summary (and manifest path)."""
    plan = plan_relocation(kinds, tenants)
    result = {"applied": False, **plan.summary()}
    if not apply or (not plan.changes and not plan.copies):
        return result

    manifest_path = manifest_path or default_manifest_path()
    models = _model_registry()
    manifest = {
        "version": MANIFEST_VERSION,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "status": "copying",
        "kinds": sorted(kinds) if kinds else None,
        "tenants": sorted(int(t) for t in tenants) if tenants else None,
        "changes": [],
        "copies": [],
    }
    _write_manifest(manifest_path, manifest)
    try:
        for copy in plan.copies:
            _copy_file(copy)
        manifest["copies"] = [asdict(c) for c in plan.copies]
        manifest["status"] = "updating"
        _write_manifest(manifest_path, manifest)

        stale = 0
        applied: list[DbChange] = []
        for change in plan.changes:
            row = db.session.get(models[change.model], change.pk)
            if row is None or getattr(row, change.column) != change.old:
                stale += 1
                continue
            setattr(row, change.column, change.new)
            applied.append(change)
        db.session.commit()
    except Exception:
        db.session.rollback()
        _remove_created(plan.copies)
        manifest["status"] = "failed"
        _write_manifest(manifest_path, manifest)
        raise

    manifest["changes"] = [asdict(c) for c in applied]
    manifest["status"] = "applied"
    _write_manifest(manifest_path, manifest)
    result.update(applied=True, manifest=manifest_path, rows_updated=len(applied), rows_changed_meanwhile=stale)
    return result


# ---------------------------------------------------------------- rollback / cleanup


def rollback_relocation(manifest_path: str, *, apply: bool = False) -> dict:
    """Point rows back at their old keys and delete the copies this run created."""
    manifest = load_manifest(manifest_path)
    if manifest.get("status") != "applied":
        raise ValueError(f"Manifest status is '{manifest.get('status')}'; only an applied run can be rolled back")
    models = _model_registry()
    restore, changed_since = [], 0
    for c in manifest["changes"]:
        row = db.session.get(models[c["model"]], c["pk"])
        if row is None or getattr(row, c["column"]) != c["new"]:
            changed_since += 1
            continue
        restore.append((row, c))
    copies = [
        FileCopy(**c) for c in manifest["copies"]
        if c.get("created") and os.path.isfile(c["dst"]) and os.path.isfile(c["src"]) and _same_file(c["src"], c["dst"])
    ]
    result = {"applied": False, "rows_restored": len(restore), "rows_changed_since": changed_since,
              "copies_removed": len(copies)}
    if not apply:
        return result
    for row, c in restore:
        setattr(row, c["column"], c["old"])
    db.session.commit()
    _remove_created(copies)
    manifest["status"] = "rolled_back"
    _write_manifest(manifest_path, manifest)
    result["applied"] = True
    return result


def cleanup_relocation(manifest_path: str, *, apply: bool = False) -> dict:
    """Delete old files of an applied run once every copy is identical and no row uses them."""
    manifest = load_manifest(manifest_path)
    if manifest.get("status") != "applied":
        raise ValueError(f"Manifest status is '{manifest.get('status')}'; only an applied run can be cleaned up")
    still_used = plan_relocation().legacy_refs
    by_src: dict[str, list[str]] = defaultdict(list)
    for c in manifest["copies"]:
        by_src[c["src"]].append(c["dst"])

    counts = Counter()
    to_delete = []
    for src, dsts in by_src.items():
        if not os.path.isfile(src):
            counts["already_gone"] += 1
        elif os.path.abspath(src) in still_used:
            counts["kept_still_referenced"] += 1
        elif not all(os.path.isfile(d) and _same_file(src, d) for d in dsts):
            counts["kept_copy_missing_or_different"] += 1
        else:
            to_delete.append(src)
    result = {"applied": False, "deletable": len(to_delete), **counts}
    if not apply:
        return result
    for src in to_delete:
        os.remove(src)
    manifest["status"] = "cleaned"
    manifest["cleaned_at"] = datetime.now(timezone.utc).isoformat()
    _write_manifest(manifest_path, manifest)
    result.update(applied=True, deleted=len(to_delete))
    return result
