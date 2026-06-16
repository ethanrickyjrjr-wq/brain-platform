"""DBPR Press Releases ingest pipeline.

Scrapes the DBPR press-release listing pages (myfloridalicense.com/press-releases/)
via Firecrawl, parses full article text from the listing markdown (articles are
rendered inline — no per-article scrape needed), and upserts raw rows into
public.dbpr_press_releases.

A separate enrichment step (--enrich-only or run after ingest) calls Sonnet to
fill: summary, topics, affected_industries, geographic_mentions, is_swfl_relevant.

Usage:
  python -m ingest.pipelines.dbpr_press_releases.pipeline          # weekly (pages 1-2)
  python -m ingest.pipelines.dbpr_press_releases.pipeline --pages 5
  python -m ingest.pipelines.dbpr_press_releases.pipeline --backfill  # all 30 pages
  python -m ingest.pipelines.dbpr_press_releases.pipeline --enrich-only
  python -m ingest.pipelines.dbpr_press_releases.pipeline --dry-run

Environment:
  FIRECRAWL_API_KEY                  — required for scrape
  ANTHROPIC_API_KEY                  — required for --enrich-only
  DESTINATION__POSTGRES__CREDENTIALS — psycopg3 connection URI (required unless --dry-run)
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from typing import Any

import psycopg

from ingest.lib.crawl4ai_client import fetch_page_markdown
from ingest.lib.storage_uploader import _upload_bytes  # type: ignore[attr-defined]
from ingest.lib.tier1_inventory import upsert_inventory_row

from .constants import (
    BACKFILL_PAGES,
    BASE_URL,
    DEFAULT_PAGES,
    PAGE_URL,
    TABLE,
    TIER1_BUCKET,
    TIER1_PREFIX,
)
from .enricher import run_enrichment
from .parser import parse_listing_page

Row = dict[str, Any]

# ── DB ─────────────────────────────────────────────────────────────────────────

_UPSERT_SQL = f"""
INSERT INTO public.{TABLE} (
    source_url, title, published_date, body_text, scraped_at
)
VALUES (
    %(source_url)s, %(title)s, %(published_date)s, %(body_text)s, %(scraped_at)s
)
ON CONFLICT (source_url) DO UPDATE SET
    title          = EXCLUDED.title,
    published_date = EXCLUDED.published_date,
    body_text      = EXCLUDED.body_text,
    scraped_at     = EXCLUDED.scraped_at
"""


def upsert_rows(rows: list[Row], conn_str: str) -> int:
    if not rows:
        return 0
    with psycopg.connect(conn_str) as conn:
        with conn.cursor() as cur:
            cur.executemany(_UPSERT_SQL, rows)
        conn.commit()
    return len(rows)


# ── Fetch ─────────────────────────────────────────────────────────────────────


def fetch_listing_pages(num_pages: int) -> list[str]:
    """Scrape listing pages 1..num_pages; return list of markdown strings."""
    markdowns: list[str] = []
    urls = [BASE_URL] + [PAGE_URL.format(n=n) for n in range(2, num_pages + 1)]
    for url in urls:
        md = fetch_page_markdown(url)
        if md:
            print(f"  {url}: fetched ({len(md):,} chars)")
            markdowns.append(md)
        else:
            print(f"  WARNING: {url} returned empty markdown — skipping.")
    return markdowns


def to_ndjson(rows: list[Row]) -> bytes:
    return (
        "\n".join(json.dumps(r, ensure_ascii=False, default=str) for r in rows) + "\n"
    ).encode("utf-8")


# ── Orchestration ─────────────────────────────────────────────────────────────


def run_ingest(
    num_pages: int,
    dry_run: bool,
    conn_str: str | None,
) -> list[Row]:
    print(f"dbpr: fetching {num_pages} listing page(s)...")
    markdowns = fetch_listing_pages(num_pages)

    rows: list[Row] = []
    for md in markdowns:
        rows.extend(parse_listing_page(md))

    # Dedup by source_url (same article can appear across pages during backfill
    # if the site recycles articles, which is unlikely but safe to handle)
    by_url: dict[str, Row] = {}
    for row in rows:
        by_url[row["source_url"]] = row
    rows = list(by_url.values())

    print(f"dbpr: parsed {len(rows)} unique articles from {len(markdowns)} pages.")
    for r in rows[:8]:
        print(
            f"  {(r.get('published_date') or '?'):<12}  {(r.get('title') or '')[:70]}"
        )
    if len(rows) > 8:
        print(f"  ... and {len(rows) - 8} more")

    now = datetime.now(timezone.utc)
    yyyy, mm, dd = f"{now.year:04d}", f"{now.month:02d}", f"{now.day:02d}"
    iso_ts = now.isoformat()
    tier1_path = f"{TIER1_PREFIX}/year={yyyy}/month={mm}/day={dd}/run-{iso_ts}.ndjson"
    ndjson_body = to_ndjson(rows)

    if dry_run:
        print(f"dbpr: --dry-run, skipping upload to {TIER1_BUCKET}/{tier1_path}.")
        print(f"dbpr: --dry-run, skipping DB upsert.")
        return rows

    if not conn_str:
        raise RuntimeError("DESTINATION__POSTGRES__CREDENTIALS not set.")

    _upload_bytes(TIER1_BUCKET, tier1_path, ndjson_body, "application/x-ndjson")
    print(f"dbpr: uploaded {len(ndjson_body)} bytes to {TIER1_BUCKET}/{tier1_path}.")

    upsert_inventory_row(
        bucket=TIER1_BUCKET,
        path=tier1_path,
        vintage=f"{yyyy}-{mm}-{dd}",
        byte_size=len(ndjson_body),
        pack_id="news-swfl",
        source_url="https://www2.myfloridalicense.com/press-releases/",
    )

    written = upsert_rows(rows, conn_str)
    print(f"dbpr: upserted {written} rows into {TABLE}.")
    return rows


# ── CLI ───────────────────────────────────────────────────────────────────────


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="DBPR Press Releases ingest pipeline."
    )
    parser.add_argument(
        "--pages",
        type=int,
        default=DEFAULT_PAGES,
        help=f"Number of listing pages to scrape (default {DEFAULT_PAGES}).",
    )
    parser.add_argument(
        "--backfill",
        action="store_true",
        help=f"Scrape all {BACKFILL_PAGES} pages (one-time historical backfill).",
    )
    parser.add_argument(
        "--enrich-only",
        action="store_true",
        help="Skip scraping; only run Sonnet enrichment on un-enriched rows.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Parse and print rows without writing to DB or Tier-1 storage.",
    )
    args = parser.parse_args(argv)

    conn_str = os.environ.get("DESTINATION__POSTGRES__CREDENTIALS")

    if args.enrich_only:
        if not conn_str:
            print("ERROR: DESTINATION__POSTGRES__CREDENTIALS not set.", file=sys.stderr)
            return 1
        run_enrichment(conn_str, dry_run=args.dry_run)
        return 0

    num_pages = BACKFILL_PAGES if args.backfill else args.pages
    run_ingest(
        num_pages=num_pages,
        dry_run=args.dry_run,
        conn_str=conn_str,
    )

    # Auto-enrich after ingest (skipped on dry-run)
    if not args.dry_run and conn_str:
        run_enrichment(conn_str, dry_run=False)

    return 0


if __name__ == "__main__":
    sys.exit(main())
