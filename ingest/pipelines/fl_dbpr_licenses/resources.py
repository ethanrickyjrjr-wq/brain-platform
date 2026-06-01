"""dlt resources for the FL DBPR Contractor Licenses ingest pipeline.

Two resources:
  fl_dbpr_licenses   — merge on license_number (idempotent upsert)
  fl_dbpr_applicants — full replace monthly (no primary key)

Both download pipe-delimited bulk CSVs from the DBPR public extract portal.
No authentication required. BOM-aware streaming via utf-8-sig codec.
"""
from __future__ import annotations

import csv
import io
import logging
from datetime import datetime, timezone

import dlt
import requests

from .constants import (
    APPLICANTS_URL,
    COL_APP_CITY_ST_ZIP,
    COL_APP_FIRST,
    COL_APP_LAST,
    COL_APP_OCC_CODE,
    COL_APP_PHONE,
    COL_BOARD,
    COL_DBA,
    COL_EFF_DATE,
    COL_EXP_DATE,
    COL_LICENSE_NO,
    COL_LICENSEE,
    COL_OCC_CODE,
    COL_ORIG_DATE,
    COL_PRI_STATUS,
    COL_SEC_STATUS,
    COL_COUNTY,
    COUNTY_FILTER,
    DBPR_CITATION_URL,
    LICENSES_URLS,
    MIN_APP_ROW_LEN,
    MIN_ROW_LEN,
)

log = logging.getLogger(__name__)

# ── dlt column schemas ─────────────────────────────────────────────────────────

_DBPR_COLUMNS: dict = {
    "license_number":          {"data_type": "text",      "nullable": False, "primary_key": True},
    "board_number":            {"data_type": "text",      "nullable": True},
    "occupation_code":         {"data_type": "text",      "nullable": True},
    "licensee_name":           {"data_type": "text",      "nullable": True},
    "dba_name":                {"data_type": "text",      "nullable": True},
    "county_code":             {"data_type": "text",      "nullable": True},
    "county":                  {"data_type": "text",      "nullable": True},
    "primary_status":          {"data_type": "text",      "nullable": True},
    "secondary_status":        {"data_type": "text",      "nullable": True},
    "original_licensure_date": {"data_type": "date",      "nullable": True},
    "effective_date":          {"data_type": "date",      "nullable": True},
    "expiration_date":         {"data_type": "date",      "nullable": True},
    "_ingested_at":            {"data_type": "timestamp", "nullable": True},
}

_APPLICANT_COLUMNS: dict = {
    "occupation_code": {"data_type": "text",      "nullable": True},
    "first_name":      {"data_type": "text",      "nullable": True},
    "last_name":       {"data_type": "text",      "nullable": True},
    "city":            {"data_type": "text",      "nullable": True},
    "state":           {"data_type": "text",      "nullable": True},
    "zip":             {"data_type": "text",      "nullable": True},
    "phone":           {"data_type": "text",      "nullable": True},
    "_ingested_at":    {"data_type": "timestamp", "nullable": True},
}

# ── Helpers ────────────────────────────────────────────────────────────────────


def _parse_date(value: object) -> str | None:
    """Parse a DBPR date string to ISO YYYY-MM-DD. Returns None on any failure."""
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    # Already ISO
    if len(text) == 10 and text[4] == "-":
        return text
    # DBPR standard: MM/DD/YYYY
    try:
        return datetime.strptime(text, "%m/%d/%Y").date().isoformat()
    except ValueError:
        pass
    # Fallback: M/D/YYYY (no zero-padding)
    try:
        return datetime.strptime(text, "%-m/%-d/%Y").date().isoformat()
    except ValueError:
        pass
    return None


def _is_header_row(row: list[str]) -> bool:
    """Return True if this row looks like the CSV header."""
    if not row:
        return False
    first = row[0].strip().lower().lstrip("﻿")
    return first in {"board", "board_number", "board number", "boardnumber"}


def _stream_csv(url: str, timeout: int = 120) -> list[list[str]]:
    """Download a DBPR bulk-extract CSV and return all rows as lists of strings.

    DBPR exports are comma-delimited with double-quoted fields (NOT pipe-delimited,
    despite older documentation). Reads the full response into memory (5-50 MB
    per file — fine for a monthly batch). utf-8-sig strips the Windows BOM.
    Returns [] if the response is HTML (e.g. the applicant URL redirects to an
    error page) so callers can fail gracefully.
    """
    resp = requests.get(url, timeout=timeout)
    resp.raise_for_status()
    text = resp.content.decode("utf-8-sig")
    # Guard: if the server returned an HTML page instead of CSV data, bail out.
    if text.lstrip().startswith("<"):
        log.warning("_stream_csv: URL %s returned HTML — skipping", url)
        return []
    reader = csv.reader(io.StringIO(text), delimiter=",")
    return list(reader)


# ── dlt resources ──────────────────────────────────────────────────────────────


@dlt.resource(
    name="fl_dbpr_licenses",
    primary_key="license_number",
    write_disposition="merge",
    columns=_DBPR_COLUMNS,
)
def dbpr_licenses_resource() -> dlt.sources.DltResource:
    """Yield FL DBPR contractor license rows for Lee + Collier counties.

    Sources: Construction Board 06 + Electrical Board 08 bulk CSVs.
    Filter: county_code IN ('21', '46'). Skips rows with empty license_number.
    """
    ingested_at = datetime.now(timezone.utc).isoformat()

    for url, board_no in LICENSES_URLS:
        log.info("fl_dbpr_licenses: downloading board %s from %s", board_no, url)
        rows = _stream_csv(url)
        matched = 0
        skipped = 0

        for row in rows:
            if _is_header_row(row):
                continue
            if len(row) < MIN_ROW_LEN:
                skipped += 1
                continue

            county_code = row[COL_COUNTY].strip()
            if county_code not in COUNTY_FILTER:
                continue

            license_no = row[COL_LICENSE_NO].strip()
            if not license_no:
                skipped += 1
                continue

            matched += 1
            yield {
                "license_number":          license_no,
                "board_number":            board_no,
                "occupation_code":         row[COL_OCC_CODE].strip() or None,
                "licensee_name":           row[COL_LICENSEE].strip() or None,
                "dba_name":               row[COL_DBA].strip() or None,
                "county_code":             county_code,
                "county":                  COUNTY_FILTER[county_code],
                "primary_status":          row[COL_PRI_STATUS].strip() or None,
                "secondary_status":        row[COL_SEC_STATUS].strip() or None,
                "original_licensure_date": _parse_date(row[COL_ORIG_DATE]),
                "effective_date":          _parse_date(row[COL_EFF_DATE]),
                "expiration_date":         _parse_date(row[COL_EXP_DATE]),
                "_ingested_at":            ingested_at,
            }

        log.info(
            "fl_dbpr_licenses: board %s — %d matched, %d skipped",
            board_no, matched, skipped,
        )


@dlt.resource(
    name="fl_dbpr_applicants",
    write_disposition="replace",
    columns=_APPLICANT_COLUMNS,
)
def dbpr_applicants_resource() -> dlt.sources.DltResource:
    """Yield FL DBPR contractor applicant rows (full replace monthly).

    No county filter — full state extract; applicants_swfl count is computed
    downstream by the brain pack via a filtered COUNT query.

    City/State/Zip is a combined field (e.g. "NAPLES, FL 34102"); stored raw in
    city with state and zip left as None — no downstream consumer requires the split.
    """
    ingested_at = datetime.now(timezone.utc).isoformat()
    rows = _stream_csv(APPLICANTS_URL)

    for row in rows:
        if _is_header_row(row):
            continue
        if len(row) < MIN_APP_ROW_LEN:
            continue

        yield {
            "occupation_code": row[COL_APP_OCC_CODE].strip() or None,
            "first_name":      row[COL_APP_FIRST].strip() or None,
            "last_name":       row[COL_APP_LAST].strip() or None,
            "city":            row[COL_APP_CITY_ST_ZIP].strip() or None,  # raw "City, State Zip"
            "state":           None,   # not split — see module docstring
            "zip":             None,   # not split — see module docstring
            "phone":           row[COL_APP_PHONE].strip() or None,
            "_ingested_at":    ingested_at,
        }
