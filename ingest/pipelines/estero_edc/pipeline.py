"""
Village of Estero EDC context pipeline — development pipeline + business climate.

Writes to data_lake.local_cre_context with source_name='estero_edc'.
Consumes: esterofl.org planning/economic pages + PDF attachments.
Consumer: refinery/sources/local-cre-context-source.mts → cre-swfl caveats[].

Note: context rows inject into cre-swfl via caveats[], NOT a new BrainOutput
field. No type-lift needed — this is an additive caveat, not a new metric.

Usage:
  python -m ingest.pipelines.estero_edc.pipeline --dry-run
"""
from __future__ import annotations

import argparse
import hashlib
import os
import sys
from datetime import datetime, timezone
from typing import Any

_TABLE = "data_lake.local_cre_context"
_SOURCE_NAME = "estero_edc"

# Verified live URLs for the Village of Estero economic/planning pages.
# esterofl.org is the official Village of Estero website.
TARGETS = [
    "https://www.esterofl.org/215/Economic-Development",
    "https://www.esterofl.org/338/Planning-Zoning",
]


def _get_conn():
    import psycopg
    db_url = os.environ.get("ESTERO_EDC_DB_URL") or os.environ.get("DATABASE_URL")
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
    """Scrape Estero EDC pages via Firecrawl and extract context items. STUB."""
    from ingest.lib.firecrawl_client import scrape

    rows = []
    for url in TARGETS:
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
                "city": "Estero",
                "report_date": None,
                "topic": "development_pipeline",
                "headline": f"Estero EDC — {url.rstrip('/').split('/')[-1].replace('-', ' ')}",
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
    parser = argparse.ArgumentParser(description="Estero EDC context pipeline")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    rows = scrape_targets(dry_run=args.dry_run)
    n = upsert_rows(rows, dry_run=args.dry_run)
    print(f"Done. {n} rows {'would be ' if args.dry_run else ''}upserted.", flush=True)


if __name__ == "__main__":
    main()
