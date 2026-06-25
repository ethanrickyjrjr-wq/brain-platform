"""John R. Wood active residential listings pipeline — region-wide SWFL seed.

Usage:
  python -m ingest.pipelines.jrw_listings.pipeline
  python -m ingest.pipelines.jrw_listings.pipeline --dry-run
  python -m ingest.pipelines.jrw_listings.pipeline --county Collier

Lands data_lake.active_listings_residential (source_name='john_r_wood'). The licensed RESO feed
(swfl_mls/nabor) drops into the same table later — this scrape is the "for now."
Design: docs/superpowers/specs/2026-06-25-jrw-active-listings-residential-design.md
"""
from __future__ import annotations

import argparse
import os
import sys

from ingest.lib.guards import assert_min_rows, assert_vs_baseline

from .distill import current_row_count, normalize, upsert_rows
from .extract import SWFL_COUNTIES, fetch_listings_for_county

# Bootstrap-safe floor (raise toward 0.9 * observed in cadence_registry after the first seed).
_MIN_ROWS = int(os.environ.get("JRW_MIN_ROWS", "1"))


def run(args: argparse.Namespace) -> None:
    counties = SWFL_COUNTIES
    if args.county:
        counties = [c for c in counties if c.lower() == args.county.lower()]
        if not counties:
            print(
                f"No SWFL county matches --county {args.county!r}. Available: {SWFL_COUNTIES}",
                file=sys.stderr,
            )
            sys.exit(1)

    # Baseline BEFORE this run (for the collapse alert). 0 in dry-run / on bootstrap.
    prior = 0 if args.dry_run else current_row_count()

    # Upsert PER COUNTY (idempotent merge), not once at the end: a later county's 403/throttle must
    # never discard the counties already gathered — the bug that lost the first 4,691-row seed.
    total_raw = 0
    total_written = 0
    for county in counties:
        print(f"[county] {county}", flush=True)
        raw = fetch_listings_for_county(county)
        print(f"  {len(raw)} in-scope listings", flush=True)
        total_raw += len(raw)
        normed = normalize(raw)
        if normed:
            written = upsert_rows(normed, dry_run=args.dry_run)
            total_written += written
            print(f"  {written} rows {'would be ' if args.dry_run else ''}upserted", flush=True)

    # Fail loud only on a TOTAL-empty scrape: every county returning nothing means the IP is
    # WAF-blocked or the card markup changed. Exit 0 here would be silent fake-green (the enemy);
    # exit 1 so heal-cron-failure triages it. A partial result (some counties landed) is success.
    if total_raw == 0:
        print(
            "ERROR: 0 listings from all SWFL counties — JRW scrape failed for every county "
            "(WAF block on the runner IP, or .listing__link markup changed). See warnings above.",
            file=sys.stderr,
            flush=True,
        )
        sys.exit(1)

    # Volume guards as end-of-run ALERTS (the per-county upsert already landed; merge = no wipe):
    # a sudden collapse vs the prior load is the tell of a partial block degrading the result set.
    assert_min_rows(total_raw, _MIN_ROWS, label="jrw_listings")
    assert_vs_baseline(total_raw, prior, label="jrw_listings")

    print(
        f"\nDone. {total_written} rows {'would be ' if args.dry_run else ''}upserted "
        f"to data_lake.active_listings_residential (across {len(counties)} counties).",
        flush=True,
    )


def main() -> None:
    # Force UTF-8 on stdout/stderr so a Windows cp1252 console can't crash a print of a crawl4ai
    # error string (which carries a U+2192 arrow). GHA/ubuntu is already UTF-8; this is local-safe.
    for stream in (sys.stdout, sys.stderr):
        reconfig = getattr(stream, "reconfigure", None)
        if reconfig:
            reconfig(encoding="utf-8", errors="replace")
    parser = argparse.ArgumentParser(description="JRW active residential listings pipeline")
    parser.add_argument("--dry-run", action="store_true", help="Extract only, no DB write")
    parser.add_argument("--county", metavar="NAME", help="Limit to one SWFL county, e.g. 'Collier'")
    run(parser.parse_args())


if __name__ == "__main__":
    main()
