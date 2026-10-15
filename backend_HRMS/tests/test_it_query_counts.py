"""
IT list endpoints must use a fixed number of SQL queries, whatever the row count.

Each endpoint is called on a small and a larger data set; the query counts must match.
A growing count means a per-row query (N+1) slipped back in.
"""
import pytest

from it_perf_support import LIST_ENDPOINTS, count_queries, it_headers, make_app, seed
from website import db

SMALL, LARGE = 4, 16


def _query_counts(n, itam_flags_on):
    app = make_app(itam_flags_on=itam_flags_on)
    with app.app_context():
        db.create_all()
        seed(n=n)
        engine = db.engine
    client = app.test_client()
    headers = it_headers(app)
    counts = {}
    for path in LIST_ENDPOINTS:
        client.get(path, headers=headers)  # warm-up: plan/tenant lookups cached per process
        with app.app_context():
            engine = db.engine
        with count_queries(engine) as statements:
            resp = client.get(path, headers=headers)
        assert resp.status_code == 200, path
        counts[path] = len(statements)
    with app.app_context():
        db.session.remove()
        db.drop_all()
    return counts


@pytest.fixture(scope="module", params=[False, True], ids=["flags_off", "flags_on"])
def counts(request):
    return _query_counts(SMALL, request.param), _query_counts(LARGE, request.param)


@pytest.mark.parametrize("path", LIST_ENDPOINTS)
def test_query_count_does_not_grow_with_rows(counts, path):
    small, large = counts
    assert large[path] == small[path], (
        f"{path}: {small[path]} queries for {SMALL} employees, {large[path]} for {LARGE}"
    )
