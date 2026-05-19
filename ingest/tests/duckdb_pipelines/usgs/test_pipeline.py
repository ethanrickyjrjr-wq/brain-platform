"""Integration test for the USGS DuckDB pipeline.

Mocks HTTP calls; runs pipeline.run() against a local tmp directory
(not S3) so no credentials are needed. Verifies Parquet files are
created with the expected schema and row count.
"""

import json
from pathlib import Path
from unittest.mock import MagicMock, patch

import duckdb
import pytest


# ── Fixtures ─────────────────────────────────────────────────────────────────


def _make_dv_response(site_no: str, parameter_cd: str) -> dict:
    """Minimal USGS dv JSON response with two data rows."""
    return {
        "value": {
            "timeSeries": [{
                "sourceInfo": {"siteCode": [{"value": site_no}]},
                "variable": {"unit": {"unitCode": "ft"}, "noDataValue": -999999.0},
                "values": [{"value": [
                    {"dateTime": "2000-01-01T00:00:00.000", "value": "1.23", "qualifiers": ["A"]},
                    {"dateTime": "2000-01-02T00:00:00.000", "value": "1.45", "qualifiers": ["A"]},
                ]}]
            }]
        }
    }


_RDB_RESPONSE = """\
# USGS test fixture
agency_cd\tsite_no\tstation_nm\tsite_tp_cd\tdec_lat_va\tdec_long_va\tdec_coord_datum_cd\talt_va\talt_datum_cd\thuc_cd\tstate_cd\tcounty_cd
5s\t15s\t50s\t7s\t16n\t16n\t20s\t8s\t12s\t16s\t3s\t3s
USGS\t02292900\tTest Station FL\tST\t26.72389\t-81.74250\tNAD83\t5.48\tNGVD29\t03100101\t12\t071
"""


# ── Mock HTTP responses ───────────────────────────────────────────────────────


def _mock_requests_get(url, **kwargs):
    mock_resp = MagicMock()
    mock_resp.raise_for_status = MagicMock()

    if "/dv/" in url:
        # Extract parameter_cd from URL query string
        param = "72019"
        for part in url.split("&"):
            if part.startswith("parameterCd="):
                param = part.split("=")[1]
                break
        mock_resp.json.return_value = _make_dv_response("02292900", param)
    else:
        # Site catalog — return RDB text
        mock_resp.text = _RDB_RESPONSE

    return mock_resp


# ── Tests ────────────────────────────────────────────────────────────────────


@patch("ingest.duckdb_pipelines.usgs.fetch.requests.get", side_effect=_mock_requests_get)
def test_run_writes_both_parquet_files(mock_get, tmp_path):
    from ingest.duckdb_pipelines.usgs.pipeline import run

    daily_out = str(tmp_path / "daily.parquet")
    sites_out = str(tmp_path / "sites.parquet")

    run(end_year=2000, daily_target=daily_out, sites_target=sites_out)

    assert Path(daily_out).exists(), "daily Parquet not written"
    assert Path(sites_out).exists(), "sites Parquet not written"


@patch("ingest.duckdb_pipelines.usgs.fetch.requests.get", side_effect=_mock_requests_get)
def test_daily_parquet_has_expected_columns(mock_get, tmp_path):
    from ingest.duckdb_pipelines.usgs.pipeline import run

    daily_out = str(tmp_path / "daily.parquet")
    sites_out = str(tmp_path / "sites.parquet")
    run(end_year=2000, daily_target=daily_out, sites_target=sites_out)

    con = duckdb.connect()
    cols = [row[0] for row in con.execute(f"DESCRIBE SELECT * FROM '{daily_out}'").fetchall()]
    assert "site_no" in cols
    assert "parameter_cd" in cols
    assert "obs_date" in cols
    assert "value" in cols
    assert "qualifiers" in cols


@patch("ingest.duckdb_pipelines.usgs.fetch.requests.get", side_effect=_mock_requests_get)
def test_daily_parquet_row_count(mock_get, tmp_path):
    from ingest.duckdb_pipelines.usgs.pipeline import run

    daily_out = str(tmp_path / "daily.parquet")
    sites_out = str(tmp_path / "sites.parquet")
    run(end_year=2000, daily_target=daily_out, sites_target=sites_out)

    con = duckdb.connect()
    # 4 parameter_cds × 1 year-chunk (2000) × 2 rows per chunk = 8 rows
    count = con.execute(f"SELECT COUNT(*) FROM '{daily_out}'").fetchone()[0]
    assert count == 8


@patch("ingest.duckdb_pipelines.usgs.fetch.requests.get", side_effect=_mock_requests_get)
def test_sites_parquet_has_parameter_cds_rollup(mock_get, tmp_path):
    from ingest.duckdb_pipelines.usgs.pipeline import run

    daily_out = str(tmp_path / "daily.parquet")
    sites_out = str(tmp_path / "sites.parquet")
    run(end_year=2000, daily_target=daily_out, sites_target=sites_out)

    con = duckdb.connect()
    row = con.execute(
        f"SELECT parameter_cds FROM '{sites_out}' WHERE site_no = '02292900'"
    ).fetchone()
    assert row is not None
    # parameter_cds is a JSON array string containing all 4 parameter_cds
    cds = json.loads(row[0])
    assert set(cds) == {"72019", "62610", "00065", "00045"}


@patch("ingest.duckdb_pipelines.usgs.fetch.requests.get", side_effect=_mock_requests_get)
def test_no_inventory_write_for_local_paths(mock_get, tmp_path):
    """upsert_inventory_row must NOT be called when targets are local file paths."""
    from ingest.duckdb_pipelines.usgs import pipeline

    daily_out = str(tmp_path / "daily.parquet")
    sites_out = str(tmp_path / "sites.parquet")

    with patch("ingest.duckdb_pipelines.usgs.pipeline.upsert_inventory_row") as mock_upsert:
        pipeline.run(end_year=2000, daily_target=daily_out, sites_target=sites_out)
        mock_upsert.assert_not_called()
