from unittest.mock import patch, MagicMock

import pytest

FAKE_STATION = {"type": "Feature", "geometry": None, "properties": {"SITE_ID": "FL001", "AADT": "15000"}}


@pytest.fixture(autouse=True)
def _bypass_volume_floor(monkeypatch):
    # The production min-rows floor (93k) would reject the 1-row fixtures the
    # plumbing tests use; bypass it. The guard itself is covered by TestVolumeGuard.
    monkeypatch.setattr("ingest.pipelines.fdot.resources._MIN_ROWS", 0)

# Mirrors a real row from the FDOT FTO_PROD/MapServer/7 layer (24 properties + Shape geometry).
FAKE_FDOT_RAW = {
    "OBJECTID": 12345,
    "YEAR_": 2024,
    "DISTRICT": "01",
    "COSITE": "120002",
    "ROADWAY": "12001000",
    "DESC_FRM": "US-41 @ MM 0.0",
    "DESC_TO": "US-41 @ MM 1.2",
    "AADT": "27500",
    "AADTFLG": "T",
    "KFLG": "T",
    "K100FLG": "T",
    "DFLG": "T",
    "TFLG": "E",
    "BEGIN_POST": "0.000",
    "END_POST": "1.200",
    "KFCTR": "0.092",
    "K100FCTR": "0.115",
    "DFCTR": "0.534",
    "TFCTR": "0.043",
    "SHAPE_LENG": "6336.0",
    "COUNTYDOT": "12",
    "COUNTY": "LEE",
    "MNG_DIST": "01",
    "Shape_Length": "6336.1234",
    "Shape": {"type": "Polyline", "paths": [[[0, 0], [1, 1]]]},
}


class TestIngestFdotAadt:
    def test_uploads_csv_gz_to_tabular_cold(self):
        from ingest.pipelines.fdot.resources import ingest_fdot_aadt
        with patch("ingest.pipelines.fdot.resources.paginate_arcgis", return_value=iter([FAKE_STATION])), \
             patch("ingest.pipelines.fdot.resources.upload_csv_gz") as mock_upload, \
             patch("ingest.pipelines.fdot.resources.upsert_inventory_row"), \
             patch("ingest.pipelines.fdot.resources._promote_to_tier2"):
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
             patch("ingest.pipelines.fdot.resources.upsert_inventory_row"), \
             patch("ingest.pipelines.fdot.resources._promote_to_tier2"):
            ingest_fdot_aadt(MagicMock())
        assert captured["rows"][0]["SITE_ID"] == "FL001"
        assert captured["rows"][0]["AADT"] == "15000"

    def test_writes_tier1_pointer(self):
        from ingest.pipelines.fdot.resources import ingest_fdot_aadt
        with patch("ingest.pipelines.fdot.resources.paginate_arcgis", return_value=iter([FAKE_STATION])), \
             patch("ingest.pipelines.fdot.resources.upload_csv_gz"), \
             patch("ingest.pipelines.fdot.resources.upsert_inventory_row") as mock_ptr, \
             patch("ingest.pipelines.fdot.resources._promote_to_tier2"):
            ingest_fdot_aadt(MagicMock())
        assert mock_ptr.call_args.kwargs["pack_id"] == "traffic-swfl"

    def test_skips_when_no_features(self):
        from ingest.pipelines.fdot.resources import ingest_fdot_aadt
        with patch("ingest.pipelines.fdot.resources.paginate_arcgis", return_value=iter([])), \
             patch("ingest.pipelines.fdot.resources.upload_csv_gz") as mock_upload, \
             patch("ingest.pipelines.fdot.resources.upsert_inventory_row"), \
             patch("ingest.pipelines.fdot.resources._promote_to_tier2") as mock_tier2:
            ingest_fdot_aadt(MagicMock())
        assert not mock_upload.called
        assert not mock_tier2.called


class TestNormalize:
    """_normalize() pins the 24 columns of the FDOT AADT MapServer schema to Tier 2 types.
    The Shape geometry field is dropped — Tier 2 doesn't need it; SWFL filtering is by COUNTY text.
    """

    def test_pins_24_columns_and_drops_shape(self):
        from ingest.pipelines.fdot.resources import _normalize, _TIER2_COLUMNS
        out = _normalize(FAKE_FDOT_RAW)
        assert set(out.keys()) == set(_TIER2_COLUMNS.keys())
        assert "Shape" not in out
        assert "shape" not in out
        assert len(_TIER2_COLUMNS) == 24

    def test_integer_coercion(self):
        from ingest.pipelines.fdot.resources import _normalize
        out = _normalize(FAKE_FDOT_RAW)
        assert out["objectid"] == 12345
        assert isinstance(out["objectid"], int)
        assert out["year_"] == 2024
        assert isinstance(out["year_"], int)
        assert out["aadt"] == 27500
        assert isinstance(out["aadt"], int)

    def test_double_coercion(self):
        from ingest.pipelines.fdot.resources import _normalize
        out = _normalize(FAKE_FDOT_RAW)
        assert out["kfctr"] == 0.092
        assert out["tfctr"] == 0.043
        assert out["shape_length"] == 6336.1234
        assert out["shape_leng"] == 6336.0
        assert out["begin_post"] == 0.0
        assert out["end_post"] == 1.2
        for k in ("kfctr", "k100fctr", "dfctr", "tfctr", "shape_leng", "shape_length", "begin_post", "end_post"):
            assert isinstance(out[k], float), f"{k} should be float"

    def test_text_passthrough(self):
        from ingest.pipelines.fdot.resources import _normalize
        out = _normalize(FAKE_FDOT_RAW)
        assert out["county"] == "LEE"
        assert out["roadway"] == "12001000"
        assert out["aadtflg"] == "T"
        assert out["desc_frm"] == "US-41 @ MM 0.0"
        for k in ("district", "cosite", "roadway", "desc_frm", "desc_to", "aadtflg",
                  "kflg", "k100flg", "dflg", "tflg", "countydot", "county", "mng_dist"):
            assert isinstance(out[k], str), f"{k} should be str"

    def test_null_aadt_preserved(self):
        """FDOT suppresses AADT on non-surveyed segments. Tier 2 must mirror; view filters later."""
        from ingest.pipelines.fdot.resources import _normalize
        raw = {**FAKE_FDOT_RAW, "AADT": None}
        out = _normalize(raw)
        assert out["aadt"] is None

    def test_empty_string_aadt_treated_as_null(self):
        from ingest.pipelines.fdot.resources import _normalize
        raw = {**FAKE_FDOT_RAW, "AADT": ""}
        out = _normalize(raw)
        assert out["aadt"] is None

    def test_missing_field_yields_none(self):
        from ingest.pipelines.fdot.resources import _normalize
        raw = {k: v for k, v in FAKE_FDOT_RAW.items() if k != "TFCTR"}
        out = _normalize(raw)
        assert out["tfctr"] is None


class TestTier2Promotion:
    def test_tier2_pipeline_fires_after_tier1(self):
        from ingest.pipelines.fdot.resources import ingest_fdot_aadt
        with patch("ingest.pipelines.fdot.resources.paginate_arcgis", return_value=iter([FAKE_STATION])), \
             patch("ingest.pipelines.fdot.resources.upload_csv_gz"), \
             patch("ingest.pipelines.fdot.resources.upsert_inventory_row"), \
             patch("ingest.pipelines.fdot.resources._promote_to_tier2") as mock_tier2:
            ingest_fdot_aadt(MagicMock())
        assert mock_tier2.called
        rows_arg = mock_tier2.call_args[0][0]
        assert rows_arg[0]["SITE_ID"] == "FL001"

    def test_tier2_uses_replace_write_disposition(self):
        from ingest.pipelines.fdot.resources import _promote_to_tier2
        mock_pipeline_instance = MagicMock()
        with patch("ingest.pipelines.fdot.resources.dlt") as mock_dlt:
            mock_dlt.pipeline.return_value = mock_pipeline_instance
            # dlt.resource is a decorator factory; return a passthrough so the inner fn is preserved
            mock_dlt.resource = lambda **kwargs: (lambda fn: fn)
            _promote_to_tier2([FAKE_FDOT_RAW])
        mock_dlt.pipeline.assert_called_once()
        call_kwargs = mock_dlt.pipeline.call_args.kwargs
        assert call_kwargs["pipeline_name"] == "fdot_aadt_tier2"
        assert call_kwargs["destination"] == "postgres"
        assert call_kwargs["dataset_name"] == "data_lake"
        mock_pipeline_instance.run.assert_called_once()

    def test_tier2_raises_on_failed_jobs(self):
        """dlt swallows per-job failures into LoadInfo. We must call raise_on_failed_jobs()
        so Tier 2 can never silently half-load while the process exits 0."""
        from ingest.pipelines.fdot.resources import _promote_to_tier2
        mock_pipeline_instance = MagicMock()
        mock_load_info = MagicMock()
        mock_pipeline_instance.run.return_value = mock_load_info
        with patch("ingest.pipelines.fdot.resources.dlt") as mock_dlt:
            mock_dlt.pipeline.return_value = mock_pipeline_instance
            mock_dlt.resource = lambda **kwargs: (lambda fn: fn)
            _promote_to_tier2([FAKE_FDOT_RAW])
        mock_load_info.raise_on_failed_jobs.assert_called_once()

    def test_tier2_propagates_failed_job_exception(self):
        """If raise_on_failed_jobs throws, _promote_to_tier2 must propagate (not swallow)."""
        from ingest.pipelines.fdot.resources import _promote_to_tier2
        mock_pipeline_instance = MagicMock()
        mock_load_info = MagicMock()
        mock_load_info.raise_on_failed_jobs.side_effect = RuntimeError("simulated dlt job failure")
        mock_pipeline_instance.run.return_value = mock_load_info
        with patch("ingest.pipelines.fdot.resources.dlt") as mock_dlt:
            mock_dlt.pipeline.return_value = mock_pipeline_instance
            mock_dlt.resource = lambda **kwargs: (lambda fn: fn)
            try:
                _promote_to_tier2([FAKE_FDOT_RAW])
            except RuntimeError as e:
                assert "simulated dlt job failure" in str(e)
            else:
                raise AssertionError("expected _promote_to_tier2 to re-raise the failed-job exception")

    def test_tier2_table_named_fdot_aadt_fl(self):
        """The @dlt.resource decorator must declare table_name='fdot_aadt_fl' and replace disposition."""
        from ingest.pipelines.fdot.resources import _promote_to_tier2
        captured_kwargs = {}
        def capture_resource(**kwargs):
            captured_kwargs.update(kwargs)
            return lambda fn: fn
        with patch("ingest.pipelines.fdot.resources.dlt") as mock_dlt:
            mock_dlt.pipeline.return_value = MagicMock()
            mock_dlt.resource = capture_resource
            _promote_to_tier2([FAKE_FDOT_RAW])
        assert captured_kwargs["table_name"] == "fdot_aadt_fl"
        assert captured_kwargs["write_disposition"] == "replace"
        assert "columns" in captured_kwargs
        assert len(captured_kwargs["columns"]) == 24


class TestVolumeGuard:
    def test_raises_when_aadt_mostly_null(self):
        """A silent AADT field rename (all None) trips the non-null floor → VolumeGuardError, no write."""
        from ingest.pipelines.fdot.resources import ingest_fdot_aadt
        from ingest.lib.guards import VolumeGuardError
        feature = {"type": "Feature", "properties": {"OBJECTID": 1, "AADT": None}}
        with patch("ingest.pipelines.fdot.resources.paginate_arcgis", return_value=iter([feature])), \
             patch("ingest.pipelines.fdot.resources.upload_csv_gz") as mock_upload, \
             patch("ingest.pipelines.fdot.resources.upsert_inventory_row"), \
             patch("ingest.pipelines.fdot.resources._promote_to_tier2") as mock_tier2:
            with pytest.raises(VolumeGuardError):
                ingest_fdot_aadt(MagicMock())
        assert not mock_upload.called
        assert not mock_tier2.called

    def test_raises_below_min_rows(self, monkeypatch):
        """A partial pull (fewer rows than the floor) trips assert_min_rows before any write."""
        from ingest.pipelines.fdot.resources import ingest_fdot_aadt
        from ingest.lib.guards import VolumeGuardError
        monkeypatch.setattr("ingest.pipelines.fdot.resources._MIN_ROWS", 1000)
        with patch("ingest.pipelines.fdot.resources.paginate_arcgis", return_value=iter([FAKE_STATION])), \
             patch("ingest.pipelines.fdot.resources.upload_csv_gz") as mock_upload, \
             patch("ingest.pipelines.fdot.resources.upsert_inventory_row"), \
             patch("ingest.pipelines.fdot.resources._promote_to_tier2"):
            with pytest.raises(VolumeGuardError):
                ingest_fdot_aadt(MagicMock())
        assert not mock_upload.called
