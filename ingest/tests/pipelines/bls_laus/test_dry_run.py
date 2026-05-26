from unittest.mock import MagicMock, patch


def _fake_bls_response():
    m = MagicMock()
    m.raise_for_status.return_value = None
    m.json.return_value = {
        "status": "REQUEST_SUCCEEDED",
        "Results": {
            "series": [{
                "seriesID": "LAUCN120710000000003",
                "data": [{"year": "2024", "period": "M01", "periodName": "January", "value": "3.5", "footnotes": [{}]}],
            }]
        },
    }
    return m


def test_dry_run_skips_dlt():
    with patch("dlt.pipeline") as mock_pipeline, \
         patch("requests.post", return_value=_fake_bls_response()):
        from ingest.pipelines.bls_laus.pipeline import main

        result = main(["--dry-run"])

    assert result == 0
    mock_pipeline.assert_not_called()
