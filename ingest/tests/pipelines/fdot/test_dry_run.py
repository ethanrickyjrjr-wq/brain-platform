from unittest.mock import patch


_FAKE_FEATURE = {"type": "Feature", "properties": {"OBJECTID": 1, "YEAR_": 2023, "AADT": 5000}}


def test_dry_run_skips_dlt():
    with patch("dlt.pipeline") as mock_pipeline, \
         patch("ingest.lib.arcgis_paginator.paginate_arcgis", return_value=[_FAKE_FEATURE]):
        from ingest.pipelines.fdot.pipeline import main

        result = main(["--dry-run"])

    assert result == 0
    mock_pipeline.assert_not_called()
