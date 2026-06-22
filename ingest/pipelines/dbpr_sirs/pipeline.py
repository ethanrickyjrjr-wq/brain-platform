#!/usr/bin/env python3
"""DBPR SIRS Submissions ingest — SWFL monthly.

Usage:
    python -m ingest.pipelines.dbpr_sirs.pipeline [--dry-run]

Pulls the two DBPR SIRS Qlik Sense apps (pre-July 2025 and July 2025+) directly from the
Qlik QIX engine over its websocket, filters to Lee + Collier counties, and upserts into
data_lake.dbpr_sirs_submissions.

Why QIX, not HTML scraping (see docs/handoff/2026-06-22-dbpr-sirs-qix-findings.md):
- The Qlik straight-table grid virtualizes BOTH axes: County/ID columns scroll off-screen and
  rows recycle on scroll, so the rendered DOM never holds the full statewide set (the old
  scrape captured ~46 alphabetical rows with County missing -> ~0 SWFL rows). The QIX hypercube
  returns every row with every column.
- ingest.pipelines.dbpr_sirs.qix harvests the live ws URL + session cookie with Playwright,
  then a websockets client pages GetHyperCubeData to completion.

Schema notes:
- pre-July 2025 (7 cols): Project Type | Project Name | Association Name | City | Zip | County | ID
- July 2025+   (5 cols): Project Name | Association Name | City | Zip Code | County  (no type, no ID)
- result_truncated=True only if the engine returns fewer rows than its reported total (qcy).
- row_hash = SHA256(project_name + '|' + association_name + '|' + zip + '|' + county)
"""
import argparse
import hashlib
import os
import sys
from datetime import datetime, timezone

import psycopg

from ingest.pipelines.dbpr_sirs.qix import fetch_app_matrix

SWFL_COUNTIES = {'LEE', 'COLLIER'}

# Only real project rows in the pre-July app (guards against any non-data row).
PRE_JULY_TYPES = {'CONDOMINIUM', 'COOPERATIVE'}

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


def row_hash(project_name: str, association_name: str, zip_: str, county: str) -> str:
    raw = '|'.join([
        (project_name or '').strip().upper(),
        (association_name or '').strip().upper(),
        (zip_ or '').strip(),
        (county or '').strip().upper(),
    ])
    return hashlib.sha256(raw.encode()).hexdigest()


def normalize_county(raw: str | None) -> str | None:
    if not raw:
        return None
    return raw.strip().upper()


def _cell(cells: list, i: int) -> str | None:
    return cells[i] if i < len(cells) else None


def map_rows(matrix: list[list], app: dict) -> list[dict]:
    """Map a QIX qMatrix (list of cell-text rows) to the table's row dicts for one app."""
    rows: list[dict] = []
    if app['has_id']:
        # 7 cols: Project Type | Project Name | Association Name | City | Zip | County | ID
        for c in matrix:
            project_type = _cell(c, 0)
            if (project_type or '').strip().upper() not in PRE_JULY_TYPES:
                continue
            rows.append({
                'project_type':     project_type,
                'project_name':     _cell(c, 1),
                'association_name': _cell(c, 2),
                'city':             _cell(c, 3),
                'zip':              _cell(c, 4),
                'county':           _cell(c, 5),
                'dbpr_id':          _cell(c, 6),
            })
    else:
        # 5 cols: Project Name | Association Name | City | Zip Code | County
        for c in matrix:
            rows.append({
                'project_type':     None,
                'project_name':     _cell(c, 0),
                'association_name': _cell(c, 1),
                'city':             _cell(c, 2),
                'zip':              _cell(c, 3),
                'county':           _cell(c, 4),
                'dbpr_id':          None,
            })
    return rows


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
        print(f"[dbpr-sirs] QIX pull {app['period']} (appid={app['appid']})")
        try:
            matrix, qcy = fetch_app_matrix(app['appid'], app['sheet'])
        except Exception as e:  # noqa: BLE001 — one app failing must not abort the other
            print(f"[dbpr-sirs] ERROR pulling {app['period']}: {type(e).__name__}: {e}")
            continue

        truncated = len(matrix) < qcy
        if truncated:
            print(f"[dbpr-sirs] WARNING: {app['period']} got {len(matrix)}/{qcy} rows "
                  f"— result_truncated=True")

        rows = map_rows(matrix, app)
        swfl_rows = [
            r for r in rows
            if normalize_county(r.get('county')) in SWFL_COUNTIES
        ]
        print(f"[dbpr-sirs] {app['period']}: {len(matrix)} engine rows "
              f"({qcy} reported), {len(rows)} mapped, {len(swfl_rows)} SWFL")

        for r in swfl_rows:
            all_rows.append({
                **r,
                'database_period': app['period'],
                'row_hash': row_hash(r['project_name'], r['association_name'], r['zip'], r['county']),
                'county_normalized': normalize_county(r['county']),
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
        print("[dbpr-sirs] no SWFL rows found — check QIX output above")
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
