"""Constants for the market_aggregates pipeline — SteadyAPI Layer-B market aggregates.

VERIFIED LIVE 2026-06-30 (RULE 1 vendor-first, real calls on our key):
- /price-histogram takes location="County, FL" (county-scale works: "Lee County, FL" -> HTTP 200,
  meta.total_listings=22,887, 40 bands) and returns body[] = {range, min_price, max_price, count}.
  `status` MUST be an array param (status[]=for_sale); an empty string 422s. Omitting it defaults to
  for_sale + ready_to_build.
- /housing-market-details takes zipcode= and returns body.market_metrics (median_sold/listing/rent,
  DOM, price_per_sqft) + body.market_temperature (local_hotness_score) + body.derived_metrics
  (list_to_sold_ratio_percentage, sold_to_rent_ratio, market_strength). ZIP 33901 -> sold 320000,
  rent 1350, sold_to_rent 19.75 (the net-new yield: price ÷ annual rent).

SteadyAPI is the ACCESS LAYER — never surfaced in a citation/source_tag/prose. Provenance =
realtor.com (the data origin).
"""
from __future__ import annotations

import json
from pathlib import Path

STEADYAPI_BASE = "https://api.steadyapi.com/v1/real-estate"

# Neutral surfaced origin (the consuming brain cites this; the access layer is never named).
SOURCE_TAG = "realtor.com"

# Cloudflare-fronting browser headers (ported from lib/listings/steadyapi.ts + listing_lifecycle).
STEADYAPI_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
    "Accept": "application/json",
    "Accept-Language": "en-US,en;q=0.9",
    "Origin": "https://steadyapi.com",
    "Referer": "https://steadyapi.com/",
}

# Hard rate cap verified 06/30 (429 above 15 req/sec). The client throttles below this.
RATE_LIMIT_RPS = 15

# County-scale location slugs for /price-histogram (verified: "Lee County, FL" -> 200, 40 bands).
COUNTY_LOCATIONS = {"Lee": "Lee County, FL", "Collier": "Collier County, FL"}

# For-sale only (excludes ready_to_build new-construction) — matches our listing_state for-sale scope.
HISTOGRAM_STATUS = "for_sale"

_REPO_ROOT = Path(__file__).resolve().parents[3]
_ZIP_FIXTURE = _REPO_ROOT / "fixtures" / "swfl-zip-county.json"
_IN_SCOPE_COUNTY_FIPS = {"12071": "Lee", "12021": "Collier"}


def swfl_zip_counties() -> list[tuple[str, str]]:
    """(zip_code, county) for every in-scope Lee/Collier ZIP. Scope source is the Census 2020
    ZCTA-county relationship fixture (fixtures/swfl-zip-county.json) — the SOLE county authority per
    CLAUDE.md. Sorted for deterministic call order."""
    data = json.loads(_ZIP_FIXTURE.read_text(encoding="utf-8"))
    out: list[tuple[str, str]] = []
    for e in data.get("entries", []):
        fips = e.get("primary_county")
        if fips in _IN_SCOPE_COUNTY_FIPS:
            out.append((str(e["zip"]), _IN_SCOPE_COUNTY_FIPS[fips]))
    return sorted(set(out))
