"""
Lee & Associates SWFL market report pipeline. STUB — URL unverified.

Writes to data_lake.marketbeat_swfl with source_name='lee_associates'.
Sector target: office (primary) + retail (where available).
These sectors are not covered by C&W MarketBeat for SWFL.

# VERIFY_URL: run a live check on lee-associates.com/research before activating.
# After URL is confirmed:
#   1. Download sample PDF
#   2. Implement parse_lee_table() in extract.py
#   3. Move cadence registry entry from not_yet_running: to pipelines:
#   4. Add GHA schedule to ingest-cre-local-brokers.yml
"""
from __future__ import annotations

import argparse
import sys


def main() -> None:
    parser = argparse.ArgumentParser(description="Lee & Associates SWFL pipeline (stub)")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    print(
        "Lee & Associates pipeline not yet implemented — URL unverified.\n"
        "See extract.py VERIFY_URL comment for activation steps.",
        file=sys.stderr,
    )
    sys.exit(1)


if __name__ == "__main__":
    main()
