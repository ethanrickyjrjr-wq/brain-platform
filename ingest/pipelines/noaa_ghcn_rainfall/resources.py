import io
import csv
from datetime import datetime, timezone

import dlt
import requests

from .constants import (
    GHCN_S3_BY_YEAR_URL,
    GHCN_COLUMNS,
    ANCHOR_STATIONS,
    ANCHOR_STATION_NAMES,
    TENTHS_MM_PER_INCH,
    MIN_DAY_COUNT,
    BACKFILL_YEARS,
    _current_year,
)

_GHCN_RAINFALL_COLUMNS: dict = {
    "id":           {"data_type": "text",      "nullable": False, "primary_key": True},
    "station_id":   {"data_type": "text",      "nullable": False},
    "station_name": {"data_type": "text",      "nullable": True},
    "county":       {"data_type": "text",      "nullable": False},
    "year":         {"data_type": "bigint",    "nullable": False},
    "annual_in":    {"data_type": "double",    "nullable": False},
    "day_count":    {"data_type": "bigint",    "nullable": False},
    "_ingested_at": {"data_type": "timestamp", "nullable": True},
}


def _fetch_year_prcp(year: int) -> dict[str, float]:
    """
    Download the GHCN by_year CSV for `year` and return a dict mapping
    anchor station_id → total annual PRCP in inches for that year.

    Only PRCP rows for anchor stations that pass QC (blank q_flag) are
    included. VALUE is tenths of mm → inches = VALUE / 254.

    Returns an empty dict if the URL is unreachable or has no data.
    """
    url = GHCN_S3_BY_YEAR_URL.format(year=year)
    resp = requests.get(url, timeout=120)
    resp.raise_for_status()

    # Accumulate per-station daily PRCP totals and day counts.
    station_totals: dict[str, float] = {}
    station_day_counts: dict[str, int] = {}

    reader = csv.DictReader(io.StringIO(resp.text), fieldnames=GHCN_COLUMNS)
    for row in reader:
        sid = row["station_id"].strip()
        if sid not in ANCHOR_STATIONS:
            continue
        if row["element"].strip() != "PRCP":
            continue
        # Drop rows that failed quality control (non-blank q_flag).
        if row["q_flag"].strip():
            continue
        try:
            value_raw = float(row["value"].strip())
        except (ValueError, TypeError):
            continue
        if value_raw < 0:
            # -9999 is the GHCN missing-data sentinel.
            continue

        inches = value_raw / TENTHS_MM_PER_INCH
        station_totals[sid] = station_totals.get(sid, 0.0) + inches
        station_day_counts[sid] = station_day_counts.get(sid, 0) + 1

    # Only keep stations with sufficient day coverage.
    return {
        sid: (total, station_day_counts[sid])
        for sid, total in station_totals.items()
        if station_day_counts.get(sid, 0) >= MIN_DAY_COUNT
    }


@dlt.resource(
    name="noaa_ghcn_rainfall",
    write_disposition="merge",
    primary_key="id",
    columns=_GHCN_RAINFALL_COLUMNS,
)
def noaa_ghcn_rainfall_resource(years: list[int]):
    """
    Fetches NOAA GHCN-Daily annual rainfall totals for SWFL anchor stations
    from the AWS Open Data S3 mirror (no auth required).

    One row per (station, year) — suitable for the refinery source to average
    across stations for the latest complete year. Uses merge+primary_key so
    re-runs are idempotent.
    """
    ingested_at = datetime.now(timezone.utc).isoformat()

    for year in years:
        prcp = _fetch_year_prcp(year)
        for station_id, (annual_in, day_count) in prcp.items():
            yield {
                "id":           f"{station_id}|{year}",
                "station_id":   station_id,
                "station_name": ANCHOR_STATION_NAMES.get(station_id),
                "county":       ANCHOR_STATIONS[station_id],
                "year":         year,
                "annual_in":    round(annual_in, 2),
                "day_count":    day_count,
                "_ingested_at": ingested_at,
            }


def build_years() -> list[int]:
    """Rolling window: current year + (BACKFILL_YEARS - 1) prior complete years."""
    end = _current_year()
    return list(range(end - BACKFILL_YEARS + 1, end + 1))
