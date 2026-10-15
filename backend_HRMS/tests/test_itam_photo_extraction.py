"""Phase 2: moving IT photos out of the database in batches, with a restore file."""
import json

import pytest

import website.itam.media as media
from it_perf_support import PHOTO, it_headers, make_app, normalize, seed
from website import db
from website.models.it_models import ITAssetUnit, ITInventoryItem

N = 6


@pytest.fixture()
def app(tmp_path):
    app = make_app()
    app.static_folder = str(tmp_path / "static")
    with app.app_context():
        db.create_all()
        seed(n=N)
    yield app
    with app.app_context():
        db.session.remove()
        db.drop_all()


def _get(app, path):
    return app.test_client().get(path, headers=it_headers(app))


def _photo_columns(app):
    with app.app_context():
        return {
            u.id: (u.photos_json, u.assignment_photos_json)
            for u in ITAssetUnit.query.order_by(ITAssetUnit.id)
        }


def _strip_photos(units):
    return [{k: v for k, v in u.items() if k not in ("photos", "assignmentPhotos")} for u in units]


def test_extract_moves_every_photo_and_keeps_the_api_shape(app, tmp_path):
    before = _get(app, "/api/it/units").get_json()["units"]
    with app.app_context():
        dry = media.extract_itam_data_urls(batch_size=4)
    assert dry["applied"] is False and dry["files"] > 0 and "backup" not in dry
    assert _photo_columns(app)[100][0] == [PHOTO]

    with app.app_context():
        done = media.extract_itam_data_urls(apply=True, batch_size=4, backup_dir=str(tmp_path / "bk"))
    assert done["applied"] is True
    assert {k: done[k] for k in ("rows", "files", "skipped")} == {
        k: dry[k] for k in ("rows", "files", "skipped")
    }
    assert done["tables"]["it_asset_units.photos_json"]["rows"] == 2 * N

    with open(done["backup"], encoding="utf-8") as fh:
        lines = [json.loads(line) for line in fh]
    assert len(lines) == done["rows"]
    assert all(line["old"] != line["new"] for line in lines)

    with app.app_context():
        for units in ITAssetUnit.query:
            for value in (units.photos_json or []) + (units.assignment_photos_json or []):
                assert value.startswith("tenants/1/itam/")
                assert (tmp_path / "static" / "uploads").joinpath(*value.split("/")).is_file()
        assert ITInventoryItem.query.get(10).photos_json[0].startswith("tenants/1/itam/inventory/")

    after = _get(app, "/api/it/units").get_json()["units"]
    assert normalize(_strip_photos(after)) == normalize(_strip_photos(before))
    for old, new in zip(before, after):
        assert len(new["photos"]) == len(old["photos"])
        assert all(p.startswith("/api/files/signed/tenants/1/itam/units/") for p in new["photos"])

    with app.app_context():
        again = media.extract_itam_data_urls(apply=True, backup_dir=str(tmp_path / "bk"))
    assert again["rows"] == 0 and "backup" not in again


def test_failed_batch_is_rolled_back_and_the_next_run_finishes(app, tmp_path, monkeypatch):
    real_write = media._write_blob
    calls = {"n": 0}

    # Writes 1-6: inventory items. 7-12: first two unit batches. 13 succeeds and 14 fails
    # inside the third unit batch, so the file from write 13 must be cleaned up.
    def flaky(*args, **kwargs):
        calls["n"] += 1
        if calls["n"] == 14:
            raise OSError("disk full")
        return real_write(*args, **kwargs)

    monkeypatch.setattr(media, "_write_blob", flaky)
    with app.app_context(), pytest.raises(OSError):
        media.extract_itam_data_urls(apply=True, batch_size=3, backup_dir=str(tmp_path / "bk"))

    with app.app_context():
        stored = [
            p
            for row in list(ITInventoryItem.query) + list(ITAssetUnit.query)
            for p in (row.photos_json or []) + (getattr(row, "assignment_photos_json", None) or [])
        ]
        unit_photos = {u.id: u.photos_json for u in ITAssetUnit.query}
    keys_in_rows = {p for p in stored if not p.startswith("data:")}
    files_on_disk = list((tmp_path / "static" / "uploads").rglob("*.png"))
    assert unit_photos[105][0].startswith("tenants/"), "earlier batches stay committed"
    assert unit_photos[106] == [PHOTO], "the failed batch is rolled back"
    assert len(files_on_disk) == len(keys_in_rows) == 12, "files of the failed batch are removed"

    monkeypatch.setattr(media, "_write_blob", real_write)
    with app.app_context():
        media.extract_itam_data_urls(apply=True, batch_size=3, backup_dir=str(tmp_path / "bk"))
        leftover = media.extract_itam_data_urls()
    assert leftover["files"] == 0


def test_restore_puts_image_data_back_except_rows_edited_since(app, tmp_path):
    original = _photo_columns(app)
    with app.app_context():
        done = media.extract_itam_data_urls(apply=True, backup_dir=str(tmp_path / "bk"))
        edited = db.session.get(ITAssetUnit, 100)
        edited.photos_json = ["tenants/1/itam/units/replaced.png"]
        db.session.commit()

        dry = media.restore_itam_photos(done["backup"])
        assert dry["applied"] is False and dry["changed_since"] == 1
        assert dry["rows"] == done["rows"] - 1

        restored = media.restore_itam_photos(done["backup"], apply=True, batch_size=4)
        assert restored["rows"] == done["rows"] - 1

    now = _photo_columns(app)
    assert now[100][0] == ["tenants/1/itam/units/replaced.png"]
    assert now[100][1] == original[100][1]
    assert {k: v for k, v in now.items() if k != 100} == {k: v for k, v in original.items() if k != 100}

    with app.app_context():
        assert media.restore_itam_photos(done["backup"])["already"] == done["rows"] - 1
