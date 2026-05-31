"""Constants for the FDLE crime data ingest pipeline.

Two sources:
  - FIBRS (2021–present): Florida Incident-Based Reporting System, one file
    with per-sheet years, County+Agency rows, 12 monthly columns per offense type.
    Verify URL against https://www.fdle.state.fl.us/cjab/fibrs if a run 404s.
  - UCR county property crime (2010–2020): FDLE static content-asset Excel files,
    one per year, county-level annual totals.
    Verify against https://www.fdle.state.fl.us/cjab/ucr/annual-reports/ucr-offense-data
"""
from __future__ import annotations

COUNTIES = ["Lee", "Collier"]

# ── FIBRS (2021–present) ──────────────────────────────────────────────────────
# Single Excel file, one sheet per year. Updated in-place when FDLE adds a year.
# If this 404s, check https://www.fdle.state.fl.us/cjab/fibrs for the new link.
FIBRS_URL = (
    "https://www.fdle.state.fl.us/getContentAsset/"
    "830c3a11-d760-4b29-9afb-0ca57c5348a0/"
    "73aabf56-e6e5-4330-95a3-5f2a270a1d2b/"
    "FIBRS_Offense_Detail_2021-2026.xlsx?language=en"
)
FIBRS_CITATION_URL = "https://www.fdle.state.fl.us/cjab/fibrs"
FIBRS_FIRST_YEAR = 2021

# FIBRS row 2 group header substrings (case-insensitive) → output slug.
# Each matching group header marks the start of a 12-month column block.
# "larceny" matches ALL "Larceny - *" subtypes; their monthly values are summed.
FIBRS_OFFENSE_GROUPS: dict[str, list[str]] = {
    "burglary":           ["burglary"],
    "larceny_theft":      ["larceny"],          # all Larceny-* subtypes combined
    "motor_vehicle_theft": ["motor vehicle theft"],
    "arson":              ["arson"],
}

# ── UCR county property crime (2010–2020) ─────────────────────────────────────
# Hardcoded content-asset URLs from the FDLE UCR offense data archive page.
# FDLE uses opaque UUIDs; these were confirmed live on 2026-05-30.
# If a URL 404s, re-scrape https://www.fdle.state.fl.us/cjab/ucr/annual-reports/ucr-offense-data
UCR_COUNTY_URLS: dict[int, str] = {
    2020: (
        "https://www.fdle.state.fl.us/getContentAsset/"
        "29ee302c-8564-40ac-b63a-e2f273f2aa7d/"
        "73aabf56-e6e5-4330-95a3-5f2a270a1d2b/"
        "Property_Crime_By_County_and_Offense_2020.xlsx?language=en"
    ),
    2019: (
        "https://www.fdle.state.fl.us/getContentAsset/"
        "cf3ae4c0-5360-4919-b342-8c8b463d6406/"
        "73aabf56-e6e5-4330-95a3-5f2a270a1d2b/"
        "Property-Crime-County-Type-2019.xlsx?language=en"
    ),
    2018: (
        "https://www.fdle.state.fl.us/getContentAsset/"
        "54f0a189-ceab-4b81-934c-e3850e3013ac/"
        "73aabf56-e6e5-4330-95a3-5f2a270a1d2b/"
        "Property-Crime-County-Type-2018.xlsx?language=en"
    ),
    2017: (
        "https://www.fdle.state.fl.us/getContentAsset/"
        "77f99634-8c93-450b-b92b-5a9eeef35773/"
        "73aabf56-e6e5-4330-95a3-5f2a270a1d2b/"
        "PROPERTY_17.xlsx?language=en"
    ),
    2016: (
        "https://www.fdle.state.fl.us/getContentAsset/"
        "911b48eb-5d97-44e0-889e-86eeeac57038/"
        "73aabf56-e6e5-4330-95a3-5f2a270a1d2b/"
        "PROPERTY_16.xlsx?language=en"
    ),
    2015: (
        "https://www.fdle.state.fl.us/getContentAsset/"
        "4783b559-6c3b-42be-a84f-21b309d6c341/"
        "73aabf56-e6e5-4330-95a3-5f2a270a1d2b/"
        "PROPERTY_15.xlsx?language=en"
    ),
    2014: (
        "https://www.fdle.state.fl.us/getContentAsset/"
        "cfd94c44-3e1e-4a31-a604-1e5f31553f14/"
        "73aabf56-e6e5-4330-95a3-5f2a270a1d2b/"
        "Property-14.xlsx?language=en"
    ),
    2013: (
        "https://www.fdle.state.fl.us/getContentAsset/"
        "bed07d2d-f2b3-43a9-86e0-bea9d670d10b/"
        "73aabf56-e6e5-4330-95a3-5f2a270a1d2b/"
        "Property-13.xlsx?language=en"
    ),
    2012: (
        "https://www.fdle.state.fl.us/getContentAsset/"
        "0112e97f-96cc-4ee0-8338-76ac2dc8c955/"
        "73aabf56-e6e5-4330-95a3-5f2a270a1d2b/"
        "Property-12.xls?language=en"
    ),
    2011: (
        "https://www.fdle.state.fl.us/getContentAsset/"
        "3da3bee1-3ebc-441e-93cd-5a43d350309b/"
        "73aabf56-e6e5-4330-95a3-5f2a270a1d2b/"
        "Property-11.xls?language=en"
    ),
    2010: (
        "https://www.fdle.state.fl.us/getContentAsset/"
        "8db39834-2e90-4d89-afda-6fd66f3a21d8/"
        "73aabf56-e6e5-4330-95a3-5f2a270a1d2b/"
        "Property-10.xls?language=en"
    ),
}
UCR_CITATION_URL = "https://www.fdle.state.fl.us/cjab/ucr/annual-reports/ucr-offense-data"

EARLIEST_YEAR = min(UCR_COUNTY_URLS)  # 2010

# ── Shared ────────────────────────────────────────────────────────────────────
TABLE = "fdle_crime_swfl"
TIER1_BUCKET = "lake-tier1"
TIER1_PREFIX = "crime"

# Column aliases for UCR county-level files (2010–2020).
# UCR files have annual totals in a simple single-header row; the first match wins.
COL_ALIASES: dict[str, list[str]] = {
    "county":              ["county"],
    "population":          ["population", "pop."],
    "burglary":            ["burglary"],
    "larceny_theft":       ["larceny", "larceny theft", "larceny/theft", "larceny-theft"],
    "motor_vehicle_theft": ["motor vehicle", "motor veh", "mvt"],
    "arson":               ["arson"],
    "total_property":      ["property crime total", "total property", "property crimes", "property total"],
}
