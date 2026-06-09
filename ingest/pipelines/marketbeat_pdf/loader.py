"""
Upsert extracted MarketBeat PDF rows into data_lake.marketbeat_swfl.

The table has a UNIQUE(source_name, sector, submarket, quarter) constraint
(via the generated `id` column). ON CONFLICT DO UPDATE keeps the latest
ingested values and updates _ingested_at so the freshness probe fires.
"""

from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Any

import psycopg

_TABLE = "data_lake.marketbeat_swfl"

# Columns written by this pipeline (subset of full table schema).
# Columns not listed here (verified_*, sale_price_psf, etc.) are left as-is on conflict.
_UPSERT_COLS = [
    "id",
    "source_name",
    "sector",
    "submarket",
    "quarter",
    "inventory_sf",
    "vacancy_rate",
    "absorption_sqft",
    "ytd_absorption_sqft",
    "under_construction",
    "deliveries",
    "asking_rent_nnn",
    "asking_rent_mf",
    "asking_rent_os",
    "geographic_type",
    "_ingested_at",
]

# On conflict, update these columns (exclude id + dedup key columns)
_UPDATE_COLS = [
    c for c in _UPSERT_COLS
    if c not in ("id", "source_name", "sector", "submarket", "quarter")
]


def _get_conn() -> psycopg.Connection:
    """Resolve DB URL from env or .dlt/secrets.toml."""
    db_url = os.environ.get("MARKETBEAT_DB_URL") or os.environ.get("DATABASE_URL")
    if not db_url:
        try:
            import tomllib
            from pathlib import Path

            secrets = Path(".dlt/secrets.toml")
            if secrets.exists():
                with secrets.open("rb") as f:
                    data = tomllib.load(f)
                host = data.get("destination", {}).get("credentials", {}).get("host", "")
                pw = data.get("destination", {}).get("credentials", {}).get("password", "")
                if host and pw:
                    db_url = f"postgresql://postgres:{pw}@{host}:5432/postgres"
        except Exception:
            pass

    if not db_url:
        raise RuntimeError(
            "No DB URL found. Set MARKETBEAT_DB_URL or DATABASE_URL env var, "
            "or ensure .dlt/secrets.toml is present."
        )
    return psycopg.connect(db_url)


def _row_to_params(row: dict[str, Any], now: datetime) -> dict[str, Any]:
    source = row.get("source_name", "")
    sector = row.get("sector", "industrial")
    submarket = row.get("submarket", "")
    quarter = row.get("quarter", "")
    return {
        "id": f"{source}_{sector}_{submarket}_{quarter}",
        "source_name": source,
        "sector": sector,
        "submarket": submarket,
        "quarter": quarter,
        "inventory_sf": row.get("inventory_sf"),
        "vacancy_rate": row.get("vacancy_rate"),
        "absorption_sqft": row.get("absorption_sqft"),
        "ytd_absorption_sqft": row.get("ytd_absorption_sqft"),
        "under_construction": row.get("under_construction"),
        "deliveries": row.get("deliveries"),
        "asking_rent_nnn": row.get("asking_rent_nnn"),
        "asking_rent_mf": row.get("asking_rent_mf"),
        "asking_rent_os": row.get("asking_rent_os"),
        "geographic_type": row.get("geographic_type", "submarket"),
        "_ingested_at": now,
    }



def upsert_rows(rows: list[dict[str, Any]], dry_run: bool = False) -> int:
    """
    Upsert rows into data_lake.marketbeat_swfl.
    Returns number of rows affected.
    Raises RuntimeError if any row is missing required fields.
    """
    for row in rows:
        for req in ("source_name", "sector", "submarket", "quarter"):
            if not row.get(req):
                raise RuntimeError(f"Row missing required field '{req}': {row}")

    if dry_run:
        print(f"[dry-run] would upsert {len(rows)} rows")
        for row in rows[:5]:
            print(f"  {row.get('source_name')} | {row.get('sector')} | "
                  f"{row.get('submarket')} | {row.get('quarter')} | "
                  f"vac={row.get('vacancy_rate')} rent={row.get('asking_rent_nnn')}")
        if len(rows) > 5:
            print(f"  ... and {len(rows) - 5} more")
        return len(rows)

    cols_sql = ", ".join(_UPSERT_COLS)
    vals_sql = ", ".join(f"%({c})s" for c in _UPSERT_COLS)
    update_sql = ", ".join(f"{c} = EXCLUDED.{c}" for c in _UPDATE_COLS)

    sql = f"""
        INSERT INTO {_TABLE} ({cols_sql})
        VALUES ({vals_sql})
        ON CONFLICT (source_name, sector, submarket, quarter)
        DO UPDATE SET {update_sql}
    """

    now = datetime.now(timezone.utc)
    params = [_row_to_params(row, now) for row in rows]

    with _get_conn() as conn:
        with conn.cursor() as cur:
            cur.executemany(sql, params)
        conn.commit()

    return len(rows)


def already_loaded(source_name: str, quarter: str) -> bool:
    """Return True if any rows for this (source_name, quarter) exist."""
    sql = f"SELECT 1 FROM {_TABLE} WHERE source_name = %s AND quarter = %s LIMIT 1"
    try:
        with _get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(sql, (source_name, quarter))
                return cur.fetchone() is not None
    except Exception:
        return False
