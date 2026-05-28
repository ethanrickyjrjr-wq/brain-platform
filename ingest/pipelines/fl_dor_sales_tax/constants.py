"""Constants for the FL DOR Form 10 — Taxable Sales pipeline."""

# URL pattern. {start} and {end} are 2-digit calendar years.
# e.g. start=22, end=23 → cy2223 → covers Jan 2022 – Dec 2023.
# Confirmed live: cy0203 through cy2425 (all 200 OK as of 2026-05-28).
FORM10_URL = (
    "https://floridarevenue.com/dataPortal/GTA/Form%2010/"
    "All%20Taxable%20Sales/F10_txsales_cy{start:02d}{end:02d}.xlsx"
)

# Human-readable citation template stored per row.
SOURCE_URL_TMPL = FORM10_URL

TABLE = "fl_dor_sales_tax"

# Counties we ingest. Mapped to their FL DOR county codes (col C of row 8).
# Code "46" = Lee, "21" = Collier — verified from cy2223 file.
DEFAULT_COUNTIES = ["Lee", "Collier"]
COUNTY_CODE_MAP: dict[str, str] = {
    "Lee": "46",
    "Collier": "21",
}

# Earliest available year-pair (Jan 2002 – Dec 2003).
EARLIEST_START_YEAR = 2002

# Sheet structure (verified from cy2223):
#   Row 8:  col C = county code (int), col D = county name
#   Row 12: col A = blank, col B = "Kind Code", cols C+ = "Month YYYY" headers
#   Row 13+: col A = row index (ignore), col B = business type name,
#            cols C+ = taxable_sales_usd (float or None)
HEADER_ROW = 12
DATA_START_ROW = 13
KIND_CODE_COL = 0   # 0-indexed within row cells: col A
BIZ_TYPE_COL = 1    # col B
DATA_START_COL = 2  # col C onward = months
