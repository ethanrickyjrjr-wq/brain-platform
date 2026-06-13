"""dlt resources for the FL DBPR Contractor Licenses ingest pipeline.

Two resources:
  fl_dbpr_licenses   — merge on license_number (idempotent upsert)
  fl_dbpr_applicants — full replace monthly (no primary key)

Both download comma-delimited, double-quoted bulk CSVs from the DBPR public extract
portal (NOT pipe-delimited, despite older DBPR docs). No authentication required.
BOM-aware streaming via utf-8-sig codec; csv.reader is quote-aware so embedded commas
in addresses do not shift column indices.

Both resources filter to Lee ("46") + Collier ("21") at ingest using the DBPR 2-digit
county_code. The applicant (replace) resource carries a volume guard — total floor +
per-county floors + a city-anchor invariant — that aborts the extract (in dry-run AND
live) if the file collapses or the county scheme drifts.
"""
from __future__ import annotations

import csv
import io
import logging
import re
from datetime import datetime, timezone

import dlt
import requests

from ingest.lib.guards import assert_min_rows, VolumeGuardError

from .constants import (
    APPLICANTS_URL,
    COL_APP_CITY,
    COL_APP_COUNTY,
    COL_APP_FIRST,
    COL_APP_LAST,
    COL_APP_OCC_CODE,
    COL_APP_PHONE,
    COL_APP_STATE,
    COL_APP_ZIP,
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

# Floors for the applicant volume guard. VERIFIED live 2026-06-13 against constr_app.csv
# (103,291 rows; SWFL = 8,727 → Lee "46" 6,031 / Collier "21" 2,696). Deliberately loose
# (~46-50% of probed) — a monthly snapshot fluctuates; the 90%-style freshness floor lives
# in cadence_registry (expected_rows_min), not in this catastrophic-collapse guard.
APP_FLOOR_TOTAL = 4_000     # ~46% of 8,727 SWFL — catches HTML/empty/scheme collapse to ~0
APP_FLOOR_LEE = 3_000       # ~50% of 6,031 Lee — catches Lee dropping out
APP_FLOOR_COLLIER = 1_300   # ~48% of 2,696 Collier — catches Collier dropping out

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
    # county_code/county are REQUIRED by the consumer's .in("county_code",["46","21"])
    # filter (refinery/sources/fl-dbpr-licenses-source.mts). Without them the consumer
    # errored non-fatally → applicants_swfl silently read 0.
    "county_code":     {"data_type": "text",      "nullable": True},
    "county":          {"data_type": "text",      "nullable": True},
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
    """Return True if this row looks like a CSV header (license OR applicant)."""
    if not row:
        return False
    first = row[0].strip().lower().lstrip("﻿")
    # License header (board column) + applicant header (occupation column). The
    # applicant file ships headerless today, but the county filter would also drop a
    # header (its col-12 is a label, not "46"/"21"); this is a cheap explicit belt.
    return first in {
        "board", "board_number", "board number", "boardnumber",
        "occ number", "occ_code", "occupation number",
    }


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


def _has_city_anchor(rows: list[dict], city_pattern: str, code: str) -> bool:
    """True if at least one row with the given county_code has a city matching the pattern."""
    pat = re.compile(city_pattern, re.I)
    return any(
        r["county_code"] == code and pat.search(r.get("city") or "")
        for r in rows
    )


def _assert_applicant_volume(rows: list[dict]) -> None:
    """Hard-block the applicant extract on collapse or county-scheme drift.

    Runs during dlt extract (dry-run AND live), BEFORE any row is yielded. Raises
    VolumeGuardError when:
      (1) total SWFL rows fall below the catastrophic floor (HTML/empty/scheme break),
      (2) either county drops below its floor — partial drift the total floor misses
          (e.g. Lee 6,031 survives the 4,000 total floor while Collier silently → 0),
      (3) the city->county_code anchors are absent (col 12 stopped being county_code:
          a FIPS swap or index shift).
    """
    lee = sum(1 for r in rows if r["county_code"] == "46")
    collier = sum(1 for r in rows if r["county_code"] == "21")

    assert_min_rows(len(rows), APP_FLOOR_TOTAL, "fl_dbpr_applicants")
    assert_min_rows(lee, APP_FLOOR_LEE, "fl_dbpr_applicants:lee_46")
    assert_min_rows(collier, APP_FLOOR_COLLIER, "fl_dbpr_applicants:collier_21")

    if not _has_city_anchor(rows, r"fort myers|cape coral", "46"):
        raise VolumeGuardError(
            "[volume-guard] fl_dbpr_applicants: no Lee city anchors county_code 46 "
            "— scheme moved, aborting"
        )
    if not _has_city_anchor(rows, r"naples|marco island", "21"):
        raise VolumeGuardError(
            "[volume-guard] fl_dbpr_applicants: no Collier city anchors county_code 21 "
            "— scheme moved, aborting"
        )


def _map_applicant_rows(raw: list[list[str]], ingested_at: str) -> list[dict]:
    """Filter constr_app.csv raw rows to Lee+Collier and map to applicant dicts.

    Shared by the dlt resource and the pipeline dry-run so both exercise the exact
    same filter + field extraction (and, via _assert_applicant_volume, the same guard).
    """
    rows: list[dict] = []
    for row in raw:
        if _is_header_row(row):
            continue
        if len(row) < MIN_APP_ROW_LEN:
            continue
        county_code = row[COL_APP_COUNTY].strip()
        if county_code not in COUNTY_FILTER:
            continue
        rows.append({
            "occupation_code": row[COL_APP_OCC_CODE].strip() or None,
            "first_name":      row[COL_APP_FIRST].strip() or None,
            "last_name":       row[COL_APP_LAST].strip() or None,
            "city":            row[COL_APP_CITY].strip() or None,
            "state":           row[COL_APP_STATE].strip() or None,
            "zip":             row[COL_APP_ZIP].strip() or None,
            # byte-exact "46"/"21" — the consumer does a string .in(); "046"/" 46"/int miss.
            "county_code":     county_code,
            "county":          COUNTY_FILTER[county_code],
            "phone":           row[COL_APP_PHONE].strip() or None,
            "_ingested_at":    ingested_at,
        })
    return rows


@dlt.resource(
    name="fl_dbpr_applicants",
    write_disposition="replace",
    columns=_APPLICANT_COLUMNS,
)
def dbpr_applicants_resource() -> dlt.sources.DltResource:
    """Yield FL DBPR construction applicant rows for Lee + Collier (full replace monthly).

    Source: constr_app.csv (the DBPR "Construction Applicants" extract). Filtered to
    Lee ("46") + Collier ("21") at ingest via the DBPR 2-digit county_code at col 12,
    mirroring the license resource — keeps the replace table ~8.7k rows, not ~103k.

    A volume guard (total + per-county floors + city-anchor invariant) runs BEFORE any
    row is yielded (_assert_applicant_volume), so it aborts the dlt extract — in dry-run
    AND live — if the file collapses or the county scheme drifts. Raises VolumeGuardError.
    """
    ingested_at = datetime.now(timezone.utc).isoformat()
    rows = _map_applicant_rows(_stream_csv(APPLICANTS_URL), ingested_at)

    # Hard-block BEFORE yielding (dry-run + live). Aborts on collapse / scheme drift.
    _assert_applicant_volume(rows)

    log.info(
        "fl_dbpr_applicants: %d SWFL rows (Lee %d / Collier %d)",
        len(rows),
        sum(1 for r in rows if r["county_code"] == "46"),
        sum(1 for r in rows if r["county_code"] == "21"),
    )
    yield from rows
