"""market_aggregates orchestrator — SteadyAPI Layer-B market aggregates (realtor.com origin).

Two resources at two cadences (see docs/superpowers/specs/2026-06-30-market-cadence-three-tier-design.md):
  histogram  weekly  (~2 calls)   -> data_lake.listing_price_histogram_swfl  (price-distribution-swfl)
  details    monthly (~57 calls)  -> data_lake.market_details_swfl           (market-temperature-swfl)

`--dry-run` makes ZERO network calls and prints the intended call count. Provenance surfaced by the
brains is realtor.com; SteadyAPI (the access layer) is never surfaced.

Run:
  python -m ingest.pipelines.market_aggregates.pipeline --resource histogram [--dry-run]
  python -m ingest.pipelines.market_aggregates.pipeline --resource details   [--dry-run]
"""
from __future__ import annotations

import argparse
import sys
from datetime import date

from . import db
from .constants import COUNTY_LOCATIONS, swfl_zip_counties
from .resources import fetch_market_details, fetch_price_histogram, intended_call_counts

_HIST_TABLE = "data_lake.listing_price_histogram_swfl"
_HIST_COLS = ["county", "band_min", "band_max", "band_range", "listing_count",
              "total_listings", "status", "captured_date", "source_tag"]
_HIST_CONFLICT = ["county", "band_min", "captured_date"]

_DET_TABLE = "data_lake.market_details_swfl"
_DET_COLS = ["zip_code", "county", "median_sold_price", "median_listing_price", "median_rent_price",
             "median_days_on_market", "median_price_per_sqft", "local_hotness_score",
             "list_to_sold_ratio_pct", "sold_to_rent_ratio", "market_strength", "is_competitive",
             "captured_date", "source_tag"]
_DET_CONFLICT = ["zip_code", "captured_date"]


def run_histogram(*, dry_run: bool = False, today: str | None = None) -> dict:
    captured = today or str(date.today())
    rows: list[dict] = []
    calls = 0
    for county in COUNTY_LOCATIONS:
        res = fetch_price_histogram(county, captured=captured, dry_run=dry_run)
        rows.extend(res["rows"])
        calls += res["calls"]
    n = db.upsert(_HIST_TABLE, _HIST_COLS, _HIST_CONFLICT, rows, dry_run=dry_run)
    intended = intended_call_counts()["histogram"]
    print(f"[budget] histogram = {calls if not dry_run else intended} price-histogram calls "
          f"(weekly; ~{intended}/run)", flush=True)
    print(f"[done] histogram rows={n} dry_run={dry_run}", flush=True)
    return {"rows": n, "calls": calls}


def run_details(*, dry_run: bool = False, today: str | None = None) -> dict:
    captured = today or str(date.today())
    zips = swfl_zip_counties()
    rows: list[dict] = []
    calls = 0
    for zip_code, county in zips:
        res = fetch_market_details(zip_code, county, captured=captured, dry_run=dry_run)
        if res["row"]:
            rows.append(res["row"])
        calls += res["calls"]
    n = db.upsert(_DET_TABLE, _DET_COLS, _DET_CONFLICT, rows, dry_run=dry_run)
    intended = intended_call_counts()["details"]
    print(f"[budget] details = {calls if not dry_run else intended} housing-market-details calls "
          f"(monthly; ~{intended}/run)", flush=True)
    print(f"[done] details rows={n} dry_run={dry_run}", flush=True)
    return {"rows": n, "calls": calls}


def main(argv: list[str] | None = None) -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    ap = argparse.ArgumentParser(description="SteadyAPI market aggregates (histogram | details).")
    ap.add_argument("--resource", choices=["histogram", "details"], required=True)
    ap.add_argument("--dry-run", action="store_true",
                    help="fetch nothing (zero network calls), print the intended call count")
    args = ap.parse_args(argv)
    if args.resource == "histogram":
        run_histogram(dry_run=args.dry_run)
    else:
        run_details(dry_run=args.dry_run)
    return 0


if __name__ == "__main__":
    sys.exit(main())
