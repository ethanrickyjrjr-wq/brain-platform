"""Pure-parser tests for market_aggregates — verified against the real 06/30/2026 response shapes."""
import json
from pathlib import Path

from ingest.pipelines.market_aggregates.resources import (
    intended_call_counts,
    parse_histogram,
    parse_market_details,
)

FX = Path(__file__).parent / "fixtures"


def _load(name: str) -> dict:
    return json.loads((FX / name).read_text(encoding="utf-8"))


def test_parse_histogram_maps_bands():
    rows = parse_histogram(_load("price_histogram_lee.json"), "Lee", "2026-06-30")
    assert len(rows) == 4
    r0 = rows[0]
    assert r0["county"] == "Lee"
    assert r0["band_min"] == 0 and r0["band_max"] == 50000 and r0["listing_count"] == 4682
    assert r0["total_listings"] == 22493
    assert r0["status"] == "for_sale"
    assert r0["captured_date"] == "2026-06-30"
    assert r0["source_tag"] == "realtor.com"
    # open-ended top band survives (int32-max upper bound)
    assert rows[-1]["band_min"] == 10000000


def test_parse_histogram_empty_body_is_no_rows():
    assert parse_histogram({"meta": {}, "body": None}, "Lee", "2026-06-30") == []
    assert parse_histogram({}, "Lee", "2026-06-30") == []


def test_parse_market_details_yield_is_net_new_field():
    row = parse_market_details(_load("housing_market_details_33901.json"), "33901", "Lee", "2026-06-30")
    assert row is not None
    assert row["median_sold_price"] == 320000 and row["median_rent_price"] == 1350
    # the net-new headline: sold ÷ annual rent = 320000 / (1350*12) ≈ 19.75
    assert row["sold_to_rent_ratio"] == 19.75
    assert row["list_to_sold_ratio_pct"] == 94.15
    assert row["market_strength"] == "warm"
    assert row["median_price_per_sqft"] == 225
    assert row["zip_code"] == "33901" and row["county"] == "Lee"
    assert row["source_tag"] == "realtor.com"


def test_parse_market_details_gap_returns_none():
    assert parse_market_details({"meta": {}, "body": {}}, "33901", "Lee", "2026-06-30") is None


def test_intended_call_counts():
    counts = intended_call_counts()
    assert counts["histogram"] == 2  # Lee + Collier
    assert counts["details"] >= 50   # ~57 in-scope Lee+Collier ZIPs
