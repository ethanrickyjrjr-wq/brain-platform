"""
Crexi active listings pipeline — weekly scrape for Estero + Fort Myers Beach.

Usage:
  python -m ingest.pipelines.crexi_listings.pipeline
  python -m ingest.pipelines.crexi_listings.pipeline --dry-run
  python -m ingest.pipelines.crexi_listings.pipeline --corridor "Fort Myers Beach"
"""
from __future__ import annotations

import argparse
import sys

from .extract import SEARCH_TARGETS, fetch_listings_for_city
from .distill import normalize, upsert_rows


def run(args: argparse.Namespace) -> None:
    targets = SEARCH_TARGETS
    if args.corridor:
        targets = [
            t for t in targets
            if args.corridor.lower() in t["city"].lower()
        ]
        if not targets:
            print(
                f"No search targets match --corridor {args.corridor!r}. "
                f"Available: {[t['city'] for t in SEARCH_TARGETS]}",
                file=sys.stderr,
            )
            sys.exit(1)

    total_raw = 0
    total_written = 0
    for target in targets:
        print(f"[search] {target['label']}", flush=True)
        raw_rows = fetch_listings_for_city(target)
        total_raw += len(raw_rows)
        print(f"  {len(raw_rows)} raw listings extracted", flush=True)

        normed = normalize(raw_rows)
        print(f"  {len(normed)} rows normalized (dropped {len(raw_rows) - len(normed)} invalid)", flush=True)

        n = upsert_rows(normed, dry_run=args.dry_run)
        total_written += n

    print(
        f"\nDone. {total_raw} raw listings, {total_written} rows "
        f"{'would be ' if args.dry_run else ''}upserted.",
        flush=True,
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Crexi active listings pipeline")
    parser.add_argument("--dry-run", action="store_true", help="Extract only, no DB write")
    parser.add_argument("--corridor", metavar="CITY", help="Limit to a specific city, e.g. 'Estero'")
    run(parser.parse_args())


if __name__ == "__main__":
    main()
