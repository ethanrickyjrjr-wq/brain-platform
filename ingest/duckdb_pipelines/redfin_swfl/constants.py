"""Redfin SWFL market tracker — Tier 1 ingest constants.

Source: Redfin public S3, zip_code_market_tracker.tsv000.gz
Grain: ZIP × month × property_type
Filter: Lee County (Cape Coral MSA) + Collier County (Naples MSA)
Output: s3://lake-tier1/market/redfin_swfl.parquet

No consuming brain yet — PACK_ID is None until redfin-swfl pack ships.
"""

# ── Source ───────────────────────────────────────────────────────────────────

REDFIN_ZIP_URL = (
    "https://redfin-public-data.s3.us-west-2.amazonaws.com"
    "/redfin_market_tracker/zip_code_market_tracker.tsv000.gz"
)

# ── Tier 1 Storage targets ────────────────────────────────────────────────────

BUCKET = "lake-tier1"
PARQUET_PATH = "market/redfin_swfl.parquet"
PARQUET_TARGET = f"s3://{BUCKET}/{PARQUET_PATH}"

# Set to "redfin-swfl" when the consuming brain PR ships.
PACK_ID: str | None = None

# ── Geographic filter ─────────────────────────────────────────────────────────

STATE_CODE = "FL"

# Shared SWFL MSA substrings — single source of truth for every Tier 1 ZIP
# ingest pipeline (redfin_swfl, zori_swfl, …). See module docstring for the
# Glades/Hendry rationale.
from ingest.lib.swfl_metros import SWFL_METRO_SUBSTRINGS  # noqa: E402, F401
