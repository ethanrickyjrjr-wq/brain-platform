"""swfl_search_demand — weekly SWFL search-demand ingest (DEMAND PROXY).

Pulls Google Ads search volume for a curated SWFL keyword set from DataForSEO
(geo-locked to SWFL), writes a raw NDJSON copy to Tier-1 cold storage, and
upserts normalized rows into public.swfl_search_demand. Operator-only roadmap
signal — never customer-facing, and NOT our own engagement data (that's the
separate Phase-2 GSC table).

Usage:
  python -m ingest.pipelines.swfl_search_demand.pipeline [--dry-run] [--provider dataforseo]

Environment:
  DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD  — DataForSEO API creds (required)
  DESTINATION__POSTGRES__CREDENTIALS      — psycopg3 URI (required unless --dry-run)
  SUPABASE_URL / SUPABASE_SERVICE_KEY     — Tier-1 storage upload (required unless --dry-run)
"""
from __future__ import annotations

import argparse
import hashlib
import os
import sys
from datetime import datetime, timezone
from typing import Any

import psycopg
from psycopg.types.json import Jsonb

from ingest.lib.storage_uploader import upload_ndjson
from ingest.lib.tier1_inventory import upsert_inventory_row

from .constants import (
    MAX_KEYWORDS_PER_TASK,
    SWFL_LOCATIONS,
    TABLE,
    TIER1_BUCKET,
    TIER1_PREFIX,
)
from .providers import (
    DataForSEOKeywordVolumeProvider,
    KeywordVolumeProvider,
    NormalizedRow,
)
from .seeds import build_seeds

Row = dict[str, Any]


# ── id ────────────────────────────────────────────────────────────────────────


def _make_id(keyword: str, source: str, location: str, captured_month: str) -> str:
    key = f"{keyword}|{source}|{location}|{captured_month}"
    return hashlib.md5(key.encode("utf-8")).hexdigest()[:16]


# ── DB upsert ─────────────────────────────────────────────────────────────────


UPSERT_SQL = f"""
INSERT INTO public.{TABLE} (
    id, keyword, source, location, captured_month,
    avg_monthly_searches, competition, cpc, monthly_searches,
    is_bucketed, fetched_at, inserted_at
)
VALUES (
    %(id)s, %(keyword)s, %(source)s, %(location)s, %(captured_month)s,
    %(avg_monthly_searches)s, %(competition)s, %(cpc)s, %(monthly_searches)s,
    %(is_bucketed)s, %(fetched_at)s, NOW()
)
ON CONFLICT (id) DO UPDATE SET
    avg_monthly_searches = EXCLUDED.avg_monthly_searches,
    competition          = EXCLUDED.competition,
    cpc                  = EXCLUDED.cpc,
    monthly_searches     = EXCLUDED.monthly_searches,
    is_bucketed          = EXCLUDED.is_bucketed,
    fetched_at           = EXCLUDED.fetched_at
"""


def _to_params(row: NormalizedRow) -> Row:
    """Normalized row -> psycopg params (adds id, wraps jsonb)."""
    return {
        "id": _make_id(
            row["keyword"], row["source"], row["location"], row["captured_month"]
        ),
        "keyword": row["keyword"],
        "source": row["source"],
        "location": row["location"],
        "captured_month": row["captured_month"],
        "avg_monthly_searches": row["avg_monthly_searches"],
        "competition": row["competition"],
        "cpc": row["cpc"],
        "monthly_searches": Jsonb(row["monthly_searches"]),
        "is_bucketed": row["is_bucketed"],
        "fetched_at": row["fetched_at"],
    }


def upsert_rows(rows: list[NormalizedRow], conn_str: str) -> int:
    if not rows:
        return 0
    params = [_to_params(r) for r in rows]
    with psycopg.connect(conn_str) as conn:
        with conn.cursor() as cur:
            cur.executemany(UPSERT_SQL, params)
        conn.commit()
    return len(rows)


# ── Orchestration ─────────────────────────────────────────────────────────────


def run(
    dry_run: bool,
    conn_str: str | None,
    provider: KeywordVolumeProvider,
    locations: dict[str, str] | None = None,
) -> None:
    locations = locations if locations is not None else SWFL_LOCATIONS
    seeds = build_seeds(MAX_KEYWORDS_PER_TASK)
    print(
        f"swfl_search_demand: provider={provider.name} "
        f"seeds={len(seeds)} locations={len(locations)}"
    )

    all_rows: list[NormalizedRow] = []
    for label, query in locations.items():
        try:
            rows = provider.fetch(seeds, label, query)
        except Exception as exc:  # one bad location must not kill the others
            print(f"  WARNING: location {label} ({query!r}) failed: {exc}")
            continue
        print(f"  {label}: {len(rows)} keyword rows")
        all_rows.extend(rows)

    if not all_rows:
        raise RuntimeError(
            "swfl_search_demand: every location returned 0 rows — check creds, "
            "location names, and the DataForSEO account balance."
        )

    ranked = sorted(
        all_rows, key=lambda r: r["avg_monthly_searches"] or 0, reverse=True
    )
    for r in ranked[:8]:
        print(
            f"  {(r['avg_monthly_searches'] or 0):>7}/mo  {r['keyword'][:48]:<48}  "
            f"{r['location']:<28}  comp={r['competition']}"
        )
    if len(ranked) > 8:
        print(f"  ... and {len(ranked) - 8} more")

    now = datetime.now(timezone.utc)
    tier1_path = (
        f"{TIER1_PREFIX}/year={now:%Y}/month={now:%m}/day={now:%d}/"
        f"run-{now.isoformat()}.ndjson"
    )

    if dry_run:
        print(f"swfl_search_demand: --dry-run, skipping upload to {TIER1_BUCKET}/{tier1_path}.")
        print("swfl_search_demand: --dry-run, skipping DB upsert.")
        return

    if not conn_str:
        raise RuntimeError(
            "DESTINATION__POSTGRES__CREDENTIALS not set — cannot write to DB."
        )

    byte_size = upload_ndjson(TIER1_BUCKET, tier1_path, all_rows)
    print(f"swfl_search_demand: uploaded {byte_size} bytes to {TIER1_BUCKET}/{tier1_path}.")
    upsert_inventory_row(
        bucket=TIER1_BUCKET,
        path=tier1_path,
        vintage=f"{now:%Y-%m-%d}",
        byte_size=byte_size,
        pack_id=None,  # no consuming brain — operator-only roadmap signal
        source_url="https://dataforseo.com/apis/google-ads-api",
    )

    written = upsert_rows(all_rows, conn_str)
    print(f"swfl_search_demand: upserted {written} rows into public.{TABLE}.")


# ── CLI ───────────────────────────────────────────────────────────────────────


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="SWFL search-demand ingest (DataForSEO Google Ads volume)."
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Fetch and print rows without writing to DB or Tier-1 storage.",
    )
    parser.add_argument(
        "--provider",
        default="dataforseo",
        choices=["dataforseo"],  # google_ads is gated — see providers.py
        help="Demand-volume provider (default: dataforseo).",
    )
    args = parser.parse_args(argv)

    login = os.environ.get("DATAFORSEO_LOGIN")
    password = os.environ.get("DATAFORSEO_PASSWORD")
    if not (login and password):
        print(
            "ERROR: DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD must be set.",
            file=sys.stderr,
        )
        return 1
    provider: KeywordVolumeProvider = DataForSEOKeywordVolumeProvider(login, password)

    conn_str = os.environ.get("DESTINATION__POSTGRES__CREDENTIALS")
    run(dry_run=args.dry_run, conn_str=conn_str, provider=provider)
    return 0


if __name__ == "__main__":
    sys.exit(main())
