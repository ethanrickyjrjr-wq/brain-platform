from unittest.mock import patch


_FAKE_FEATURE = {"type": "Feature", "properties": {"FOLIOID": "12-45-24-00-00001.0000"}}
_FAKE_ROW = {"FOLIOID": "12-45-24-00-00001.0000", "Just": "250000"}


def test_dry_run_skips_dlt():
    with patch("dlt.pipeline") as mock_pipeline, \
         patch("ingest.lib.arcgis_paginator.paginate_arcgis", return_value=[_FAKE_FEATURE]), \
         patch("ingest.lib.arcgis_paginator.paginate_arcgis_tabular", return_value=[_FAKE_ROW]):
        from ingest.pipelines.leepa.pipeline import main

        result = main(["--dry-run"])

    assert result == 0
    mock_pipeline.assert_not_called()
