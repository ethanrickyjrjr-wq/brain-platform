"""FL DEO / CareerSource Florida weekly job postings ingest pipeline.

Scrapes online job posting counts by NAICS supersector for Lee + Collier counties
from CareerSource Florida / DEO OSPA. Writes:
  Tier-1 — NDJSON archive in Supabase Storage (lake-tier1/labor/fl_deo_job_postings/)
  Tier-2 — dlt merge into data_lake.fl_deo_job_postings (Postgres)

Usage:
  python -m ingest.pipelines.fl_deo_job_postings.pipeline [--dry-run]

Environment (all required for live writes):
  FIRECRAWL_API_KEY                  — primary scrape vendor
  SPIDER_API_KEY                     — fallback scrape vendor (optional)
  SUPABASE_URL                       — for Tier-1 Storage upload
  SUPABASE_SERVICE_KEY               — for Tier-1 Storage upload
  DESTINATION__POSTGRES__CREDENTIALS — dlt Postgres connection URI
"""
from __future__ import annotations

import argparse
import sys
from datetime import date

import dlt

from ingest.lib.storage_uploader import upload_ndjson
from ingest.lib.tier1_inventory import upsert_inventory_row

from .constants import BUCKET, OSPA_URL, SOURCE_URL, TIER1_PATH_PREFIX
from .resources import fetch_raw_rows, fl_deo_job_postings_resource, parse_rows


def _tier1_path(ref_date: date) -> str:
    year, week, _ = ref_date.isocalendar()
    return f"{TIER1_PATH_PREFIX}/{year}-W{week:02d}.ndjson"


def run() -> None:
    raw = fetch_raw_rows()
    rows = parse_rows(raw)

    if not rows:
        raise RuntimeError(
            "fl_deo_job_postings: zero rows parsed — "
            "CareerSource FL / DEO OSPA page structure may have changed. "
            f"Verify source URL: {SOURCE_URL} and OSPA URL: {OSPA_URL}"
        )

    # ── Tier-1: NDJSON archive ────────────────────────────────────────────────
    today = date.today()
    t1_path = _tier1_path(today)
    byte_size = upload_ndjson(BUCKET, t1_path, rows)
    upsert_inventory_row(
        bucket=BUCKET,
        path=t1_path,
        vintage=today.isoformat(),
        byte_size=byte_size,
        pack_id="labor-demand-swfl",
        source_url=SOURCE_URL,
    )
    print(f"fl_deo_job_postings: Tier-1 NDJSON uploaded → {BUCKET}/{t1_path} ({byte_size:,} bytes).")

    # ── Tier-2: dlt → Postgres data_lake ─────────────────────────────────────
    pipeline = dlt.pipeline(
        pipeline_name="fl_deo_job_postings",
        destination="postgres",
        dataset_name="data_lake",
    )
    load_info = pipeline.run(fl_deo_job_postings_resource())
    load_info.raise_on_failed_jobs()
    print(f"fl_deo_job_postings: Tier-2 dlt load complete — {len(rows)} rows → data_lake.fl_deo_job_postings.")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="FL DEO / CareerSource Florida weekly job postings ingest pipeline."
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Fetch and parse only; skip Tier-1 Storage upload and dlt write.",
    )
    args = parser.parse_args(argv)

    if args.dry_run:
        raw = fetch_raw_rows()
        rows = parse_rows(raw)
        print(f"fl_deo_job_postings dry-run: {len(rows)} rows parsed from {len(raw)} raw extracts.")
        for r in rows[:5]:
            print(" ", r)
        if len(rows) > 5:
            print(f"  ... ({len(rows) - 5} more)")
        return 0

    run()
    return 0


if __name__ == "__main__":
    sys.exit(main())
