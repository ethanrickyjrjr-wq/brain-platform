"""
FDLE UCR property crime — Lee County + Collier County ingest pipeline.

Source: Florida Department of Law Enforcement (FDLE) Uniform Crime Report,
  county offense by type (UCR Part I property crimes: burglary, larceny-theft,
  motor vehicle theft, arson). Published annually with ~6–9 month lag.
  URL pattern (verify against https://www.fdle.state.fl.us/FSAC/Crime-Data/UCR-Data-Archive.aspx):
  https://www.fdle.state.fl.us/FSAC/docs/UCR/Documents/{year}/countybytype{year}.xlsx

Tiers:
  Tier 1 — Raw rows → NDJSON → Supabase Storage
             path: lake-tier1/crime/{year}/fdle_crime_swfl.ndjson
  Tier 2 — Aggregated rows → PostgreSQL public.fdle_crime_swfl
             upsert key: (county, period)

Cadence: quarterly GHA cron picks up each new annual FDLE release.

Usage:
  python -m ingest.pipelines.fdle_crime_swfl.pipeline [--backfill] [--current]
      [--year YYYY] [--dry-run]

Environment:
  DESTINATION__POSTGRES__CREDENTIALS  — psycopg3 connection URI
  SUPABASE_URL                        — Supabase project URL (Tier-1 upload)
  SUPABASE_SERVICE_KEY                — Supabase service role key (Tier-1 upload)
"""
from __future__ import annotations

import argparse
import io
import json
import os
import sys
import time
from datetime import datetime, timezone
from typing import Any

import openpyxl
import psycopg
import requests

from ingest.lib.tier1_inventory import upsert_inventory_row

from .constants import (
    COL_ALIASES,
    COUNTIES,
    EARLIEST_YEAR,
    FDLE_CITATION_URL,
    FDLE_COUNTY_OFFENSE_URL,
    TABLE,
    TIER1_BUCKET,
    TIER1_PREFIX,
)

Row = dict[str, Any]

# ── Helpers ───────────────────────────────────────────────────────────────────


def _current_year() -> int:
    """Most recent year FDLE typically has data for (prior calendar year)."""
    return datetime.now(timezone.utc).year - 1


def _to_int(value: Any) -> int | None:
    if value is None:
        return None
    try:
        return int(float(str(value).replace(",", "").strip()))
    except (ValueError, TypeError):
        return None


# ── Tier-1 NDJSON upload ──────────────────────────────────────────────────────


def _upload_ndjson(bucket: str, object_path: str, rows: list[Row]) -> int:
    """Serialize rows as NDJSON, upload to Supabase Storage. Returns byte size."""
    ndjson_bytes = "\n".join(json.dumps(r, default=str) for r in rows).encode("utf-8")
    url = f"{os.environ['SUPABASE_URL']}/storage/v1/object/{bucket}/{object_path}"
    headers = {
        "Authorization": f"Bearer {os.environ['SUPABASE_SERVICE_KEY']}",
        "Content-Type": "application/x-ndjson",
        "x-upsert": "true",
    }
    for attempt in range(3):
        try:
            resp = requests.post(url, headers=headers, data=ndjson_bytes, timeout=60)
            if resp.ok:
                return len(ndjson_bytes)
            if resp.status_code >= 500 and attempt < 2:
                time.sleep(10 * (attempt + 1))
                continue
            raise RuntimeError(
                f"Storage upload failed {resp.status_code}: {resp.text[:200]}"
            )
        except (requests.Timeout, requests.ConnectionError):
            if attempt < 2:
                time.sleep(5 * (attempt + 1))
                continue
            raise
    return len(ndjson_bytes)


# ── Excel download + parse ────────────────────────────────────────────────────


def download_fdle_excel(year: int, timeout: int = 60) -> bytes:
    url = FDLE_COUNTY_OFFENSE_URL.format(year=year)
    resp = requests.get(url, timeout=timeout)
    if resp.status_code == 404:
        raise FileNotFoundError(
            f"FDLE UCR {year} not found at {url}. "
            f"Check {FDLE_CITATION_URL} for the current archive link."
        )
    resp.raise_for_status()
    return resp.content


def _normalize_cell(s: object) -> str:
    return str(s or "").strip().lower().replace("  ", " ")


def _find_header_row(
    ws: Any,
) -> tuple[int, dict[str, int]]:
    """Scan rows for the one with 'county' and 'population' headers.

    Returns (1-based row index, {slug: 0-based column index}).
    Raises ValueError if no such row is found.
    """
    for row_idx, row in enumerate(ws.iter_rows(values_only=True), 1):
        cells = [_normalize_cell(c) for c in row]
        has_county = any("county" in c for c in cells)
        has_pop = any("population" in c or "pop." in c for c in cells)
        if not (has_county and has_pop):
            continue
        col_map: dict[str, int] = {}
        for slug, aliases in COL_ALIASES.items():
            for col_idx, cell in enumerate(cells):
                if any(alias in cell for alias in aliases):
                    if slug not in col_map:
                        col_map[slug] = col_idx
        if "county" in col_map and "population" in col_map:
            return row_idx, col_map
    raise ValueError(
        "No header row with 'county' and 'population' found. "
        f"FDLE may have changed the Excel layout — update COL_ALIASES in constants.py. "
        f"Archive: {FDLE_CITATION_URL}"
    )


def parse_fdle_excel(content: bytes, year: int) -> list[Row]:
    """Parse FDLE UCR county offense Excel for Lee + Collier counties.

    Tries each sheet; returns the first sheet that yields target-county rows.
    Raises ValueError if no usable data is found.
    """
    wb = openpyxl.load_workbook(io.BytesIO(content), read_only=True, data_only=True)
    now_iso = datetime.now(timezone.utc).isoformat()
    source_url = FDLE_COUNTY_OFFENSE_URL.format(year=year)

    for sheet_name in wb.sheetnames:
        ws = wb[sheet_name]
        try:
            header_row_idx, col_map = _find_header_row(ws)
        except ValueError:
            continue

        rows: list[Row] = []
        all_data = list(ws.iter_rows(min_row=header_row_idx + 1, values_only=True))

        for data_row in all_data:
            county_key = col_map.get("county")
            if county_key is None:
                continue
            county_raw = _normalize_cell(data_row[county_key])
            if not county_raw:
                continue

            matched_county: str | None = None
            for target in COUNTIES:
                if county_raw.startswith(target.lower()):
                    matched_county = target
                    break
            if matched_county is None:
                continue

            def get_int(slug: str) -> int | None:
                idx = col_map.get(slug)
                if idx is None:
                    return None
                return _to_int(data_row[idx])

            population = get_int("population")
            burglary = get_int("burglary")
            larceny_theft = get_int("larceny_theft")
            motor_vehicle_theft = get_int("motor_vehicle_theft")
            arson = get_int("arson")

            # Prefer the Excel's own total; derive from parts if absent.
            total_from_excel = get_int("total_property")
            parts = [
                x
                for x in [burglary, larceny_theft, motor_vehicle_theft, arson]
                if x is not None
            ]
            total_property_crimes = total_from_excel or (sum(parts) if parts else None)

            property_crime_per_1k: float | None = None
            if population and total_property_crimes:
                property_crime_per_1k = round(total_property_crimes / population * 1000, 2)

            rows.append(
                {
                    "county": matched_county,
                    "period": f"{year}-01-01",
                    "data_year": year,
                    "burglary": burglary,
                    "larceny_theft": larceny_theft,
                    "motor_vehicle_theft": motor_vehicle_theft,
                    "arson": arson,
                    "total_property_crimes": total_property_crimes,
                    "population": population,
                    "property_crime_per_1k": property_crime_per_1k,
                    "source_url": source_url,
                    "retrieved_at": now_iso,
                }
            )

        if rows:
            wb.close()
            return rows

    wb.close()
    raise ValueError(
        f"FDLE UCR {year}: no rows found for Lee or Collier across sheets {wb.sheetnames}. "
        "Verify Excel structure and update COL_ALIASES."
    )


# ── DB upsert ─────────────────────────────────────────────────────────────────

UPSERT_SQL = f"""
INSERT INTO {TABLE}
  (county, period, data_year, burglary, larceny_theft, motor_vehicle_theft, arson,
   total_property_crimes, population, property_crime_per_1k, source_url, retrieved_at, inserted_at)
VALUES
  (%(county)s, %(period)s::date, %(data_year)s, %(burglary)s, %(larceny_theft)s,
   %(motor_vehicle_theft)s, %(arson)s, %(total_property_crimes)s, %(population)s,
   %(property_crime_per_1k)s, %(source_url)s, %(retrieved_at)s, NOW())
ON CONFLICT (county, period) DO UPDATE SET
  data_year             = EXCLUDED.data_year,
  burglary              = EXCLUDED.burglary,
  larceny_theft         = EXCLUDED.larceny_theft,
  motor_vehicle_theft   = EXCLUDED.motor_vehicle_theft,
  arson                 = EXCLUDED.arson,
  total_property_crimes = EXCLUDED.total_property_crimes,
  population            = EXCLUDED.population,
  property_crime_per_1k = EXCLUDED.property_crime_per_1k,
  source_url            = EXCLUDED.source_url,
  retrieved_at          = EXCLUDED.retrieved_at,
  inserted_at           = NOW()
"""


def upsert_rows(rows: list[Row], conn_str: str) -> int:
    if not rows:
        return 0
    with psycopg.connect(conn_str) as conn:
        with conn.cursor() as cur:
            cur.executemany(UPSERT_SQL, rows)
        conn.commit()
    return len(rows)


# ── Orchestration ─────────────────────────────────────────────────────────────


def run(years: list[int], dry_run: bool, conn_str: str | None) -> None:
    total = 0
    for year in years:
        url = FDLE_COUNTY_OFFENSE_URL.format(year=year)
        print(f"fdle_crime_swfl: downloading UCR {year} ({url})...")
        try:
            content = download_fdle_excel(year)
        except FileNotFoundError as exc:
            print(f"  SKIP: {exc}", file=sys.stderr)
            continue
        except requests.exceptions.RequestException as exc:
            print(f"  SKIP {year}: network error — {exc}", file=sys.stderr)
            continue

        try:
            rows = parse_fdle_excel(content, year)
        except ValueError as exc:
            print(f"  SKIP {year}: parse error — {exc}", file=sys.stderr)
            continue

        print(f"  {year}: {len(rows)} rows parsed ({[r['county'] for r in rows]}).")

        if dry_run:
            for r in rows:
                print(f"    {r}")
            continue

        if not conn_str:
            raise RuntimeError(
                "DESTINATION__POSTGRES__CREDENTIALS not set — cannot write to DB."
            )

        # ── Tier 1: NDJSON cold storage ───────────────────────────────────────
        supabase_url = os.environ.get("SUPABASE_URL")
        supabase_key = os.environ.get("SUPABASE_SERVICE_KEY")
        if supabase_url and supabase_key:
            ndjson_path = f"{TIER1_PREFIX}/{year}/fdle_crime_swfl.ndjson"
            byte_size = _upload_ndjson(TIER1_BUCKET, ndjson_path, rows)
            upsert_inventory_row(
                bucket=TIER1_BUCKET,
                path=ndjson_path,
                vintage=str(year),
                byte_size=byte_size,
                pack_id="safety-swfl",
                source_url=FDLE_CITATION_URL,
            )
            print(f"  Tier 1: {byte_size} bytes → {TIER1_BUCKET}/{ndjson_path}")
        else:
            print(
                "  WARNING: SUPABASE_URL / SUPABASE_SERVICE_KEY not set — "
                "skipping Tier-1 NDJSON upload.",
                file=sys.stderr,
            )

        # ── Tier 2: Postgres upsert ───────────────────────────────────────────
        written = upsert_rows(rows, conn_str)
        print(f"  Tier 2: upserted {written} rows.")
        total += written

    if not dry_run:
        print(f"Done. Total rows upserted: {total}.")


# ── CLI ───────────────────────────────────────────────────────────────────────


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="FDLE UCR property crime ingest — Lee + Collier counties."
    )
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument(
        "--backfill",
        action="store_true",
        help=f"Ingest all years from {EARLIEST_YEAR} through current.",
    )
    mode.add_argument(
        "--current",
        action="store_true",
        help="Ingest current and prior year (default for cron).",
    )
    mode.add_argument(
        "--year",
        type=int,
        metavar="YYYY",
        help="Ingest a specific year, e.g. --year 2023.",
    )
    parser.add_argument("--dry-run", action="store_true")

    args = parser.parse_args(argv)
    conn_str = os.environ.get("DESTINATION__POSTGRES__CREDENTIALS")
    current = _current_year()

    if args.backfill:
        years = list(range(EARLIEST_YEAR, current + 1))
    elif args.year:
        years = [args.year]
    else:
        years = [current - 1, current]

    print(
        f"fdle_crime_swfl: {'dry-run ' if args.dry_run else ''}"
        f"years={years}, counties={COUNTIES}"
    )
    run(years, dry_run=args.dry_run, conn_str=conn_str)
    return 0


if __name__ == "__main__":
    sys.exit(main())
