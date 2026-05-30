"""Constants for the FDLE UCR crime data ingest pipeline."""
from __future__ import annotations

COUNTIES = ["Lee", "Collier"]

# FDLE UCR county offense Excel.
# Verify against https://www.fdle.state.fl.us/FSAC/Crime-Data/UCR-Data-Archive.aspx
# if a run 404s — FDLE updates archive path with each annual release.
FDLE_COUNTY_OFFENSE_URL = (
    "https://www.fdle.state.fl.us/FSAC/docs/UCR/Documents/"
    "{year}/countybytype{year}.xlsx"
)

# Citation URL stored per-row and used in the pack's BrainOutputMetricSource.
FDLE_CITATION_URL = "https://www.fdle.state.fl.us/FSAC/Crime-Data/UCR-Data-Archive.aspx"

# FDLE publishes the prior calendar year with ~6–9 month lag. Earliest Excel
# archive confirmed at FDLE FSAC portal: 2010.
EARLIEST_YEAR = 2010

# public schema — matches existing non-dlt pipeline pattern (fl_dor_sales_tax, fgcu_reri).
TABLE = "fdle_crime_swfl"

TIER1_BUCKET = "lake-tier1"
TIER1_PREFIX = "crime"

# Column alias map: internal slug → list of substrings to match in the FDLE
# header row (case-insensitive). First match per slug wins. FDLE tweaks column
# labels slightly across years — all known variants are listed here.
COL_ALIASES: dict[str, list[str]] = {
    "county":              ["county"],
    "population":          ["population", "pop."],
    "burglary":            ["burglary"],
    "larceny_theft":       ["larceny", "larceny theft", "larceny/theft", "larceny-theft"],
    "motor_vehicle_theft": ["motor vehicle", "motor veh", "mvt"],
    "arson":               ["arson"],
    "total_property":      ["property crime total", "total property", "property crimes", "property total"],
}
