"""DBPR public notices ingest — SWFL weekly.

Usage:
    python -m ingest.pipelines.dbpr_public_notices.pipeline [--dry-run]

Scrapes https://www2.myfloridalicense.com/public-notices/, filters SWFL counties,
fetches each PDF via Firecrawl (scrape_with_fallback), parses metadata, generates a
Claude summary, and upserts into public.dbpr_public_notices.

Environment:
  FIRECRAWL_API_KEY                  — required for scrape
  SPIDER_API_KEY                     — optional Spider fallback
  ANTHROPIC_API_KEY                  — required for PDF summaries
  DESTINATION__POSTGRES__CREDENTIALS — psycopg3 connection URI (required unless --dry-run)
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone

import psycopg

from ingest.lib.extract_client import scrape_with_fallback

from .parse import parse_index_markdown, parse_pdf_markdown
from .summarize import summarize_notice

INDEX_URL = 'https://www2.myfloridalicense.com/public-notices/'


def scrape_markdown(url: str) -> str:
    """Scrape a URL via Firecrawl/Spider, return markdown string."""
    response = scrape_with_fallback(url, only_main_content=False)
    data = response.get("data", {})
    return data.get("markdown", "") if isinstance(data, dict) else ""


def get_db_conn():
    conn_str = os.environ.get("DESTINATION__POSTGRES__CREDENTIALS")
    if not conn_str:
        raise RuntimeError("DESTINATION__POSTGRES__CREDENTIALS not set.")
    return psycopg.connect(conn_str)


UPSERT_SQL = """
INSERT INTO public.dbpr_public_notices
  (pdf_url, respondent_name, county, case_number, all_case_numbers,
   violation_type, industry, pdf_summary, response_deadline, last_seen_at, scraped_at)
VALUES
  (%(pdf_url)s, %(respondent_name)s, %(county)s, %(case_number)s, %(all_case_numbers)s,
   %(violation_type)s, %(industry)s, %(pdf_summary)s, %(response_deadline)s,
   %(last_seen_at)s, %(scraped_at)s)
ON CONFLICT (pdf_url) DO UPDATE SET
  respondent_name   = EXCLUDED.respondent_name,
  county            = EXCLUDED.county,
  case_number       = EXCLUDED.case_number,
  all_case_numbers  = EXCLUDED.all_case_numbers,
  violation_type    = EXCLUDED.violation_type,
  industry          = EXCLUDED.industry,
  pdf_summary       = COALESCE(EXCLUDED.pdf_summary, public.dbpr_public_notices.pdf_summary),
  response_deadline = EXCLUDED.response_deadline,
  last_seen_at      = EXCLUDED.last_seen_at
  -- scraped_at intentionally NOT updated on conflict (preserves first-seen timestamp)
"""


def run(dry_run: bool = False):
    run_ts = datetime.now(timezone.utc)
    print(f"[dbpr-notices] run_ts={run_ts.isoformat()} dry_run={dry_run}")

    # 1. Scrape index
    print(f"[dbpr-notices] scraping index: {INDEX_URL}")
    index_md = scrape_markdown(INDEX_URL)
    if not index_md.strip():
        print("[dbpr-notices] ERROR: empty index response — aborting", file=sys.stderr)
        sys.exit(1)

    notices = parse_index_markdown(index_md)
    print(f"[dbpr-notices] found {len(notices)} SWFL notices on index page")

    if not notices:
        print("[dbpr-notices] no SWFL notices this week — nothing to do")
        return

    rows = []
    for n in notices:
        url = n['pdf_url']
        print(f"[dbpr-notices] fetching PDF: {url}")
        pdf_md = scrape_markdown(url)

        if not pdf_md.strip():
            print(f"[dbpr-notices] SKIP (empty response): {url}")
            continue

        parsed = parse_pdf_markdown(pdf_md, url, respondent_hint=n['respondent_name'])
        parsed['county'] = parsed['county'] or n['county']  # fallback to index-page county

        summary = summarize_notice(pdf_md) if not dry_run else '[dry-run]'
        parsed['pdf_summary'] = summary or None

        parsed['last_seen_at'] = run_ts
        parsed['scraped_at'] = run_ts

        rows.append(parsed)
        print(f"  county={parsed['county']} respondent={parsed['respondent_name']} "
              f"case={parsed['case_number']} violation={parsed['violation_type']} "
              f"deadline={parsed['response_deadline']}")

    if dry_run:
        print(f"[dbpr-notices] dry-run: would upsert {len(rows)} rows")
        for r in rows:
            print(f"  {json.dumps({k: str(v) for k, v in r.items()}, indent=2)}")
        return

    # 2. Upsert
    with get_db_conn() as conn:
        with conn.cursor() as cur:
            for row in rows:
                cur.execute(UPSERT_SQL, row)
        conn.commit()

    print(f"[dbpr-notices] upserted {len(rows)} rows")


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()
    run(dry_run=args.dry_run)
