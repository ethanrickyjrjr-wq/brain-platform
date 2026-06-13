"""Pivoted-Views build §08a/§08b — in-house ALFRED vintage capture.

Snapshots the registered pivoted views into data_lake.view_vintages, one row per
(view_name, as_of=CURRENT_DATE, period, series_key). ZHVI/ZORI publish no vintages
(Zillow re-writes history), so capturing the view as-of each monthly run is the only
way they become point-in-time / backtestable. as_of is the real run date — NEVER
backdated. A same-day rerun is a no-op (ON CONFLICT DO NOTHING on the unique index).

GENERIC unpivot: `jsonb_each_text(to_jsonb(t) - <period_col>)` turns every NON-period
column into a (series_key, value) pair, so a new column added to a view is captured
automatically. The `::double precision` cast on each value is a deliberate R1
tripwire — a view that emits a non-numeric column (a label/direction, violating
"views emit pure math only") makes the cast RAISE, failing that view loudly instead
of silently storing a string.

Run monthly AFTER the ZHVI (day 22) / ZORI (day 20) ingests land (cron: day 26).
Creds: DESTINATION__POSTGRES__CREDENTIALS env, else .dlt/secrets.toml (same resolution
as ingest/scripts/migrate_nfip_flood_zone_current.py).

  python -m ingest.scripts.capture_view_vintages --dry-run   # count only, no write
  python -m ingest.scripts.capture_view_vintages             # capture (idempotent)
"""
from __future__ import annotations

import argparse
import os
import re
import sys

import psycopg
from psycopg import sql

# ── Opt-in registry: view_name -> the column that holds the PERIOD ────────────
# Everything that is NOT the period column is captured as a numeric series. Add a
# view here (and only here) to start capturing its vintages. Both pivoted views
# carry the month in a 'month' text column ('YYYY-MM'); the city columns are series.
VIEWS: dict[str, str] = {
    "zhvi_pivoted": "month",
    "zori_pivoted": "month",
}


def _uri() -> str:
    uri = os.environ.get("DESTINATION__POSTGRES__CREDENTIALS")
    if uri:
        return uri
    secrets = os.path.join(os.path.dirname(__file__), "..", "..", ".dlt", "secrets.toml")
    txt = open(secrets, encoding="utf-8").read()

    def _v(k: str) -> str | None:
        m = re.search(r"^\s*" + k + r'\s*=\s*"?([^"\r\n]+?)"?\s*$', txt, re.M)
        return m.group(1) if m else None

    return f"postgresql://{_v('username')}:{_v('password')}@{_v('host')}:{_v('port')}/{_v('database')}"


def _select_sql(view_name: str, period_col: str) -> sql.Composed:
    """The generic unpivot SELECT for one view. Identifiers come from the hardcoded
    allowlist above (never user input) but are still composed via psycopg.sql so the
    query is injection-safe by construction."""
    return sql.SQL(
        """
        SELECT
          {view_lit}                  AS view_name,
          CURRENT_DATE                AS as_of,
          (t.{period_col})::text      AS period,
          kv.key                      AS series_key,
          kv.value::double precision  AS value
        FROM data_lake.{view} t
        CROSS JOIN LATERAL jsonb_each_text(to_jsonb(t) - {period_lit}) AS kv(key, value)
        WHERE kv.value IS NOT NULL
        """
    ).format(
        view_lit=sql.Literal(view_name),
        period_col=sql.Identifier(period_col),
        view=sql.Identifier(view_name),  # rendered under the literal `data_lake.` schema prefix
        period_lit=sql.Literal(period_col),
    )


def _capture_one(cur: psycopg.Cursor, view_name: str, period_col: str, dry_run: bool) -> int:
    select = _select_sql(view_name, period_col)
    if dry_run:
        # Materialize every row (not count(*) over a subquery — Postgres would elide the
        # unreferenced `value` projection and SKIP the cast). Fetching forces the
        # ::double precision cast on every row, so a non-numeric column trips the R1
        # tripwire in dry-run too — before any live write. Our views are ~1k rows.
        cur.execute(select)
        return len(cur.fetchall())
    insert = (
        sql.SQL(
            "INSERT INTO data_lake.view_vintages (view_name, as_of, period, series_key, value) "
        )
        + select
        + sql.SQL(" ON CONFLICT (view_name, as_of, period, series_key) DO NOTHING")
    )
    cur.execute(insert)
    return cur.rowcount


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Capture pivoted-view vintages (in-house ALFRED).")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Count what WOULD be captured per view; write nothing.",
    )
    args = parser.parse_args(argv)

    mode = "DRY-RUN" if args.dry_run else "CAPTURE"
    print(f"view_vintages {mode}: {len(VIEWS)} view(s) - {', '.join(VIEWS)}")

    total = 0
    with psycopg.connect(_uri(), connect_timeout=30) as conn:
        with conn.cursor() as cur:
            for view_name, period_col in VIEWS.items():
                try:
                    n = _capture_one(cur, view_name, period_col, args.dry_run)
                except Exception as exc:  # noqa: BLE001 — fail this view LOUDLY (R1 tripwire / missing view)
                    conn.rollback()
                    print(f"  {view_name}: FAILED - {exc}", file=sys.stderr)
                    return 1
                total += n
                verb = "would capture" if args.dry_run else "inserted"
                print(f"  {view_name}: {verb} {n} row(s)")
        if not args.dry_run:
            conn.commit()

    print(f"view_vintages {mode}: {total} row(s) total")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
