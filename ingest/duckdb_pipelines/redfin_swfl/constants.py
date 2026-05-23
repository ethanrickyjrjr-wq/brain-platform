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

# Redfin's PARENT_METRO_REGION substrings for all four SWFL MSAs.
# Cape Coral-Fort Myers = Lee County; Naples-Marco Island = Collier County;
# Punta Gorda = Charlotte County; North Port-Sarasota-Bradenton = Sarasota County.
# Glades and Hendry counties are outside Redfin's MSA coverage (rural/untracked).
SWFL_METRO_SUBSTRINGS = [
    "Cape Coral",
    "Naples",
    "Punta Gorda",
    "North Port",
]
