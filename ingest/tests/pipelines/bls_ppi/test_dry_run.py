from unittest.mock import MagicMock, patch


def _fake_bls_response():
    m = MagicMock()
    m.raise_for_status.return_value = None
    m.json.return_value = {
        "status": "REQUEST_SUCCEEDED",
        "Results": {
            "series": [
                {
                    "seriesID": "PCU236221236221",
                    "data": [
                        {"year": "2024", "period": "M04", "periodName": "April", "value": "239.2"},
                    ],
                },
                {
                    "seriesID": "PCU236211236211",
                    "data": [
                        {"year": "2024", "period": "M04", "periodName": "April", "value": "200.5"},
                    ],
                },
            ]
        },
    }
    return m


def test_dry_run_skips_upload():
    with (
        patch("requests.post", return_value=_fake_bls_response()),
        patch("ingest.pipelines.bls_ppi.pipeline.upload_parquet") as mock_upload,
        patch("ingest.pipelines.bls_ppi.pipeline.upsert_inventory_row") as mock_inv,
    ):
        import importlib
        import ingest.pipelines.bls_ppi.pipeline as mod
        importlib.reload(mod)
        result = mod.main(["--dry-run"])

    assert result == 0
    mock_upload.assert_not_called()
    mock_inv.assert_not_called()
