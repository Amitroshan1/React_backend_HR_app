from datetime import datetime

from it_perf_support import OTHER_TENANT_ADMIN_ID, it_headers, make_app, seed
from website import db
from website.models.it_models import ITParcelExport, ITParcelExportItem, ITParcelImport


def test_parcel_monthly_summary_groups_by_month_and_stays_in_tenant():
    app = make_app()
    with app.app_context():
        db.create_all()
        seed()
        db.session.add_all([
            ITParcelImport(
                tenant_id=1,
                import_code="IMP-OCT-1",
                source="Vendor A",
                asset_name="Laptop",
                count=3,
                received_at=datetime(2026, 10, 4, 10, 0, 0),
            ),
            ITParcelImport(
                tenant_id=1,
                import_code="IMP-OCT-2",
                source="Vendor B",
                asset_name="Mouse",
                count=5,
                received_at=datetime(2026, 10, 18, 10, 0, 0),
            ),
            ITParcelImport(
                tenant_id=1,
                import_code="IMP-NOV-1",
                source="Vendor C",
                asset_name="Dock",
                count=2,
                received_at=datetime(2026, 11, 2, 10, 0, 0),
            ),
            ITParcelImport(
                tenant_id=2,
                import_code="IMP-OTHER",
                source="Other tenant",
                asset_name="Hidden",
                count=99,
                received_at=datetime(2026, 10, 5, 10, 0, 0),
            ),
        ])
        export = ITParcelExport(
            tenant_id=1,
            export_code="EXP-OCT-1",
            destination="Site A",
            exported_at=datetime(2026, 10, 20, 10, 0, 0),
        )
        db.session.add(export)
        db.session.flush()
        db.session.add_all([
            ITParcelExportItem(parcel_export_id=export.id, asset_name="Laptop A"),
            ITParcelExportItem(parcel_export_id=export.id, asset_name="Laptop B"),
        ])
        db.session.commit()

    client = app.test_client()
    headers = it_headers(app, 1)

    bad = client.get("/api/it/parcels/monthly-summary?year=1999", headers=headers)
    assert bad.status_code == 400

    res = client.get("/api/it/parcels/monthly-summary?year=2026", headers=headers)
    assert res.status_code == 200
    body = res.get_json()
    assert body["success"] is True
    assert body["year"] == 2026
    assert len(body["months"]) == 12

    oct_row = body["months"][9]
    nov_row = body["months"][10]
    assert oct_row["month"] == "2026-10"
    assert oct_row["imports"] == {"shipments": 2, "quantity": 8}
    assert oct_row["exports"] == {"shipments": 1, "units": 2}
    assert nov_row["imports"] == {"shipments": 1, "quantity": 2}
    assert nov_row["exports"] == {"shipments": 0, "units": 0}

    assert body["totals"]["imports"] == {"shipments": 3, "quantity": 10}
    assert body["totals"]["exports"] == {"shipments": 1, "units": 2}

    other = client.get(
        "/api/it/parcels/monthly-summary?year=2026",
        headers=it_headers(app, OTHER_TENANT_ADMIN_ID, tenant_id=2),
    )
    other_oct = other.get_json()["months"][9]
    assert other_oct["imports"]["quantity"] == 99
    assert other_oct["exports"]["units"] == 0
