"""
SVN Florida SWFL market report pipeline. STUB — URL unverified.

Writes to data_lake.marketbeat_swfl with source_name='svn_florida'.
Sector target: retail + investment sales where C&W SWFL coverage is absent.

# VERIFY_URL: confirm active report URL before building extractor.
# Candidates: https://svnfloridacommercial.com  or  https://swfl.svn.com
# After URL confirmed: build extract.py, implement parse table, activate GHA.
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
