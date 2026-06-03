"""Constants for the swfl_search_demand pipeline.

Source: DataForSEO Google Ads search-volume API (a DEMAND PROXY — "what SWFL
searches for"), NOT our own engagement data. Operator-only roadmap signal.

API contract verified live 2026-06-03 against
https://docs.dataforseo.com/v3/keywords_data-google_ads-search_volume-live/
  POST (HTTP Basic auth) — request body is an ARRAY of task objects.
  keywords: max 1000 per task. Response: tasks[].result[] with keyword,
  search_volume, competition (HIGH/MEDIUM/LOW), competition_index, cpc,
  monthly_searches[]{year, month, search_volume}.
"""
from __future__ import annotations

DATAFORSEO_SEARCH_VOLUME_URL = (
    "https://api.dataforseo.com/v3/keywords_data/google_ads/search_volume/live"
)

# DataForSEO caps a single search_volume task at 1000 keywords (verified).
MAX_KEYWORDS_PER_TASK = 1000

LANGUAGE_CODE = "en"

TABLE = "swfl_search_demand"  # public.swfl_search_demand
TIER1_BUCKET = "lake-tier1"
TIER1_PREFIX = "demand/swfl_search_demand"  # cold NDJSON archive prefix

# SWFL geo targets. We pull each location separately so every row carries which
# SWFL geography its volume describes (the `location` column). Florida is the
# reliable baseline; the metros are best-effort and skipped (with a warning) if
# DataForSEO doesn't resolve the name — see pipeline.run().
#
# location label (stored verbatim in the `location` column)  ->  DataForSEO location_name
# NOTE (Vendor-First, confirm on first live run): DataForSEO matches
# `location_name` against its own locations list exactly. If a metro name misses,
# look it up via /v3/keywords_data/google_ads/locations and switch to the numeric
# `location_code` (more robust than the name). The labels on the left are ours.
SWFL_LOCATIONS: dict[str, str] = {
    "metro:cape-coral-fort-myers": "Fort Myers,Florida,United States",
    "metro:naples-marco-island": "Naples,Florida,United States",
    "state:fl": "Florida,United States",
}
