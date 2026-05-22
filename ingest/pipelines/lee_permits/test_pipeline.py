"""Pipeline test — verifies dlt resource emits correctly bucketed rows.

Uses an ephemeral DuckDB destination so no live Postgres credentials needed.
"""
import json
from pathlib import Path
import tempfile
import pytest
import dlt
from .pipeline import permits_resource
from .buckets import classify_permit_type

FIXTURES = Path(__file__).parent / "fixtures"


def _load_fixture_rows() -> list[dict]:
    return json.loads((FIXTURES / "sample_rows.json").read_text())


def test_permits_resource_emits_typed_rows_with_bucket() -> None:
    fixture_rows = _load_fixture_rows()
    with tempfile.TemporaryDirectory() as td:
        pipeline = dlt.pipeline(
            pipeline_name="lee_permits_test",
            destination=dlt.destinations.duckdb(f"{td}/test.duckdb"),
            dataset_name="data_lake",
        )
        load_info = pipeline.run(
            permits_resource(rows=fixture_rows),
            table_name="lee_building_permits",
            write_disposition="merge",
            primary_key="permit_id",
        )
        assert load_info.has_failed_jobs is False

        with pipeline.sql_client() as client:
            result = client.execute_sql(
                "SELECT permit_id, bucket FROM data_lake.lee_building_permits ORDER BY permit_id"
            )

    assert result == [
        ("BLDR23-12345", "commercial_alteration"),
        ("BLDR24-00001", "commercial_new"),
    ]


def test_permits_resource_handles_empty_input() -> None:
    with tempfile.TemporaryDirectory() as td:
        pipeline = dlt.pipeline(
            pipeline_name="lee_permits_empty_test",
            destination=dlt.destinations.duckdb(f"{td}/test.duckdb"),
            dataset_name="data_lake",
        )
        load_info = pipeline.run(
            permits_resource(rows=[]),
            table_name="lee_building_permits",
            write_disposition="merge",
            primary_key="permit_id",
        )
        assert load_info.has_failed_jobs is False
