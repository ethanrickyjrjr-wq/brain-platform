"""Lee County building permits dlt pipeline.

Writes to `data_lake.lee_building_permits` in Tier 2 Postgres via merge on permit_id.
Live runs pull via crawl4ai + UndetectedAdapter (see scraper.py); tests inject fixture rows directly.

Incremental, self-healing window (the house pattern — ingest/CLAUDE.md):
  `dlt.sources.incremental("issued_date", last_value_func=max, lag=..., on_cursor_value_missing="exclude")`
The cursor persists a lag-adjusted high-water mark in dlt state; `cursor.start_value`
(verified on dlt 1.26.0) = MAX(loaded issued_date) - lag, and drives the scrape window's
`--start`. A skipped/failed run leaves the persisted mark untouched, so the next run
re-covers the gap automatically (no fixed "7 days ago" window that strands a missed week).
merge + primary_key dedups the overlap; `on_cursor_value_missing="exclude"` drops rows whose
enrichment failed to yield a real issued_date (never invent one, never advance the cursor on one).
"""
from __future__ import annotations
from datetime import date, timedelta
from typing import Iterable, Optional
import argparse
import dlt

import json
import pathlib

from .buckets import classify_permit_type
from .geocoder import assign_corridor, geocode_batch, load_lee_centroids
from .scraper import enrich_rows_with_details, fetch_permit_pages, parse_accela_result_page
from ingest.lib.geo_utils import coord_to_zip

_SCOPE_FIXTURE = pathlib.Path(__file__).parents[3] / "fixtures" / "swfl-zip-county.json"

# Re-scan window (days): dlt's `lag` re-fetches the last N days every run to absorb
# late-posted / late-enriched permits; merge keeps it idempotent.
_LAG_DAYS = 30
# First-run scrape window when the table is empty / DB unreadable (no cursor seed).
_FIRST_RUN_WINDOW_DAYS = 45


def _load_in_scope_zips() -> frozenset[str]:
    data = json.loads(_SCOPE_FIXTURE.read_text())
    return frozenset(e["zip"] for e in data["entries"])


def _postgres_uri() -> str | None:
    """Tier-2 Postgres URI from env, else from .dlt/secrets.toml (psql is not on this box)."""
    import os

    uri = os.environ.get("DESTINATION__POSTGRES__CREDENTIALS")
    if uri:
        return uri
    try:
        import re

        secrets = pathlib.Path(__file__).parents[3] / ".dlt" / "secrets.toml"
        txt = secrets.read_text(encoding="utf-8")

        def _v(k: str) -> str | None:
            m = re.search(r"^\s*" + k + r'\s*=\s*"?([^"\r\n]+?)"?\s*$', txt, re.M)
            return m.group(1) if m else None

        host = _v("host")
        if not host:
            return None
        return (
            f"postgresql://{_v('username')}:{_v('password')}@{host}:{_v('port')}/"
            f"{_v('database')}?sslmode=require"
        )
    except Exception:
        return None


def _latest_issued_date() -> date | None:
    """MAX(issued_date) in data_lake.lee_building_permits, or None if unreadable/empty.

    Used ONLY to seed the cursor's initial_value on the very first incremental run (the
    table is already backfilled but has no dlt state yet), so we don't backfill to 1970.
    After the first run dlt's persisted state takes over.
    """
    uri = _postgres_uri()
    if not uri:
        return None
    try:
        import psycopg
    except ImportError:
        return None
    try:
        with psycopg.connect(uri, connect_timeout=15) as conn:
            with conn.cursor() as cur:
                cur.execute("select max(issued_date) from data_lake.lee_building_permits")
                row = cur.fetchone()
                return row[0] if row and row[0] else None
    except Exception:
        return None


def _fetch_enrich_geo(start_date: date, end_date: date) -> list[dict]:
    """Live path (skipped in tests): scrape the window, enrich details, geocode, scope-gate ZIP.

    No issued_date fallback is stamped — an unenriched row carries no date and is dropped by
    the cursor's on_cursor_value_missing="exclude" rather than given a fabricated date.
    """
    pages = fetch_permit_pages(start_date, end_date)
    permit_rows: list = []
    for html in pages:
        permit_rows.extend(parse_accela_result_page(html))
    permit_rows = enrich_rows_with_details(permit_rows)
    rows = [r.__dict__ for r in permit_rows]

    addresses = [r["address"] for r in rows if r.get("address")]
    geo = geocode_batch(addresses)
    centroids = load_lee_centroids()
    for r in rows:
        addr = r.get("address") or ""
        lat_lon = geo.get(addr) if addr else None
        lat, lon = lat_lon if lat_lon else (None, None)
        r["lat"] = lat
        r["lon"] = lon
        r["corridor"] = assign_corridor(lat, lon, centroids)

    in_scope_zips = _load_in_scope_zips()
    for r in rows:
        raw_zip = r.get("zip_code")
        lat, lon = r.get("lat"), r.get("lon")
        if raw_zip and raw_zip in in_scope_zips:
            pass  # already a valid site ZIP — keep it
        elif lat and lon:
            r["zip_code"] = coord_to_zip(lat, lon)
        else:
            r["zip_code"] = None
    return rows


@dlt.resource(
    name="lee_building_permits",
    primary_key="permit_id",
    write_disposition="merge",
    columns={"issued_date": {"data_type": "date"}},
)
def permits_resource(
    rows: Optional[Iterable[dict]] = None,
    cursor=dlt.sources.incremental(
        "issued_date",
        last_value_func=max,
        lag=_LAG_DAYS,
        on_cursor_value_missing="exclude",
    ),
):
    """Emit typed, bucket-classified permit rows; dlt's incremental cursor filters them.

    Live (rows is None): the cursor's persisted, lag-adjusted high-water mark drives the
    scrape window start. Tests inject `rows=` and the cursor filters those instead.
    """
    if rows is None:
        start = cursor.start_value
        if start is None:
            # First run / no seed: fall back to a fixed window so the scrape still runs.
            start_date = date.today() - timedelta(days=_FIRST_RUN_WINDOW_DAYS)
        else:
            # cursor.start_value may be a pendulum Date subclass — coerce to a plain date.
            start_date = date(start.year, start.month, start.day)
        print(f"lee_permits: incremental scrape window start={start_date} (cursor={cursor.start_value})")
        rows = _fetch_enrich_geo(start_date, date.today())

    for r in rows:
        issued = r.get("issued_date")
        if isinstance(issued, str) and issued:
            issued = date.fromisoformat(issued)
        elif not issued:
            issued = None  # cursor's on_cursor_value_missing="exclude" drops these
        bucket = classify_permit_type(
            r.get("permit_type_raw", ""),
            r.get("permit_description_raw", ""),
        )
        yield {
            "permit_id": r["permit_id"],
            "issued_date": issued,
            "permit_type_raw": r.get("permit_type_raw", ""),
            "permit_description_raw": r.get("permit_description_raw", ""),
            "bucket": bucket,
            "address": r.get("address", ""),
            "zip_code": r.get("zip_code"),
            "lat": r.get("lat"),
            "lon": r.get("lon"),
            "corridor": r.get("corridor"),
            "declared_value_usd": r.get("declared_value_usd"),
            "status": r.get("status"),
            "_ingest_metadata": {
                "source": "lee_accela_citizen_access",
                "scraped_via": "crawl4ai",
            },
        }


def run_pipeline() -> None:
    """Live entry point. The incremental cursor drives the window; no fixed dates."""
    # Seed the cursor's first-run floor from the already-loaded MAX so a populated-but-
    # stateless table doesn't backfill to 1970. None (empty/unreadable) -> resource's
    # _FIRST_RUN_WINDOW_DAYS fallback. After the first run, dlt's persisted state wins.
    seed = _latest_issued_date()
    cursor = dlt.sources.incremental(
        "issued_date",
        initial_value=seed,
        last_value_func=max,
        lag=_LAG_DAYS,
        on_cursor_value_missing="exclude",
    )
    pipeline = dlt.pipeline(
        pipeline_name="lee_permits",
        destination="postgres",
        dataset_name="data_lake",
    )
    load_info = pipeline.run(permits_resource(cursor=cursor))
    # House convention (bls_*, fema, fdot, collier_parcels): without this dlt swallows a
    # per-job failure into LoadInfo and the process exits 0 with a half-written table.
    load_info.raise_on_failed_jobs()


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser()
    p.add_argument(
        "--start",
        type=lambda s: date.fromisoformat(s),
        default=None,
        help="Override scrape start (dry-run probe only; live runs are cursor-driven).",
    )
    p.add_argument(
        "--end",
        type=lambda s: date.fromisoformat(s),
        default=None,
        help="Override scrape end (dry-run probe only; default today).",
    )
    p.add_argument(
        "--dry-run",
        action="store_true",
        help="Fetch and parse only; skip detail enrichment and dlt write.",
    )
    args = p.parse_args(argv)

    if args.dry_run:
        # Probe needs a concrete window without touching the DB; default to the last day.
        end_date = args.end or date.today()
        start_date = args.start or (end_date - timedelta(days=1))
        pages = fetch_permit_pages(start_date, end_date)
        rows: list = []
        for html in pages:
            rows.extend(parse_accela_result_page(html))
        print(f"lee_permits dry-run: {len(rows)} rows (detail enrichment skipped)")
        if rows:
            print("first row:", rows[0])
        return 0

    run_pipeline()
    return 0


if __name__ == "__main__":
    main()
