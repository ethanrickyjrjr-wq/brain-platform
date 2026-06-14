"""
Tests for ingest/utils/zip_approx.py

Real GeoJSON used for tests 1+2 (Lee / Collier county integration).
Fake minimal GeoJSON used for tests 3-5 (isolation, no 22 MB parse).
Census Geocoder API is mocked throughout — no real network calls.
"""

from __future__ import annotations

import json
import os
from unittest.mock import MagicMock, patch

import pytest

import ingest.utils.zip_approx as _mod
from ingest.utils.zip_approx import get_zip_approx

# Real TIGER ZCTA asset (repo root -> public/maps/fl_zips.geojson)
_REAL_ZCTA_PATH = os.path.normpath(
    os.path.join(
        os.path.dirname(__file__), "..", "..", "..", "public", "maps", "fl_zips.geojson"
    )
)

# Mock Census Geocoder payloads
_GEO_FORT_MYERS = {
    "result": {
        "addressMatches": [{"coordinates": {"y": 26.6406, "x": -81.8723}}]
    }
}
_GEO_NAPLES = {
    "result": {
        "addressMatches": [{"coordinates": {"y": 26.1420, "x": -81.7948}}]
    }
}
_GEO_NO_MATCH = {"result": {"addressMatches": []}}


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(autouse=True)
def _reset_caches():
    """Wipe all module-level caches before each test for full isolation."""
    _mod._zcta_records = None
    _mod._county_zcta_map = None
    _mod._city_coord_cache.clear()
    _mod._result_cache.clear()
    yield


@pytest.fixture()
def fake_zcta_path(tmp_path):
    """
    Minimal ZCTA GeoJSON with two representative features — one near Fort Myers
    (33901) and one near Naples (34102). Fast to parse; no real file dependency.
    """
    data = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {
                    "ZCTA5CE10": "33901",
                    "INTPTLAT10": "+26.6248",
                    "INTPTLON10": "-81.8701",
                },
                "geometry": {"type": "Polygon", "coordinates": [[]]},
            },
            {
                "type": "Feature",
                "properties": {
                    "ZCTA5CE10": "34102",
                    "INTPTLAT10": "+26.1420",
                    "INTPTLON10": "-81.7948",
                },
                "geometry": {"type": "Polygon", "coordinates": [[]]},
            },
        ],
    }
    p = tmp_path / "fake_fl_zips.geojson"
    p.write_text(json.dumps(data))
    return str(p)


def _mock_geocoder(payload: dict) -> MagicMock:
    m = MagicMock()
    m.raise_for_status = MagicMock()
    m.json.return_value = payload
    return m


# ---------------------------------------------------------------------------
# Test 1 — Known city in Lee County FL
# ---------------------------------------------------------------------------

def test_lee_county_known_city():
    """Fort Myers geocodes to a valid Lee County ZCTA (33xxx / 34xxx range)."""
    with patch("requests.get", return_value=_mock_geocoder(_GEO_FORT_MYERS)):
        result = get_zip_approx("Fort Myers", "Lee County", "FL", _REAL_ZCTA_PATH)

    assert result["zip_is_approx"] is True
    assert result["zip_approx"] is not None
    assert result["zip_approx"].isdigit()
    assert len(result["zip_approx"]) == 5
    # All Lee County ZCTAs fall in the 33xxx / 34xxx ranges
    assert result["zip_approx"][:2] in ("33", "34"), (
        f"Expected a FL ZCTA, got {result['zip_approx']!r}"
    )


# ---------------------------------------------------------------------------
# Test 2 — Known city in Collier County FL
# ---------------------------------------------------------------------------

def test_collier_county_known_city():
    """Naples geocodes to a valid Collier County ZCTA (34xxx range)."""
    with patch("requests.get", return_value=_mock_geocoder(_GEO_NAPLES)):
        result = get_zip_approx("Naples", "Collier County", "FL", _REAL_ZCTA_PATH)

    assert result["zip_is_approx"] is True
    assert result["zip_approx"] is not None
    assert result["zip_approx"].isdigit()
    assert len(result["zip_approx"]) == 5
    assert result["zip_approx"][:2] in ("33", "34"), (
        f"Expected a FL ZCTA, got {result['zip_approx']!r}"
    )


# ---------------------------------------------------------------------------
# Test 3 — Garbage / unknown city -> zip_approx = None, no exception
# ---------------------------------------------------------------------------

def test_garbage_city_returns_none(fake_zcta_path):
    with patch("requests.get", return_value=_mock_geocoder(_GEO_NO_MATCH)):
        result = get_zip_approx("XXXXXXGARBAGE", "Lee County", "FL", fake_zcta_path)

    assert result["zip_approx"] is None
    assert result["zip_is_approx"] is True
    assert "approx_method" in result


# ---------------------------------------------------------------------------
# Test 4 — zip_is_approx is ALWAYS True across every code path
# ---------------------------------------------------------------------------

@pytest.mark.parametrize(
    "city,county,geo_payload",
    [
        ("Fort Myers", "Lee County",    _GEO_FORT_MYERS),   # happy path, county indexed
        ("Naples",     "Collier County", _GEO_NAPLES),       # happy path, county indexed
        ("GARBAGE",    "Lee County",    _GEO_NO_MATCH),      # geocode miss
        ("",           "Unknown County", _GEO_NO_MATCH),     # empty city + unknown county
    ],
)
def test_zip_is_approx_always_true(city, county, geo_payload, fake_zcta_path):
    with patch("requests.get", return_value=_mock_geocoder(geo_payload)):
        result = get_zip_approx(city, county, "FL", fake_zcta_path)
    assert result["zip_is_approx"] is True


# ---------------------------------------------------------------------------
# Test 5 — Caching: geo asset queried only once even across repeated calls
# ---------------------------------------------------------------------------

def test_caching_geo_asset_not_requeried(fake_zcta_path):
    """
    Calling get_zip_approx with the same args twice loads the ZCTA asset exactly
    once. The second call is served entirely from _result_cache.
    """
    with patch.object(
        _mod, "_load_zcta_records", wraps=_mod._load_zcta_records
    ) as spy, patch(
        "requests.get", return_value=_mock_geocoder(_GEO_FORT_MYERS)
    ):
        result_a = get_zip_approx("Fort Myers", "Lee County", "FL", fake_zcta_path)
        result_b = get_zip_approx("Fort Myers", "Lee County", "FL", fake_zcta_path)

    # Same result both times
    assert result_a == result_b
    assert result_a["zip_is_approx"] is True

    # _load_zcta_records called exactly once; second call hit _result_cache first
    assert spy.call_count == 1, (
        f"Expected _load_zcta_records called once, got {spy.call_count}"
    )
