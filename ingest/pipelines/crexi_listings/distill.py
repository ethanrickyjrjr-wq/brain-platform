"""
Normalize and upsert Crexi listing rows into data_lake.active_listings_cre.

Primary key: sha256(source_name + source_url) truncated to 32 chars,
or sha256(source_name + address + city) when source_url is absent.
The UNIQUE (source_name, source_url) constraint deduplicates cleanly
on re-runs; rows without a URL are always re-inserted.
"""
from __future__ import annotations

import hashlib
import os
from datetime import datetime, timezone
from typing import Any

import psycopg

_TABLE = "data_lake.active_listings_cre"
_SOURCE_NAME = "crexi"

_VALID_STATUSES = {"available", "leased", "sale"}


def _get_conn() -> psycopg.Connection:
    db_url = os.environ.get("CREXI_DB_URL") or os.environ.get("DATABASE_URL")
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
        raise RuntimeError(
            "No DB URL found. Set CREXI_DB_URL or DATABASE_URL, "
            "or ensure .dlt/secrets.toml is present."
        )
    return psycopg.connect(db_url)


def _make_id(row: dict[str, Any]) -> str:
    src_url = (row.get("source_url") or "").strip()
    addr = (row.get("address") or "").strip()
    city = (row.get("city") or "").strip()
    key = f"{_SOURCE_NAME}:{src_url or addr + ':' + city}"
    return hashlib.sha256(key.encode()).hexdigest()[:32]


def _parse_status(raw: str | None) -> str:
    if not raw:
        return "available"
    s = raw.strip().lower()
    if s in _VALID_STATUSES:
        return s
    if "avail" in s or "lease" in s:
        return "available"
    if "sold" in s or "sale" in s:
        return "sale"
    return "available"


def normalize(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Validate and normalize raw Firecrawl rows. Drops rows missing address+city."""
    out = []
    for raw in rows:
        addr = (raw.get("address") or "").strip()
        city = (raw.get("city") or "").strip()
        if not addr or not city:
            continue

        sqft = raw.get("sqft")
        asking_psf = raw.get("asking_price_psf")

        out.append({
            "id": _make_id(raw),
            "source_name": _SOURCE_NAME,
            "corridor_name": None,
            "address": addr,
            "city": city,
            "state": "FL",
            "property_type": (raw.get("property_type") or "").strip().lower() or None,
            "sqft": int(sqft) if sqft is not None else None,
            "asking_price_psf": float(asking_psf) if asking_psf is not None else None,
            "status": _parse_status(raw.get("status")),
            "listed_date": raw.get("listed_date") or None,
            "source_url": (raw.get("source_url") or "").strip() or None,
        })
    return out


def upsert_rows(rows: list[dict[str, Any]], *, dry_run: bool = False) -> int:
    """Write normalized rows to data_lake.active_listings_cre. Returns row count."""
    if not rows:
        return 0
    if dry_run:
        print(f"[dry-run] would upsert {len(rows)} rows to {_TABLE}")
        for r in rows[:5]:
            print(f"  {r['city']} | {r.get('address', '')[:40]} | "
                  f"psf={r.get('asking_price_psf')} sqft={r.get('sqft')} status={r['status']}")
        if len(rows) > 5:
            print(f"  ... and {len(rows) - 5} more")
        return len(rows)

    sql = f"""
        INSERT INTO {_TABLE}
          (id, source_name, corridor_name, address, city, state,
           property_type, sqft, asking_price_psf, status, listed_date,
           source_url, _ingested_at)
        VALUES
          (%(id)s, %(source_name)s, %(corridor_name)s, %(address)s, %(city)s, %(state)s,
           %(property_type)s, %(sqft)s, %(asking_price_psf)s, %(status)s, %(listed_date)s,
           %(source_url)s, %(now)s)
        ON CONFLICT (source_name, source_url) DO UPDATE SET
          address        = EXCLUDED.address,
          city           = EXCLUDED.city,
          property_type  = EXCLUDED.property_type,
          sqft           = EXCLUDED.sqft,
          asking_price_psf = EXCLUDED.asking_price_psf,
          status         = EXCLUDED.status,
          listed_date    = EXCLUDED.listed_date,
          _ingested_at   = EXCLUDED._ingested_at
        WHERE active_listings_cre.source_url IS NOT NULL
    """
    now = datetime.now(timezone.utc)
    params = [{**r, "now": now} for r in rows]

    with _get_conn() as conn:
        with conn.cursor() as cur:
            cur.executemany(sql, params)
        conn.commit()
    return len(rows)
