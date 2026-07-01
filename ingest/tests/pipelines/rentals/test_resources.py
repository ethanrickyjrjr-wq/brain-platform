"""Pure-parser tests for rentals — verified against a real live 07/01/2026 /rentals-search response
(Naples, FL probe, trimmed to 3 rows incl. a real null-price/null-beds edge case)."""
import json
from pathlib import Path

from ingest.pipelines.rentals.resources import (
    intended_call_counts,
    parse_rentals_page,
)

FX = Path(__file__).parent / "fixtures"


def _load(name: str) -> dict:
    return json.loads((FX / name).read_text(encoding="utf-8"))


def test_parse_rentals_page_maps_rows():
    rows = parse_rentals_page(_load("rentals_search_naples.json"), "Collier", "2026-07-01")
    assert len(rows) == 3
    r0 = rows[0]
    assert r0["property_id"] == "9837463914"
    assert r0["county"] == "Collier"
    assert r0["zip_code"] == "34114"
    assert r0["city"] == "Naples"
    assert r0["address_line"] == "8360 Rattlesnake Hammock Rd"
    assert r0["property_type"] == "apartment"
    assert r0["price_min"] == 485 and r0["price_max"] == 1244
    assert r0["beds_min"] == 0 and r0["beds_max"] == 1
    assert r0["baths_min"] == 1 and r0["baths_max"] == 1
    assert r0["sqft_min"] == 527 and r0["sqft_max"] == 708
    assert r0["captured_date"] == "2026-07-01"
    assert r0["source_tag"] == "realtor.com"


def test_parse_rentals_page_null_price_and_beds_survive_as_none():
    # Real live edge case: a row with null price/beds/baths/sqft (display "$0"/"Studio") — never
    # fabricate a number, just carry the gap through as None.
    rows = parse_rentals_page(_load("rentals_search_naples.json"), "Collier", "2026-07-01")
    r2 = rows[2]
    assert r2["property_id"] == "6546627169"
    assert r2["price_min"] is None and r2["price_max"] is None
    assert r2["beds_min"] is None and r2["baths_min"] is None and r2["sqft_min"] is None
    assert r2["property_type"] == "single_family"


def test_parse_rentals_page_drops_rows_without_property_id():
    raw = {"body": [{"price": {"min": 1000}}]}
    assert parse_rentals_page(raw, "Lee", "2026-07-01") == []


def test_parse_rentals_page_empty_body_is_no_rows():
    assert parse_rentals_page({"meta": {}, "body": None}, "Lee", "2026-07-01") == []
    assert parse_rentals_page({}, "Lee", "2026-07-01") == []


def test_intended_call_counts():
    counts = intended_call_counts()
    assert counts["Lee"] > 0 and counts["Collier"] > 0
    # ~471 total pages at the 07/01 measured totals (5,211 Lee / 4,182 Collier @ 20/page).
    assert 400 <= counts["Lee"] + counts["Collier"] <= 550
