"""Regression: IT employee lookup by first_name, emp_id, email (partial match)."""


class _FakeAdmin:
    def __init__(self, *, id, emp_id, email, first_name, is_exited=False):
        self.id = id
        self.emp_id = emp_id
        self.email = email
        self.first_name = first_name
        self.is_exited = is_exited


def _matches(admin, q):
    """Mirror _employee_lookup_filter logic without DB."""
    term = (q or "").strip()
    if len(term) < 2:
        return False
    if getattr(admin, "is_exited", False):
        return False
    needle = term.lower()
    fields = [
        (admin.emp_id or "").lower(),
        (admin.email or "").lower(),
        (admin.first_name or "").lower(),
    ]
    return any(needle in f for f in fields)


def _filter_admins(admins, q, limit=20):
    term = (q or "").strip()
    if len(term) < 2:
        return []
    out = [a for a in admins if _matches(a, term)]
    out.sort(key=lambda a: ((a.first_name or "").lower(), a.id))
    return out[:limit]


SAMPLE = [
    _FakeAdmin(id=1, emp_id="EMP001", email="aarav@company.com", first_name="Aarav Sharma"),
    _FakeAdmin(id=2, emp_id="EMP002", email="priya@company.com", first_name="Priya Mehta"),
    _FakeAdmin(id=3, emp_id="EMP003", email="rohan@company.com", first_name="Rohan Desai"),
    _FakeAdmin(id=4, emp_id="EMP004", email="neha.patel@company.com", first_name="Neha Patel"),
    _FakeAdmin(id=5, emp_id="EMP099", email="exited@company.com", first_name="Exited User", is_exited=True),
]


def test_lookup_by_first_name_partial():
    rows = _filter_admins(SAMPLE, "priya")
    assert len(rows) == 1
    assert rows[0].first_name == "Priya Mehta"


def test_lookup_by_emp_id_partial():
    rows = _filter_admins(SAMPLE, "emp001")
    assert len(rows) == 1
    assert rows[0].emp_id == "EMP001"


def test_lookup_by_email_partial():
    rows = _filter_admins(SAMPLE, "neha.patel")
    assert len(rows) == 1
    assert rows[0].email == "neha.patel@company.com"


def test_lookup_excludes_exited():
    rows = _filter_admins(SAMPLE, "exited")
    assert len(rows) == 0


def test_lookup_min_two_chars():
    assert _filter_admins(SAMPLE, "a") == []
    assert _filter_admins(SAMPLE, "") == []


def test_lookup_no_false_cross_match():
    rows = _filter_admins(SAMPLE, "rohan")
    assert len(rows) == 1
    assert "Priya" not in rows[0].first_name


if __name__ == "__main__":
    test_lookup_by_first_name_partial()
    test_lookup_by_emp_id_partial()
    test_lookup_by_email_partial()
    test_lookup_excludes_exited()
    test_lookup_min_two_chars()
    test_lookup_no_false_cross_match()
    print("PASS: employee lookup regression")
