"""Constants for fred_listing_swfl pipeline."""

# Realtor.com® Housing Market listing series on FRED.
# Grain: MSA-level, monthly. No ZIP equivalent exists.
# 15980 = Fort Myers-Cape Coral, FL MSA (Lee County).
# 34940 = Naples-Immokalee-Marco Island, FL MSA (Collier County).
SERIES_MAP: dict[str, dict] = {
    "ACTLISCOU15980": {"area": "lee",     "metric": "active_listing_count",  "msa_code": "15980"},
    "ACTLISCOU34940": {"area": "collier", "metric": "active_listing_count",  "msa_code": "34940"},
    "MEDDAYONMAR15980": {"area": "lee",     "metric": "median_days_on_market", "msa_code": "15980"},
    "MEDDAYONMAR34940": {"area": "collier", "metric": "median_days_on_market", "msa_code": "34940"},
    "MEDLISPRI15980": {"area": "lee",     "metric": "median_list_price",     "msa_code": "15980"},
    "MEDLISPRI34940": {"area": "collier", "metric": "median_list_price",     "msa_code": "34940"},
    "NEWLISCOU15980": {"area": "lee",     "metric": "new_listing_count",     "msa_code": "15980"},
    "NEWLISCOU34940": {"area": "collier", "metric": "new_listing_count",     "msa_code": "34940"},
}

# Realtor.com data starts July 2016.
OBSERVATION_START = "2016-07-01"

SOURCE_URL = "https://fred.stlouisfed.org/categories/32287"
BUCKET = "lake-tier1"
