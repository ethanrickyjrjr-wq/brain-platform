"""Integration smoke test for census_vip. Requires live env vars."""
import pytest


@pytest.mark.skip(reason="live integration test — run manually with env vars")
def test_pipeline_runs():
    from ingest.pipelines.census_vip.pipeline import main
    assert main([]) == 0
