from datetime import datetime, timezone

# NOAA GHCN-Daily is mirrored on AWS Open Data — no auth, no token.
# Verified: inventory last-modified 2026-06-03; by_year files update daily.
# Use csv/by_year/{YYYY}.csv NOT csv/by_station/ (by_station lags ~4 months).
GHCN_S3_BY_YEAR_URL = "https://noaa-ghcn-pds.s3.amazonaws.com/csv/by_year/{year}.csv"

# Column order in the by_year CSV (no header row):
#   ID, DATE(YYYYMMDD), ELEMENT, VALUE, M-FLAG, Q-FLAG, S-FLAG, OBS-TIME
GHCN_COLUMNS = ["station_id", "date", "element", "value", "m_flag", "q_flag", "s_flag", "obs_time"]

# Anchor stations — verified 2026-06-05:
#   USW00012835  Fort Myers Page Field AP  (Lee)    1892-present, 2024: 365 days / 80.5 in
#   USW00012894  Fort Myers SW FL Regional (Lee)    1998-present
#   USW00012897  Naples Municipal AP       (Collier) 2002-present
#   USC00086078  Naples (COOP)             (Collier) 1942-present, current to 2026-05-30
ANCHOR_STATIONS: dict[str, str] = {
    "USW00012835": "Lee",
    "USW00012894": "Lee",
    "USW00012897": "Collier",
    "USC00086078": "Collier",
}

ANCHOR_STATION_NAMES: dict[str, str] = {
    "USW00012835": "Fort Myers Page Field AP",
    "USW00012894": "Fort Myers SW FL Regional (RSW)",
    "USW00012897": "Naples Municipal AP",
    "USC00086078": "Naples COOP",
}

# VALUE is tenths of millimetres; divide by 254 to get inches.
TENTHS_MM_PER_INCH = 254

# Minimum days with valid PRCP readings for a station-year to be considered
# "complete" (≥300 of 365/366 days). Mirrors the plan doc spec.
MIN_DAY_COUNT = 300

# How many calendar years to backfill on the initial load.
# A rolling 3-year window covers the current year + 2 prior complete years.
BACKFILL_YEARS = 3


def _current_year() -> int:
    return datetime.now(timezone.utc).year
