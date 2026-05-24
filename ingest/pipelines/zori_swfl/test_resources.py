"""Unit tests for the zori_swfl dlt resource.

Validates the merge-on-PK shape contract and the row passthrough behavior
without needing a live Postgres destination.
"""
from __future__ import annotations

from datetime import date

import pytest

FAKE_ROWS = [
    {
        "zip_code": "34135",
        "period_end": date(2026, 4, 30),
        "rent_index": 2420.5,
        "metro": "Cape Coral-Fort Myers, FL",
        "county_name": "Lee County",
        "city": "Bonita Springs",
        "ingested_at": "2026-05-23T15:00:00+00:00",
    },
    {
        "zip_code": "34102",
        "period_end": date(2026, 4, 30),
        "rent_index": 4250.0,
        "metro": "Naples-Marco Island, FL",
        "county_name": "Collier County",
        "city": "Naples",
        "ingested_at": "2026-05-23T15:00:00+00:00",
    },
]


def test_resource_is_decorated_with_merge_on_composite_pk():
    """Contract: merge disposition + (zip_code, period_end) primary key."""
    from ingest.pipelines.zori_swfl.resources import zori_swfl_resource

    # dlt stores the source-level metadata; we read it off the bound resource.
    bound = zori_swfl_resource(rows=FAKE_ROWS)
    assert bound.write_disposition == "merge"
    # primary key is a list of two columns
    pk = bound.compute_table_schema().get("columns", {})
    pk_cols = [c["name"] for c in pk.values() if c.get("primary_key")]
    assert set(pk_cols) == {"zip_code", "period_end"}


def test_resource_emits_all_columns_and_metadata():
    from ingest.pipelines.zori_swfl.resources import zori_swfl_resource

    rows = list(zori_swfl_resource(rows=FAKE_ROWS))
    assert len(rows) == 2

    first = rows[0]
    for k in (
        "zip_code",
        "period_end",
        "rent_index",
        "metro",
        "county_name",
        "city",
        "ingested_at",
        "_ingest_metadata",
    ):
        assert k in first, f"missing key {k} in emitted row"

    assert first["_ingest_metadata"]["source"] == "zillow_zori_research"
    assert first["_ingest_metadata"]["tier1_bucket"] == "lake-tier1"
    assert first["_ingest_metadata"]["tier1_path"] == "market/zori_swfl.parquet"


def test_resource_handles_missing_optional_metadata():
    """metro/county/city are nullable per the DDL — resource must not KeyError."""
    from ingest.pipelines.zori_swfl.resources import zori_swfl_resource

    minimal = [
        {
            "zip_code": "34135",
            "period_end": date(2026, 4, 30),
            "rent_index": 2420.5,
        }
    ]
    rows = list(zori_swfl_resource(rows=minimal))
    assert rows[0]["metro"] is None
    assert rows[0]["county_name"] is None
    assert rows[0]["city"] is None


def test_read_tier1_parquet_local_path(tmp_path):
    """`read_tier1_parquet` honors the parquet_path override for tests."""
    import duckdb
    from ingest.pipelines.zori_swfl.resources import read_tier1_parquet

    fixture_parquet = tmp_path / "fake_tier1.parquet"
    con = duckdb.connect()
    con.execute(
        f"""
        CREATE TABLE t AS
        SELECT
            '34135' AS zip_code,
            DATE '2026-04-30' AS period_end,
            CAST(2420.5 AS DOUBLE) AS rent_index,
            'Cape Coral-Fort Myers, FL' AS metro,
            'Lee County' AS county_name,
            'Bonita Springs' AS city,
            '2026-05-23T15:00:00+00:00' AS ingested_at
        """
    )
    con.execute(
        f"COPY t TO '{fixture_parquet.as_posix()}' (FORMAT PARQUET)"
    )

    rows = list(read_tier1_parquet(parquet_path=str(fixture_parquet)))
    assert len(rows) == 1
    assert rows[0]["zip_code"] == "34135"
    assert rows[0]["rent_index"] == pytest.approx(2420.5)
