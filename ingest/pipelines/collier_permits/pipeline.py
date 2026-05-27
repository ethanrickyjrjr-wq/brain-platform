"""Collier County building permits dlt pipeline.

Writes to data_lake.collier_building_permits via merge on permit_number.
Issued series only. Source: monthly XLSX from colliercountyfl.gov.
"""
from __future__ import annotations

import argparse
import io
from datetime import date, timedelta
from typing import Iterable

import dlt
import pandas as pd

from .fetcher import discover_issued_reports, download_month
from .geocoder import assign_corridor, geocode_batch, load_collier_centroids
from .normalizer import normalize_df


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


def _previous_month() -> tuple[int, int]:
    today = date.today()
    first_of_this = today.replace(day=1)
    last_of_prev = first_of_this - timedelta(days=1)
    return last_of_prev.year, last_of_prev.month


def run_pipeline(year: int, month: int) -> None:
    xlsx_bytes, filename = download_month(year, month)
    df = pd.read_excel(io.BytesIO(xlsx_bytes), engine="openpyxl", header=1)
    rows = normalize_df(df, source_file=filename)

    addresses = [r["site_address"] for r in rows if r["site_address"]]
    geo = geocode_batch(addresses)
    centroids = load_collier_centroids()

    for r in rows:
        addr = r["site_address"]
        lat_lon = geo.get(addr) if addr else None
        lat, lon = lat_lon if lat_lon else (None, None)
        r["lat"] = lat
        r["lon"] = lon
        r["corridor"] = assign_corridor(lat, lon, centroids)
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
        xlsx_bytes, filename = download_month(year, month)
        df = pd.read_excel(io.BytesIO(xlsx_bytes), engine="openpyxl", header=1)
        rows = normalize_df(df, source_file=filename)
        print(f"collier_permits dry-run: {len(rows)} rows from {filename} (geocode + dlt skipped)")
        return 0

    run_pipeline(year, month)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
