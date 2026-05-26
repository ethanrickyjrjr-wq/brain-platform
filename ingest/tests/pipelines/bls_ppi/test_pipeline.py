"""Integration smoke test for bls_ppi. Requires live env vars."""
import pytest


@pytest.mark.skip(reason="live integration test — run manually with env vars")
def test_pipeline_runs():
    from ingest.pipelines.bls_ppi.pipeline import main
    assert main([]) == 0
