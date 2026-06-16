"""
FGCU RERI Regional Economic Indicators — monthly ingest pipeline.

Scrapes the FGCU Regional Economic Research Institute homepage
(https://www.fgcu.edu/cob/reri/) using Firecrawl, extracts the 8
"Southwest Florida Economic Outlook" monthly metrics, and upserts into
public.fgcu_reri_indicators.

Source: FGCU Lutgert College of Business – Regional Economic Research Institute
  URL:      https://www.fgcu.edu/cob/reri/
  PDF:      https://www.fgcu.edu/cob/reri/files/rei/indicators{YYYYMM}.pdf
  Cadence:  ~4th of each month, ~2-month data lag
  Coverage: Lee, Collier, Charlotte counties (SWFL coastal)

Usage:
  python -m ingest.pipelines.fgcu_reri_indicators.pipeline [--current] [--dry-run]

Environment:
  FIRECRAWL_API_KEY                  — Firecrawl API key (required)
  DESTINATION__POSTGRES__CREDENTIALS — psycopg3 connection URI (required unless --dry-run)
"""
from __future__ import annotations

import argparse
import os
import re
import sys
from datetime import date, datetime, timezone
from typing import Iterator

import psycopg

from ingest.lib.crawl4ai_client import fetch_page_markdown

# ── Constants ─────────────────────────────────────────────────────────────────

RERI_HOME_URL = "https://www.fgcu.edu/cob/reri/"
TABLE = "fgcu_reri_indicators"

INDICATOR_LABELS: dict[str, str] = {
    "Airport Activity": "airport_activity",
    "Tourist Tax Revenues": "tourist_tax_revenues",
    "Taxable Sales": "taxable_sales",
    "Unemployment Rate": "unemployment_rate",
    "Single-family Building Permits": "permits_single_family",
    "Single-family Home Sales": "home_sales_single_family",
    "Single-family Home Prices": "home_prices_single_family",
    "Residential Active Listings": "active_listings_residential",
}

MONTH_NAMES: dict[str, int] = {
    "January": 1, "February": 2, "March": 3, "April": 4,
    "May": 5, "June": 6, "July": 7, "August": 8,
    "September": 9, "October": 10, "November": 11, "December": 12,
}

# Regex for simple indicator sentences:
#   "Up 1.8 percent from March 2025 to March 2026."
#   "Down 14.7 percent from January 2025 to January 2026."
#   "Up 1.7 percentage points from February 2025 to February 2026."
_SIMPLE_RE = re.compile(
    r"^(Up|Down)\s+([\d.]+)\s+(percent|percentage points)\s+"
    r"from\s+([A-Z][a-z]+ \d{4})\s+to\s+([A-Z][a-z]+ \d{4})",
    re.IGNORECASE,
)

# Regex for multi-county home price sentences:
#   "Up 5.6 percent in Collier, down 1.1 and 4.6 percent in Charlotte and Lee
#    from March 2025 to March 2026."
_MULTI_COUNTY_RE = re.compile(
    r"from\s+([A-Z][a-z]+ \d{4})\s+to\s+([A-Z][a-z]+ \d{4})",
    re.IGNORECASE,
)
_PER_COUNTY_RE = re.compile(
    r"(up|down)\s+([\d.]+)\s+(?:and\s+[\d.]+\s+)?percent(?:age points)?\s+in\s+"
    r"(Collier|Lee|Charlotte|Hendry|Glades)",
    re.IGNORECASE,
)

Row = dict  # typed below in UPSERT_SQL


def _parse_month(text: str) -> date | None:
    """'March 2026' → date(2026, 3, 1). Returns None on failure."""
    parts = text.strip().split()
    if len(parts) != 2:
        return None
    month_name, year_str = parts
    month = MONTH_NAMES.get(month_name.capitalize())
    if not month:
        return None
    try:
        return date(int(year_str), month, 1)
    except ValueError:
        return None


def _parse_report_month(text: str) -> date | None:
    """'MAY 2026' → date(2026, 5, 1)."""
    parts = text.strip().split()
    if len(parts) != 2:
        return None
    month_name = parts[0].capitalize()
    month = MONTH_NAMES.get(month_name)
    if not month:
        return None
    try:
        return date(int(parts[1]), month, 1)
    except ValueError:
        return None


def _make_id(report_month: date, indicator: str, county: str) -> str:
    return f"{report_month.strftime('%Y%m')}_{indicator}_{county}"


def parse_indicators(markdown: str, source_url: str) -> list[Row]:
    """Parse RERI homepage markdown → list of indicator rows.

    Finds the 'Southwest Florida Economic Outlook' section and extracts
    the 8 monthly metrics. Returns [] if the section is not found or
    cannot be parsed.
    """
    # Normalise line endings
    text = markdown.replace("\r\n", "\n")
    lines = text.split("\n")

    # Locate the indicator section start.
    start_idx: int | None = None
    for i, line in enumerate(lines):
        if "Southwest Florida Economic Outlook" in line:
            start_idx = i
            break

    if start_idx is None:
        print("parse_indicators: 'Southwest Florida Economic Outlook' section not found.",
              file=sys.stderr)
        return []

    # Extract report month from the line that looks like "MAY 2026" or "APRIL 2026".
    report_month: date | None = None
    for line in lines[start_idx + 1 : start_idx + 10]:
        stripped = line.strip()
        if re.match(r"^[A-Z]+ \d{4}$", stripped):
            report_month = _parse_report_month(stripped)
            break

    if report_month is None:
        print("parse_indicators: could not parse report month.", file=sys.stderr)
        return []

    now_iso = datetime.now(timezone.utc).isoformat()
    rows: list[Row] = []

    # Walk indicator name / value pairs.
    # After the report-month header, expect alternating: blank → indicator_name → blank → value_sentence
    # Allow extra blank lines between them (the Firecrawl output has variable spacing).
    indicator_names = set(INDICATOR_LABELS.keys())
    current_indicator: str | None = None

    for line in lines[start_idx + 1:]:
        stripped = line.strip()

        # Stop at the report-link line.
        if "[MAY" in stripped or "[APRIL" in stripped or "[MARCH" in stripped \
                or "[FEBRUARY" in stripped or "[JANUARY" in stripped \
                or "[JUNE" in stripped or "[JULY" in stripped \
                or "[AUGUST" in stripped or "[SEPTEMBER" in stripped \
                or "[OCTOBER" in stripped or "[NOVEMBER" in stripped \
                or "[DECEMBER" in stripped:
            break
        # Also stop at another section header.
        if stripped.startswith("##") or stripped.startswith("Recent Publications"):
            break

        # Detect indicator name.
        if stripped in indicator_names:
            current_indicator = stripped
            continue

        # Detect and parse value sentence.
        if current_indicator and (stripped.startswith("Up ") or stripped.startswith("Down ")):
            indicator_slug = INDICATOR_LABELS[current_indicator]

            # Handle multi-county home prices separately.
            if indicator_slug == "home_prices_single_family" and " in " in stripped:
                period_match = _MULTI_COUNTY_RE.search(stripped)
                period_label = stripped
                ref_end: date | None = None
                if period_match:
                    ref_end = _parse_month(period_match.group(2))
                    period_label = f"{period_match.group(1)} to {period_match.group(2)}"
                    # Strip the period clause so county/value parsing is cleaner.
                    sentence = stripped[: period_match.start()].strip().rstrip(",")
                else:
                    sentence = stripped

                # Parse segments like:
                #   "Up 5.6 percent in Collier"
                #   "down 1.1 and 4.6 percent in Charlotte and Lee"
                # Split on ", " to get individual clauses.
                _COUNTY_NAMES = r"(Collier|Lee|Charlotte|Hendry|Glades)"
                for segment in re.split(r",\s*", sentence):
                    seg = segment.strip()
                    dir_match = re.match(r"(up|down)\s+", seg, re.IGNORECASE)
                    if not dir_match:
                        continue
                    direction = dir_match.group(1).lower()

                    # Extract all numeric values and county names in this segment.
                    vals = [float(v) for v in re.findall(r"[\d.]+", seg)]
                    counties_in_seg = re.findall(_COUNTY_NAMES, seg, re.IGNORECASE)

                    # Pair values to counties in order; if lengths mismatch, use last val.
                    for idx, county_name in enumerate(counties_in_seg):
                        val_idx = min(idx, len(vals) - 1)
                        pct = vals[val_idx] if vals else 0.0
                        if direction == "down":
                            pct = -pct
                        county_slug = county_name.lower()
                        rows.append({
                            "id": _make_id(report_month, indicator_slug, county_slug),
                            "report_month": report_month.isoformat(),
                            "indicator": indicator_slug,
                            "county": county_slug,
                            "reference_period_label": period_label,
                            "reference_period_end": ref_end.isoformat() if ref_end else None,
                            "pct_change": pct,
                            "pct_change_unit": "percent",
                            "source_url": source_url,
                            "inserted_at": now_iso,
                        })
                current_indicator = None
                continue

            # Simple single-value indicator.
            m = _SIMPLE_RE.match(stripped)
            if m:
                direction_str, pct_str, unit_str, period_from, period_to = (
                    m.group(1), m.group(2), m.group(3), m.group(4), m.group(5)
                )
                direction = direction_str.lower()
                pct = float(pct_str)
                if direction == "down":
                    pct = -pct
                ref_end = _parse_month(period_to)
                rows.append({
                    "id": _make_id(report_month, indicator_slug, "swfl"),
                    "report_month": report_month.isoformat(),
                    "indicator": indicator_slug,
                    "county": "swfl",
                    "reference_period_label": f"{period_from} to {period_to}",
                    "reference_period_end": ref_end.isoformat() if ref_end else None,
                    "pct_change": pct,
                    "pct_change_unit": unit_str.lower(),
                    "source_url": source_url,
                    "inserted_at": now_iso,
                })
            current_indicator = None

    return rows


# ── Fetch ─────────────────────────────────────────────────────────────────────


def fetch_homepage() -> str:
    """Return markdown of the RERI homepage via crawl4ai."""
    return fetch_page_markdown(RERI_HOME_URL)


# ── DB upsert ─────────────────────────────────────────────────────────────────


UPSERT_SQL = f"""
INSERT INTO {TABLE} (
    id, report_month, indicator, county,
    reference_period_label, reference_period_end,
    pct_change, pct_change_unit, source_url, inserted_at
)
VALUES (
    %(id)s, %(report_month)s, %(indicator)s, %(county)s,
    %(reference_period_label)s, %(reference_period_end)s,
    %(pct_change)s, %(pct_change_unit)s, %(source_url)s, %(inserted_at)s
)
ON CONFLICT (id) DO UPDATE SET
    reference_period_label = EXCLUDED.reference_period_label,
    reference_period_end   = EXCLUDED.reference_period_end,
    pct_change             = EXCLUDED.pct_change,
    pct_change_unit        = EXCLUDED.pct_change_unit,
    source_url             = EXCLUDED.source_url,
    inserted_at            = EXCLUDED.inserted_at
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
    print("fgcu_reri_indicators: fetching RERI homepage via crawl4ai...")
    markdown = fetch_homepage()

    if not markdown:
        raise RuntimeError("fgcu_reri_indicators: Firecrawl returned empty markdown.")

    rows = parse_indicators(markdown, source_url=RERI_HOME_URL)

    if not rows:
        raise RuntimeError(
            "fgcu_reri_indicators: zero rows parsed — RERI page structure may have changed."
        )

    print(f"fgcu_reri_indicators: parsed {len(rows)} indicator rows.")
    for r in rows:
        print(
            f"  {r['report_month']}  {r['indicator']:<36}  {r['county']:<12}  "
            f"{r['pct_change']:+.1f} {r['pct_change_unit']}"
        )

    if dry_run:
        print("fgcu_reri_indicators: --dry-run, skipping DB write.")
        return

    if not conn_str:
        raise RuntimeError(
            "DESTINATION__POSTGRES__CREDENTIALS not set — cannot write to DB."
        )
    written = upsert_rows(rows, conn_str)
    print(f"fgcu_reri_indicators: upserted {written} rows into {TABLE}.")


# ── CLI ───────────────────────────────────────────────────────────────────────


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="FGCU RERI Regional Economic Indicators ingest pipeline."
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Parse and print rows without writing to DB.",
    )

    args = parser.parse_args(argv)

    conn_str = os.environ.get("DESTINATION__POSTGRES__CREDENTIALS")
    run(dry_run=args.dry_run, conn_str=conn_str)
    return 0


if __name__ == "__main__":
    sys.exit(main())
