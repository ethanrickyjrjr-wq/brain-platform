"""Tier-1 pipeline — fred_listing_swfl (Realtor.com listing series for Lee + Collier MSAs).

Pulls 8 monthly FRED series (active listings, DOM, list price, new listings)
for the Fort Myers-Cape Coral MSA (15980) and Naples MSA (34940) and writes
a monthly Parquet snapshot to:
  lake-tier1/market/fred_listing_swfl/{YYYY-MM}.parquet

Each run overwrites the current month's file with the full history as of today.
See docs/standards/pipeline-freshness.md for the freshness contract.
"""
from __future__ import annotations

import argparse
import sys
from datetime import date

from ingest.lib.storage_uploader import upload_parquet
from ingest.lib.tier1_inventory import upsert_inventory_row

from .constants import BUCKET, SOURCE_URL
from .resources import fetch_fred_listing_swfl


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="FRED Realtor.com listing series ingest for Lee + Collier MSAs."
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Fetch and validate only; skip Storage upload.",
    )
    args = parser.parse_args(argv)

    rows = fetch_fred_listing_swfl()
    print(f"fred_listing_swfl: {len(rows)} rows fetched.")

    if args.dry_run:
        print("fred_listing_swfl: --dry-run, skipping upload.")
        if rows:
            print("first row:", rows[0])
            print("last row:", rows[-1])
        return 0

    today = date.today()
    path = f"market/fred_listing_swfl/{today:%Y-%m}.parquet"
    byte_size = upload_parquet(BUCKET, path, rows)
    upsert_inventory_row(
        bucket=BUCKET,
        path=path,
        vintage=today.isoformat(),
        byte_size=byte_size,
        pack_id=None,
        source_url=SOURCE_URL,
    )
    print(f"fred_listing_swfl: uploaded {len(rows)} rows to {BUCKET}/{path}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
