"""End-to-end test for the zori_swfl Tier 2 loader.

Uses an ephemeral DuckDB destination (no live Postgres) so the merge
roundtrip can be verified without credentials. Mirrors the lee_permits
test_pipeline.py pattern.
"""
from __future__ import annotations

from datetime import date
import tempfile

import dlt


FAKE_ROWS = [
    {
        "zip_code": "34135",
        "period_end": date(2026, 3, 31),
        "rent_index": 2419.0,
        "metro": "Cape Coral-Fort Myers, FL",
        "county_name": "Lee County",
        "city": "Bonita Springs",
        "ingested_at": "2026-05-23T15:00:00+00:00",
    },
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


def test_resource_roundtrips_through_dlt_to_ephemeral_duckdb() -> None:
    from ingest.pipelines.zori_swfl.resources import zori_swfl_resource

    with tempfile.TemporaryDirectory() as td:
        pipeline = dlt.pipeline(
            pipeline_name="zori_swfl_test",
            destination=dlt.destinations.duckdb(f"{td}/test.duckdb"),
            dataset_name="data_lake",
        )
        load_info = pipeline.run(zori_swfl_resource(rows=FAKE_ROWS))
        assert load_info.has_failed_jobs is False

        with pipeline.sql_client() as client:
            result = client.execute_sql(
                "SELECT zip_code, period_end, rent_index "
                "FROM data_lake.zori_swfl ORDER BY zip_code, period_end"
            )

    assert len(result) == 3
    # (zip_code, period_end, rent_index)
    assert result[0][0] == "34102"
    assert result[1][0] == "34135"
    assert result[2][0] == "34135"
    assert result[1][2] == 2419.0
    assert result[2][2] == 2420.5


def test_merge_on_composite_pk_is_idempotent() -> None:
    """Two consecutive runs with the same rows must not duplicate."""
    from ingest.pipelines.zori_swfl.resources import zori_swfl_resource

    with tempfile.TemporaryDirectory() as td:
        pipeline = dlt.pipeline(
            pipeline_name="zori_swfl_test_idempotent",
            destination=dlt.destinations.duckdb(f"{td}/test.duckdb"),
            dataset_name="data_lake",
        )
        pipeline.run(zori_swfl_resource(rows=FAKE_ROWS))
        pipeline.run(zori_swfl_resource(rows=FAKE_ROWS))

        with pipeline.sql_client() as client:
            result = client.execute_sql(
                "SELECT COUNT(*) FROM data_lake.zori_swfl"
            )

    assert result[0][0] == 3


def test_merge_overwrites_changed_rent_index_for_same_pk() -> None:
    """If a later run carries a different rent_index for the same
    (zip_code, period_end), the merge should overwrite."""
    from ingest.pipelines.zori_swfl.resources import zori_swfl_resource

    later_rows = [
        {
            "zip_code": "34135",
            "period_end": date(2026, 4, 30),
            "rent_index": 9999.99,   # revised value
            "metro": "Cape Coral-Fort Myers, FL",
            "county_name": "Lee County",
            "city": "Bonita Springs",
            "ingested_at": "2026-06-01T10:00:00+00:00",
        }
    ]

    with tempfile.TemporaryDirectory() as td:
        pipeline = dlt.pipeline(
            pipeline_name="zori_swfl_test_overwrite",
            destination=dlt.destinations.duckdb(f"{td}/test.duckdb"),
            dataset_name="data_lake",
        )
        pipeline.run(zori_swfl_resource(rows=FAKE_ROWS))
        pipeline.run(zori_swfl_resource(rows=later_rows))

        with pipeline.sql_client() as client:
            result = client.execute_sql(
                "SELECT rent_index FROM data_lake.zori_swfl "
                "WHERE zip_code = '34135' AND period_end = '2026-04-30'"
            )

    assert len(result) == 1
    assert result[0][0] == 9999.99
