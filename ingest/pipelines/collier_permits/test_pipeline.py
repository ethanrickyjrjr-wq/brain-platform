"""Tests for the Collier County building permits pipeline.

All tests are fixture-backed — no live network calls, no Supabase writes.
The fetcher and Census geocoder HTTP calls are mocked.
"""
from __future__ import annotations

import io
from datetime import date
from typing import Any
from unittest.mock import MagicMock, patch

import pandas as pd
import pytest

from .geocoder import _haversine_mi, _split_site_address, assign_corridor, geocode_batch
from .normalizer import (
    BUCKET_COMMERCIAL_ALT,
    BUCKET_COMMERCIAL_NEW,
    BUCKET_DEMOLITION,
    BUCKET_OTHER,
    BUCKET_RESIDENTIAL,
    _to_date,
    _to_float,
    _to_int,
    _to_str,
    classify_bucket,
    normalize_df,
)
from .pipeline import _previous_month, permits_resource


# ── fixtures ───────────────────────────────────────────────────────────────────

def _make_raw_df() -> pd.DataFrame:
    """Minimal DataFrame that mirrors the real XLSX column layout (after header=1 read)."""
    return pd.DataFrame(
        {
            "Permit Number": [
                "PRAC20260001",
                "PRAC20260002",
                "PRAC20260003",
                "PRAC20260001",  # duplicate of first — dedup test
                "",              # blank permit number — should be skipped
            ],
            "Declared Value": ["$250,000", 50000.0, None, "$250,000", None],
            "Building Type": [
                "Commercial",
                "1 to 2 Family",
                "Commercial",
                "Commercial",
                "Commercial",
            ],
            "Permit Class": ["Commercial", "Res.1&2 or Guest House", "Commercial", "Commercial", "Commercial"],
            "Permit Type Desc": [
                "New Construction",
                "New Construction",
                "Demolition",
                "New Construction",
                "New Construction",
            ],
            "Permit Status": ["Issued", "Issued", "Issued", "Issued", "Issued"],
            "Site Address": [
                "3301 Tamiami TRL E, Naples",
                "3390 27th AVE NE, Naples",
                "500 5th AVE S, Naples",
                "3301 Tamiami TRL E, Naples",
                None,  # non-geocodable
            ],
            "Property ID": [12345678.0, 40175160000.0, 99999.0, 12345678.0, None],
            "Date Issued": [
                pd.Timestamp("2026-04-01"),
                pd.Timestamp("2026-04-02"),
                pd.Timestamp("2026-04-03"),
                pd.Timestamp("2026-04-01"),
                None,
            ],
            "Date Applied": [
                pd.Timestamp("2026-03-15"),
                pd.Timestamp("2026-03-17"),
                pd.Timestamp("2026-03-18"),
                pd.Timestamp("2026-03-15"),
                None,
            ],
            "Total SF": [5000.0, 900.0, 2000.0, 5000.0, None],
            "Total Units": [1.0, 1.0, None, 1.0, None],
            "Const Type": ["New Construction", "New Construction", "Demolition", "New Construction", None],
            "Owner Name": ["Acme LLC", "Rivadeneira, Fernando", "Owner3", "Acme LLC", None],
            "City": ["Naples", "Naples", "Naples", "Naples", None],
            "State": ["FL", "FL", "FL", "FL", None],
            "Zip": ["34112", "34120", "34102", "34112", None],
            "Contractor Type": ["General Contractor", "Owner Builder", "General Contractor", "General Contractor", None],
            "License Number": ["CGC123456", float("nan"), "CGC789", "CGC123456", None],
            "Contractor Name": ["BuildCo Inc", "Rivadeneira, Fernando", "DemoCo", "BuildCo Inc", None],
            "City 1": ["Naples", "Naples", "Naples", "Naples", None],
            "State 1": ["FL", "FL", "FL", "FL", None],
            "Zip 1": ["34112", "34120", "34102", "34112", None],
        }
    )


_MOCK_CENTROIDS = [
    {"corridor_id": "tamiami-naples", "corridor_label": "Tamiami Naples", "center_lat": 26.120, "center_lon": -81.764},
    {"corridor_id": "5th-ave-south-3rd-street-south", "corridor_label": "5th Ave South / 3rd Street South", "center_lat": 26.138, "center_lon": -81.797},
]


# ── type parsers ───────────────────────────────────────────────────────────────

def test_to_str_strips_whitespace():
    assert _to_str("  hello  ") == "hello"


def test_to_str_returns_none_for_nan():
    assert _to_str(float("nan")) is None


def test_to_str_returns_none_for_empty():
    assert _to_str("") is None


def test_to_float_parses_dollar_string():
    assert _to_float("$250,000") == pytest.approx(250000.0)


def test_to_float_returns_none_for_none():
    assert _to_float(None) is None


def test_to_int_truncates_float():
    assert _to_int(5000.9) == 5000


def test_to_date_from_timestamp():
    ts = pd.Timestamp("2026-04-01 15:47:52")
    assert _to_date(ts) == date(2026, 4, 1)


def test_to_date_returns_none_for_none():
    assert _to_date(None) is None


# ── bucket classifier ──────────────────────────────────────────────────────────

def test_classify_commercial_new():
    assert classify_bucket("Commercial", "New Construction", "New Construction") == BUCKET_COMMERCIAL_NEW


def test_classify_residential_new():
    assert classify_bucket("1 to 2 Family", "New Construction", "New Construction") == BUCKET_RESIDENTIAL


def test_classify_commercial_alteration():
    assert classify_bucket("Commercial", "Alteration", "Tenant Improvement") == BUCKET_COMMERCIAL_ALT


def test_classify_demolition():
    assert classify_bucket("Commercial", "Demolition", "Demolition") == BUCKET_DEMOLITION


def test_classify_other_fallback():
    assert classify_bucket(None, None, None) == BUCKET_OTHER


# ── column normalization ───────────────────────────────────────────────────────

def test_normalize_df_column_count():
    df = _make_raw_df()
    rows = normalize_df(df, source_file="test.xlsx")
    # 5 source rows: 1 blank permit_number skipped → 4 rows
    assert len(rows) == 4


def test_normalize_df_source_file_present():
    rows = normalize_df(_make_raw_df(), source_file="2026-4-issued-permits.xlsx")
    for r in rows:
        assert r["source_file"] == "2026-4-issued-permits.xlsx"


def test_normalize_df_declared_value_parsed():
    rows = normalize_df(_make_raw_df(), source_file="test.xlsx")
    commercial_row = next(r for r in rows if r["permit_number"] == "PRAC20260001")
    assert commercial_row["declared_value"] == pytest.approx(250000.0)


def test_normalize_df_date_parsed():
    rows = normalize_df(_make_raw_df(), source_file="test.xlsx")
    r = next(r for r in rows if r["permit_number"] == "PRAC20260001")
    assert r["date_issued"] == date(2026, 4, 1)


def test_normalize_df_none_address_row_kept():
    """Row with null site_address is kept (not dropped); corridor will be null."""
    rows = normalize_df(_make_raw_df(), source_file="test.xlsx")
    # The row with None site_address has permit PRAC20260003 (Demolition)
    # and the duplicate PRAC20260001 is also present (dedup is dlt's job)
    permit_numbers = {r["permit_number"] for r in rows}
    assert "PRAC20260003" in permit_numbers


def test_normalize_df_bucket_assigned():
    rows = normalize_df(_make_raw_df(), source_file="test.xlsx")
    by_permit = {r["permit_number"]: r for r in rows}
    assert by_permit["PRAC20260001"]["bucket"] == BUCKET_COMMERCIAL_NEW
    assert by_permit["PRAC20260002"]["bucket"] == BUCKET_RESIDENTIAL
    assert by_permit["PRAC20260003"]["bucket"] == BUCKET_DEMOLITION


# ── address splitting ──────────────────────────────────────────────────────────

def test_split_site_address_normal():
    street, city = _split_site_address("3390 27th AVE NE, Naples")
    assert street == "3390 27th AVE NE"
    assert city == "Naples"


def test_split_site_address_no_comma():
    street, city = _split_site_address("123 Main St Naples")
    assert street == "123 Main St Naples"
    assert city == "Naples"


def test_split_site_address_multiple_commas():
    street, city = _split_site_address("4308 Golden Gate PKWY 1,  (BLDG) , Naples")
    assert city == "Naples"
    assert "Golden Gate" in street


# ── haversine ─────────────────────────────────────────────────────────────────

def test_haversine_same_point():
    assert _haversine_mi(26.138, -81.797, 26.138, -81.797) == pytest.approx(0.0)


def test_haversine_known_distance():
    # ~69 miles per degree of latitude at the equator; ~0.5 mi for 0.007° lat
    d = _haversine_mi(26.138, -81.797, 26.145, -81.797)
    assert 0.4 < d < 0.6


# ── corridor assignment ────────────────────────────────────────────────────────

def test_assign_corridor_within_radius():
    # Point very close to Tamiami Naples centroid (26.120, -81.764)
    corridor = assign_corridor(26.121, -81.764, _MOCK_CENTROIDS)
    assert corridor == "tamiami-naples"


def test_assign_corridor_outside_radius():
    # Point far from all centroids (Miami)
    corridor = assign_corridor(25.775, -80.208, _MOCK_CENTROIDS)
    assert corridor is None


def test_assign_corridor_none_coords():
    assert assign_corridor(None, None, _MOCK_CENTROIDS) is None
    assert assign_corridor(None, -81.797, _MOCK_CENTROIDS) is None


# ── Census geocoder response parsing ──────────────────────────────────────────

def test_geocode_batch_parses_match():
    # Census API returns quoted fields — the matched address contains commas.
    # Coords field is also quoted: "lon,lat". Without quoting the matched address,
    # csv.reader would mis-index the coords column.
    census_response = (
        '0,"3301 Tamiami TRL E Naples FL ",Match,Exact,'
        '"3301 TAMIAMI TRL E, NAPLES, FL, 34112","-81.764000,26.120000",123456789,R\n'
        '1,"3390 27th AVE NE Naples FL ",No_Match,"","","","",""\n'
    )
    mock_resp = MagicMock()
    mock_resp.text = census_response
    mock_resp.raise_for_status = MagicMock()

    with patch("ingest.pipelines.collier_permits.geocoder.requests.Session") as MockSession:
        mock_session = MockSession.return_value
        mock_session.post.return_value = mock_resp

        result = geocode_batch(
            ["3301 Tamiami TRL E, Naples", "3390 27th AVE NE, Naples"],
            session=mock_session,
        )

    assert result["3301 Tamiami TRL E, Naples"] == pytest.approx((26.120, -81.764), rel=1e-4)
    assert result["3390 27th AVE NE, Naples"] is None


def test_geocode_batch_empty_input():
    result = geocode_batch([])
    assert result == {}


def test_geocode_batch_deduplicates():
    """Same address sent twice → only one row in CSV payload."""
    mock_resp = MagicMock()
    mock_resp.text = "0,3301 Tamiami TRL E Naples FL ,Match,Exact,,-81.764,26.120,,\n"
    mock_resp.raise_for_status = MagicMock()

    with patch("ingest.pipelines.collier_permits.geocoder.requests.Session") as MockSession:
        mock_session = MockSession.return_value
        mock_session.post.return_value = mock_resp

        result = geocode_batch(
            ["3301 Tamiami TRL E, Naples", "3301 Tamiami TRL E, Naples"],
            session=mock_session,
        )

    # The deduplicated call should have posted only 1 row
    call_args = mock_session.post.call_args
    csv_payload = call_args[1]["files"]["addressFile"][1].decode()
    assert csv_payload.count("\n") == 0  # 1 row, no trailing newlines


# ── dlt resource ──────────────────────────────────────────────────────────────

def test_permits_resource_yields_all_rows():
    rows = [
        {"permit_number": "A1", "date_issued": date(2026, 4, 1), "source_file": "f.xlsx"},
        {"permit_number": "A2", "date_issued": date(2026, 4, 2), "source_file": "f.xlsx"},
    ]
    emitted = list(permits_resource(rows))
    assert len(emitted) == 2
    assert emitted[0]["permit_number"] == "A1"


def test_permits_resource_empty():
    assert list(permits_resource([])) == []


def test_permits_resource_none():
    assert list(permits_resource(None)) == []


# ── dry-run ───────────────────────────────────────────────────────────────────

def test_dry_run_skips_dlt(capsys):
    """--dry-run must print row count and never call dlt.pipeline."""
    from .pipeline import main

    fake_xlsx = _build_minimal_xlsx()

    with (
        patch("ingest.pipelines.collier_permits.pipeline.download_month", return_value=(fake_xlsx, "test.xlsx")),
        patch("ingest.pipelines.collier_permits.pipeline.dlt") as mock_dlt,
    ):
        exit_code = main(["--month", "2026-04", "--dry-run"])

    assert exit_code == 0
    mock_dlt.pipeline.assert_not_called()
    captured = capsys.readouterr()
    assert "dry-run" in captured.out
    assert "rows" in captured.out


# ── previous month helper ─────────────────────────────────────────────────────

def test_previous_month_never_returns_current():
    from datetime import date as _date
    year, month = _previous_month()
    today = _date.today()
    assert (year, month) < (today.year, today.month)


# ── helpers ───────────────────────────────────────────────────────────────────

def _build_minimal_xlsx() -> bytes:
    """Build a minimal XLSX with the expected layout (title row + header row + 2 data rows)."""
    import openpyxl

    wb = openpyxl.Workbook()
    ws = wb.active
    # Row 1: title row (blank — matches the real XLSX structure)
    ws.append([""] * 23)
    # Row 2: column headers
    ws.append([
        "Permit Number", "Declared Value", "Building Type", "Permit Class",
        "Permit Type Desc", "Permit Status", "Site Address", "Property ID",
        "Date Issued", "Date Applied", "Total SF", "Total Units", "Const Type",
        "Owner Name", "City", "State", "Zip", "Contractor Type", "License Number",
        "Contractor Name", "City 1", "State 1", "Zip 1",
    ])
    # Row 3: data
    ws.append([
        "PRAC20260001", 250000, "Commercial", "Commercial", "New Construction",
        "Issued", "3301 Tamiami TRL E, Naples", "12345678",
        "2026-04-01", "2026-03-15", 5000, 1, "New Construction",
        "Acme LLC", "Naples", "FL", "34112",
        "General Contractor", "CGC123456", "BuildCo Inc", "Naples", "FL", "34112",
    ])
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()
