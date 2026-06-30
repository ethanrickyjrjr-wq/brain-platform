"""Tests for the API-fed listing extractor — SteadyAPI sole spine.

Pure parser + batched-enrichment tests are network-free; fixtures mirror the live-probed record
shapes (RULE 0.4, 2026-06-30): SteadyAPI location.county_fips 5-digit "12071";
/nearby-home-values body.properties[].description.baths is a STRING ("2.5"), not an int.
The fetch/scan tests (mocked HTTP, no network) live alongside in the second block."""
from __future__ import annotations

from ingest.pipelines.listing_lifecycle.extract_api import (
    _cluster_by_latlon,
    enrich_baths_batched,
    map_property_type,
    parse_steadyapi,
)

# Real-shaped SteadyAPI search record (fields verified against the live API 2026-06-30).
_STEADYAPI_ROW = {
    "property_id": "5493101642",
    "permalink": "https://www.realtor.com/realestateandhomes-detail/1403-NE-19th-Ter_Cape-Coral_FL_33909_M54931-01642",
    "price": {"amount": 374900, "reduced_amount": None},
    "status": "for_sale",
    "source_type": "mls",
    "photo_url": "https://ap.rdcpix.com/abc/x.webp",
    "location": {"lat": 26.6712, "lon": -81.961, "county_fips": "12071"},
    "description": {"beds": 4, "sqft": 1800, "lot_sqft": 10000},
    "flags": {
        "is_pending": False, "is_contingent": False, "is_coming_soon": False,
        "is_foreclosure": False, "is_new_construction": False,
        "is_price_reduced": True, "is_new_listing": True,
    },
}

# Real-shaped /nearby-home-values record (verified against live docs.steadyapi.com, 2026-06-30).
_NEARBY_ROW = {
    "property_id": "5493101642",
    "listing_id": "2996679504",
    "status": "for_sale",
    "list_price": 374900,
    "description": {"beds": 4, "baths": "2.5", "sqft": 1800, "lot_sqft": 10000},
}


def test_parse_steadyapi_parses_permalink_and_photo():
    r = parse_steadyapi(_STEADYAPI_ROW, city="Cape Coral", state="FL")
    assert r is not None
    assert r["street_address"] == "1403 NE 19th Ter"
    assert r["zip_code"] == "33909"
    assert r["county_fips"] == "12071"
    assert r["county"] == "Lee"
    assert r["photo_url"].endswith(".webp")
    assert r["list_price"] == 374900
    assert r["beds"] == 4
    assert r["property_type"] == "single_family"  # has beds -> a home, not land
    assert r["days_on_market"] is None            # SteadyAPI gives no list date / DOM


def test_parse_steadyapi_persists_property_id_status_flags():
    r = parse_steadyapi(_STEADYAPI_ROW, city="Cape Coral", state="FL")
    assert r["property_id"] == "5493101642"        # real column now — known_ids depends on this
    assert r["status"] == "for_sale"
    assert r["reduced_amount"] is None
    assert r["flag_price_reduced"] is True
    assert r["flag_new_listing"] is True
    assert r["flag_pending"] is False


def test_parse_steadyapi_land_when_no_beds_but_lot():
    row = {**_STEADYAPI_ROW, "description": {"beds": None, "lot_sqft": 10890}}
    r = parse_steadyapi(row, city="Cape Coral", state="FL")
    assert r is not None and r["property_type"] == "land" and r["beds"] is None


def test_parse_steadyapi_out_of_scope_returns_none():
    row = {**_STEADYAPI_ROW, "location": {"lat": 1, "lon": 1, "county_fips": "12086"}}
    assert parse_steadyapi(row, city="Miami", state="FL") is None


def test_map_property_type_fallback():
    assert map_property_type("Single Family") == "single_family"
    assert map_property_type("Quadruplex") == "other"
    assert map_property_type(None) == "other"


# ---------------------------------------------------------- clustering (pure, no network)

def test_cluster_by_latlon_groups_nearby_points_into_one_cell():
    rows = [
        {"lat": 26.6712, "lon": -81.9610},
        {"lat": 26.6713, "lon": -81.9611},  # same ~2km cell
    ]
    assert len(_cluster_by_latlon(rows)) == 1


def test_cluster_by_latlon_separates_distant_points():
    rows = [
        {"lat": 26.6712, "lon": -81.9610},
        {"lat": 26.1500, "lon": -81.7900},  # Naples — different cell
    ]
    assert len(_cluster_by_latlon(rows)) == 2


def test_cluster_by_latlon_skips_rows_without_coords():
    rows = [{"lat": None, "lon": None}, {"lat": 26.6712, "lon": -81.9610}]
    assert len(_cluster_by_latlon(rows)) == 1


# ---------------------------------------------------------- batched enrichment (mocked HTTP)
from unittest.mock import MagicMock, patch  # noqa: E402

from ingest.pipelines.listing_lifecycle import extract_api  # noqa: E402


def _resp(status, body):
    m = MagicMock()
    m.status_code = status
    m.json.return_value = body
    return m


def _new_row(pid="5493101642", baths=None):
    r = parse_steadyapi(_STEADYAPI_ROW, city="Cape Coral", state="FL")
    r["property_id"] = pid
    r["baths"] = baths
    return r


def test_enrich_baths_batched_fires_one_call_per_cluster_not_per_listing(monkeypatch):
    monkeypatch.setenv("PHOTOS_API", "p")
    rows = [_new_row(pid=str(i)) for i in range(30)]  # 30 NEW listings, same lat/lon cell
    for r in rows:
        r["lat"], r["lon"] = 26.6712, -81.9610
    body = {"body": {"properties": [{"property_id": str(i),
                                      "description": {"baths": "2.5"}} for i in range(30)]}}
    with patch.object(extract_api.requests, "get", return_value=_resp(200, body)) as mock_get:
        stats = enrich_baths_batched(rows, known_ids=set())
    assert mock_get.call_count == 1                # ONE call covers all 30 — the whole point of the fix
    assert stats["calls"] == 1
    assert stats["new_count"] == 30
    assert stats["baths_filled"] == 30
    assert all(r["baths"] == 2.5 for r in rows)


def test_enrich_baths_batched_skips_known_ids():
    rows = [_new_row(pid="5493101642")]
    with patch.object(extract_api.requests, "get") as mock_get:
        stats = enrich_baths_batched(rows, known_ids={"5493101642"})
    mock_get.assert_not_called()                    # already-held listing — zero calls, the budget fix
    assert stats["new_count"] == 0
    assert stats["calls"] == 0


def test_enrich_baths_batched_skips_land_rows():
    row = _new_row()
    row["property_type"] = "land"
    with patch.object(extract_api.requests, "get") as mock_get:
        stats = enrich_baths_batched([row], known_ids=set())
    mock_get.assert_not_called()                    # land has no baths — not worth a call
    assert stats["new_count"] == 0


def test_enrich_baths_batched_dry_run_makes_zero_network_calls(monkeypatch):
    monkeypatch.setenv("PHOTOS_API", "p")
    rows = [_new_row(pid=str(i)) for i in range(5)]
    for r in rows:
        r["lat"], r["lon"] = 26.6712, -81.9610
    with patch.object(extract_api.requests, "get") as mock_get:
        stats = enrich_baths_batched(rows, known_ids=set(), dry_run=True)
    mock_get.assert_not_called()                    # the dry-run-trap fix: no network in dry_run
    assert stats["new_count"] == 5
    assert stats["calls"] == 1                       # still reports the real call count it WOULD make


def test_enrich_baths_batched_no_key_is_a_gap(monkeypatch):
    monkeypatch.delenv("PHOTOS_API", raising=False)
    rows = [_new_row()]
    for r in rows:
        r["lat"], r["lon"] = 26.6712, -81.9610
    stats = enrich_baths_batched(rows, known_ids=set())
    assert stats["calls"] == 0 and stats["baths_filled"] == 0


# ---------------------------------------------------------- fetch + scan (mocked HTTP, no network)

def test_fetch_steadyapi_paginates_to_meta_total():
    body1 = {"meta": {"total": 250}, "body": [_STEADYAPI_ROW] * 200}
    body2 = {"meta": {"total": 250}, "body": [_STEADYAPI_ROW] * 50}
    with patch.object(extract_api.requests, "get", side_effect=[_resp(200, body1), _resp(200, body2)]):
        rows, ok, pages = extract_api.fetch_steadyapi_city("Cape Coral", key="p")
    assert len(rows) == 250 and ok is True and pages == 2


def test_fetch_steadyapi_clean_empty_first_page_is_complete():
    with patch.object(extract_api.requests, "get", return_value=_resp(200, {"meta": {"total": 0}, "body": []})):
        rows, ok, pages = extract_api.fetch_steadyapi_city("Sanibel", key="p")
    assert rows == [] and ok is True and pages == 1


def test_fetch_steadyapi_non_200_is_a_gap():
    with patch.object(extract_api.requests, "get", return_value=_resp(429, {})):
        rows, ok, pages = extract_api.fetch_steadyapi_city("Cape Coral", key="p")
    assert rows == [] and ok is False


def test_fetch_steadyapi_no_key_is_a_gap():
    rows, ok, pages = extract_api.fetch_steadyapi_city("Cape Coral", key=None)
    assert rows == [] and ok is False and pages == 0


def test_scan_county_api_labels_counts_and_reports_call_budget(monkeypatch):
    monkeypatch.setenv("PHOTOS_API", "p")
    with patch.object(extract_api, "fetch_steadyapi_city", return_value=([_STEADYAPI_ROW], True, 1)):
        out = extract_api.scan_county_api("Lee", known_ids={"5493101642"})
    assert out["count"] >= 1
    assert out["exhausted"] is True
    assert out["last_status"] == 200
    assert all(r["county"] == "Lee" for r in out["rows"])
    assert out["search_calls"] == len(extract_api.SWFL_CITY_SEED["Lee"])  # 1 page/city, mocked
    assert out["enrich_calls"] == 0                  # the one row is already in known_ids


def test_scan_county_api_clean_empty_city_stays_complete(monkeypatch):
    # A cleanly-empty city must NOT poison the whole county's completeness (robustness fix).
    monkeypatch.setenv("PHOTOS_API", "p")
    with patch.object(extract_api, "fetch_steadyapi_city", return_value=([], True, 1)):
        out = extract_api.scan_county_api("Lee")
    assert out["exhausted"] is True and out["count"] == 0


def test_scan_county_api_truncated_city_marks_incomplete(monkeypatch):
    monkeypatch.setenv("PHOTOS_API", "p")
    with patch.object(extract_api, "fetch_steadyapi_city", return_value=([_STEADYAPI_ROW], False, 1)):
        out = extract_api.scan_county_api("Lee")
    assert out["exhausted"] is False and out["last_status"] != 200


def test_scan_county_api_dry_run_never_calls_nearby_home_values(monkeypatch):
    # The regression this whole fix targets: a --dry-run invocation must not detonate the budget.
    monkeypatch.setenv("PHOTOS_API", "p")
    with patch.object(extract_api, "fetch_steadyapi_city", return_value=([_STEADYAPI_ROW], True, 1)), \
         patch.object(extract_api.requests, "get") as mock_get:
        extract_api.scan_county_api("Lee", known_ids=set(), dry_run=True)
    mock_get.assert_not_called()                     # fetch_steadyapi_city is mocked out above;
                                                       # this proves enrich made no real request either
