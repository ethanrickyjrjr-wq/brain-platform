"""Constants for bls_ppi pipeline."""
from datetime import datetime

SERIES_IDS = ["PCU236221236221", "PCU236211236211"]

# Why 10y: BLS POST caps at 20 years; match FRED G.17 / Census VIP 10-year window.
# PCU236221236221 = Single-family home construction PPI
# PCU236211236211 = Multi-family home construction PPI
def current_year_window() -> tuple[str, str]:
    now = datetime.now()
    return str(now.year - 9), str(now.year)

SOURCE_URL = "https://api.bls.gov/publicAPI/v2/timeseries/data/"
BUCKET = "lake-tier1"
