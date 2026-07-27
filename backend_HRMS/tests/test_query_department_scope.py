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
    return _norm(query_dept) in set(_department_variants(dept))


def test_scope():
    cases = [
        ("IT", "IT", True),
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


if __name__ == "__main__":
    test_scope()
    print("PASS: department query isolation")
