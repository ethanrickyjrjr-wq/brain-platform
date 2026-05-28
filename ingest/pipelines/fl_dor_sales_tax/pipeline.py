"""
FL DOR Form 10 — Taxable Sales by Business Type, ingest pipeline.

Downloads the biennial Form 10 Excel from Florida DOR, parses the per-county
sheets for Lee + Collier, and upserts monthly taxable-sales rows by business
type into public.fl_dor_sales_tax.

URL pattern (confirmed live cy0203–cy2425 as of 2026-05-28):
  https://floridarevenue.com/dataPortal/GTA/Form%2010/All%20Taxable%20Sales/
  F10_txsales_cy{start:02d}{end:02d}.xlsx

File structure (verified from cy2223):
  - One sheet per FL county (+ Summary + Line Item Detail sheets).
  - Row 8:  col C = DOR county code, col D = county name.
  - Row 12: col B = "Kind Code", cols C+ = "Month YYYY" column headers.
  - Row 13+: col B = business type name, cols C+ = taxable_sales_usd.
  - Each file covers 24 months (2 calendar years, Jan–Dec for each).

Year-pair convention:
  cy2223 → start=22 (2022), end=23 (2023) → Jan 2022 – Dec 2023.
  cy2425 → start=24 (2024), end=25 (2025) → Jan 2024 – Dec 2025 (current).
  Files release in pairs; next pair will be cy2627.

Usage:
  python -m ingest.pipelines.fl_dor_sales_tax.pipeline [--backfill] [--current]
      [--year-pair START END] [--dry-run] [--counties Lee,Collier]

Environment:
  DESTINATION__POSTGRES__CREDENTIALS — psycopg3 connection URI
"""

from __future__ import annotations

import argparse
import io
import os
import re
import sys
import zipfile
from datetime import date, datetime, timezone
from typing import Iterator

import psycopg
import requests

from .constants import (
    COUNTY_CODE_MAP,
    DATA_START_COL,
    DATA_START_ROW,
    DEFAULT_COUNTIES,
    EARLIEST_START_YEAR,
    FORM10_URL,
    HEADER_ROW,
    SOURCE_URL_TMPL,
    TABLE,
)

# ── Helpers ───────────────────────────────────────────────────────────────────


def current_year_pair() -> tuple[int, int]:
    """Return the (start, end) 4-digit years of the active file pair.

    Form 10 pairs start on even years: cy0203, cy0405 ... cy2425, cy2627.
    Each file covers 2 full calendar years and is published with ~2-month lag.
    The 'current' file is the one FL DOR is actively updating — which covers
    through the prior calendar year (since cy2627 won't exist until FL DOR
    begins publishing 2026 data, likely mid-2026 at earliest).

    2026 → reference year = 2025 → floor to even = 2024 → pair (2024, 2025).
    2027 → reference year = 2026 → floor to even = 2026 → pair (2026, 2027).
    """
    y = datetime.now(timezone.utc).year
    reference = y - 1  # most recent year FL DOR has data for
    start = reference if reference % 2 == 0 else reference - 1
    return start, start + 1


def all_year_pairs(from_year: int = EARLIEST_START_YEAR) -> list[tuple[int, int]]:
    start, end = current_year_pair()
    pairs = []
    s = from_year
    while s <= start:
        pairs.append((s, s + 1))
        s += 2
    return pairs


def pair_url(start: int, end: int) -> str:
    return FORM10_URL.format(start=start % 100, end=end % 100)


# ── Excel parsing ─────────────────────────────────────────────────────────────


def _load_shared_strings(zf: zipfile.ZipFile) -> list[str]:
    xml = zf.read("xl/sharedStrings.xml").decode("utf-8")
    return re.findall(r"<t[^>]*>([^<]*)</t>", xml)


def _sheet_index_for_county(zf: zipfile.ZipFile, county: str) -> int | None:
    """Return 1-based sheet file index (matches sheet{N}.xml) for the county."""
    wb_xml = zf.read("xl/workbook.xml").decode("utf-8")
    sheet_names = re.findall(r'<sheet name="([^"]+)"', wb_xml)
    try:
        return sheet_names.index(county) + 1  # 1-based
    except ValueError:
        return None


def _parse_period(header: str) -> date | None:
    """'January 2022' → date(2022, 1, 1). Returns None on parse failure."""
    try:
        d = datetime.strptime(header.strip(), "%B %Y")
        return d.date().replace(day=1)
    except ValueError:
        return None


def _parse_usd(value: object) -> float | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value) if value == value else None  # NaN guard
    text = str(value).replace("$", "").replace(",", "").strip()
    if text in ("", "None", "N/A", "#VALUE!", "#REF!"):
        return None
    try:
        return float(text)
    except ValueError:
        return None


Row = dict  # county, county_code, kind_code, business_type, period, taxable_sales_usd, ...


def parse_county_sheet(
    zf: zipfile.ZipFile,
    strings: list[str],
    county: str,
    start_year: int,
    end_year: int,
    source_url: str,
) -> list[Row]:
    """Parse one county's sheet from Form 10. Returns list of Row dicts."""
    sheet_idx = _sheet_index_for_county(zf, county)
    if sheet_idx is None:
        print(
            f"  WARNING: county '{county}' sheet not found in cy{start_year % 100:02d}{end_year % 100:02d}.",
            file=sys.stderr,
        )
        return []

    sheet_xml = zf.read(f"xl/worksheets/sheet{sheet_idx}.xml").decode("utf-8")
    all_rows = re.findall(
        r'<row[^>]*r="(\d+)"[^>]*>(.*?)</row>', sheet_xml, re.DOTALL
    )
    row_map: dict[int, list[tuple[str, str, str]]] = {}
    for rnum_str, rcontent in all_rows:
        rnum = int(rnum_str)
        cells = re.findall(
            r'<c r="([^"]+)"(?:[^>]* t="([^"]+)")?[^>]*><v>([^<]*)</v>', rcontent
        )
        row_map[rnum] = cells

    def cell_val(cells: list[tuple[str, str, str]], col_idx: int) -> str:
        """Get value at 0-based column index from a list of (ref, type, val) cells."""
        for ref, typ, val in cells:
            # Convert col letter(s) to 0-based index
            col_letters = re.match(r"([A-Z]+)", ref)
            if not col_letters:
                continue
            letters = col_letters.group(1)
            col_num = 0
            for ch in letters:
                col_num = col_num * 26 + (ord(ch) - ord("A") + 1)
            col_num -= 1  # 0-based
            if col_num == col_idx:
                if typ == "s":
                    idx = int(val)
                    return strings[idx] if idx < len(strings) else val
                return val
        return ""

    # County code from row 8, col C (index 2)
    county_code = cell_val(row_map.get(8, []), 2) or COUNTY_CODE_MAP.get(county, "")

    # Header row (12): build column-index → period mapping
    header_cells = row_map.get(HEADER_ROW, [])
    col_to_period: dict[int, date] = {}
    for ref, typ, val in header_cells:
        col_letters = re.match(r"([A-Z]+)", ref)
        if not col_letters:
            continue
        letters = col_letters.group(1)
        col_num = 0
        for ch in letters:
            col_num = col_num * 26 + (ord(ch) - ord("A") + 1)
        col_num -= 1  # 0-based
        raw = strings[int(val)] if typ == "s" and val else val
        period = _parse_period(raw)
        if period is not None:
            col_to_period[col_num] = period

    if not col_to_period:
        print(
            f"  WARNING: no month headers found in {county} sheet (cy{start_year % 100:02d}{end_year % 100:02d}).",
            file=sys.stderr,
        )
        return []

    now_iso = datetime.now(timezone.utc).isoformat()
    rows: list[Row] = []

    for rnum in range(DATA_START_ROW, max(row_map.keys()) + 1):
        data_cells = row_map.get(rnum, [])
        if not data_cells:
            continue

        # kind_code is col A (index 0) — stored as a number in Excel
        kind_raw = cell_val(data_cells, 0)
        if not kind_raw.strip():
            continue
        try:
            kind_code = int(float(kind_raw))
        except (ValueError, OverflowError):
            continue

        # business_type is col B (index 1) — shared string
        biz_type = cell_val(data_cells, 1).strip()
        if not biz_type:
            continue

        # Data columns: each maps to a period
        for col_idx, period in col_to_period.items():
            usd_raw = cell_val(data_cells, col_idx)
            usd = _parse_usd(usd_raw) if usd_raw else None
            if usd is None:
                continue  # not yet published
            rows.append(
                {
                    "county": county,
                    "county_code": county_code,
                    "kind_code": kind_code,
                    "business_type": biz_type,
                    "period": period.isoformat(),
                    "taxable_sales_usd": usd,
                    "source_url": source_url,
                    "retrieved_at": now_iso,
                }
            )

    return rows


# ── Download ──────────────────────────────────────────────────────────────────


def download_form10(start: int, end: int, timeout: int = 180) -> bytes:
    url = pair_url(start, end)
    resp = requests.get(url, timeout=timeout)
    if resp.status_code == 404:
        raise FileNotFoundError(
            f"Form 10 cy{start % 100:02d}{end % 100:02d} not found at {url}"
        )
    resp.raise_for_status()
    return resp.content


# ── DB upsert ─────────────────────────────────────────────────────────────────


UPSERT_SQL = f"""
INSERT INTO {TABLE}
  (county, county_code, kind_code, business_type, period,
   taxable_sales_usd, source_url, retrieved_at)
VALUES
  (%(county)s, %(county_code)s, %(kind_code)s, %(business_type)s, %(period)s,
   %(taxable_sales_usd)s, %(source_url)s, %(retrieved_at)s)
ON CONFLICT (county, kind_code, period) DO UPDATE SET
  taxable_sales_usd = EXCLUDED.taxable_sales_usd,
  business_type     = EXCLUDED.business_type,
  county_code       = EXCLUDED.county_code,
  source_url        = EXCLUDED.source_url,
  retrieved_at      = EXCLUDED.retrieved_at
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


def run(
    pairs: list[tuple[int, int]],
    counties: list[str],
    dry_run: bool,
    conn_str: str | None,
) -> None:
    total = 0
    for start, end in pairs:
        label = f"cy{start % 100:02d}{end % 100:02d}"
        print(f"{label}: downloading Form 10 ({pair_url(start, end)})...")
        try:
            content = download_form10(start, end)
        except FileNotFoundError as exc:
            print(f"  SKIP: {exc}", file=sys.stderr)
            continue
        except requests.exceptions.RequestException as exc:
            print(f"  SKIP {label}: network error — {exc}", file=sys.stderr)
            continue

        with zipfile.ZipFile(io.BytesIO(content)) as zf:
            strings = _load_shared_strings(zf)
            all_rows: list[Row] = []
            for county in counties:
                rows = parse_county_sheet(
                    zf, strings, county, start, end,
                    source_url=SOURCE_URL_TMPL.format(start=start % 100, end=end % 100),
                )
                print(f"  {county}: {len(rows)} rows parsed.")
                all_rows.extend(rows)

        if dry_run:
            for r in all_rows[:3]:
                print(f"    {r}")
            if len(all_rows) > 3:
                print(f"    ... and {len(all_rows) - 3} more")
        else:
            if not conn_str:
                raise RuntimeError(
                    "DESTINATION__POSTGRES__CREDENTIALS not set — cannot write to DB."
                )
            written = upsert_rows(all_rows, conn_str)
            print(f"  Upserted {written} rows.")
            total += written

    if not dry_run:
        print(f"Done. Total rows upserted: {total}.")


# ── CLI ───────────────────────────────────────────────────────────────────────


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="FL DOR Form 10 Taxable Sales ingest pipeline."
    )
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument(
        "--backfill",
        action="store_true",
        help=f"Ingest all available year-pairs (cy0203 through current).",
    )
    mode.add_argument(
        "--current",
        action="store_true",
        help="Ingest current + prior year-pair (default for cron).",
    )
    mode.add_argument(
        "--year-pair",
        nargs=2,
        type=int,
        metavar=("START", "END"),
        help="Ingest a specific year pair, e.g. --year-pair 2022 2023.",
    )
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument(
        "--counties",
        default=",".join(DEFAULT_COUNTIES),
        help=f"Comma-separated county names (default: {','.join(DEFAULT_COUNTIES)}).",
    )

    args = parser.parse_args(argv)
    counties = [c.strip() for c in args.counties.split(",") if c.strip()]
    conn_str = os.environ.get("DESTINATION__POSTGRES__CREDENTIALS")
    cur_start, cur_end = current_year_pair()

    if args.backfill:
        pairs = all_year_pairs()
    elif args.year_pair:
        pairs = [(args.year_pair[0], args.year_pair[1])]
    else:
        # --current: current pair + prior pair
        prior_start = cur_start - 2
        pairs = [(prior_start, prior_start + 1), (cur_start, cur_end)]

    print(
        f"fl_dor_sales_tax: {'dry-run ' if args.dry_run else ''}"
        f"pairs={[(s, e) for s, e in pairs]}, counties={counties}"
    )
    run(pairs, counties, dry_run=args.dry_run, conn_str=conn_str)
    return 0


if __name__ == "__main__":
    sys.exit(main())
