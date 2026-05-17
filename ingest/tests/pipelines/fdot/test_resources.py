from unittest.mock import patch, MagicMock

FAKE_STATION = {"type": "Feature", "geometry": None, "properties": {"SITE_ID": "FL001", "AADT": "15000"}}


class TestIngestFdotAadt:
    def test_uploads_csv_gz_to_tabular_cold(self):
        from ingest.pipelines.fdot.resources import ingest_fdot_aadt
        with patch("ingest.pipelines.fdot.resources.paginate_arcgis", return_value=iter([FAKE_STATION])), \
             patch("ingest.pipelines.fdot.resources.upload_csv_gz") as mock_upload, \
             patch("ingest.pipelines.fdot.resources.write_tier1_pointer"):
            ingest_fdot_aadt(MagicMock())
        assert mock_upload.call_args[0][0] == "raw-tabular-cold"
        assert "fdot_aadt/" in mock_upload.call_args[0][1]
        assert mock_upload.call_args[0][1].endswith(".csv.gz")

    def test_extracts_properties_as_rows(self):
        from ingest.pipelines.fdot.resources import ingest_fdot_aadt
        captured = {}
        def cap(bucket, path, rows, fieldnames):
            captured["rows"] = rows
        with patch("ingest.pipelines.fdot.resources.paginate_arcgis", return_value=iter([FAKE_STATION])), \
             patch("ingest.pipelines.fdot.resources.upload_csv_gz", side_effect=cap), \
             patch("ingest.pipelines.fdot.resources.write_tier1_pointer"):
            ingest_fdot_aadt(MagicMock())
        assert captured["rows"][0]["SITE_ID"] == "FL001"
        assert captured["rows"][0]["AADT"] == "15000"

    def test_writes_tier1_pointer(self):
        from ingest.pipelines.fdot.resources import ingest_fdot_aadt
        with patch("ingest.pipelines.fdot.resources.paginate_arcgis", return_value=iter([FAKE_STATION])), \
             patch("ingest.pipelines.fdot.resources.upload_csv_gz"), \
             patch("ingest.pipelines.fdot.resources.write_tier1_pointer") as mock_ptr:
            ingest_fdot_aadt(MagicMock())
        assert mock_ptr.call_args[0][1] == "fdot_aadt"

    def test_skips_when_no_features(self):
        from ingest.pipelines.fdot.resources import ingest_fdot_aadt
        with patch("ingest.pipelines.fdot.resources.paginate_arcgis", return_value=iter([])), \
             patch("ingest.pipelines.fdot.resources.upload_csv_gz") as mock_upload, \
             patch("ingest.pipelines.fdot.resources.write_tier1_pointer"):
            ingest_fdot_aadt(MagicMock())
        assert not mock_upload.called
