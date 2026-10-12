"""Rollout step 8 — one-off move of legacy uploads into tenants/{id}/ (plan, apply, cleanup, rollback)."""
import importlib
import json
import os
import pkgutil
from datetime import date, datetime, timedelta

import pytest
from flask import Flask

import website.models as models_pkg
from website import db

for _mod in pkgutil.iter_modules(models_pkg.__path__):
    # confirmation_request references a Signup model that is not defined.
    if _mod.name != "confirmation_request":
        importlib.import_module(f"website.models.{_mod.name}")

from website.models.Admin_models import Admin  # noqa: E402
from website.models.education import UploadDoc  # noqa: E402
from website.models.emp_detail_models import Asset  # noqa: E402
from website.models.ex_employee_documents import ExEmployeeDocFile, ExEmployeeDocShare  # noqa: E402
from website.models.expense import ExpenseClaimHeader, ExpenseLineItem  # noqa: E402
from website.models.news_feed import NewsFeed, PaySlip  # noqa: E402
from website.models.query import Query  # noqa: E402
from website.models.tenant import Tenant  # noqa: E402

TODAY = date.today()
LONG_DOC = "profile/4_" + "x" * 185 + ".pdf"


@pytest.fixture()
def roots(tmp_path, monkeypatch):
    import website.query as query_mod

    paths = {
        "private": tmp_path / "private",
        "static": tmp_path / "site" / "static" / "uploads",
        "queries": tmp_path / "qbase",
    }
    monkeypatch.setattr(query_mod, "UPLOADS_BASE", str(paths["queries"]))
    monkeypatch.setattr(query_mod, "UPLOAD_DIR", str(paths["queries"] / "queries"))
    return paths


def _put(root, rel, content=None):
    path = root.joinpath(*rel.split("/"))
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content if content is not None else b"file:" + rel.encode())
    return path


@pytest.fixture()
def app(tmp_path, roots):
    from website.commands.upload_relocation import register_upload_relocation_commands

    app = Flask("relocation", root_path=str(tmp_path / "site"), instance_path=str(tmp_path / "instance"))
    app.config.update(
        SQLALCHEMY_DATABASE_URI="sqlite:///:memory:",
        SQLALCHEMY_TRACK_MODIFICATIONS=False,
        UPLOADS_ROOT=str(roots["private"]),
        TESTING=True,
    )
    db.init_app(app)
    register_upload_relocation_commands(app)

    _put(roots["private"], "payslips/p4.pdf")
    _put(roots["private"], "payslips/p2.pdf")
    _put(roots["private"], "tenants/1/payslips/p2.pdf", b"another file")
    _put(roots["static"], "expenses/E1_40_1_taxi.pdf")
    _put(roots["static"], "profile/4_aadharFront_x.pdf")
    _put(roots["static"], "banner.png")
    _put(roots["static"], "assets/E1/a.png")
    _put(roots["static"], "ex_employee_docs/7/relieving.pdf")
    _put(roots["queries"], "queries/q40_abc.pdf")

    with app.app_context():
        db.create_all()
        db.session.add_all([
            Tenant(id=1, name="One", slug="default", plan="enterprise", status="active"),
            Tenant(id=2, name="Two", slug="two", plan="enterprise", status="active"),
        ])
        common = dict(circle="NHQ", is_active=True, is_exited=False, doj=TODAY - timedelta(days=400))
        db.session.add_all([
            Admin(id=1, tenant_id=1, email="acc@x.com", emp_id="A1", first_name="One Acc", emp_type="Accounts", **common),
            Admin(id=2, tenant_id=1, email="alpha@x.com", emp_id="E1", first_name="Alpha", emp_type="Engineering", **common),
            Admin(id=3, tenant_id=2, email="acc@x.com", emp_id="A1", first_name="Two Acc", emp_type="Accounts", **common),
            Admin(id=4, tenant_id=2, email="beta@x.com", emp_id="E1", first_name="Beta", emp_type="Engineering", **common),
        ])
        db.session.flush()
        db.session.add_all([
            PaySlip(id=1, admin_id=4, month="Aug", year="2026", file_path="payslips/p4.pdf"),
            PaySlip(id=2, admin_id=2, month="Aug", year="2026", file_path="payslips/p2.pdf"),
            PaySlip(id=3, admin_id=4, month="Sep", year="2026", file_path="tenants/2/payslips/new.pdf"),
            UploadDoc(id=1, admin_id=4, aadhaar_front="profile/4_aadharFront_x.pdf", aadhaar_back=LONG_DOC),
            NewsFeed(id=1, tenant_id=1, title="T1", content="x", circle="All", emp_type="All", file_path="banner.png"),
            NewsFeed(id=2, tenant_id=2, title="T2", content="x", circle="All", emp_type="All", file_path="banner.png"),
            Query(id=40, admin_id=4, title="Q", department="Human Resource", query_text="x", photo='["q40_abc.pdf"]'),
            Asset(id=20, name="Laptop", admin_id=2, image_files="assets/E1/a.png,assets/E1/missing.png"),
            ExEmployeeDocShare(id=7, token_hash="h" * 64, recipient_email="old@x.com",
                               expires_at=datetime(2030, 1, 1), created_by_admin_id=None),
            ExpenseClaimHeader(
                id=40, admin_id=4, employee_name="Beta", designation="Dev", email="beta@x.com", emp_id="E1",
                project_name="P", country_state="MH", travel_from_date=TODAY, travel_to_date=TODAY,
            ),
        ])
        db.session.flush()
        db.session.add_all([
            ExpenseLineItem(id=1, claim_id=40, sr_no=1, date=TODAY, purpose="Taxi", amount=10,
                            currency="INR", Attach_file="E1_40_1_taxi.pdf"),
            ExEmployeeDocFile(id=1, share_id=7, display_name="Relieving",
                              stored_rel_path="ex_employee_docs/7/relieving.pdf"),
        ])
        db.session.commit()
        yield app
        db.session.remove()
        db.drop_all()


def _snapshot():
    return {
        "payslips": {p.id: p.file_path for p in PaySlip.query.all()},
        "expense": db.session.get(ExpenseLineItem, 1).Attach_file,
        "doc": db.session.get(UploadDoc, 1).aadhaar_front,
        "news": {n.id: n.file_path for n in NewsFeed.query.all()},
        "asset": db.session.get(Asset, 20).image_files,
        "query": db.session.get(Query, 40).photo,
        "share": db.session.get(ExEmployeeDocFile, 1).stored_rel_path,
    }


def _allowed(admin_id, rel):
    from website.secure_file_service import authorize_upload_access

    return authorize_upload_access(db.session.get(Admin, admin_id), rel, {})[0]


def test_dry_run_reports_plan_and_changes_nothing(app, roots):
    from website.upload_relocation import relocate_uploads

    with app.app_context():
        before = _snapshot()
        result = relocate_uploads()
        assert result["applied"] is False
        kinds = result["kinds"]
        assert kinds["payslips"]["rows"] == 1 and kinds["payslips"]["skipped"] == {
            "a different file already sits at the new path": 1
        }
        assert kinds["news"] == {"rows": 2, "files": 2, "bytes": 2 * len(b"file:banner.png"), "skipped": {}}
        assert kinds["query_attachments"]["files"] == 1 and kinds["query_attachments"]["rows"] == 0
        assert kinds["legacy_assets"]["skipped"] == {"file not found on disk": 1}
        assert kinds["profile_docs"]["skipped"] == {"new path longer than the column": 1}
        assert kinds["ex_employee_docs"]["skipped"] == {"owner company unknown": 1}
        assert _snapshot() == before
        assert not (roots["static"] / "tenants").exists()
        assert not (roots["queries"] / "tenants").exists()
        assert not os.path.exists(os.path.join(app.instance_path, "upload_relocation"))


def test_apply_copies_files_and_points_rows_at_company_folders(app, roots):
    from website.expense_utils import claim_attach_storage_name
    from website.upload_relocation import load_manifest, relocate_uploads

    with app.test_request_context():
        result = relocate_uploads(apply=True)
        assert result["applied"] is True and result["rows_updated"] == 6
        snap = _snapshot()
        assert snap["payslips"] == {1: "tenants/2/payslips/p4.pdf", 2: "payslips/p2.pdf", 3: "tenants/2/payslips/new.pdf"}
        assert claim_attach_storage_name(snap["expense"]) == "tenants/2/expenses/E1_40_1_taxi.pdf"
        assert snap["doc"] == "tenants/2/profile/4_aadharFront_x.pdf"
        assert db.session.get(UploadDoc, 1).aadhaar_back == LONG_DOC
        # One bare legacy name shared by two companies: each gets its own copy.
        assert snap["news"] == {1: "tenants/1/banner.png", 2: "tenants/2/banner.png"}
        assert snap["asset"] == "tenants/1/assets/E1/a.png,assets/E1/missing.png"
        assert snap["query"] == '["q40_abc.pdf"]'
        assert snap["share"] == "ex_employee_docs/7/relieving.pdf"

        for root, rel in [
            ("private", "tenants/2/payslips/p4.pdf"),
            ("static", "tenants/2/expenses/E1_40_1_taxi.pdf"),
            ("static", "tenants/1/banner.png"),
            ("static", "tenants/2/banner.png"),
            ("static", "tenants/1/assets/E1/a.png"),
            ("queries", "tenants/2/queries/q40_abc.pdf"),
        ]:
            assert roots[root].joinpath(*rel.split("/")).is_file(), rel
        assert (roots["private"] / "payslips" / "p4.pdf").is_file(), "old files are kept until cleanup"
        assert (roots["private"] / "tenants" / "1" / "payslips" / "p2.pdf").read_bytes() == b"another file"

        # Same company still opens the moved file; the other company still cannot.
        assert _allowed(3, "tenants/2/payslips/p4.pdf") is True
        assert _allowed(1, "tenants/2/payslips/p4.pdf") is False

        manifest = load_manifest(result["manifest"])
        assert manifest["status"] == "applied"
        assert len(manifest["changes"]) == 6 and len(manifest["copies"]) == 7
        assert os.path.dirname(result["manifest"]) == os.path.join(app.instance_path, "upload_relocation")


def test_old_files_left_until_cleanup_stay_with_their_company(app):
    from website.upload_relocation import relocate_uploads
    from website.upload_tenancy import NO_TENANT, upload_owner_tenant

    with app.test_request_context():
        assert _allowed(1, "payslips/p4.pdf") is False
        relocate_uploads(apply=True)
        # No row points at the old path any more; the copy under tenants/2/ names the owner.
        assert upload_owner_tenant("payslips/p4.pdf") == 2
        assert _allowed(1, "payslips/p4.pdf") is False
        assert _allowed(1, "expenses/E1_40_1_taxi.pdf") is False
        # Copied for two companies: nobody may use the old path.
        assert upload_owner_tenant("banner.png") == NO_TENANT
        assert _allowed(1, "banner.png") is False and _allowed(3, "banner.png") is False
        # A row still using the old path decides, not a same-named file under tenants/.
        assert upload_owner_tenant("payslips/p2.pdf") == 1


def test_rerun_after_apply_has_nothing_left_to_move(app):
    from website.upload_relocation import relocate_uploads

    with app.app_context():
        relocate_uploads(apply=True)
        again = relocate_uploads(apply=True)
        assert again["applied"] is False
        assert again["total_rows"] == 0 and again["total_files"] == 0


def test_cleanup_deletes_only_identical_originals_no_row_uses(app, roots):
    from website.upload_relocation import cleanup_relocation, load_manifest, relocate_uploads, rollback_relocation

    with app.app_context():
        manifest_path = relocate_uploads(apply=True)["manifest"]
        # A row that went back to the old key keeps its original file alive.
        db.session.get(NewsFeed, 1).file_path = "banner.png"
        db.session.commit()

        dry = cleanup_relocation(manifest_path)
        assert dry == {"applied": False, "deletable": 5, "kept_still_referenced": 1}
        assert (roots["private"] / "payslips" / "p4.pdf").is_file()

        done = cleanup_relocation(manifest_path, apply=True)
        assert done["deleted"] == 5
        for root, rel in [
            ("private", "payslips/p4.pdf"),
            ("static", "expenses/E1_40_1_taxi.pdf"),
            ("static", "profile/4_aadharFront_x.pdf"),
            ("static", "assets/E1/a.png"),
            ("queries", "queries/q40_abc.pdf"),
        ]:
            assert not roots[root].joinpath(*rel.split("/")).exists(), rel
        assert (roots["static"] / "banner.png").is_file()
        assert (roots["private"] / "payslips" / "p2.pdf").is_file(), "skipped files are never touched"
        assert (roots["static"] / "ex_employee_docs" / "7" / "relieving.pdf").is_file()
        assert load_manifest(manifest_path)["status"] == "cleaned"
        with pytest.raises(ValueError):
            rollback_relocation(manifest_path, apply=True)


def test_rollback_restores_rows_and_removes_copies(app, roots):
    from website.upload_relocation import cleanup_relocation, load_manifest, relocate_uploads, rollback_relocation

    with app.app_context():
        before = _snapshot()
        manifest_path = relocate_uploads(apply=True)["manifest"]
        # Changed after the move (e.g. payslip replaced): left as it is.
        db.session.get(PaySlip, 1).file_path = "tenants/2/payslips/replaced.pdf"
        db.session.commit()

        dry = rollback_relocation(manifest_path)
        assert dry == {"applied": False, "rows_restored": 5, "rows_changed_since": 1, "copies_removed": 7}
        rollback_relocation(manifest_path, apply=True)

        after = _snapshot()
        assert after["payslips"][1] == "tenants/2/payslips/replaced.pdf"
        after["payslips"][1] = before["payslips"][1]
        assert after == before
        assert not (roots["static"] / "tenants").exists() or not any(
            p.is_file() for p in (roots["static"] / "tenants").rglob("*")
        )
        assert not (roots["private"] / "tenants" / "2" / "payslips" / "p4.pdf").exists()
        assert (roots["private"] / "tenants" / "1" / "payslips" / "p2.pdf").read_bytes() == b"another file"
        assert (roots["private"] / "payslips" / "p4.pdf").is_file()
        assert load_manifest(manifest_path)["status"] == "rolled_back"
        with pytest.raises(ValueError):
            cleanup_relocation(manifest_path)


def test_kind_and_company_filters(app, roots):
    from website.upload_relocation import relocate_uploads

    with app.app_context():
        result = relocate_uploads(apply=True, kinds=["payslips", "query_attachments", "news"], tenants=[2])
        assert result["rows_updated"] == 2
        snap = _snapshot()
        assert snap["payslips"][1] == "tenants/2/payslips/p4.pdf"
        assert snap["news"] == {1: "banner.png", 2: "tenants/2/banner.png"}
        assert snap["expense"] == "E1_40_1_taxi.pdf"
        assert (roots["queries"] / "tenants" / "2" / "queries" / "q40_abc.pdf").is_file()


def test_failed_commit_leaves_rows_and_disk_as_they_were(app, roots, monkeypatch):
    from website.upload_relocation import load_manifest, relocate_uploads

    manifest_path = os.path.join(app.instance_path, "run.json")
    with app.app_context():
        before = _snapshot()

        def boom():
            raise RuntimeError("database went away")

        with monkeypatch.context() as m:
            m.setattr(db.session, "commit", boom)
            with pytest.raises(RuntimeError):
                relocate_uploads(apply=True, manifest_path=manifest_path)

        db.session.expire_all()
        assert _snapshot() == before
        assert not (roots["private"] / "tenants" / "2").exists() or not any(
            p.is_file() for p in (roots["private"] / "tenants" / "2").rglob("*")
        )
        assert not any(p.is_file() for p in (roots["queries"] / "tenants").rglob("*"))
        assert load_manifest(manifest_path)["status"] == "failed"


def test_cli_is_a_dry_run_unless_apply(app, roots):
    runner = app.test_cli_runner()

    out = runner.invoke(args=["uploads-relocate"])
    assert out.exit_code == 0, out.output
    assert "Dry run" in out.output
    assert json.loads(out.output.split("Dry run")[0])["total_rows"] == 6
    assert not (roots["private"] / "tenants" / "2").exists()

    kinds = runner.invoke(args=["uploads-relocate", "--list-kinds"])
    assert "payslips" in kinds.output and "query_attachments" in kinds.output

    bad = runner.invoke(args=["uploads-relocate", "--kind", "nope"])
    assert bad.exit_code != 0 and "Unknown kind" in bad.output

    applied = runner.invoke(args=["uploads-relocate", "--apply", "--kind", "payslips"])
    assert applied.exit_code == 0, applied.output
    manifest_path = json.loads(applied.output)["manifest"]
    assert (roots["private"] / "tenants" / "2" / "payslips" / "p4.pdf").is_file()

    cleanup = runner.invoke(args=["uploads-relocate-cleanup", manifest_path])
    assert json.loads(cleanup.output)["deletable"] == 1
    rollback = runner.invoke(args=["uploads-relocate-rollback", manifest_path, "--apply"])
    assert json.loads(rollback.output)["rows_restored"] == 1
