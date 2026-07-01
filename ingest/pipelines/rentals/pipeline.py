"""rentals orchestrator — SteadyAPI /rentals-search active rental inventory (realtor.com origin).

Weekly sweep, both counties, county-form only (see constants.py docstring — the per-city Lee fallback
in the original plan was proven unnecessary live 07/01: county-form paginates cleanly to completion and
covers MORE than the proposed 7-city list). `--dry-run` makes ZERO network calls and prints the
approximate intended page count. Provenance surfaced by the brain is realtor.com; SteadyAPI (the access
layer) is never surfaced.

Run:
  python -m ingest.pipelines.rentals.pipeline [--dry-run]
"""
from __future__ import annotations

import argparse
import sys
from datetime import date

from . import db
from .constants import COUNTY_LOCATIONS
from .resources import fetch_rentals_county, intended_call_counts

_TABLE = "data_lake.rental_listings_swfl"
_COLS = ["property_id", "county", "zip_code", "city", "address_line", "property_type",
          "price_min", "price_max", "beds_min", "beds_max", "baths_min", "baths_max",
          "sqft_min", "sqft_max", "captured_date", "source_tag"]
_CONFLICT = ["property_id", "captured_date"]


def run(*, dry_run: bool = False, today: str | None = None) -> dict:
    captured = today or str(date.today())
    rows: list[dict] = []
    calls = 0
    per_county: dict[str, int] = {}
    for county in COUNTY_LOCATIONS:
        res = fetch_rentals_county(county, captured=captured, dry_run=dry_run)
        rows.extend(res["rows"])
        calls += res["calls"]
        per_county[county] = res["calls"]
    n = db.upsert(_TABLE, _COLS, _CONFLICT, rows, dry_run=dry_run)
    intended = sum(intended_call_counts().values())
    print(f"[budget] rentals = {calls if not dry_run else intended} rentals-search calls "
          f"(weekly; ~{intended}/run; per-county={per_county if not dry_run else intended_call_counts()})",
          flush=True)
    print(f"[done] rentals rows={n} dry_run={dry_run}", flush=True)
    return {"rows": n, "calls": calls}


def main(argv: list[str] | None = None) -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    ap = argparse.ArgumentParser(description="SteadyAPI active rental listing inventory (weekly sweep).")
    ap.add_argument("--dry-run", action="store_true",
                    help="fetch nothing (zero network calls), print the intended call count")
    args = ap.parse_args(argv)
    run(dry_run=args.dry_run)
    return 0


if __name__ == "__main__":
    sys.exit(main())
