"""
RSW Airport Monthly Statistics — ingest pipeline.

Scrapes the Lee County Port Authority (LCPA) statistics page
(https://www.flylcpa.com/about/statistics) using Firecrawl (with Spider
fallback via extract_client.scrape_with_fallback), extracts monthly
enplanement counts for RSW (Southwest Florida International Airport) and
PGD (Punta Gorda Airport), and upserts into public.rsw_airport_monthly.

Source: Lee County Port Authority
  URL:      https://www.flylcpa.com/about/statistics
  Cadence:  monthly, published in the first week of the following month
  Coverage: RSW + PGD; primary metric = enplanements (passengers boarding)

Parser notes:
  Firecrawl renders the JS-heavy LCPA page and returns markdown. The parser
  looks for markdown tables whose headers contain 4-digit year numbers (e.g.
  "2026", "2025") and whose data rows start with a month name. If the page
  structure changes and parse_stats() returns [], the pipeline raises a
  RuntimeError with instructions to update the parser.

  Run --dry-run first after any website redesign to verify parsing before
  writing to the DB.

Usage:
  python -m ingest.pipelines.rsw_airport_monthly.pipeline [--dry-run]

Environment:
  FIRECRAWL_API_KEY                  — required
  SPIDER_API_KEY                     — optional fallback
  DESTINATION__POSTGRES__CREDENTIALS — psycopg3 URI (required unless --dry-run)
"""
from __future__ import annotations

import argparse
import os
import re
import sys
from datetime import date, datetime, timezone
from typing import Any

import psycopg
from ingest.lib.extract_client import scrape_with_fallback

# ── Constants ─────────────────────────────────────────────────────────────────

STATS_URL = "https://www.flylcpa.com/about/statistics"
TABLE = "rsw_airport_monthly"

MONTH_NAMES: dict[str, int] = {
    "january": 1, "february": 2, "march": 3, "april": 4,
    "may": 5, "june": 6, "july": 7, "august": 8,
    "september": 9, "october": 10, "november": 11, "december": 12,
    "jan": 1, "feb": 2, "mar": 3, "apr": 4,
    "jun": 6, "jul": 7, "aug": 8, "sep": 9, "sept": 9,
    "oct": 10, "nov": 11, "dec": 12,
}

# Keywords in column headers that signal enplanements vs total passengers.
# The first match wins; default is "enplanements".
_METRIC_KEYWORDS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"enplan|board", re.IGNORECASE), "enplanements"),
    (re.compile(r"deplan|arriv", re.IGNORECASE), "deplaned"),
    (re.compile(r"total.pass|passenger", re.IGNORECASE), "total_passengers"),
    (re.compile(r"operat|ops", re.IGNORECASE), "aircraft_operations"),
    (re.compile(r"cargo|freight", re.IGNORECASE), "cargo_lbs"),
]

Row = dict[str, Any]


# ── Helpers ───────────────────────────────────────────────────────────────────


def _parse_int(s: str) -> int | None:
    """Parse a possibly comma-formatted integer. Returns None on failure."""
    clean = re.sub(r"[,\s]", "", s.strip())
    if not clean or clean in ("-", "N/A", "n/a", "—", "–", "*"):
        return None
    try:
        return int(clean)
    except ValueError:
        try:
            return int(float(clean))
        except ValueError:
            return None


def _parse_pct(s: str) -> float | None:
    """Parse a percentage like '3.2%', '-1.5', or '(3.2)'. Returns None on failure."""
    clean = re.sub(r"[%\s]", "", s.strip())
    # Parenthetical negatives: (3.2) → -3.2
    clean = re.sub(r"\(([0-9.]+)\)", r"-\1", clean)
    if not clean or clean in ("-", "N/A", "n/a", "—"):
        return None
    try:
        return round(float(clean), 2)
    except ValueError:
        return None


def _make_id(report_month: date, airport_code: str, metric: str) -> str:
    return f"{report_month.strftime('%Y%m')}_{airport_code}_{metric}"


def _resolve_metric(header_row_text: str) -> str:
    """Infer metric slug from the column header text block."""
    for pattern, slug in _METRIC_KEYWORDS:
        if pattern.search(header_row_text):
            return slug
    return "enplanements"


def _compute_yoy(rows: list[Row]) -> list[Row]:
    """Back-fill yoy_pct_change where current+prior year rows both exist.

    Groups by (airport_code, metric, calendar month). If a row's
    yoy_pct_change is already set (from the scrape), it is preserved.
    """
    # (airport_code, metric, month_number) → {year: Row}
    by_key: dict[tuple[str, str, int], dict[int, Row]] = {}
    for r in rows:
        rd = date.fromisoformat(r["report_month"])
        key = (r["airport_code"], r["metric"], rd.month)
        by_key.setdefault(key, {})[rd.year] = r

    for key, year_map in by_key.items():
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


# ── Parser ────────────────────────────────────────────────────────────────────


def parse_stats(markdown: str, source_url: str) -> list[Row]:
    """Parse LCPA statistics page markdown → list of DB rows.

    Strategy:
    1. Scan for markdown tables (lines starting with '|').
    2. Treat a table header as valid when at least one column contains a
       4-digit year (20xx). That year number becomes the key for mapping
       columns to report months.
    3. Data rows whose first cell matches a known month name are emitted as
       rows with airport_code derived from the nearest preceding section
       heading ("RSW" / "PGD").
    4. YoY pct change is taken from any column matching r'%|change|chg|var';
       if absent it is computed post-parse where both years are present.

    Returns [] if no parseable data is found. The caller raises RuntimeError.
    Update the parser when the LCPA page structure changes.
    """
    text = markdown.replace("\r\n", "\n")
    lines = text.split("\n")
    now_iso = datetime.now(timezone.utc).isoformat()
    rows: list[Row] = []

    current_airport = "RSW"  # updated by section headings
    in_table = False
    header_cols: list[str] = []
    year_col_indices: list[int] = []
    pct_col_idx: int | None = None
    metric = "enplanements"

    for line in lines:
        stripped = line.strip()
        upper = stripped.upper()

        # ── Airport context detection ────────────────────────────────────────
        # Update when we see a heading that names an airport.
        if any(kw in upper for kw in (
            "SOUTHWEST FLORIDA INTERNATIONAL", "FORT MYERS", " RSW",
        )) and not stripped.startswith("|"):
            current_airport = "RSW"
        elif any(kw in upper for kw in (
            "PUNTA GORDA", " PGD", "CHARLOTTE COUNTY",
        )) and not stripped.startswith("|"):
            current_airport = "PGD"

        # ── Table boundary ───────────────────────────────────────────────────
        if not stripped.startswith("|"):
            # Leaving a table — reset state but keep airport context.
            in_table = False
            header_cols = []
            year_col_indices = []
            pct_col_idx = None
            metric = "enplanements"
            continue

        # ── Parse table cells ────────────────────────────────────────────────
        parts = [c.strip() for c in stripped.split("|")]
        parts = [c for c in parts if c]  # drop empty splits

        if not parts:
            continue

        # Skip separator rows (---|---)
        if all(re.match(r"^[-:]+$", p) for p in parts):
            continue

        # ── Header row detection ─────────────────────────────────────────────
        # A header row has at least one cell matching a 4-digit year (20xx).
        year_hits = [(i, int(p)) for i, p in enumerate(parts) if re.match(r"^20\d\d$", p)]
        if year_hits and not in_table:
            header_cols = parts
            year_col_indices = [i for i, _ in year_hits]
            pct_col_idx = next(
                (i for i, p in enumerate(parts)
                 if re.match(r"^(%|change|chg|var|yoy)", p, re.IGNORECASE)),
                None,
            )
            # Infer metric from the full header row text
            metric = _resolve_metric(stripped)
            in_table = True
            continue

        if not in_table:
            continue

        # ── Data row ─────────────────────────────────────────────────────────
        first = parts[0].lower().rstrip(".,:")
        month_num = MONTH_NAMES.get(first)
        if month_num is None:
            # Not a month row — could be a "Total" row or sub-header; skip.
            if re.match(r"(total|ytd|annual)", first, re.IGNORECASE):
                continue
            # Unexpected content; if this extends far, treat as end of table.
            continue

        # Extract value for each year column
        for col_idx in year_col_indices:
            if col_idx >= len(parts):
                continue
            year = int(header_cols[col_idx])
            value = _parse_int(parts[col_idx])
            if value is None:
                continue

            pct: float | None = None
            if pct_col_idx is not None and pct_col_idx < len(parts):
                pct = _parse_pct(parts[pct_col_idx])

            report_month = date(year, month_num, 1)
            rows.append({
                "id": _make_id(report_month, current_airport, metric),
                "report_month": report_month.isoformat(),
                "airport_code": current_airport,
                "metric": metric,
                "value": value,
                "yoy_pct_change": pct if len(year_col_indices) == 1 else None,
                "period_label": report_month.strftime("%B %Y"),
                "source_url": source_url,
                "inserted_at": now_iso,
            })

    if not rows:
        return []

    return _compute_yoy(rows)


# ── Fetch ─────────────────────────────────────────────────────────────────────


def fetch_page() -> str:
    """Fetch LCPA statistics page markdown via scrape_with_fallback."""
    response = scrape_with_fallback(STATS_URL, formats=["markdown"])
    data = response.get("data", {})
    return data.get("markdown", "") if isinstance(data, dict) else ""


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
    print("rsw_airport_monthly: fetching LCPA statistics page via Firecrawl...")
    markdown = fetch_page()

    if not markdown:
        raise RuntimeError(
            "rsw_airport_monthly: Firecrawl returned empty markdown. "
            "The LCPA statistics page may be blocked or restructured."
        )

    rows = parse_stats(markdown, source_url=STATS_URL)

    if not rows:
        raise RuntimeError(
            "rsw_airport_monthly: zero rows parsed — LCPA page structure may have "
            "changed. Run with --dry-run and update parse_stats() as needed. "
            f"Markdown excerpt (first 800 chars):\n{markdown[:800]}"
        )

    # Only emit enplanement rows in the summary (filter out derived metrics)
    enplane_rows = [r for r in rows if r["metric"] == "enplanements"]
    print(f"rsw_airport_monthly: parsed {len(rows)} rows "
          f"({len(enplane_rows)} enplanement, {len(rows) - len(enplane_rows)} other).")
    for r in sorted(rows, key=lambda x: (x["airport_code"], x["report_month"]), reverse=True)[:20]:
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
        description="RSW/PGD monthly enplanement ingest pipeline (LCPA)."
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Fetch and parse, print rows, do not write to DB.",
    )
    args = parser.parse_args(argv)

    api_key = os.environ.get("FIRECRAWL_API_KEY")
    if not api_key:
        print("ERROR: FIRECRAWL_API_KEY not set.", file=sys.stderr)
        return 1

    conn_str = os.environ.get("DESTINATION__POSTGRES__CREDENTIALS")
    run(dry_run=args.dry_run, conn_str=conn_str)
    return 0


if __name__ == "__main__":
    sys.exit(main())
