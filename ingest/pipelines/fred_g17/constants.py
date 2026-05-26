"""Constants for fred_g17 pipeline."""

SERIES_IDS = ["INDPRO", "TCU", "MCUMFN", "IPMAN"]

# Why 10y: aligns with BLS PPI / Census VIP 10-year window; FRED defaults to series start
# (~1919) if unset which inflates Parquet size unnecessarily.
OBSERVATION_START = "2015-01-01"

SOURCE_URL = "https://api.stlouisfed.org/fred/series/observations"
BUCKET = "lake-tier1"
