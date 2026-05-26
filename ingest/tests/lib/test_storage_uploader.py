import csv
import gzip
import io
import json
import os
from unittest.mock import patch, MagicMock

os.environ.setdefault("SUPABASE_URL", "https://test.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_KEY", "test-service-key")


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


_FAKE_CREDS = {
    "destination": {"postgres": {"credentials": {
        "host": "test.supabase.co",
        "port": 5432,
        "database": "postgres",
        "username": "postgres",
        "password": "secret",
    }}}
}


class TestWriteTier1Pointer:
    def test_executes_upsert_with_correct_params(self):
        from ingest.lib import storage_uploader
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_conn.cursor.return_value = mock_cursor
        with patch.object(storage_uploader, "tomllib") as mock_toml, \
             patch.object(storage_uploader.psycopg2, "connect", return_value=mock_conn):
            mock_toml.load.return_value = _FAKE_CREDS
            storage_uploader.write_tier1_pointer(
                None, "fema_zones", "raw-geometry", "path.geojson.gz", 500, "https://src.com"
            )
        assert mock_cursor.execute.call_count == 1
        sql, params = mock_cursor.execute.call_args[0]
        assert "INSERT INTO data_lake._tier1_inventory" in sql
        assert "ON CONFLICT (id) DO UPDATE" in sql
        assert params[0] == "raw-geometry/path.geojson.gz"
        assert params[1] == "raw-geometry"
        assert params[2] == "path.geojson.gz"
        assert params[4] == 500
        assert params[6] == "https://src.com"

    def test_reads_credentials_from_dlt_secrets_toml(self):
        from ingest.lib import storage_uploader
        mock_conn = MagicMock()
        with patch.object(storage_uploader, "tomllib") as mock_toml, \
             patch.object(storage_uploader.psycopg2, "connect", return_value=mock_conn) as mock_connect:
            mock_toml.load.return_value = _FAKE_CREDS
            storage_uploader.write_tier1_pointer(
                None, "fema_zones", "raw-geometry", "p.gz", 1, "https://s"
            )
        kwargs = mock_connect.call_args.kwargs
        assert kwargs["host"] == "test.supabase.co"
        assert kwargs["user"] == "postgres"
        assert kwargs["password"] == "secret"
