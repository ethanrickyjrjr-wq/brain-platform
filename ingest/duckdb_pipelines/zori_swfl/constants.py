"""Zillow ZORI SWFL rent-index tracker — Tier 1 ingest constants.

Source: Zillow Research public CSV — ZIP-level smoothed all-homes rent index.
Grain: ZIP × month (wide-format source, melted to long via DuckDB UNPIVOT).
Filter: STATE = 'FL' + Metro IN (Cape Coral, Naples, Punta Gorda, North Port) MSAs.
Output: s3://lake-tier1/market/zori_swfl.parquet

PACK_ID is set to the consuming brain from day one per Data Tier Policy §2 —
the rentals-swfl pack ships in the same PR as this pipeline.
"""

from ingest.lib.swfl_metros import SWFL_METRO_SUBSTRINGS  # noqa: F401  (re-export for pipeline)

# ── Source ───────────────────────────────────────────────────────────────────
#
# Zillow Research publishes the ZIP-level rent index at the stable public path
# below. Filename is the ZIP-level, all-homes (SFR + Condo + Multifamily),
# smoothed series — verified against the local cold-storage copy at
# data/external/zillow/zori_zip_rent_index.csv (145 cols: 9 metadata + 136
# monthly from 2015-01-31 through 2026-04-30, 8,316 national rows).
#
# If Zillow renames the file in a future research-data revamp the pipeline
# will fail loudly on the download step (HTTP 404) — preferred to silent drift.

ZORI_CSV_URL = (
    "https://files.zillowstatic.com/research/public_csvs"
    "/zori/Zip_zori_uc_sfrcondomfr_sm_month.csv"
)

# ── Tier 1 Storage targets ────────────────────────────────────────────────────

BUCKET = "lake-tier1"
PARQUET_PATH = "market/zori_swfl.parquet"
PARQUET_TARGET = f"s3://{BUCKET}/{PARQUET_PATH}"

# Consuming brain ships in the same PR — set the inventory pointer from day 1.
PACK_ID: str | None = "rentals-swfl"

# ── Geographic filter ─────────────────────────────────────────────────────────

STATE_CODE = "FL"
REGION_TYPE = "zip"

# Metadata columns to preserve through the UNPIVOT (everything not month-shaped).
# Names match the ZORI CSV header verbatim (case-sensitive).
METADATA_COLUMNS: tuple[str, ...] = (
    "RegionID",
    "SizeRank",
    "RegionName",
    "RegionType",
    "StateName",
    "State",
    "City",
    "Metro",
    "CountyName",
)
