"""Export View Details must include stored unit identity, not blank brand/serial."""
from datetime import date

from it_perf_support import it_headers, make_app, seed
from website import db
from website.models.it_models import ITAssetUnit, ITInventoryItem, ITParcelExport, ITParcelExportItem


def test_export_list_fills_asset_details_from_linked_unit():
    app = make_app()
    with app.app_context():
        db.create_all()
        seed(n=1)
        db.session.add(
            ITInventoryItem(
                id=40,
                tenant_id=1,
                inventory_code="INV-40",
                name="Dell Latitude",
                category="Hardware",
                inventory_category="IT Assets",
                hw_type="Laptop",
                purchase_date=date(2025, 3, 12),
            )
        )
        db.session.flush()
        db.session.add(
            ITAssetUnit(
                id=500,
                inventory_item_id=40,
                unit_code="LAP-500",
                asset_name="Dell Latitude",
                category="Hardware",
                hw_type="Laptop",
                brand="Dell",
                make="Latitude",
                model="LAT-500",
                serial_number="SN-VIEW-500",
                status="exported",
            )
        )
        db.session.flush()
        export = ITParcelExport(
            tenant_id=1,
            export_code="EXP-VIEW-1",
            destination="Pune Branch",
            exported_by_name="Ravi",
            inventory_category="IT Assets",
        )
        db.session.add(export)
        db.session.flush()
        db.session.add(
            ITParcelExportItem(
                parcel_export_id=export.id,
                asset_unit_id=500,
                asset_name="Dell Latitude",
                serial_number=None,
                brand=None,
                make=None,
                model=None,
            )
        )
        db.session.commit()

    client = app.test_client()
    res = client.get("/api/it/parcels/exports?page=1&per_page=50", headers=it_headers(app))
    body = res.get_json() or {}
    assert res.status_code == 200, body
    row = next((e for e in body.get("exports") or [] if e.get("exportCode") == "EXP-VIEW-1"), None)
    assert row, body
    assert row["to"] == "Pune Branch"
    assert row["exportedBy"] == "Ravi"
    assets = row.get("assets") or []
    assert len(assets) == 1
    asset = assets[0]
    assert asset["assetName"] == "Dell Latitude"
    assert asset["serialNo"] == "SN-VIEW-500"
    assert asset["brand"] == "Dell"
    assert asset["make"] == "Latitude"
    assert asset["model"] == "LAT-500"
    assert asset["hwType"] == "Laptop"
    assert asset["laptopCode"] == "LAT-500"
    assert asset["unitCode"] == "LAP-500"
    assert asset["purchaseDate"] == "2025-03-12"
    for key in ("assetName", "serialNo", "brand", "make", "model", "hwType"):
        assert str(asset.get(key) or "").strip(), f"blank {key}: {asset}"
