"""psycopg DB layer for rentals — idempotent time-series upsert of rental-listing rows. Mirrors
market_aggregates/db.py verbatim.

Append-with-captured_date (never a destructive replace, so the Gate-4 guard is a no-op here): each
run inserts this sweep's rows; a same-day re-run MERGEs on the conflict key. History accumulates;
the consuming brain reads the latest captured_date via an aggregate stats view (aggregate-at-source,
never haul raw rows into TS)."""
from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Sequence


def _get_conn():
    import psycopg

    db_url = os.environ.get("DATABASE_URL")
    if not db_url:
        try:
            import tomllib

            s = Path(".dlt/secrets.toml")
            if s.exists():
                with s.open("rb") as f:
                    data = tomllib.load(f)
                pg = data.get("destination", {}).get("postgres", {}).get("credentials", {})
                host, pw = pg.get("host", ""), pg.get("password", "")
                db, user = pg.get("database", "postgres"), pg.get("username", "postgres")
                port = pg.get("port", 5432)
                if host and pw:
                    db_url = f"postgresql://{user}:{pw}@{host}:{port}/{db}?sslmode=require"
        except Exception:
            pass
    if not db_url:
        raise RuntimeError("No DB URL. Set DATABASE_URL or ensure .dlt/secrets.toml is present.")
    return psycopg.connect(db_url)


def upsert(
    table: str,
    cols: Sequence[str],
    conflict: Sequence[str],
    rows: list[dict[str, Any]],
    *,
    dry_run: bool = False,
) -> int:
    """INSERT rows into `table`; ON CONFLICT(conflict) DO UPDATE the non-key columns. Idempotent.
    dry_run prints a preview and writes nothing."""
    if not rows:
        return 0
    if dry_run:
        print(f"[dry-run] would upsert {len(rows)} rows to {table}", flush=True)
        for r in rows[:5]:
            print("  ", {c: r.get(c) for c in cols}, flush=True)
        return len(rows)

    updatable = [c for c in cols if c not in conflict]
    set_clause = ", ".join(f"{c} = EXCLUDED.{c}" for c in updatable)
    placeholders = ", ".join(f"%({c})s" for c in cols)
    sql = (
        f"INSERT INTO {table} ({', '.join(cols)}) VALUES ({placeholders}) "
        f"ON CONFLICT ({', '.join(conflict)}) DO UPDATE SET {set_clause}"
    )
    params = [{c: r.get(c) for c in cols} for r in rows]
    with _get_conn() as conn:
        with conn.cursor() as cur:
            cur.executemany(sql, params)
        conn.commit()
    return len(rows)
