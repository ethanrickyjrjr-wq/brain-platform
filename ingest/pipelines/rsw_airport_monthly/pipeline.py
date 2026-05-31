"""
RSW Airport Monthly Statistics — ingest pipeline (v2).

Source: Lee County Port Authority (LCPA) — Reports and Statistics page
  URL:      https://www.flylcpa.com/about-lcpa/reports-and-statistics/
  Data:     Enplanements PDF (RSW only; LCPA does not operate PGD)
  Cadence:  monthly, updated in the first week of the following month
  Coverage: RSW (Southwest Florida International Airport) only

v1 scraped /about/statistics for an HTML table — that URL is now a 404.
v2 (this file) fetches the enplanements PDF linked from the reports page,
downloads it with requests, and parses with pdfplumber.

PDF structure (year-as-row):
    Year | JAN | FEB | MAR | ... | DEC | TOTAL
    1983 |     |     |     | ... |
    ...
    2026 | val | val | ...

Parser notes:
  - The header row is identified by the presence of 3+ month abbreviations.
  - Data rows whose first cell is a 4-digit year (19xx/20xx) are extracted.
  - The TOTAL column (rightmost) is skipped.
  - Empty cells produce no row (partial years for the current year are normal).

Usage:
  python -m ingest.pipelines.rsw_airport_monthly.pipeline [--dry-run]

Environment:
  FIRECRAWL_API_KEY                  — required (to scrape reports page for PDF URL)
  SPIDER_API_KEY                     — optional fallback
  DESTINATION__POSTGRES__CREDENTIALS — psycopg3 URI (required unless --dry-run)
"""
from __future__ import annotations

import argparse
import io
import os
import re
import sys
from datetime import date, datetime, timezone
from typing import Any

import psycopg
import requests

# ── Constants ─────────────────────────────────────────────────────────────────

REPORTS_PAGE_URL = "https://www.flylcpa.com/about-lcpa/reports-and-statistics/"

# Fallback: known-good S3 URL from November 2024. Update if LCPA re-uploads.
# Run with --dry-run after any LCPA site update to verify the dynamic URL first.
ENPLANEMENTS_PDF_URL_FALLBACK = (
    "https://s3.wasabisys.com/cdn.flylcpa.com/app/uploads/"
    "2024/11/21144941/RSW-Enplanement-Passengers.pdf"
)

TABLE = "rsw_airport_monthly"

MONTH_ABBREVS = [
    "jan", "feb", "mar", "apr", "may", "jun",
    "jul", "aug", "sep", "oct", "nov", "dec",
]
MONTH_MAP = {abbr: i + 1 for i, abbr in enumerate(MONTH_ABBREVS)}

Row = dict[str, Any]


# ── Helpers ───────────────────────────────────────────────────────────────────


def _parse_int(s: str) -> int | None:
    clean = re.sub(r"[,\s$]", "", str(s).strip())
    if not clean or clean in ("-", "N/A", "n/a", "—", "–", "*", ""):
        return None
    try:
        return int(clean)
    except ValueError:
        try:
            return int(float(clean))
        except ValueError:
            return None


def _make_id(report_month: date, airport_code: str, metric: str) -> str:
    return f"{report_month.strftime('%Y%m')}_{airport_code}_{metric}"


def _compute_yoy(rows: list[Row]) -> list[Row]:
    """Back-fill yoy_pct_change where current + prior-year rows both exist."""
    by_key: dict[tuple[str, str, int], dict[int, Row]] = {}
    for r in rows:
        rd = date.fromisoformat(r["report_month"])
        key = (r["airport_code"], r["metric"], rd.month)
        by_key.setdefault(key, {})[rd.year] = r

    for _key, year_map in by_key.items():
        years = sorted(year_map.keys(), reverse=True)
        if len(years) < 2:
            continue
        cur = year_map[years[0]]
        prv = year_map[years[1]]
        if (
            cur.get("yoy_pct_change") is None
            and cur.get("value") is not None
            and prv.get("value") is not None
            and prv["value"] != 0
        ):
            cur["yoy_pct_change"] = round(
                (cur["value"] - prv["value"]) / prv["value"] * 100, 2
            )

    return rows


# ── PDF URL discovery ─────────────────────────────────────────────────────────


def _find_enplanements_pdf_url() -> str:
    """Scrape the LCPA reports page to find the enplanements PDF link.

    Falls back to ENPLANEMENTS_PDF_URL_FALLBACK on any error.
    """
    from ingest.lib.extract_client import scrape_with_fallback

    try:
        response = scrape_with_fallback(REPORTS_PAGE_URL, formats=["markdown"])
        data = response.get("data", {})
        markdown = data.get("markdown", "") if isinstance(data, dict) else ""

        # Look for a S3 URL whose filename includes "Enplane" / "enplane" / "RSW-Enplane"
        # Example: https://s3.wasabisys.com/.../RSW-Enplanement-Passengers.pdf
        pattern = re.compile(
            r"(https://s3\.wasabisys\.com/[^\s\"'<>)]*[Ee]nplane[^\s\"'<>)]*\.pdf)"
        )
        m = pattern.search(markdown)
        if m:
            url = m.group(1).strip().rstrip('"').rstrip("'")
            print(f"rsw_airport_monthly: found enplanements PDF URL: {url}")
            return url
    except Exception as exc:
        print(f"rsw_airport_monthly: reports-page scrape failed ({exc}); using fallback PDF URL.")

    print(f"rsw_airport_monthly: using fallback PDF URL: {ENPLANEMENTS_PDF_URL_FALLBACK}")
    return ENPLANEMENTS_PDF_URL_FALLBACK


# ── PDF download ──────────────────────────────────────────────────────────────


def _download_pdf(url: str) -> bytes:
    """Download a PDF from a direct URL with a plain requests GET."""
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (compatible; SWFL-Data-Gulf/1.0; "
            "+https://www.swfldatagulf.com)"
        )
    }
    resp = requests.get(url, headers=headers, timeout=60, stream=True)
    resp.raise_for_status()
    return resp.content


# ── PDF parser ────────────────────────────────────────────────────────────────


def parse_enplanements_pdf(pdf_bytes: bytes, source_url: str) -> list[Row]:
    """Parse the RSW enplanements PDF into DB rows.

    The PDF has one table spanning multiple pages:
      Year | JAN | FEB | ... | DEC | TOTAL
      1983 |     |     | ... (partial)
      1984 | N   | N   | ...
      ...

    The TOTAL column is skipped. Empty cells are skipped (partial years).
    Returns rows sorted by report_month ascending.
    """
    try:
        import pdfplumber  # type: ignore[import-not-found]
    except ImportError as exc:
        raise RuntimeError("pdfplumber not installed — add it to ingest/requirements.txt") from exc

    now_iso = datetime.now(timezone.utc).isoformat()
    rows: list[Row] = []
    month_col_indices: list[tuple[int, int]] = []  # (col_idx, month_num)

    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        for page in pdf.pages:
            tables = page.extract_tables()
            for table in tables:
                for raw_row in table:
                    if not raw_row:
                        continue
                    cells = [str(c).strip() if c is not None else "" for c in raw_row]

                    # ── Header detection ─────────────────────────────────────
                    # A header row has ≥3 cells matching month abbreviations.
                    lower_cells = [c.lower()[:3] for c in cells]
                    matching_months = [
                        (i, MONTH_MAP[lc])
                        for i, lc in enumerate(lower_cells)
                        if lc in MONTH_MAP
                    ]
                    if len(matching_months) >= 3:
                        month_col_indices = matching_months
                        continue

                    if not month_col_indices:
                        continue

                    # ── Data row ─────────────────────────────────────────────
                    # First cell must be a 4-digit year.
                    first = cells[0].strip()
                    if not re.match(r"^(19|20)\d\d$", first):
                        continue
                    year = int(first)

                    for col_idx, month_num in month_col_indices:
                        if col_idx >= len(cells):
                            continue
                        value = _parse_int(cells[col_idx])
                        if value is None:
                            continue

                        report_month = date(year, month_num, 1)
                        rows.append({
                            "id": _make_id(report_month, "RSW", "enplanements"),
                            "report_month": report_month.isoformat(),
                            "airport_code": "RSW",
                            "metric": "enplanements",
                            "value": value,
                            "yoy_pct_change": None,
                            "period_label": report_month.strftime("%B %Y"),
                            "source_url": source_url,
                            "inserted_at": now_iso,
                        })

    # Deduplicate (same id → keep one)
    seen: dict[str, Row] = {}
    for r in rows:
        seen[r["id"]] = r
    rows = list(seen.values())
    rows.sort(key=lambda r: r["report_month"])

    return _compute_yoy(rows)


# ── DB upsert ─────────────────────────────────────────────────────────────────

UPSERT_SQL = f"""
INSERT INTO {TABLE} (
    id, report_month, airport_code, metric,
    value, yoy_pct_change, period_label, source_url, inserted_at
)
VALUES (
    %(id)s, %(report_month)s, %(airport_code)s, %(metric)s,
    %(value)s, %(yoy_pct_change)s, %(period_label)s, %(source_url)s, %(inserted_at)s
)
ON CONFLICT (id) DO UPDATE SET
    value          = EXCLUDED.value,
    yoy_pct_change = EXCLUDED.yoy_pct_change,
    period_label   = EXCLUDED.period_label,
    source_url     = EXCLUDED.source_url,
    inserted_at    = EXCLUDED.inserted_at
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


def run(dry_run: bool, conn_str: str | None) -> None:
    # Step 1: find PDF URL
    pdf_url = _find_enplanements_pdf_url()

    # Step 2: download PDF
    print(f"rsw_airport_monthly: downloading enplanements PDF...")
    pdf_bytes = _download_pdf(pdf_url)
    print(f"rsw_airport_monthly: downloaded {len(pdf_bytes):,} bytes.")

    # Step 3: parse
    rows = parse_enplanements_pdf(pdf_bytes, source_url=pdf_url)

    if not rows:
        raise RuntimeError(
            "rsw_airport_monthly: zero rows parsed from PDF. "
            "Check that pdfplumber can read the file and that the table structure "
            f"matches the expected year-as-row format. PDF URL: {pdf_url}"
        )

    # Summary
    years = sorted({r["report_month"][:4] for r in rows})
    rsw_rows = [r for r in rows if r["airport_code"] == "RSW"]
    print(
        f"rsw_airport_monthly: parsed {len(rows)} rows  "
        f"RSW={len(rsw_rows)}  "
        f"years={years[0]}–{years[-1]}"
    )

    # Print most-recent 24 rows for inspection
    recent = sorted(rows, key=lambda r: r["report_month"], reverse=True)[:24]
    for r in recent:
        pct_str = f" {r['yoy_pct_change']:+.1f}%" if r["yoy_pct_change"] is not None else ""
        print(
            f"  {r['airport_code']:<4}  {r['period_label']:<16}  "
            f"{r['metric']:<22}  {r['value']:>10,}{pct_str}"
        )

    if dry_run:
        print("rsw_airport_monthly: --dry-run, skipping DB write.")
        return

    if not conn_str:
        raise RuntimeError(
            "DESTINATION__POSTGRES__CREDENTIALS not set — cannot write to DB."
        )
    written = upsert_rows(rows, conn_str)
    print(f"rsw_airport_monthly: upserted {written} rows into {TABLE}.")


# ── CLI ───────────────────────────────────────────────────────────────────────


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="RSW monthly enplanement ingest pipeline (LCPA PDF)."
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Download and parse, print rows, do not write to DB.",
    )
    args = parser.parse_args(argv)

    api_key = os.environ.get("FIRECRAWL_API_KEY")
    if not api_key:
        print("WARNING: FIRECRAWL_API_KEY not set — will use fallback PDF URL.", file=sys.stderr)

    conn_str = os.environ.get("DESTINATION__POSTGRES__CREDENTIALS")
    run(dry_run=args.dry_run, conn_str=conn_str)
    return 0


if __name__ == "__main__":
    sys.exit(main())
