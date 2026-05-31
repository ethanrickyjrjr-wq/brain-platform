# BLS Occupational Employment and Wage Statistics (OEWS) — SWFL MSA pipeline.
#
# Download page (authoritative): https://www.bls.gov/oes/tables.htm
# Metro area zip: https://www.bls.gov/oes/special-requests/oesm{YY}ma.zip
# Verified live 2026-05-30: HTTP 200, ~40 MB, MSA_M{YYYY}_dl.xlsx inside.
#
# FREIDA (Florida's old state LMI portal) is retired; Florida Insight replaced it
# but is an interactive portal with the same scraping problem. BLS flat files are
# the authoritative source — the state portals only re-presented federal data.

# Download page cited in source attribution
SOURCE_URL = "https://www.bls.gov/oes/tables.htm"

# Zip URL pattern — substitute two-digit year for {YY}
BLS_OEWS_BASE = "https://www.bls.gov/oes/special-requests"

# Target MSAs (BLS area codes)
MSA_CODES: dict[str, str] = {
    "15980": "Cape Coral-Fort Myers, FL",         # Lee County
    "34940": "Naples-Marco Island, FL",            # Collier County
}

# Most recent published survey year.
# BLS releases May YYYY estimates ~April of YYYY+1.
# Update CURRENT_OEWS_YEAR when the next annual release ships.
CURRENT_OEWS_YEAR = 2025

# Years available for --backfill (oldest → newest)
BACKFILL_YEARS = [2021, 2022, 2023, 2024, 2025]

BUCKET = "lake-tier1"
TIER1_PATH_PREFIX = "labor/bls_oews_swfl"
