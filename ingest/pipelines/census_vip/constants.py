"""Constants for census_vip pipeline."""
from datetime import date

# Why 10y: same window as FRED G.17 / BLS PPI for cross-macro consistency.
# time= uses ISO-8601 range: "from YYYY-MM" syntax confirmed against live API.
TIME_FROM = "from+2015-01"

def time_to() -> str:
    return date.today().strftime("%Y-%m")

# Seasonally-adjusted annual-rate value in millions $
DATA_TYPE_CODE = "V"
SEASONALLY_ADJ = "yes"

# Category codes verified against live API 2026-05-26
# All use "A" prefix = annual-rate form of the data
CATEGORY_CODES = {
    "AXXXX": "total_construction",
    "A01XX": "residential",
    "ANRXX": "nonresidential",
    "A20IX": "manufacturing",
}

SOURCE_URL = "https://api.census.gov/data/timeseries/eits/vip"
BUCKET = "lake-tier1"
