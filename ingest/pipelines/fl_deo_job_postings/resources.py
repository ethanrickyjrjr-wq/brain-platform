"""dlt resource for FL DEO / CareerSource Florida weekly job postings.

Live mode: uses extract_client.extract() (Firecrawl primary, Spider fallback)
to AI-scrape job posting counts by NAICS supersector for Lee County (12071) and
Collier County (12021) from CareerSource Florida / DEO OSPA portal.

Dry-run mode: fetches and parses but does not call dlt.pipeline().

Schema: one row per (area_fips, naics_sector, week_end_date).
Primary key: "{area_fips}|{naics_sector}|{week_end_date}" — idempotent weekly merge.
"""
from __future__ import annotations

import re
from datetime import date, datetime, timezone
from typing import Iterator

import dlt

from ingest.lib.extract_client import extract

from .constants import (
    AREA_FIPS,
    COUNTY_NAMES,
    NAICS_LABEL_TO_CODE,
    NAICS_SECTORS,
    OSPA_URL,
    SOURCE_URL,
)

_COLUMNS: dict = {
    "id":            {"data_type": "text",      "nullable": False, "primary_key": True},
    "area_fips":     {"data_type": "text",      "nullable": False},
    "county_name":   {"data_type": "text",      "nullable": False},
    "naics_sector":  {"data_type": "text",      "nullable": False},
    "naics_label":   {"data_type": "text",      "nullable": True},
    "week_end_date": {"data_type": "date",      "nullable": False},
    "posting_count": {"data_type": "bigint",    "nullable": True},
    "source_url":    {"data_type": "text",      "nullable": True},
    "_ingested_at":  {"data_type": "timestamp", "nullable": True},
}

_EXTRACT_SCHEMA = {
    "type": "object",
    "properties": {
        "rows": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "county":             {"type": "string"},
                    "naics_sector_code":  {"type": "string"},
                    "naics_sector_label": {"type": "string"},
                    "posting_count":      {"type": "integer"},
                    "week_ending_date":   {"type": "string"},
                },
                "required": ["county", "naics_sector_code", "posting_count", "week_ending_date"],
            },
        }
    },
    "required": ["rows"],
}

_EXTRACT_PROMPT = (
    "Extract weekly online job posting counts by 2-digit NAICS industry supersector "
    "for Lee County and Collier County, Florida. "
    "For each county × NAICS sector combination return: "
    "county name, 2-digit NAICS sector code, NAICS sector label, "
    "integer posting count, and week ending date (ISO 8601 YYYY-MM-DD). "
    "Only include rows for Lee County (FL FIPS 12071) and Collier County (FL FIPS 12021). "
    "Do not aggregate across counties."
)


# ── Normalisation helpers ──────────────────────────────────────────────────────

def _fips_from_county(county: str) -> str | None:
    """Map a county string to its 5-digit FIPS. Case-insensitive, handles variants."""
    c = county.strip().lower().replace(" county", "").replace(",", "").strip()
    for geo_key, fips in AREA_FIPS.items():
        if geo_key in c or c in geo_key:
            return fips
    return None


def _normalize_naics(raw: str) -> str | None:
    """Normalise a NAICS value to a 2-digit code string.

    Handles: "62", "062", "44-45" (→ "44"), or a label string looked up
    in NAICS_LABEL_TO_CODE.  Returns None when the input is unresolvable.
    """
    s = str(raw).strip()
    # Range like "44-45" or "31-33" — take the first number
    range_match = re.match(r"^(\d{2})", s)
    if range_match:
        code = range_match.group(1).lstrip("0").zfill(2)
        if code in NAICS_SECTORS:
            return code
    # Plain numeric
    if re.fullmatch(r"\d{1,3}", s):
        code = s.lstrip("0").zfill(2)
        return code if code in NAICS_SECTORS else None
    # Label → code reverse lookup
    return NAICS_LABEL_TO_CODE.get(s.lower())


_DATE_FORMATS = ["%Y-%m-%d", "%m/%d/%Y", "%m-%d-%Y"]


def _normalize_date(raw: str) -> str | None:
    """Normalise a date string to ISO YYYY-MM-DD. Returns None on failure."""
    s = str(raw).strip()
    for fmt in _DATE_FORMATS:
        try:
            return datetime.strptime(s, fmt).date().isoformat()
        except ValueError:
            pass
    # "May 24, 2026" → try dateutil-style fallback
    try:
        from datetime import date as _d
        _d.fromisoformat(s)
        return s  # already ISO
    except (ValueError, AttributeError):
        pass
    return None


# ── Scrape ─────────────────────────────────────────────────────────────────────

def fetch_raw_rows() -> list[dict]:
    """Call extract_client.extract() against CareerSource FL + DEO OSPA portal."""
    response = extract(
        _EXTRACT_PROMPT,
        urls=[SOURCE_URL, OSPA_URL],
        schema=_EXTRACT_SCHEMA,
        max_credits=2000,
        strict_constrain_to_urls=False,
    )
    return response.get("data", {}).get("rows", [])


def parse_rows(raw_rows: list[dict]) -> list[dict]:
    """Validate and normalise extracted rows into the canonical DB schema."""
    ingested_at = datetime.now(timezone.utc).isoformat()
    out: list[dict] = []
    skipped = 0

    for row in raw_rows:
        county_raw = str(row.get("county", "")).strip()
        fips = _fips_from_county(county_raw)
        if not fips:
            skipped += 1
            continue

        naics = _normalize_naics(str(row.get("naics_sector_code", "")))
        if not naics:
            skipped += 1
            continue

        week_end = _normalize_date(str(row.get("week_ending_date", "")))
        if not week_end:
            skipped += 1
            continue

        count_raw = row.get("posting_count")
        count: int | None = None
        if count_raw is not None:
            try:
                count = int(count_raw)
            except (ValueError, TypeError):
                count = None

        label = (
            str(row.get("naics_sector_label", "")).strip()
            or NAICS_SECTORS.get(naics)
        )

        out.append({
            "id":            f"{fips}|{naics}|{week_end}",
            "area_fips":     fips,
            "county_name":   COUNTY_NAMES[fips],
            "naics_sector":  naics,
            "naics_label":   label,
            "week_end_date": week_end,
            "posting_count": count,
            "source_url":    SOURCE_URL,
            "_ingested_at":  ingested_at,
        })

    if skipped:
        print(f"fl_deo_job_postings: skipped {skipped} rows (unresolvable county/NAICS/date).")

    return out


# ── dlt resource ───────────────────────────────────────────────────────────────

@dlt.resource(
    name="fl_deo_job_postings",
    write_disposition="merge",
    primary_key="id",
    columns=_COLUMNS,
)
def fl_deo_job_postings_resource() -> Iterator[dict]:
    """Yield canonical job-posting rows for the current week.

    Calls CareerSource FL / DEO OSPA via extract_client (Firecrawl primary,
    Spider fallback). Merges into data_lake.fl_deo_job_postings by (area_fips,
    naics_sector, week_end_date) — idempotent re-runs are safe.
    """
    raw = fetch_raw_rows()
    rows = parse_rows(raw)
    print(f"fl_deo_job_postings: {len(rows)} rows parsed from {len(raw)} raw extracts.")
    yield from rows
