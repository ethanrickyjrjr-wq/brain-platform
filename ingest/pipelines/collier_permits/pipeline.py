"""Collier County building permits dlt pipeline.

Writes to data_lake.collier_building_permits via merge on permit_number.
Issued series only. Source: monthly XLSX from colliercountyfl.gov.
"""
from __future__ import annotations

import argparse
import io
import json
from datetime import date, timedelta
from pathlib import Path
from typing import Iterable

import dlt
import pandas as pd

from ingest.lib.guards import assert_min_rows

from .fetcher import discover_issued_reports, download_latest_issued, download_month
from .geocoder import assign_corridor, geocode_batch, load_collier_centroids
from .normalizer import normalize_df

_SCOPE_FIXTURE = Path(__file__).resolve().parents[3] / "fixtures" / "swfl-zip-county.json"


def _load_in_scope_zips() -> frozenset:
    """Load the 6-county SWFL ZIP scope from the authoritative fixture."""
    with open(_SCOPE_FIXTURE) as f:
        data = json.load(f)
    return frozenset(e["zip"] for e in data["entries"])

# Collier publishes the prior month's XLSX mid-month; tolerate up to this many
# days of lag before treating a missing month as an actual error.
_PUBLISH_LAG_TOLERANCE_DAYS = 60

# Volume guard floor — mirrors ingest/cadence_registry.yaml collier_permits
# expected_rows_min (90% of the 4,975 confirmed 2026-05-31). A pull below this
# (e.g. the WAF proxy serving a truncated file, or a parse break) aborts the
# merge instead of silently landing a partial month.
_EXPECTED_ROWS_MIN = 4477


@dlt.resource(
    name="collier_building_permits",
    primary_key="permit_number",
    write_disposition="merge",
    columns={
        "date_issued": {"data_type": "date"},
        "date_applied": {"data_type": "date"},
    },
)
def permits_resource(rows: Iterable[dict] | None = None):
    """Emit normalized permit rows for dlt to merge into data_lake."""
    for row in rows or []:
        yield row


def _fallback_latest(year: int, month: int) -> tuple[bytes, str] | None:
    """Return the latest published XLSX when the requested month isn't out yet.

    Returns None (caller should re-raise) if the gap is too large to be a
    normal publish lag — something is actually wrong.
    """
    reports = discover_issued_reports()
    if not reports:
        return None
    latest = reports[0]
    requested_first = date(year, month, 1)
    latest_first = date(latest.year, latest.month, 1)
    lag_days = (requested_first - latest_first).days
    if 0 < lag_days <= _PUBLISH_LAG_TOLERANCE_DAYS:
        print(
            f"collier_permits: {year}-{month:02d} not yet published; "
            f"falling back to latest available ({latest.year}-{latest.month:02d}). "
            "This is normal before mid-month publish."
        )
        return download_latest_issued()
    return None


def _previous_month() -> tuple[int, int]:
    today = date.today()
    first_of_this = today.replace(day=1)
    last_of_prev = first_of_this - timedelta(days=1)
    return last_of_prev.year, last_of_prev.month


def run_pipeline(year: int, month: int) -> None:
    try:
        xlsx_bytes, filename = download_month(year, month)
    except ValueError:
        result = _fallback_latest(year, month)
        if result is None:
            raise
        xlsx_bytes, filename = result
    df = pd.read_excel(io.BytesIO(xlsx_bytes), engine="openpyxl", header=1)
    rows = normalize_df(df, source_file=filename)
    assert_min_rows(len(rows), _EXPECTED_ROWS_MIN, "collier_building_permits")

    addresses = [r["site_address"] for r in rows if r["site_address"]]
    geo = geocode_batch(addresses)
    centroids = load_collier_centroids()
    in_scope_zips = _load_in_scope_zips()

    for r in rows:
        addr = r["site_address"]
        geo_result = geo.get(addr) if addr else None
        lat, lon, raw_zip = geo_result if geo_result else (None, None, None)
        r["lat"] = lat
        r["lon"] = lon
        r["corridor"] = assign_corridor(lat, lon, centroids)
        # Scope-gate: only write zip_code if it's in the 6-county SWFL footprint (MOAT).
        r["zip_code"] = raw_zip if (raw_zip and raw_zip in in_scope_zips) else None
        r["_ingest_metadata"] = {
            "source": "collier_county_official",
            "format": "xlsx",
            "series": "issued",
        }

    pipeline = dlt.pipeline(
        pipeline_name="collier_permits",
        destination="postgres",
        dataset_name="data_lake",
    )
    pipeline.run(permits_resource(rows))
    print(f"collier_permits: loaded {len(rows)} rows from {filename}")


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Collier County building permits ingest")
    p.add_argument(
        "--month",
        metavar="YYYY-MM",
        help="Month to ingest (default: previous calendar month)",
    )
    p.add_argument(
        "--dry-run",
        action="store_true",
        help="Download and parse only; skip geocode and dlt write",
    )
    args = p.parse_args(argv)

    if args.month:
        year_str, month_str = args.month.split("-")
        year, month = int(year_str), int(month_str)
    else:
        year, month = _previous_month()

    if args.dry_run:
        try:
            xlsx_bytes, filename = download_month(year, month)
        except ValueError:
            result = _fallback_latest(year, month)
            if result is None:
                raise
            xlsx_bytes, filename = result
        df = pd.read_excel(io.BytesIO(xlsx_bytes), engine="openpyxl", header=1)
        rows = normalize_df(df, source_file=filename)
        print(f"collier_permits dry-run: {len(rows)} rows from {filename} (geocode + dlt skipped)")
        return 0

    run_pipeline(year, month)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
