"""FL DBPR Contractor Licenses ingest pipeline.

Downloads FL Department of Business & Professional Regulation (DBPR) bulk
extract CSVs for Construction Board (06) and Electrical Board (08), filters
to Lee County (code 46) + Collier County (code 21), and writes to Postgres.

Writes:
  Tier-2 — dlt merge into data_lake.fl_dbpr_licenses (on license_number)
  Tier-2 — dlt replace into data_lake.fl_dbpr_applicants (full replace)

Usage:
  python -m ingest.pipelines.fl_dbpr_licenses.pipeline [--dry-run]

Environment (required for live writes):
  DESTINATION__POSTGRES__CREDENTIALS — dlt Postgres connection URI
"""
from __future__ import annotations

import argparse
import sys
from collections import Counter
from datetime import datetime, timezone

import dlt

from .constants import APPLICANTS_URL, COL_APP_COUNTY, COUNTY_FILTER, DBPR_CITATION_URL, LICENSES_URLS
from .resources import (
    _assert_applicant_volume,
    _is_header_row,
    _map_applicant_rows,
    _stream_csv,
    dbpr_licenses_resource,
    dbpr_applicants_resource,
    MIN_ROW_LEN,
)


def run(*, dry_run: bool = False) -> tuple[int, int]:
    """Download DBPR bulk CSVs and ingest into Postgres.

    Returns (license_row_count, applicant_row_count).
    In dry-run mode: fetches + prints samples, skips all DB writes.
    """
    print("fl_dbpr_licenses: downloading license CSVs...")
    license_rows: list[dict] = []

    for url, board_no in LICENSES_URLS:
        from .constants import COUNTY_FILTER, COL_COUNTY, COL_LICENSE_NO
        raw_rows = _stream_csv(url)
        print(f"  Board {board_no}: {len(raw_rows)} total rows from CSV")
        if raw_rows:
            print(f"  Board {board_no}: first raw row ({len(raw_rows[0])} cols): {raw_rows[0][:5]}")
        matched = 0
        for row in raw_rows:
            if _is_header_row(row):
                continue
            if len(row) < MIN_ROW_LEN:
                continue
            if row[COL_COUNTY].strip() not in COUNTY_FILTER:
                continue
            if not row[COL_LICENSE_NO].strip():
                continue
            license_rows.append({"_board": board_no, "_raw": row})
            matched += 1
        print(f"  Board {board_no}: {matched} Lee/Collier rows matched")

    print(f"fl_dbpr_licenses: downloading applicants from {APPLICANTS_URL}...")
    raw_app_rows = _stream_csv(APPLICANTS_URL)
    print(f"  Applicants: {len(raw_app_rows)} total rows from CSV")
    if raw_app_rows:
        print(f"  Applicants first raw row ({len(raw_app_rows[0])} cols): {raw_app_rows[0][:5]}")
    ingested_at = datetime.now(timezone.utc).isoformat()
    app_rows = _map_applicant_rows(raw_app_rows, ingested_at)  # Lee+Collier, mapped
    print(f"  Applicants: {len(app_rows)} Lee/Collier rows after county filter")

    if dry_run:
        print(f"\nDRY RUN — {len(license_rows)} license rows (Lee+Collier), "
              f"{len(app_rows)} applicant rows (Lee+Collier)")
        print("\n--- Sample license rows (first 6) ---")
        for r in license_rows[:6]:
            print(f"  board={r['_board']} | {r['_raw']}")

        print("\n=== APPLICANT LAYOUT RE-VERIFY (constr_app.csv) ===")
        len_dist = Counter(len(r) for r in raw_app_rows)
        print(f"  row-length distribution: {dict(len_dist)}  (expect all 15)")
        cc = Counter(
            r[COL_APP_COUNTY].strip() for r in raw_app_rows
            if len(r) > COL_APP_COUNTY and r[COL_APP_COUNTY].strip() in COUNTY_FILTER
        )
        print(f"  SWFL county_code counts: Lee(46)={cc.get('46', 0)} "
              f"Collier(21)={cc.get('21', 0)} total={sum(cc.values())}")
        print("  probed 2026-06-13: Lee 6,031 / Collier 2,696 / 8,727")
        print("  Positions: OCC_CODE=0 OCC_DESC=1 FIRST=2 MID=3 LAST=4 SUFFIX=5 ADDR1=6 "
              "ADDR2=7 ADDR3=8 CITY=9 STATE=10 ZIP=11 COUNTY=12 PHONE=13 EXT=14")
        print("\n  Running volume guard (total + per-county floors + city anchors)...")
        _assert_applicant_volume(app_rows)  # raises VolumeGuardError on collapse / scheme drift
        print(f"  GUARD PASSED — {len(app_rows)} SWFL applicant rows would be written.")
        return len(license_rows), len(app_rows)

    print("\nfl_dbpr_licenses: running dlt pipeline (licenses)...")
    pipeline = dlt.pipeline(
        pipeline_name="fl_dbpr_licenses",
        destination="postgres",
        dataset_name="data_lake",
    )

    load_info = pipeline.run(dbpr_licenses_resource())
    load_info.raise_on_failed_jobs()
    print(f"  Licenses: dlt merge complete — {len(license_rows)} rows matched filters")

    print("fl_dbpr_licenses: running dlt pipeline (applicants)...")
    load_info2 = pipeline.run(dbpr_applicants_resource())
    load_info2.raise_on_failed_jobs()
    print(f"  Applicants: dlt replace complete — {len(app_rows)} rows")

    return len(license_rows), len(app_rows)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="FL DBPR Contractor License ingest — Lee + Collier counties."
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Fetch and print samples only; skip all DB writes.",
    )
    args = parser.parse_args(argv)

    mode = "dry-run" if args.dry_run else "live"
    print(f"fl_dbpr_licenses: starting ({mode}) ...")

    license_count, app_count = run(dry_run=args.dry_run)
    print(f"\nDone — {license_count} license rows, {app_count} applicant rows.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
