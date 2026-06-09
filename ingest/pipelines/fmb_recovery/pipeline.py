"""
Fort Myers Beach recovery context pipeline — rebuild counts + Estero Blvd progress.

Writes to data_lake.local_cre_context with source_name='fmb_planning'.
Sources: fmbgov.com (Town of FMB), leegov.com/recovery, rebuild.fl.gov.
Consumer: refinery/sources/local-cre-context-source.mts → cre-swfl caveats[].

Note: context rows inject into cre-swfl via caveats[], NOT a new BrainOutput
field. No type-lift needed — this is an additive caveat, not a new metric.

Usage:
  python -m ingest.pipelines.fmb_recovery.pipeline --dry-run
"""
from __future__ import annotations

import argparse
import hashlib
import os
import sys
from datetime import datetime, timezone
from typing import Any

_TABLE = "data_lake.local_cre_context"
_SOURCE_NAME = "fmb_planning"

TARGETS = [
    {"url": "https://www.fmbgov.com/recovery", "topic": "rebuild_progress", "city": "Fort Myers Beach"},
    {"url": "https://www.leegov.com/recovery", "topic": "rebuild_progress", "city": "Fort Myers Beach"},
]


def _get_conn():
    import psycopg
    db_url = os.environ.get("FMB_RECOVERY_DB_URL") or os.environ.get("DATABASE_URL")
    if not db_url:
        try:
            import tomllib
            from pathlib import Path
            s = Path(".dlt/secrets.toml")
            if s.exists():
                with s.open("rb") as f:
                    data = tomllib.load(f)
                pg = data.get("destination", {}).get("postgres", {}).get("credentials", {})
                host = pg.get("host", "")
                pw = pg.get("password", "")
                db = pg.get("database", "postgres")
                user = pg.get("username", "postgres")
                port = pg.get("port", 5432)
                if host and pw:
                    db_url = f"postgresql://{user}:{pw}@{host}:{port}/{db}"
        except Exception:
            pass
    if not db_url:
        raise RuntimeError("No DB URL. Set DATABASE_URL or .dlt/secrets.toml.")
    return psycopg.connect(db_url)


def scrape_targets(dry_run: bool = False) -> list[dict[str, Any]]:
    """Scrape FMB recovery pages via Firecrawl."""
    from ingest.lib.firecrawl_client import scrape

    rows = []
    for t in TARGETS:
        url, topic, city = t["url"], t["topic"], t["city"]
        try:
            result = scrape(url)
            md = result.get("data", {}).get("markdown", "") or ""
            if not md.strip():
                print(f"[warn] No content from {url}", flush=True)
                continue
            row_id = hashlib.sha256(f"{_SOURCE_NAME}:{url}".encode()).hexdigest()[:32]
            rows.append({
                "id": row_id,
                "source_name": _SOURCE_NAME,
                "city": city,
                "report_date": None,
                "topic": topic,
                "headline": f"FMB Recovery — {url.rstrip('/').split('/')[-1].replace('-', ' ')}",
                "detail": md[:2000],
                "source_url": url,
            })
        except Exception as exc:
            print(f"[warn] {url}: {exc}", flush=True)
    return rows


def upsert_rows(rows: list[dict[str, Any]], *, dry_run: bool = False) -> int:
    if not rows:
        return 0
    if dry_run:
        print(f"[dry-run] would upsert {len(rows)} context rows to {_TABLE}")
        for r in rows:
            print(f"  {r['city']} | {r['topic']} | {r['source_url']}")
        return len(rows)

    sql = f"""
        INSERT INTO {_TABLE} (id, source_name, city, report_date, topic, headline, detail, source_url, _ingested_at)
        VALUES (%(id)s, %(source_name)s, %(city)s, %(report_date)s, %(topic)s, %(headline)s, %(detail)s, %(source_url)s, %(now)s)
        ON CONFLICT (id) DO UPDATE SET
          detail = EXCLUDED.detail, _ingested_at = EXCLUDED._ingested_at
    """
    now = datetime.now(timezone.utc)
    params = [{**r, "now": now} for r in rows]
    with _get_conn() as conn:
        with conn.cursor() as cur:
            cur.executemany(sql, params)
        conn.commit()
    return len(rows)


def main() -> None:
    parser = argparse.ArgumentParser(description="Fort Myers Beach recovery context pipeline")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    rows = scrape_targets(dry_run=args.dry_run)
    n = upsert_rows(rows, dry_run=args.dry_run)
    print(f"Done. {n} rows {'would be ' if args.dry_run else ''}upserted.", flush=True)


if __name__ == "__main__":
    main()
