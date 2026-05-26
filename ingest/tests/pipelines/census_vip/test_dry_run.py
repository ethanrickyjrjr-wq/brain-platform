from unittest.mock import MagicMock, patch


def _fake_census_response():
    m = MagicMock()
    m.raise_for_status.return_value = None
    m.json.return_value = [
        ["cell_value", "category_code", "time_slot_id", "data_type_code", "seasonally_adj", "time"],
        ["1677114", "AXXXX", "0", "V", "yes", "2024-01"],
        ["901234", "A01XX", "0", "V", "yes", "2024-01"],
        ["775573", "ANRXX", "0", "V", "yes", "2024-01"],
        ["229705", "A20IX", "0", "V", "yes", "2024-01"],
        # This row should be filtered out (wrong data_type_code):
        ["5.0", "AXXXX", "0", "E_P", "yes", "2024-01"],
    ]
    return m


def test_dry_run_skips_upload():
    with (
        patch("requests.get", return_value=_fake_census_response()),
        patch("ingest.pipelines.census_vip.pipeline.upload_parquet") as mock_upload,
        patch("ingest.pipelines.census_vip.pipeline.upsert_inventory_row") as mock_inv,
    ):
        import importlib
        import os
        os.environ.setdefault("CENSUS_API_KEY", "test-key")
        import ingest.pipelines.census_vip.pipeline as mod
        importlib.reload(mod)
        result = mod.main(["--dry-run"])

    assert result == 0
    mock_upload.assert_not_called()
    mock_inv.assert_not_called()
