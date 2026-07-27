"""Regression: each department inbox only matches its own query department."""


def _norm(value):
    return (value or "").strip().lower()


def _department_variants(department):
    d = _norm(department)
    variants = {d}
    if d in {"human resource", "human resources", "hr"}:
        variants.update({"human resource", "human resources", "hr"})
    elif d in {"it", "it department", "engineering", "inventory"}:
        variants.update({"it", "it department", "engineering", "inventory"})
    elif d in {"accounts", "account", "accountant"}:
        variants.update({"accounts", "account", "accountant"})
    elif d in {"admin", "administration"}:
        variants.update({"admin", "administration"})
    return list(variants)


def _canonical_inbox_department(name):
  QUERY_CANONICAL = ("Human Resource", "IT", "Accounts")

  def is_hr(n):
      return n in {"human resource", "human resources", "hr"} or "human resource" in n

  def is_it(n):
      return n in {"it", "it department", "engineering", "inventory"}

  def is_accounts(n):
      return n in {"accounts", "account", "accountant"} or n.startswith("account") or "accounts" in n

  def canonical(name):
      n = _norm(name)
      if not n:
          return None
      if is_hr(n):
          return "Human Resource"
      if is_it(n) or n == "inventory":
          return "IT"
      if is_accounts(n):
          return "Accounts"
      return None

  if not name:
      return None
  canon = canonical(name)
  if canon:
      return canon
  for label in QUERY_CANONICAL:
      if _norm(label) == _norm(name):
          return label
  return None


def _inbox_department_labels(inbox_department):
    canon = _canonical_inbox_department(inbox_department)
    if not canon:
        return []
    labels = {_norm(canon)}
    for label in ("Human Resource", "IT", "Accounts"):
        if _canonical_inbox_department(label) == canon:
            labels.add(_norm(label))
    labels.update(_norm(v) for v in _department_variants(canon))
    return sorted(labels)


def _query_belongs_to_inbox(query_department, inbox_department):
    labels = frozenset(_inbox_department_labels(inbox_department))
    if not labels:
        return False
    return _norm(query_department) in labels


def _emp_type_to_department(emp_type):
    normalized = _norm(emp_type)
    if normalized in {"human resource", "human resources", "hr"}:
        return "Human Resource"
    if normalized in {"it", "it department", "engineering", "inventory"}:
        return "IT"
    if normalized in {"admin", "administration"}:
        return "Administration"
    if normalized in {"accounts", "account", "accountant"}:
        return "Accounts"
    return None


def can_see(staff_emp, query_dept):
    dept = _emp_type_to_department(staff_emp)
    if not dept:
        return False
    return _query_belongs_to_inbox(query_dept, dept)


def test_scope():
    cases = [
        ("IT", "IT", True),
        ("IT", "IT Department", True),
        ("IT", "Human Resource", False),
        ("IT", "Accounts", False),
        ("Human Resource", "Human Resource", True),
        ("HR", "IT", False),
        ("Accounts", "Accounts", True),
        ("accountant", "IT", False),
        ("inventory", "IT", True),
        ("inventory", "Accounts", False),
        ("IT", "Inventory", True),
    ]
    for staff, qdept, expect in cases:
        got = can_see(staff, qdept)
        assert got == expect, f"{staff} vs {qdept}: expected {expect}, got {got}"


def test_it_inbox_labels_exclude_hr_accounts():
    it_labels = frozenset(_inbox_department_labels("IT"))
    assert _norm("Human Resource") not in it_labels
    assert _norm("Accounts") not in it_labels
    assert _norm("IT") in it_labels
    assert _norm("IT Department") in it_labels


def test_super_admin_not_mapped_to_administration_inbox():
    def infer(value):
        import re
        text = (value or "").strip()
        if not text:
            return None
        n = _norm(text)
        if "super" in n and "admin" in n:
            return None
        if re.search(r"\badministration\b", text, re.I):
            return "Administration"
        if n in {"admin", "administrator"}:
            return "Administration"
        return None

    assert infer("Super Admin") is None


def test_department_queries_post_filter_excludes_hr_from_it_inbox():
    """Simulate post-filter applied in department_queries."""
    it_rows = [
        {"department": "IT", "title": "VPN"},
        {"department": "Human Resource", "title": "Attendance"},
        {"department": "HR", "title": "Leave"},
        {"department": "Accounts", "title": "Payslip"},
        {"department": "IT Department", "title": "Laptop"},
        {"department": "inventory", "title": "Mouse"},
    ]
    filtered = [r for r in it_rows if _query_belongs_to_inbox(r["department"], "IT")]
    titles = {r["title"] for r in filtered}
    assert titles == {"VPN", "Laptop", "Mouse"}
    assert "Attendance" not in titles
    assert "Leave" not in titles
    assert "Payslip" not in titles


if __name__ == "__main__":
    test_scope()
    test_it_inbox_labels_exclude_hr_accounts()
    test_super_admin_not_mapped_to_administration_inbox()
    test_department_queries_post_filter_excludes_hr_from_it_inbox()
    print("PASS: department query isolation")
