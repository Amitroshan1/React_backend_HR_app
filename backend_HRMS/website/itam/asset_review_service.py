"""Device review log — append-only notes, independent of Repair / History / status."""

from __future__ import annotations

from typing import Any, Optional

from ..datetime_utils import isoformat_api, utc_now

REVIEW_TEXT_MIN = 3
REVIEW_TEXT_MAX = 2000
CONDITION_GRADES = ("Good", "Fair", "Poor")


class AssetReviewError(ValueError):
    pass


def normalize_review_payload(data: Optional[dict] = None) -> dict[str, Any]:
    raw = data or {}
    text = str(raw.get("review_text") or raw.get("reviewText") or raw.get("text") or "").strip()
    if len(text) < REVIEW_TEXT_MIN:
        raise AssetReviewError(f"Review must be at least {REVIEW_TEXT_MIN} characters.")
    if len(text) > REVIEW_TEXT_MAX:
        raise AssetReviewError(f"Review must be at most {REVIEW_TEXT_MAX} characters.")

    grade_raw = raw.get("condition_grade") if "condition_grade" in raw else raw.get("conditionGrade")
    grade = str(grade_raw or "").strip()
    if not grade:
        grade = None
    else:
        matched = next((g for g in CONDITION_GRADES if g.lower() == grade.lower()), None)
        if not matched:
            raise AssetReviewError("Condition must be Good, Fair, or Poor.")
        grade = matched

    return {"review_text": text, "condition_grade": grade}


def serialize_review(row, *, created_by_name: Optional[str] = None) -> dict[str, Any]:
    admin = getattr(row, "created_by_admin", None)
    name = created_by_name
    if name is None and admin is not None:
        name = (getattr(admin, "first_name", None) or "").strip() or getattr(admin, "email", None)
    return {
        "id": getattr(row, "id", None),
        "assetUnitId": getattr(row, "asset_unit_id", None),
        "inventoryItemId": getattr(row, "inventory_item_id", None),
        "reviewText": getattr(row, "review_text", None) or "",
        "conditionGrade": getattr(row, "condition_grade", None),
        "createdAt": isoformat_api(getattr(row, "created_at", None)),
        "createdByAdminId": getattr(row, "created_by_admin_id", None),
        "createdByName": name or None,
    }


def list_asset_reviews(
    *,
    asset_unit_id: Optional[int] = None,
    inventory_item_id: Optional[int] = None,
    limit: int = 200,
) -> list[dict[str, Any]]:
    from ..models.it_models import ITAssetReview

    cap = max(1, min(500, int(limit or 200)))
    query = ITAssetReview.query
    if asset_unit_id is not None:
        query = query.filter(ITAssetReview.asset_unit_id == int(asset_unit_id))
    elif inventory_item_id is not None:
        query = query.filter(ITAssetReview.inventory_item_id == int(inventory_item_id))
        query = query.filter(ITAssetReview.asset_unit_id.is_(None))
    else:
        return []

    rows = query.order_by(ITAssetReview.created_at.desc(), ITAssetReview.id.desc()).limit(cap).all()
    return [serialize_review(row) for row in rows]


def create_asset_review(
    *,
    asset_unit_id: Optional[int] = None,
    inventory_item_id: Optional[int] = None,
    actor_admin_id: Optional[int] = None,
    data: Optional[dict] = None,
):
    from .. import db
    from ..models.it_models import ITAssetReview

    if asset_unit_id is None and inventory_item_id is None:
        raise AssetReviewError("A device unit or inventory item is required.")

    fields = normalize_review_payload(data)
    row = ITAssetReview(
        asset_unit_id=int(asset_unit_id) if asset_unit_id is not None else None,
        inventory_item_id=int(inventory_item_id) if inventory_item_id is not None else None,
        review_text=fields["review_text"],
        condition_grade=fields["condition_grade"],
        created_by_admin_id=int(actor_admin_id) if actor_admin_id is not None else None,
        created_at=utc_now(),
    )
    db.session.add(row)
    db.session.flush()
    return row
