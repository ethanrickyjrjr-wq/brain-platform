import os
from unittest.mock import MagicMock, patch


def _fake_fred_response(sid: str):
    m = MagicMock()
    m.raise_for_status.return_value = None
    m.json.return_value = {
        "observations": [
            {"date": "2024-04-01", "value": "102.5"},
            {"date": "2024-03-01", "value": "."},  # should be skipped
        ]
    }
    return m


def test_dry_run_skips_upload():
    with (
        patch.dict(os.environ, {"FRED_API_KEY": "test-key"}),
        patch("requests.get", side_effect=lambda url, params, timeout: _fake_fred_response(params.get("series_id"))),
        patch("ingest.pipelines.fred_g17.pipeline.upload_parquet") as mock_upload,
        patch("ingest.pipelines.fred_g17.pipeline.upsert_inventory_row") as mock_inv,
    ):
        import importlib
        import ingest.pipelines.fred_g17.pipeline as mod
        importlib.reload(mod)
        result = mod.main(["--dry-run"])

    assert result == 0
    mock_upload.assert_not_called()
    mock_inv.assert_not_called()
