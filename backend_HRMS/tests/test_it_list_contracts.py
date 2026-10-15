"""
IT list endpoints must return exactly what they returned before performance work.

The snapshot was recorded from the code before any query changes. To re-record after an
intended response change: UPDATE_IT_SNAPSHOT=1 python -m pytest tests/test_it_list_contracts.py
"""
import json
import os
from pathlib import Path

import pytest

from it_perf_support import LIST_ENDPOINTS, it_headers, make_app, normalize, seed
from website import db

SNAPSHOT = Path(__file__).parent / "snapshots" / "it_list_contracts.json"


def _capture(itam_flags_on):
    app = make_app(itam_flags_on=itam_flags_on)
    with app.app_context():
        db.create_all()
        seed(n=3)
    client = app.test_client()
    headers = it_headers(app)
    out = {}
    for path in LIST_ENDPOINTS:
        resp = client.get(path, headers=headers)
        out[path] = {"status": resp.status_code, "body": normalize(resp.get_json())}
    with app.app_context():
        db.session.remove()
        db.drop_all()
    return out


@pytest.fixture(scope="module")
def responses():
    return {
        "flags_off": _capture(itam_flags_on=False),
        "flags_on": _capture(itam_flags_on=True),
    }


def test_snapshot_exists_or_is_recorded(responses):
    if os.getenv("UPDATE_IT_SNAPSHOT") == "1":
        SNAPSHOT.parent.mkdir(parents=True, exist_ok=True)
        SNAPSHOT.write_text(json.dumps(responses, indent=1, sort_keys=True), encoding="utf-8")
    assert SNAPSHOT.exists(), "Run once with UPDATE_IT_SNAPSHOT=1 to record the baseline"


@pytest.mark.parametrize("variant", ["flags_off", "flags_on"])
@pytest.mark.parametrize("path", LIST_ENDPOINTS)
def test_response_matches_snapshot(responses, variant, path):
    expected = json.loads(SNAPSHOT.read_text(encoding="utf-8"))[variant][path]
    assert responses[variant][path] == expected


def test_seed_covers_every_list(responses):
    """Guard against a snapshot of empty lists, which would prove nothing."""
    for path, result in responses["flags_off"].items():
        assert result["status"] == 200, path
        body = result["body"]
        lists = [v for v in body.values() if isinstance(v, list)]
        if "summary" in body:
            assert body["summary"]["total_assets"] > 0
        elif "employee" in body:
            assert body["employee"]["assignedAssets"]
        else:
            assert lists and lists[0], path
