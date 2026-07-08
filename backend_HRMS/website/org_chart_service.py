"""Org chart data from ManagerContact L1/L2/L3 assignments."""
from __future__ import annotations

from sqlalchemy import or_

from .manager_utils import get_manager_detail, resolve_manager_contact_for_employee
from .models.Admin_models import Admin
from .models.emp_detail_models import Employee


def _enabled_filters():
    return (
        or_(Admin.is_exited == False, Admin.is_exited.is_(None)),
        or_(Admin.is_active == True, Admin.is_active.is_(None)),
    )


def build_org_chart(*, circle: str | None = None, emp_type: str | None = None) -> dict:
    q = Admin.query.filter(*_enabled_filters()).order_by(Admin.circle.asc(), Admin.emp_type.asc(), Admin.first_name.asc())
    if circle:
        q = q.filter(Admin.circle == circle.strip())
    if emp_type:
        q = q.filter(Admin.emp_type == emp_type.strip())

    admins = q.all()
    admin_ids = [a.id for a in admins]
    desig_map: dict[int, str] = {}
    if admin_ids:
        for row in Employee.query.filter(Employee.admin_id.in_(admin_ids)).all():
            if row.designation:
                desig_map[row.admin_id] = row.designation

    employees = []
    manager_index: dict[int, dict] = {}

    for admin in admins:
        contact = resolve_manager_contact_for_employee(admin)
        l1 = get_manager_detail(contact, "l1") if contact else get_manager_detail(None, "l1")
        l2 = get_manager_detail(contact, "l2") if contact else get_manager_detail(None, "l2")
        l3 = get_manager_detail(contact, "l3") if contact else get_manager_detail(None, "l3")

        row = {
            "admin_id": admin.id,
            "name": admin.first_name or admin.email,
            "email": admin.email,
            "emp_id": admin.emp_id,
            "circle": admin.circle,
            "emp_type": admin.emp_type,
            "designation": desig_map.get(admin.id),
            "doj": admin.doj.isoformat() if admin.doj else None,
            "managers": {"l1": l1, "l2": l2, "l3": l3},
            "l1_admin_id": l1.get("id"),
        }
        employees.append(row)

        for mgr in (l1, l2, l3):
            mid = mgr.get("id")
            if mid and mid not in manager_index:
                manager_index[mid] = {
                    "admin_id": mid,
                    "name": mgr.get("name"),
                    "email": mgr.get("email"),
                    "direct_reports": [],
                }

    for row in employees:
        l1_id = row.get("l1_admin_id")
        if l1_id and l1_id in manager_index:
            manager_index[l1_id]["direct_reports"].append({
                "admin_id": row["admin_id"],
                "name": row["name"],
                "emp_id": row["emp_id"],
            })

    return {
        "count": len(employees),
        "employees": employees,
        "manager_nodes": list(manager_index.values()),
        "tree": _build_org_tree(employees, manager_index),
        "tree_multilevel": _build_multilevel_tree(employees),
    }


def org_chart_to_csv(employees: list[dict]) -> str:
    import csv
    import io

    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow([
        "Name",
        "Employee ID",
        "Email",
        "Circle",
        "Department",
        "Designation",
        "DOJ",
        "L1 Manager",
        "L2 Manager",
        "L3 Manager",
    ])
    for emp in employees:
        m = emp.get("managers") or {}
        writer.writerow([
            emp.get("name") or "",
            emp.get("emp_id") or "",
            emp.get("email") or "",
            emp.get("circle") or "",
            emp.get("emp_type") or "",
            emp.get("designation") or "",
            emp.get("doj") or "",
            (m.get("l1") or {}).get("name") or "",
            (m.get("l2") or {}).get("name") or "",
            (m.get("l3") or {}).get("name") or "",
        ])
    return out.getvalue()


def _mgr_snapshot(mgr: dict | None, fallback_id: int | None = None) -> dict:
    if not mgr or not mgr.get("id"):
        if fallback_id is None:
            return {"admin_id": None, "name": "Unassigned", "email": None}
        return {"admin_id": fallback_id, "name": f"Manager #{fallback_id}", "email": None}
    return {
        "admin_id": mgr.get("id"),
        "name": mgr.get("name") or f"Manager #{mgr.get('id')}",
        "email": mgr.get("email"),
    }


def _build_multilevel_tree(employees: list[dict]) -> list[dict]:
    """L3 → L2 → L1 → employee leaves."""
    from collections import defaultdict

    # (l3_id, l2_id, l1_id) -> [employees]
    buckets: dict[tuple, list] = defaultdict(list)
    for emp in employees:
        m = emp.get("managers") or {}
        l3_id = (m.get("l3") or {}).get("id") or 0
        l2_id = (m.get("l2") or {}).get("id") or 0
        l1_id = emp.get("l1_admin_id") or 0
        buckets[(l3_id, l2_id, l1_id)].append(emp)

    l3_groups: dict[int, dict] = {}
    for (l3_id, l2_id, l1_id), emps in buckets.items():
        sample = emps[0]
        m = sample.get("managers") or {}
        l3_node = l3_groups.setdefault(
            l3_id,
            {"level": "l3", "manager": _mgr_snapshot(m.get("l3"), l3_id or None), "children": {}},
        )
        l2_children = l3_node["children"]
        l2_node = l2_children.setdefault(
            l2_id,
            {"level": "l2", "manager": _mgr_snapshot(m.get("l2"), l2_id or None), "children": {}},
        )
        l1_children = l2_node["children"]
        l1_node = l1_children.setdefault(
            l1_id,
            {
                "level": "l1",
                "manager": _mgr_snapshot(m.get("l1"), l1_id or None),
                "reports": [],
            },
        )
        l1_node["reports"].extend(emps)

    def _finalize_l1(node):
        node["reports"] = sorted(node.get("reports") or [], key=lambda e: (e.get("name") or "").lower())
        node["report_count"] = len(node["reports"])
        return node

    def _finalize_l2(node):
        children = [_finalize_l1(c) for c in node.get("children", {}).values()]
        children.sort(key=lambda n: (n.get("manager") or {}).get("name") or "")
        return {**node, "children": children, "report_count": sum(c["report_count"] for c in children)}

    def _finalize_l3(node):
        children = [_finalize_l2(c) for c in node.get("children", {}).values()]
        children.sort(key=lambda n: (n.get("manager") or {}).get("name") or "")
        return {**node, "children": children, "report_count": sum(c["report_count"] for c in children)}

    roots = [_finalize_l3(v) for v in l3_groups.values()]
    roots.sort(key=lambda n: (n.get("manager") or {}).get("name") or "")
    return roots


def _build_org_tree(employees: list[dict], manager_index: dict[int, dict]) -> list[dict]:
    """Build L1-rooted hierarchy for visual org tree."""
    by_l1: dict[int | None, list[dict]] = {}
    for row in employees:
        l1_id = row.get("l1_admin_id")
        by_l1.setdefault(l1_id, []).append(row)

    roots = []
    for l1_id, reports in sorted(by_l1.items(), key=lambda x: (x[0] is None, str(x[0]))):
        if l1_id is None:
            mgr = {"admin_id": None, "name": "Unassigned", "email": None}
        else:
            mgr_node = manager_index.get(l1_id) or {}
            l1_detail = next((r.get("managers", {}).get("l1") for r in reports if r.get("l1_admin_id") == l1_id), {})
            mgr = {
                "admin_id": l1_id,
                "name": l1_detail.get("name") or mgr_node.get("name") or f"Manager #{l1_id}",
                "email": l1_detail.get("email") or mgr_node.get("email"),
            }
        roots.append({
            "manager": mgr,
            "reports": sorted(reports, key=lambda e: (e.get("name") or "").lower()),
            "report_count": len(reports),
        })
    return roots
