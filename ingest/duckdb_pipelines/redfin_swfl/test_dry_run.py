"""Verify --dry-run skips the download/write/inventory path."""
from unittest.mock import patch


def test_dry_run_skips_run():
    """--dry-run must not trigger the download, DuckDB filter, or S3 write."""
    import ingest.duckdb_pipelines.redfin_swfl.pipeline as mod

    with patch.object(mod, "run") as mock_run:
        result = mod.main(["--dry-run"])

    assert result == 0
    mock_run.assert_not_called()
