"""Integration smoke test for fred_g17. Requires live env vars."""
import pytest


@pytest.mark.skip(reason="live integration test — run manually with env vars")
def test_pipeline_runs():
    from ingest.pipelines.fred_g17.pipeline import main
    assert main([]) == 0
