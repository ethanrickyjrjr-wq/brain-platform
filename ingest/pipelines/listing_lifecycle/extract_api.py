"""API extractor for the listing lifecycle — SteadyAPI sole spine.

SteadyAPI /v1/real-estate/search is the primary feed: address (permalink slug), price, beds,
sqft, lot, lat/lon, county_fips (5-digit), photo_url, status, flags, source_type.

Budget-bomb fix (audited 06/30): baths enrich in BATCHES via /nearby-home-values (clustered by
lat/lon, ~25-100 properties' baths per call) instead of one /property-tax-history + one
/similar-homes call PER new listing (the old design — 2 calls/listing, ~42,000 calls/sweep,
4x the monthly cap). Enrichment only runs for property_ids not already in `known_ids` (threaded
from the prior scan's persisted `property_id` column), and `dry_run=True` skips the network
calls entirely so `--dry-run` is actually safe to run (the old dry-run still fired the full
enrich storm because it lived inside the unconditional scan, before the dry_run check).

Field contract VERIFIED LIVE 2026-06-30 (RULE 0.4): SteadyAPI location.county_fips is full
5-digit ("12071"); paginates via meta.total; /nearby-home-values returns body.properties[] with
property_id + description.baths (string, e.g. "2.5") — a direct batch lookup, no per-property call.
"""
from __future__ import annotations

import os
import re
from typing import Any

import requests

from ingest.pipelines.listing_lifecycle.address_key import address_key
from ingest.pipelines.listing_lifecycle.constants_api import (
    IN_SCOPE_FIPS,
    PROPERTY_TYPE_MAP,
    STEADYAPI_BASE,
    STEADYAPI_HEADERS,
    SWFL_CITY_SEED,
)

_PERMALINK_ZIP = re.compile(r"_(\d{5})_")

_SA_PAGE = 200   # SteadyAPI page size (meta.returned/limit = 200)
_MAX_PAGES = 60  # backstop (~30k listings) — real cities exhaust far sooner

# Batched baths enrichment (the budget-bomb fix): one /nearby-home-values call covers every new
# listing within ~2mi of a grid cell, instead of one call per listing.
_ENRICH_RADIUS = "2mi"
_ENRICH_LIMIT = 100
_ENRICH_GRID = 0.02       # ~2km cells at SWFL latitude — clusters new listings before calling
_MAX_ENRICH_CALLS = 60    # hard backstop: even a worst-case spread can't multiply past this


# ----------------------------------------------------------------------------- pure helpers

def map_property_type(raw: str | None) -> str:
    return PROPERTY_TYPE_MAP.get((raw or "").strip().lower(), "other")


def _num(v: Any) -> float | None:
    try:
        return float(v) if v is not None and v != "" else None
    except (TypeError, ValueError):
        return None


def _int(v: Any) -> int | None:
    f = _num(v)
    return None if f is None else int(f)


def _iso_date(v: Any) -> str | None:
    return v[:10] if isinstance(v, str) and len(v) >= 10 else None


# ----------------------------------------------------------------------------- pure parser

def parse_steadyapi(raw: dict, city: str, state: str) -> dict | None:
    """One SteadyAPI search record -> the wide row shape. Street + zip parsed from the permalink slug.
    Property type derived: lot + no beds = land. Returns None without identity or out of SWFL scope.
    `property_id` is a REAL persisted column (not stripped) — it's what makes `known_ids` possible."""
    pid = raw.get("property_id")
    if not pid:
        return None
    permalink = raw.get("permalink") or ""
    last = permalink.split("/")[-1]
    parts = last.split("_")
    street = (parts[0].replace("-", " ") if parts else "").strip()
    zm = _PERMALINK_ZIP.search(permalink)
    zip_code = zm.group(1) if zm else next((p for p in parts if p.isdigit() and len(p) == 5), "")
    loc = raw.get("location") or {}
    county_fips = loc.get("county_fips")
    if county_fips not in IN_SCOPE_FIPS:
        return None
    desc = raw.get("description") or {}
    beds = _int(desc.get("beds"))
    lot_sqft = _num(desc.get("lot_sqft"))
    ptype = "land" if (beds is None and lot_sqft) else "single_family"
    price = raw.get("price") or {}
    flags = raw.get("flags") or {}
    return {
        "street_address": street or None,
        "city": city,
        "zip_code": zip_code or None,
        "state": state,
        "county": IN_SCOPE_FIPS[county_fips],
        "county_fips": county_fips,
        "list_price": _int(price.get("amount")),
        "beds": beds,
        "baths": None,
        "sqft": _int(desc.get("sqft")),
        "lot_acres": (lot_sqft / 43560.0) if lot_sqft else None,
        "property_type": ptype,
        "listing_id": str(pid),
        "sale_or_rent": "sale",
        "photo_url": raw.get("photo_url") or None,
        "lat": _num(loc.get("lat")),
        "lon": _num(loc.get("lon")),
        "mls_number": None,
        "mls_name": raw.get("source_type"),
        "listing_type": None,
        "listed_date": None,
        "days_on_market": None,
        "property_id": str(pid),
        "status": raw.get("status"),
        "reduced_amount": _int(price.get("reduced_amount")),
        "flag_pending": bool(flags.get("is_pending")),
        "flag_contingent": bool(flags.get("is_contingent")),
        "flag_coming_soon": bool(flags.get("is_coming_soon")),
        "flag_foreclosure": bool(flags.get("is_foreclosure")),
        "flag_new_construction": bool(flags.get("is_new_construction")),
        "flag_price_reduced": bool(flags.get("is_price_reduced")),
        "flag_new_listing": bool(flags.get("is_new_listing")),
    }


def _cluster_by_latlon(rows: list[dict], grid: float = _ENRICH_GRID) -> list[tuple[float, float]]:
    """Pure: bucket rows onto a coarse lat/lon grid, one query point per occupied cell — keeps
    enrichment call count roughly proportional to geographic spread, not row count."""
    seen: dict[tuple[int, int], tuple[float, float]] = {}
    for r in rows:
        lat, lon = r.get("lat"), r.get("lon")
        if lat is None or lon is None:
            continue
        cell = (round(lat / grid), round(lon / grid))
        seen.setdefault(cell, (lat, lon))
    return list(seen.values())


# ----------------------------------------------------------------------------- fetchers (network)
# Each fetcher returns (raw_rows, ok). `ok` is the completeness signal the coverage guard needs:
# True  = paginated to NATURAL exhaustion (a short/empty page, or reached meta.total) — trustworthy.
# False = a GAP: no key, non-200, bad body, network error, or _MAX_PAGES backstop — may be truncated.

def fetch_steadyapi_city(city: str, state: str = "FL", key: str | None = None) -> tuple[list[dict], bool, int]:
    """Enumerate one city via SteadyAPI (location slug 'City-Name_FL', offset += 200 until meta.total).
    Returns (rows, ok, pages_fetched) — pages_fetched is the real call count for budget logging."""
    key = key or os.environ.get("PHOTOS_API")
    if not key or not city:
        return [], False, 0
    slug = f"{city.strip().replace(' ', '-')}_{state}"
    out: list[dict] = []
    total: int | None = None
    for page in range(_MAX_PAGES):
        params = {"location": slug, "offset": page * _SA_PAGE}
        try:
            r = requests.get(f"{STEADYAPI_BASE}/search", params=params,
                             headers={**STEADYAPI_HEADERS, "Authorization": f"Bearer {key}"}, timeout=30)
            pages = page + 1
            if r.status_code != 200:
                return out, False, pages
            data = r.json()
            body = data.get("body") if isinstance(data, dict) else None
            if not isinstance(body, list):
                return out, False, pages
            if not body:
                return out, True, pages
            out.extend(body)
            total = (data.get("meta") or {}).get("total", total)
            if total is not None and (page + 1) * _SA_PAGE >= total:
                return out, True, pages
            if len(body) < _SA_PAGE:
                return out, True, pages
        except Exception:
            return out, False, page + 1
    return out, False, _MAX_PAGES


def enrich_baths_batched(rows: list[dict], known_ids: set[str], *, dry_run: bool = False) -> dict[str, Any]:
    """In-place: batch-fill baths for NEW listings (property_id not in known_ids) via clustered
    /nearby-home-values calls. Land rows are skipped (baths is meaningless there; Phase 5 parks
    that type). `dry_run=True` runs the same clustering math with ZERO network calls — this is
    what makes `--dry-run` safe; the old per-property enrich_new fired live calls unconditionally."""
    new_rows = [
        r for r in rows
        if r.get("property_id") and r["property_id"] not in known_ids
        and r.get("property_type") != "land" and r.get("lat") is not None and r.get("lon") is not None
    ]
    clusters = _cluster_by_latlon(new_rows)
    calls_needed = min(len(clusters), _MAX_ENRICH_CALLS)
    if dry_run or not new_rows:
        return {"new_count": len(new_rows), "calls": calls_needed, "baths_filled": 0}

    key = os.environ.get("PHOTOS_API")
    if not key:
        return {"new_count": len(new_rows), "calls": 0, "baths_filled": 0}

    by_pid = {r["property_id"]: r for r in new_rows}
    calls = 0
    filled = 0
    for lat, lon in clusters:
        if calls >= _MAX_ENRICH_CALLS:
            break
        try:
            r = requests.get(
                f"{STEADYAPI_BASE}/nearby-home-values",
                params={"lat": lat, "lon": lon, "radius": _ENRICH_RADIUS, "limit": _ENRICH_LIMIT},
                headers={**STEADYAPI_HEADERS, "Authorization": f"Bearer {key}"},
                timeout=30,
            )
            calls += 1
            if r.status_code != 200:
                continue
            body = (r.json() or {}).get("body") or {}
            for prop in body.get("properties") or []:
                pid = str(prop.get("property_id") or "")
                target = by_pid.get(pid)
                if target is None or target.get("baths") is not None:
                    continue
                baths = (prop.get("description") or {}).get("baths")
                if baths is None:
                    continue
                try:
                    target["baths"] = float(baths)
                    filled += 1
                except (TypeError, ValueError):
                    pass
        except Exception:
            continue
    return {"new_count": len(new_rows), "calls": calls, "baths_filled": filled}


def scan_county_api(county: str, known_ids: set[str] | None = None, *, dry_run: bool = False) -> dict[str, Any]:
    """SteadyAPI-only: enumerate every seed city, parse + scope-filter, batch-enrich new listings.
    Returns the coverage-guard payload pipeline.py consumes: {rows, exhausted, count, last_status,
    county_total, search_calls, enrich_calls}. County is COMPLETE only if every city's pull reached
    natural exhaustion. `dry_run=True` still fires the (cheap, ~106-call) search sweep — that's the
    real page count the gate needs — but skips the (expensive, multiplying) enrich network calls."""
    cities = SWFL_CITY_SEED.get(county, [])
    sa_rows: list[dict] = []
    all_ok = True
    search_calls = 0
    for city in cities:
        sa_raw, sa_ok, pages = fetch_steadyapi_city(city)
        all_ok = all_ok and sa_ok
        search_calls += pages
        sa_rows.extend(p for p in (parse_steadyapi(x, city, "FL") for x in sa_raw) if p)
    rows = [r for r in sa_rows if r.get("county") == county]
    enrich_stats = enrich_baths_batched(rows, known_ids or set(), dry_run=dry_run)
    return {
        "rows": rows, "exhausted": all_ok, "count": len(rows),
        "last_status": 200 if all_ok else 429, "county_total": len(rows),
        "search_calls": search_calls,
        "enrich_calls": enrich_stats["calls"],
        "enrich_new_count": enrich_stats["new_count"],
        "enrich_baths_filled": enrich_stats["baths_filled"],
    }
