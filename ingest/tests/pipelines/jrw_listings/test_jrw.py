"""Deterministic tests for the JRW listings normalizer + card parser (no network)."""
from __future__ import annotations

from ingest.pipelines.jrw_listings.distill import normalize
from ingest.pipelines.jrw_listings.extract import _parse_cards

_RAW_HOME = {
    "mls_id": "225073939",
    "zip_code": "34102",
    "county": "Collier",
    "list_price": "$17,950,000",
    "street_address": "285 Central Avenue",
    "city": "Naples ,",
    "state": "FL",
    "community": "OLDE NAPLES",
    "details": "5 Beds 8 Baths 0.34 Acres 6,822 SqFt 244 Days on Market",
    "listing_url": "https://www.johnrwood.com/listing/225073939/285-central-avenue-naples-fl-34102/",
}
_RAW_LAND = {
    "mls_id": "226014932",
    "zip_code": "34102",
    "county": "Collier",
    "list_price": "$195,000,000",
    "street_address": "100 & 104 Bay Road",
    "city": "Naples ,",
    "state": "FL",
    "community": "PORT ROYAL",
    "details": "Land 5.39 Acres 77 Days on Market",
    "listing_url": "https://www.johnrwood.com/listing/226014932/x-bay-road-naples-fl-34102/",
}


def test_normalize_home_row_types_and_fields():
    [r] = normalize([_RAW_HOME])
    assert r["source_name"] == "john_r_wood"
    assert r["mls_id"] == "225073939"
    assert r["list_price"] == 17950000.0
    assert r["beds"] == 5
    assert r["baths"] == 8.0
    assert r["acres"] == 0.34
    assert r["sqft"] == 6822
    assert r["days_on_market"] == 244
    assert r["city"] == "Naples"  # trailing comma stripped
    assert r["status"] == "active"
    assert r["property_type"] == "residential"
    assert r["county"] == "Collier"  # derived from the ZIP fixture


def test_normalize_land_row_has_no_beds_and_is_land():
    [r] = normalize([_RAW_LAND])
    assert r["beds"] is None
    assert r["baths"] is None
    assert r["acres"] == 5.39
    assert r["property_type"] == "land"


def test_normalize_drops_rows_missing_key_fields():
    assert normalize([{"mls_id": "", "zip_code": "34102"}]) == []
    assert normalize([{"mls_id": "X1", "zip_code": ""}]) == []


def test_parse_cards_extracts_from_real_markup():
    html = """
    <a class="listing__link" href="/listing/225073939/285-central-avenue-naples-fl-34102/">
      <span class="listing__price-value">$17,950,000</span>
      <span class="listing__city">Naples ,</span>
      <span class="listing__state">FL</span>
      <span class="listing__subdivision">OLDE NAPLES</span>
      <span class="listing__address-display">285 Central Avenue</span>
      <span class="listing__property-details">5 Beds 8 Baths 0.34 Acres 6,822 SqFt 244 Days on Market</span>
    </a>
    """
    cards = _parse_cards(html, "Collier")
    assert len(cards) == 1
    c = cards[0]
    assert c["mls_id"] == "225073939"
    assert c["zip_code"] == "34102"
    assert c["list_price"] == "$17,950,000"
    assert c["street_address"] == "285 Central Avenue"
    assert "5 Beds" in c["details"]
