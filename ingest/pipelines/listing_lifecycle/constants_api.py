"""Constants for the API-fed listing extractor — SteadyAPI sole spine (RentCast retired 06/30).

Field contract VERIFIED LIVE 2026-06-30 (RULE 0.4): SteadyAPI search returns location.county_fips
as a FULL 5-DIGIT code ("12071") + meta.total for pagination; /nearby-home-values returns
body.properties[].property_id + description.baths (string, e.g. "2.5") for batched baths enrich.
"""

import os

STEADYAPI_BASE = "https://api.steadyapi.com/v1/real-estate"

# Sold-capture (Phase-2 Part A) paid-call budget, per pipeline invocation. Target ~500/mo: Lee + Collier
# run on separate daily crons, so ~8/county-run (8 * 2 counties * 30d ~= 480/mo). Env-overridable for
# tuning once the real departure-vs-recheck yield is observed. 0 disables the hook entirely.
SOLD_CHECK_CAP = int(os.environ.get("SOLD_CHECK_CAP", "8"))

# Neutral internal source identity (no vendor name in the table; the brain CITES the real source).
API_SOURCE_NAME = "api_feed"

# Enumeration seed: query the APIs by city, then self-label every row by its API-returned county FIPS
# (so a city that bleeds into a neighbor county lands under the right county). v1 = Lee + Collier;
# widening is just adding cities here — no code change (capture wide).
SWFL_CITY_SEED = {
    "Lee": [
        "Cape Coral", "Fort Myers", "North Fort Myers", "Lehigh Acres",
        "Bonita Springs", "Estero", "Fort Myers Beach", "Sanibel",
    ],
    "Collier": ["Naples", "Marco Island", "Golden Gate", "Immokalee", "Ave Maria"],
}

# County FIPS we keep (the scope gate; everything else self-drops). 5-digit FL state+county.
IN_SCOPE_FIPS = {"12071": "Lee", "12021": "Collier"}

# RentCast countyFips is the 3-digit county code ("071"); prefix the FL state FIPS to get "12071".
FL_STATE_FIPS = "12"

# Browser-like headers SteadyAPI's Cloudflare requires (ported from lib/listings/steadyapi.ts).
STEADYAPI_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
    "Accept": "application/json",
    "Accept-Language": "en-US,en;q=0.9",
    "Origin": "https://steadyapi.com",
    "Referer": "https://steadyapi.com/",
}

# RentCast/SteadyAPI type strings -> the lifecycle property_type tokens. Unknown -> "other".
PROPERTY_TYPE_MAP = {
    "single family": "single_family", "single-family": "single_family",
    "condo": "condo", "condominium": "condo", "condos": "condo",
    "townhouse": "townhouse", "townhomes": "townhouse",
    "multi-family": "multi_family", "multifamily": "multi_family", "multi family": "multi_family",
    "manufactured": "manufactured", "mobile": "manufactured", "mobile/manufactured": "manufactured",
    "land": "land", "lot": "land", "vacant land": "land", "lots/land": "land",
    "apartment": "multi_family",
}
