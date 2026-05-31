"""BLS OEWS SWFL MSA ingest pipeline.

Downloads BLS Occupational Employment and Wage Statistics (OEWS) metro area
data for Cape Coral-Fort Myers (15980) and Naples-Marco Island (34940).
Major occupation groups only (O_GROUP='major').

Writes:
  Tier-1 — NDJSON archive in Supabase Storage (lake-tier1/labor/bls_oews_swfl/{year}.ndjson)
  Tier-2 — dlt merge into data_lake.bls_oews_swfl (Postgres)

Usage:
  python -m ingest.pipelines.bls_oews_swfl.pipeline [--year YYYY] [--backfill] [--dry-run]

Environment (required for live writes):
  SUPABASE_URL                       — Tier-1 Storage upload
  SUPABASE_SERVICE_KEY               — Tier-1 Storage upload
  DESTINATION__POSTGRES__CREDENTIALS — dlt Postgres connection URI
"""
from __future__ import annotations

import argparse
import sys

import dlt

from ingest.lib.storage_uploader import upload_ndjson
from ingest.lib.tier1_inventory import upsert_inventory_row

from .constants import (
    BACKFILL_YEARS,
    BUCKET,
    CURRENT_OEWS_YEAR,
    SOURCE_URL,
    TIER1_PATH_PREFIX,
)
from .resources import bls_oews_swfl_resource, download_oews_zip, parse_oews_rows


def _tier1_path(ref_year: int) -> str:
    return f"{TIER1_PATH_PREFIX}/{ref_year}.ndjson"


def run_year(ref_year: int, *, dry_run: bool = False) -> int:
    """Download and ingest one OEWS survey year. Returns row count."""
    print(f"bls_oews_swfl: fetching ref_year={ref_year}...")
    zip_bytes = download_oews_zip(ref_year)
    rows = parse_oews_rows(zip_bytes, ref_year)

    if not rows:
        raise RuntimeError(
            f"bls_oews_swfl: zero rows parsed for ref_year={ref_year}. "
            f"Check MSA codes in constants.py and BLS download at {SOURCE_URL}."
        )

    if dry_run:
        print(f"bls_oews_swfl dry-run: {len(rows)} rows for {ref_year}.")
        for r in rows[:6]:
            print(" ", r)
        if len(rows) > 6:
            print(f"  ... ({len(rows) - 6} more)")
        return len(rows)

    # Tier-1: NDJSON archive
    t1_path = _tier1_path(ref_year)
    byte_size = upload_ndjson(BUCKET, t1_path, rows)
    upsert_inventory_row(
        bucket=BUCKET,
        path=t1_path,
        vintage=str(ref_year),
        byte_size=byte_size,
        pack_id="labor-demand-swfl",
        source_url=SOURCE_URL,
    )
    print(f"bls_oews_swfl: Tier-1 uploaded -> {BUCKET}/{t1_path} ({byte_size:,} bytes).")

    # Tier-2: dlt → Postgres
    pipeline = dlt.pipeline(
        pipeline_name="bls_oews_swfl",
        destination="postgres",
        dataset_name="data_lake",
    )
    load_info = pipeline.run(bls_oews_swfl_resource(ref_year))
    load_info.raise_on_failed_jobs()
    print(f"bls_oews_swfl: Tier-2 complete -- {len(rows)} rows for {ref_year} -> data_lake.bls_oews_swfl.")
    return len(rows)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="BLS OEWS SWFL MSA ingest pipeline."
    )
    parser.add_argument(
        "--year",
        type=int,
        default=CURRENT_OEWS_YEAR,
        help="OEWS survey year to ingest (default: %(default)s).",
    )
    parser.add_argument(
        "--backfill",
        action="store_true",
        help="Ingest all years in BACKFILL_YEARS (%(default)s).",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Fetch and parse only; skip Tier-1 upload and dlt write.",
    )
    args = parser.parse_args(argv)

    years = BACKFILL_YEARS if args.backfill else [args.year]
    total = 0
    for year in years:
        total += run_year(year, dry_run=args.dry_run)
    print(f"bls_oews_swfl: done -- {total} rows across {len(years)} year(s).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
