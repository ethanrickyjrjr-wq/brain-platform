"""
SVN Florida SWFL market report pipeline. STUB — URL unverified.

Writes to data_lake.marketbeat_swfl with source_name='svn_florida'.
Sector target: retail + investment sales where C&W SWFL coverage is absent.

# URL VERIFIED 2026-06-09: https://svncp.com/
# Next: obtain sample SWFL PDF, build extract.py, implement parse table, activate GHA.
"""
from __future__ import annotations

import argparse
import sys


def main() -> None:
    parser = argparse.ArgumentParser(description="SVN Florida SWFL pipeline (stub)")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    print(
        "SVN Florida pipeline not yet implemented — URL unverified.\n"
        "See pipeline.py VERIFY_URL comment for activation steps.",
        file=sys.stderr,
    )
    sys.exit(1)


if __name__ == "__main__":
    main()
