"""dlt resource for BLS OEWS metro area data — SWFL MSAs.

Downloads oesm{YY}ma.zip from BLS, parses MSA_M{YYYY}_dl.xlsx, filters for
Cape Coral-Fort Myers (15980) and Naples-Marco Island (34940), major groups only.

Schema: one row per (area_code, occ_code, ref_year).
Primary key: "{area_code}|{occ_code}|{ref_year}" — idempotent annual merge.

BLS suppresses wages/employment below sample-size thresholds and marks them '*'.
_parse_int / _parse_float return None for suppressed values.
"""
from __future__ import annotations

import io
import zipfile
from datetime import datetime, timezone
from typing import Iterator

import dlt
import pandas as pd
import requests

from .constants import BLS_OEWS_BASE, MSA_CODES, SOURCE_URL

_USER_AGENT = (
    "Mozilla/5.0 (compatible; brain-platform/1.0; +https://swfldatagulf.com)"
)

_COLUMNS: dict = {
    "id":            {"data_type": "text",      "nullable": False, "primary_key": True},
    "area_code":     {"data_type": "text",      "nullable": False},
    "area_name":     {"data_type": "text",      "nullable": False},
    "prim_state":    {"data_type": "text",      "nullable": True},
    "occ_code":      {"data_type": "text",      "nullable": False},
    "occ_title":     {"data_type": "text",      "nullable": False},
    "o_group":       {"data_type": "text",      "nullable": False},
    "tot_emp":       {"data_type": "bigint",    "nullable": True},
    "jobs_1000":     {"data_type": "double",    "nullable": True},
    "loc_quotient":  {"data_type": "double",    "nullable": True},
    "h_median":      {"data_type": "double",    "nullable": True},
    "a_median":      {"data_type": "bigint",    "nullable": True},
    "ref_year":      {"data_type": "bigint",    "nullable": False},
    "source_url":    {"data_type": "text",      "nullable": True},
    "_ingested_at":  {"data_type": "timestamp", "nullable": True},
}

_SUPPRESSED = frozenset({"*", "#", "**", "***", ""})


def _parse_int(val: object) -> int | None:
    s = str(val).strip() if val is not None else ""
    if s in _SUPPRESSED:
        return None
    try:
        return int(float(s.replace(",", "")))
    except (ValueError, TypeError):
        return None


def _parse_float(val: object) -> float | None:
    s = str(val).strip() if val is not None else ""
    if s in _SUPPRESSED:
        return None
    try:
        return float(s.replace(",", ""))
    except (ValueError, TypeError):
        return None


def download_oews_zip(ref_year: int) -> bytes:
    """Download BLS OEWS metro area zip for the given survey year."""
    yy = str(ref_year)[2:]
    url = f"{BLS_OEWS_BASE}/oesm{yy}ma.zip"
    resp = requests.get(url, timeout=180, headers={"User-Agent": _USER_AGENT})
    resp.raise_for_status()
    return resp.content


def parse_oews_rows(zip_bytes: bytes, ref_year: int) -> list[dict]:
    """Extract SWFL MSA major-group rows from the OEWS metro zip bytes."""
    yy = str(ref_year)[2:]
    excel_name = f"oesm{yy}ma/MSA_M{ref_year}_dl.xlsx"

    zf = zipfile.ZipFile(io.BytesIO(zip_bytes))
    with zf.open(excel_name) as f:
        df = pd.read_excel(f, dtype=str)

    mask = df["AREA"].isin(MSA_CODES) & (df["O_GROUP"] == "major")
    filtered = df[mask].copy()

    if filtered.empty:
        return []

    ingested_at = datetime.now(timezone.utc).isoformat()
    zip_url = f"{BLS_OEWS_BASE}/oesm{yy}ma.zip"
    rows: list[dict] = []

    for _, row in filtered.iterrows():
        area_code = str(row["AREA"]).strip()
        occ_code = str(row["OCC_CODE"]).strip()
        area_title = str(row.get("AREA_TITLE", "")).strip()
        # Trim long MSA suffix for display; fall back to constants value.
        area_name = (
            area_title.split(" Metropolitan")[0].split(" MSA")[0]
            if area_title
            else MSA_CODES[area_code]
        )

        rows.append({
            "id":           f"{area_code}|{occ_code}|{ref_year}",
            "area_code":    area_code,
            "area_name":    area_name,
            "prim_state":   str(row.get("PRIM_STATE", "FL")).strip() or "FL",
            "occ_code":     occ_code,
            "occ_title":    str(row["OCC_TITLE"]).strip(),
            "o_group":      str(row["O_GROUP"]).strip(),
            "tot_emp":      _parse_int(row["TOT_EMP"]),
            "jobs_1000":    _parse_float(row["JOBS_1000"]),
            "loc_quotient": _parse_float(row["LOC_QUOTIENT"]),
            "h_median":     _parse_float(row["H_MEDIAN"]),
            "a_median":     _parse_int(row["A_MEDIAN"]),
            "ref_year":     ref_year,
            "source_url":   zip_url,
            "_ingested_at": ingested_at,
        })

    return rows


@dlt.resource(
    name="bls_oews_swfl",
    write_disposition="merge",
    primary_key="id",
    columns=_COLUMNS,
)
def bls_oews_swfl_resource(ref_year: int) -> Iterator[dict]:
    """Yield SWFL OEWS major-group rows for the given survey year."""
    zip_bytes = download_oews_zip(ref_year)
    rows = parse_oews_rows(zip_bytes, ref_year)
    print(f"bls_oews_swfl: {len(rows)} rows parsed for ref_year={ref_year}.")
    yield from rows
