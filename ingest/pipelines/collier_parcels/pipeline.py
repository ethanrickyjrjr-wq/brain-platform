"""Collier County parcel ingest entry point (FDOR Statewide Cadastral).

Run with: python -m ingest.pipelines.collier_parcels.pipeline [--dry-run]

Writes Collier parcels (CO_NO=21) to data_lake.collier_parcels (Tier 2). Gives
the properties-collier-value brain its Save-Our-Homes gap + parcel count — the
parcel-grain parity with properties-lee-value that the Redfin market source can't.
"""
from __future__ import annotations

import argparse
import sys

from ingest.lib.arcgis_paginator import arcgis_count

from .constants import COLLIER_CADASTRAL_URL, COLLIER_CO_NO_WHERE
from .resources import fetch_collier_parcels, ingest_collier_parcels


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Collier County FDOR cadastral parcel ingest.")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Fetch + normalize only; print count + sample; skip dlt write.",
    )
    args = parser.parse_args(argv)

    if args.dry_run:
        canonical = arcgis_count(COLLIER_CADASTRAL_URL, where=COLLIER_CO_NO_WHERE)
        rows = fetch_collier_parcels()
        print(f"collier_parcels dry-run: {len(rows)} parcels (server count {canonical})")
        if rows:
            print("first row:", rows[0])
            homesteaded = sum(1 for r in rows if (r.get("jv_hmstd") or 0) > 0)
            print(f"homesteaded (jv_hmstd>0): {homesteaded}")
        return 0

    ingest_collier_parcels()
    return 0


if __name__ == "__main__":
    sys.exit(main())
