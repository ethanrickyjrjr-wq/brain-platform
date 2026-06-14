"""
ZIP approximation utility.

Given (city, county, state) -> nearest ZCTA centroid from the TIGER ZCTA asset.

TIGER source: U.S. Census TIGER/Line 2024 ZCTA5 (vintage embedded in fl_zips.geojson)
  - ZCTA5CE10   : 5-digit ZCTA code
  - INTPTLAT10  : Census internal-point latitude  (label-placement centroid)
  - INTPTLON10  : Census internal-point longitude

City geocoder: U.S. Census Geocoder one-line-address endpoint
  URL: https://geocoding.geo.census.gov/geocoder/locations/onelineaddress
  Free, no API key required.

County fast-path: fixtures/swfl-zip-county.json
  Pre-built county-name -> ZCTA set for 6-county SWFL footprint.
  For any county NOT in that file, all ZCTAs from the TIGER asset are searched.
  No county-specific branching — the lookup logic is fully generic.
"""

from __future__ import annotations

import json
import math
import os
import re
from typing import Optional

import requests

# ---------------------------------------------------------------------------
# Module-level singletons — each loaded at most once per process
# ---------------------------------------------------------------------------
_zcta_records: Optional[list[tuple[str, float, float]]] = None  # (zcta, lat, lon)
_county_zcta_map: Optional[dict[str, frozenset[str]]] = None    # norm_name -> zcta set
_city_coord_cache: dict[tuple[str, str], Optional[tuple[float, float]]] = {}
_result_cache: dict[tuple[str, str, str], dict] = {}

# swfl-zip-county.json lives at <repo-root>/fixtures/; this file is at ingest/utils/.
_CROSSWALK_PATH = os.path.normpath(
    os.path.join(os.path.dirname(__file__), "..", "..", "fixtures", "swfl-zip-county.json")
)

_CENSUS_GEOCODER = (
    "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress"
)


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _norm_county(raw: str) -> str:
    """Lowercase and strip a trailing ' County' suffix."""
    return re.sub(r"\s+county\s*$", "", raw.strip(), flags=re.IGNORECASE).strip().lower()


def _load_zcta_records(zcta_asset_path: str) -> list[tuple[str, float, float]]:
    """
    Parse the TIGER GeoJSON and return (zcta, lat, lon) for every feature.
    Idempotent: the file is opened at most once per process regardless of how many
    times this function is called.
    """
    global _zcta_records
    if _zcta_records is not None:
        return _zcta_records
    records: list[tuple[str, float, float]] = []
    try:
        with open(zcta_asset_path, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        for feature in data.get("features", []):
            props = feature.get("properties", {})
            zcta = props.get("ZCTA5CE10")
            lat_str = props.get("INTPTLAT10")
            lon_str = props.get("INTPTLON10")
            if zcta and lat_str and lon_str:
                try:
                    records.append((zcta, float(lat_str), float(lon_str)))
                except (ValueError, TypeError):
                    pass
    except OSError:
        pass
    _zcta_records = records
    return _zcta_records


def _load_county_zcta_map() -> dict[str, frozenset[str]]:
    """
    Build normalized-county-name -> frozenset[zcta] from swfl-zip-county.json.
    Returns an empty dict if the file is absent (graceful degradation).
    Idempotent: file opened at most once per process.
    """
    global _county_zcta_map
    if _county_zcta_map is not None:
        return _county_zcta_map
    idx: dict[str, set[str]] = {}
    try:
        if os.path.exists(_CROSSWALK_PATH):
            with open(_CROSSWALK_PATH, "r", encoding="utf-8") as fh:
                data = json.load(fh)
            for entry in data.get("entries", []):
                zcta = entry.get("zip")
                if not zcta:
                    continue
                for name in entry.get("county_names", []):
                    key = _norm_county(name)
                    idx.setdefault(key, set()).add(zcta)
    except OSError:
        pass
    _county_zcta_map = {k: frozenset(v) for k, v in idx.items()}
    return _county_zcta_map


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance in kilometres between two WGS-84 points."""
    R = 6371.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = (
        math.sin(dphi / 2) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    )
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _geocode_city(city: str, state: str) -> Optional[tuple[float, float]]:
    """
    Geocode city + state to (lat, lon) via the Census Geocoder API.
    Returns None if the city cannot be matched or the request fails.
    Result is cached per (city, state) for the process lifetime.
    """
    cache_key = (city.strip().lower(), state.strip().lower())
    if cache_key in _city_coord_cache:
        return _city_coord_cache[cache_key]
    result: Optional[tuple[float, float]] = None
    try:
        resp = requests.get(
            _CENSUS_GEOCODER,
            params={
                "address": f"{city}, {state}",
                "benchmark": "Public_AR_Current",
                "format": "json",
            },
            timeout=8,
        )
        resp.raise_for_status()
        matches = resp.json().get("result", {}).get("addressMatches", [])
        if matches:
            coords = matches[0].get("coordinates", {})
            lat, lon = coords.get("y"), coords.get("x")
            if lat is not None and lon is not None:
                result = (float(lat), float(lon))
    except Exception:
        pass
    _city_coord_cache[cache_key] = result
    return result


# ---------------------------------------------------------------------------
# Public interface
# ---------------------------------------------------------------------------

def get_zip_approx(
    city: str,
    county: str,
    state: str,
    zcta_asset_path: str,
) -> dict:
    """
    Best-effort ZCTA approximation for (city, county, state).

    Finds the ZCTA whose Census internal-point centroid (INTPTLAT10/INTPTLON10)
    is geographically closest to the geocoded city centroid.

    County filter (fully generic — no county-specific branching):
      - If county appears in swfl-zip-county.json, candidates are limited to its
        ZCTAs (fast path, O(county_size) search).
      - Otherwise all ZCTAs in zcta_asset_path are searched; the geocoded city
        point will naturally resolve to the nearest ZCTA in the correct county.

    Parameters
    ----------
    city            City or place name (e.g. "Fort Myers", "Immokalee").
    county          County name; "Lee" and "Lee County" are both accepted.
    state           State name or abbreviation (e.g. "FL" or "Florida").
    zcta_asset_path Absolute path to the TIGER ZCTA GeoJSON (from Step 0).

    Returns
    -------
    dict:
        zip_approx    str | None  5-digit ZCTA, or None if no match found.
        zip_is_approx bool        Always True — never authoritative ZIP data.
        approx_method str         Method tag describing how the result was found.
    """
    cache_key = (city.strip().lower(), county.strip().lower(), state.strip().lower())
    if cache_key in _result_cache:
        return _result_cache[cache_key]

    def _miss(method: str) -> dict:
        out = {"zip_approx": None, "zip_is_approx": True, "approx_method": method}
        _result_cache[cache_key] = out
        return out

    # Step 1: load ZCTA centroid table (singleton — file opened once per process).
    all_zctas = _load_zcta_records(zcta_asset_path)
    if not all_zctas:
        return _miss("zcta_asset_empty")

    # Step 2: narrow candidate ZCTAs by county if the fast-path index covers it;
    #         otherwise fall through to the full ZCTA list.
    county_map = _load_county_zcta_map()
    county_key = _norm_county(county)
    county_zcta_set = county_map.get(county_key)  # None => county not in index

    if county_zcta_set is not None:
        candidates = [(z, lat, lon) for z, lat, lon in all_zctas if z in county_zcta_set]
        method_tag = "tiger_zcta_county_indexed_centroid"
    else:
        candidates = all_zctas
        method_tag = "tiger_zcta_all_fl_centroid"

    if not candidates:
        return _miss("no_zctas_for_county")

    # Step 3: geocode city to a lat/lon reference point (cached per city+state).
    city_coord = _geocode_city(city, state)
    if city_coord is None:
        return _miss("city_geocode_failed")

    city_lat, city_lon = city_coord

    # Step 4: pick the nearest ZCTA centroid by haversine distance.
    best_zcta: Optional[str] = None
    best_dist = float("inf")
    for zcta, lat, lon in candidates:
        d = _haversine_km(city_lat, city_lon, lat, lon)
        if d < best_dist:
            best_dist = d
            best_zcta = zcta

    if best_zcta is None:
        return _miss("no_match")

    result = {
        "zip_approx": best_zcta,
        "zip_is_approx": True,
        "approx_method": method_tag,
    }
    _result_cache[cache_key] = result
    return result
