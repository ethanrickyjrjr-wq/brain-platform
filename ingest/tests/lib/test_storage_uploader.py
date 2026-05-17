import csv
import gzip
import io
import json
import os
from unittest.mock import patch, MagicMock

os.environ.setdefault("BRAINS_SUPABASE_URL", "https://test.supabase.co")
os.environ.setdefault("BRAINS_SUPABASE_SERVICE_KEY", "test-service-key")


def _ok_resp():
    m = MagicMock()
    m.raise_for_status = MagicMock()
    return m


class TestUploadCsvGz:
    def test_calls_requests_post_with_bucket_and_path(self):
        from ingest.lib.storage_uploader import upload_csv_gz
        with patch("requests.post", return_value=_ok_resp()) as mock_post:
            upload_csv_gz("my-bucket", "test/file.csv.gz", [{"a": 1}], ["a"])
        url = mock_post.call_args[0][0]
        assert "my-bucket" in url
        assert "test/file.csv.gz" in url

    def test_returns_object_path(self):
        from ingest.lib.storage_uploader import upload_csv_gz
        with patch("requests.post", return_value=_ok_resp()):
            result = upload_csv_gz("b", "path/file.csv.gz", [{"x": 1}], ["x"])
        assert result == "path/file.csv.gz"

    def test_body_is_valid_gzipped_csv(self):
        from ingest.lib.storage_uploader import upload_csv_gz
        rows = [{"name": "Alice", "age": "30"}, {"name": "Bob", "age": "25"}]
        captured = {}
        def cap(url, **kw):
            captured["data"] = kw["data"]
            return _ok_resp()
        with patch("requests.post", side_effect=cap):
            upload_csv_gz("b", "p/f.csv.gz", rows, ["name", "age"])
        reader = csv.DictReader(io.StringIO(gzip.decompress(captured["data"]).decode()))
        result = list(reader)
        assert result[0]["name"] == "Alice"
        assert result[1]["age"] == "25"


class TestUploadGeojsonGz:
    def test_calls_requests_post(self):
        from ingest.lib.storage_uploader import upload_geojson_gz
        features = [{"type": "Feature", "geometry": None, "properties": {"id": 1}}]
        with patch("requests.post", return_value=_ok_resp()) as mock_post:
            result = upload_geojson_gz("geo-bucket", "fema/2026-01-01.geojson.gz", features)
        assert mock_post.called
        assert result == "fema/2026-01-01.geojson.gz"

    def test_body_is_valid_gzipped_geojson_feature_collection(self):
        from ingest.lib.storage_uploader import upload_geojson_gz
        features = [{"type": "Feature", "geometry": {"type": "Point", "coordinates": [0, 0]}, "properties": {}}]
        captured = {}
        def cap(url, **kw):
            captured["data"] = kw["data"]
            return _ok_resp()
        with patch("requests.post", side_effect=cap):
            upload_geojson_gz("b", "p/f.geojson.gz", features)
        parsed = json.loads(gzip.decompress(captured["data"]).decode())
        assert parsed["type"] == "FeatureCollection"
        assert len(parsed["features"]) == 1


class TestWriteTier1Pointer:
    def test_calls_pipeline_run(self):
        from ingest.lib.storage_uploader import write_tier1_pointer
        mock_pipeline = MagicMock()
        write_tier1_pointer(mock_pipeline, "fema_zones", "raw-geometry", "path.geojson.gz", 500, "https://src.com")
        assert mock_pipeline.run.called

    def test_inventory_row_has_required_fields(self):
        from ingest.lib.storage_uploader import write_tier1_pointer
        captured = []
        def cap_run(resource):
            captured.extend(list(resource))
        mock_pipeline = MagicMock()
        mock_pipeline.run.side_effect = cap_run
        write_tier1_pointer(mock_pipeline, "fema_zones", "raw-geometry", "path.geojson.gz", 100, "https://src.com")
        assert len(captured) == 1
        row = captured[0]
        assert row["table_name"] == "fema_zones"
        assert row["bucket"] == "raw-geometry"
        assert row["object_path"] == "path.geojson.gz"
        assert row["row_count"] == 100
        assert row["source_url"] == "https://src.com"
        assert "ingested_at" in row
