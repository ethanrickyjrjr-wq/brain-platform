"""Constants for the rentals pipeline — SteadyAPI /rentals-search (realtor.com origin).

VERIFIED LIVE 2026-07-01 (RULE 0.4 vendor-first, real calls on our key):
- /rentals-search takes location= + offset=, returns 20 rows/page (meta.total/returned/limit/offset).
  body[] = {property_id, price:{min,max,display}, permalink, photo_url, has_specials, promotions,
  description:{name,type,beds:{min,max,display},baths:{min,max,display},sqft:{min,max,display}},
  address:{line,city,state,zip,full}}. No lat/lon on rental rows (address.zip is the grain key).
- County-form works for BOTH counties, paginates cleanly to completion (checked offset up to 5210 on
  Lee, returns 0 past total, no 500 at depth). Lee County, FL -> 200, total ~5,211. Collier County, FL
  -> 200, total ~4,182. The 06/30 "Lee county-form 500s" note was a transient blip, not reproducible on
  4 retries this session — a per-Lee-city sweep is UNNECESSARY and would under-count (7-city sum 4,895
  < county-form 5,211 — misses smaller Lee towns like North Fort Myers, Pine Island, Gateway).

SteadyAPI is the ACCESS LAYER — never surfaced in a citation/source_tag/prose. Provenance = realtor.com
(the data origin). Mirrors ingest/pipelines/market_aggregates/constants.py.
"""
from __future__ import annotations

STEADYAPI_BASE = "https://api.steadyapi.com/v1/real-estate"

# Neutral surfaced origin (the consuming brain cites this; the access layer is never named).
SOURCE_TAG = "realtor.com"

# Cloudflare-fronting browser headers (ported from market_aggregates/constants.py).
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

# County-form location slugs — verified live 07/01: both counties paginate cleanly to completion,
# no city-sweep fallback needed (see module docstring).
COUNTY_LOCATIONS = {"Lee": "Lee County, FL", "Collier": "Collier County, FL"}

# /rentals-search pages at 20/row (NOT /search's 200 — a different, smaller-page endpoint).
PAGE_SIZE = 20
