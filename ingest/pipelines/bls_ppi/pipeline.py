"""Tier 1 storage pipeline — bls_ppi (BLS Producer Price Index - Construction).

See docs/standards/pipeline-freshness.md for the freshness contract.
"""
from __future__ import annotations

import argparse
import sys
from datetime import date

from ingest.lib.storage_uploader import upload_parquet
from ingest.lib.tier1_inventory import upsert_inventory_row

from .constants import BUCKET, SOURCE_URL
from .resources import fetch_bls_ppi


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="BLS PPI ingest pipeline.")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Fetch and validate only; skip Storage upload.",
    )
    args = parser.parse_args(argv)

    rows = fetch_bls_ppi()
    print(f"bls_ppi: {len(rows)} rows fetched.")

    if args.dry_run:
        print("bls_ppi: --dry-run, skipping upload.")
        if rows:
            print("first row:", rows[0])
        return 0

    today = date.today()
    path = f"macro/bls_ppi/{today:%Y-%m}.parquet"
    byte_size = upload_parquet(BUCKET, path, rows)
    upsert_inventory_row(
        bucket=BUCKET,
        path=path,
        vintage=today.isoformat(),
        byte_size=byte_size,
        pack_id=None,
        source_url=SOURCE_URL,
    )
    print(f"bls_ppi: uploaded {len(rows)} rows to {BUCKET}/{path}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
