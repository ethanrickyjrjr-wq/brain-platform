"""Constants for the hurdat2_fl DuckDB ingest pipeline.

HURDAT2 = NOAA NHC Atlantic Hurricane Database (best-track). One row per
6-hour observation per named storm. Includes pre-modern records (1851+).

This pipeline filters to storms that touched Florida's bounding box at any
point in their lifetime (lat 24.0-31.5, lon -87.75 to -79.75). The brain
(`hurricane-tracks-fl`) then computes within-50mi-of-SWFL-county-centroid
metrics over the full per-storm tracks in DuckDB SQL.
"""

# NHC HURDAT2 index — annual files like hurdat2-1851-2024-040425.txt.
# Filename includes a publish date suffix; pipeline scrapes for the latest.
NHC_BASE_URL = "https://www.nhc.noaa.gov/data/hurdat/"
NHC_FILE_PREFIX = "hurdat2-"  # excludes Pacific (hurdat2-nepac-*)
NHC_FILE_SUFFIX = ".txt"

# Florida bounding box (deg). Generous on north + south to capture brushers.
FL_LAT_MIN = 24.0
FL_LAT_MAX = 31.5
FL_LON_MIN = -87.75
FL_LON_MAX = -79.75

# Tier 1 Storage destination
BUCKET = "lake-tier1"
PARQUET_PATH = "environmental/hurdat2_fl.parquet"
PARQUET_TARGET = f"s3://{BUCKET}/{PARQUET_PATH}"

# Pack consumer + audit-trail
PACK_ID = "hurricane-tracks-fl"

# Saffir-Simpson windspeed cuts (kt, lower-bound inclusive).
# 64-73 kt = Cat 1 lower-bound is 64kt; we use NHC's published cuts.
SAFFIR_CUTS_KT = [
    (157, 5),
    (130, 4),
    (111, 3),
    (96, 2),
    (74, 1),
]

# HURDAT2 sentinel for unknown numeric fields (-999 across the spec).
HURDAT2_MISSING_SENTINEL = -999
