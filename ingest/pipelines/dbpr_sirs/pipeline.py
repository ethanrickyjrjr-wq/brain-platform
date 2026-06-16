#!/usr/bin/env python3
"""DBPR SIRS Submissions ingest — SWFL monthly.

Usage:
    python -m ingest.pipelines.dbpr_sirs.pipeline [--dry-run]

Scrapes the two DBPR SIRS Qlik apps (pre-July 2025 and July 2025+),
filters to Lee + Collier counties, and upserts into data_lake.dbpr_sirs_submissions.

Extraction notes:
- URL-based county pre-filter does not work; filter in Python after scrape.
- 15s wait needed for Qlik to render rows into DOM.
- result_truncated=True when "Load more" still visible at scrape end (hypercube limit fired).
- July 2025+ schema has no ID column; row_hash is the dedup key.
- row_hash = SHA256(project_name + '|' + association_name + '|' + zip + '|' + county)
"""
import argparse
import asyncio
import hashlib
import os
import sys
from datetime import datetime, timezone

import psycopg
from bs4 import BeautifulSoup

from ingest.lib.crawl4ai_client import Crawl4aiSession, Crawl4aiError

SWFL_COUNTIES = {'LEE', 'COLLIER'}

APPS = [
    {
        'period': 'pre_july_2025',
        'appid': '14f1ed21-7b21-4272-af14-9eaad7911440',
        'sheet': 'mcprvJW',
        'has_id': True,
    },
    {
        'period': 'july_2025_plus',
        'appid': 'd217126f-2edc-408b-bb98-2c355b6f0429',
        'sheet': 'HUGAcyE',
        'has_id': False,
    },
]

BASE_URL = 'https://dbpr-publicrecords.myfloridalicense.com/qpr/single/'

_WAIT_SECONDS = 16.0  # Qlik needs ~15s to render rows into DOM


async def _fetch_html(url: str) -> str:
    """Fetch url via crawl4ai UndetectedAdapter. Returns rendered HTML."""
    async with Crawl4aiSession(session_id="dbpr_sirs") as session:
        return await session.step(
            url,
            wait_for="js:document.querySelectorAll('table tbody tr').length > 2",
            delay_after=_WAIT_SECONDS,
            timeout=120_000,
        )


def crawl4ai_scrape(url: str) -> str:
    html = asyncio.run(_fetch_html(url))
    if not html:
        raise RuntimeError(f"crawl4ai returned empty HTML for {url}")
    return html


def row_hash(project_name: str, association_name: str, zip_: str, county: str) -> str:
    raw = '|'.join([
        (project_name or '').strip().upper(),
        (association_name or '').strip().upper(),
        (zip_ or '').strip(),
        (county or '').strip().upper(),
    ])
    return hashlib.sha256(raw.encode()).hexdigest()


def normalize_county(raw: str) -> str | None:
    if not raw:
        return None
    return raw.strip().upper()


def _cells(tr) -> list[str]:
    return [td.get_text(strip=True) for td in tr.find_all('td')]


def parse_pre_july_rows(html: str) -> list[dict]:
    """Parse table rows from pre-July 2025 app.
    Columns: Project Type | Project Name | Association Name | City | Zip | County | ID
    """
    soup = BeautifulSoup(html, 'html.parser')
    rows = []
    for tr in soup.find_all('tr'):
        parts = _cells(tr)
        if not parts:
            continue
        if parts[0] not in ('CONDOMINIUM', 'COOPERATIVE'):
            continue
        rows.append({
            'project_type':     parts[0] if len(parts) > 0 else None,
            'project_name':     parts[1] if len(parts) > 1 else None,
            'association_name': parts[2] if len(parts) > 2 else None,
            'city':             parts[3] if len(parts) > 3 else None,
            'zip':              parts[4] if len(parts) > 4 else None,
            'county':           parts[5] if len(parts) > 5 else None,
            'dbpr_id':          parts[6] if len(parts) > 6 else None,
        })
    return rows


def parse_july_plus_rows(html: str) -> list[dict]:
    """Parse table rows from July 2025+ app.
    Columns: Project Name | Association Name | City | Zip Code | County
    """
    soup = BeautifulSoup(html, 'html.parser')
    rows = []
    for table in soup.find_all('table'):
        header_texts = [th.get_text(strip=True) for th in table.find_all('th')]
        if not any('Project Name' in h for h in header_texts):
            continue
        for tr in table.find_all('tr'):
            parts = _cells(tr)
            if len(parts) < 5:
                continue
            rows.append({
                'project_type':     None,
                'project_name':     parts[0] if len(parts) > 0 else None,
                'association_name': parts[1] if len(parts) > 1 else None,
                'city':             parts[2] if len(parts) > 2 else None,
                'zip':              parts[3] if len(parts) > 3 else None,
                'county':           parts[4] if len(parts) > 4 else None,
                'dbpr_id':          None,
            })
        break
    return rows


def check_truncated(html: str) -> bool:
    soup = BeautifulSoup(html, 'html.parser')
    return bool(soup.find(string=lambda t: t and 'Load more' in t))


def get_db_conn():
    uri = os.environ.get('DESTINATION__POSTGRES__CREDENTIALS')
    if not uri:
        raise RuntimeError("DESTINATION__POSTGRES__CREDENTIALS not set.")
    return psycopg.connect(uri)


UPSERT_SQL = """
INSERT INTO data_lake.dbpr_sirs_submissions
  (database_period, row_hash, project_type, project_name, association_name,
   city, zip, county, county_normalized, dbpr_id, result_truncated, scraped_at)
VALUES
  (%(database_period)s, %(row_hash)s, %(project_type)s, %(project_name)s, %(association_name)s,
   %(city)s, %(zip)s, %(county)s, %(county_normalized)s, %(dbpr_id)s,
   %(result_truncated)s, %(scraped_at)s)
ON CONFLICT (row_hash, database_period) DO UPDATE SET
  project_type       = EXCLUDED.project_type,
  project_name       = EXCLUDED.project_name,
  association_name   = EXCLUDED.association_name,
  city               = EXCLUDED.city,
  zip                = EXCLUDED.zip,
  county             = EXCLUDED.county,
  county_normalized  = EXCLUDED.county_normalized,
  dbpr_id            = COALESCE(EXCLUDED.dbpr_id, data_lake.dbpr_sirs_submissions.dbpr_id),
  result_truncated   = EXCLUDED.result_truncated,
  scraped_at         = EXCLUDED.scraped_at
"""


def run(dry_run: bool = False):
    run_ts = datetime.now(timezone.utc)
    print(f"[dbpr-sirs] run_ts={run_ts.isoformat()} dry_run={dry_run}")

    all_rows = []

    for app in APPS:
        url = (
            f"{BASE_URL}?appid={app['appid']}"
            f"&sheet={app['sheet']}&opt=ctxmenu"
        )
        print(f"[dbpr-sirs] scraping {app['period']}: {url}")
        try:
            html = crawl4ai_scrape(url)
        except (RuntimeError, Crawl4aiError) as e:
            print(f"[dbpr-sirs] ERROR scraping {app['period']}: {e}")
            continue

        truncated = check_truncated(html)
        if truncated:
            print(f"[dbpr-sirs] WARNING: {app['period']} hit hypercube limit — result_truncated=True")

        rows = (
            parse_pre_july_rows(html)
            if app['has_id']
            else parse_july_plus_rows(html)
        )

        swfl_rows = [
            r for r in rows
            if normalize_county(r.get('county')) in SWFL_COUNTIES
        ]
        print(f"[dbpr-sirs] {app['period']}: {len(rows)} total rows, {len(swfl_rows)} SWFL")

        for r in swfl_rows:
            cn = normalize_county(r['county'])
            h = row_hash(r['project_name'], r['association_name'], r['zip'], r['county'])
            all_rows.append({
                **r,
                'database_period': app['period'],
                'row_hash': h,
                'county_normalized': cn,
                'result_truncated': truncated,
                'scraped_at': run_ts,
            })

    if dry_run:
        print(f"[dbpr-sirs] dry-run: would upsert {len(all_rows)} rows")
        for r in all_rows:
            print(f"  {r['database_period']} | {r['county_normalized']} | "
                  f"{r['association_name']} | {r['city']} | id={r['dbpr_id']}")
        return

    if not all_rows:
        print("[dbpr-sirs] no SWFL rows found — check crawl4ai output above")
        sys.exit(1)

    with get_db_conn() as conn:
        with conn.cursor() as cur:
            for row in all_rows:
                cur.execute(UPSERT_SQL, row)
        conn.commit()

    print(f"[dbpr-sirs] upserted {len(all_rows)} rows")


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()
    run(dry_run=args.dry_run)
