from unittest.mock import MagicMock, patch


def _fake_fhfa_response():
    m = MagicMock()
    m.raise_for_status.return_value = None
    m.json.return_value = [
        {"hpi_type": "traditional", "hpi_flavor": "all-transactions", "frequency": "quarterly",
         "level": "MSA", "place_name": "Cape Coral-Fort Myers", "place_id": "15980",
         "yr": 2024, "period": 1, "index_nsa": 350.0, "index_sa": 352.0},
    ]
    return m


def test_dry_run_skips_dlt():
    with patch("dlt.pipeline") as mock_pipeline, \
         patch("requests.get", return_value=_fake_fhfa_response()):
        from ingest.pipelines.fhfa.pipeline import main

        result = main(["--dry-run"])

    assert result == 0
    mock_pipeline.assert_not_called()
