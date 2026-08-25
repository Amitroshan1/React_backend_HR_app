"""Device review payload validation (no Flask DB required)."""

from types import SimpleNamespace

from website.itam.asset_review_service import (
    AssetReviewError,
    normalize_review_payload,
    serialize_review,
)


def test_normalize_review_requires_text():
    try:
        normalize_review_payload({"review_text": "ab"})
        raise AssertionError("expected AssetReviewError")
    except AssetReviewError as exc:
        assert "at least" in str(exc)


def test_normalize_review_accepts_optional_condition():
    fields = normalize_review_payload({"review_text": "Battery health is fine", "condition_grade": "good"})
    assert fields["review_text"] == "Battery health is fine"
    assert fields["condition_grade"] == "Good"


def test_normalize_review_rejects_unknown_condition():
    try:
        normalize_review_payload({"review_text": "Looks ok overall", "condition_grade": "mint"})
        raise AssertionError("expected AssetReviewError")
    except AssetReviewError as exc:
        assert "Good" in str(exc)


def test_serialize_review_includes_date_and_author():
    row = SimpleNamespace(
        id=9,
        asset_unit_id=4,
        inventory_item_id=12,
        review_text="Screen scratch on lid",
        condition_grade="Fair",
        created_at=None,
        created_by_admin_id=3,
        created_by_admin=SimpleNamespace(first_name="Priya", email="priya@example.com"),
    )
    payload = serialize_review(row)
    assert payload["id"] == 9
    assert payload["assetUnitId"] == 4
    assert payload["reviewText"] == "Screen scratch on lid"
    assert payload["conditionGrade"] == "Fair"
    assert payload["createdByName"] == "Priya"
