from unittest.mock import patch, MagicMock

FAKE_PARCEL = {"type": "Feature", "geometry": None, "properties": {"STRAP": "01-42-24-01-00001.0000"}}

# Tabular attribute rows as paginate_arcgis_tabular yields them — flat dicts, no .attributes wrapper.
USE_ROW_1 = {"FOLIOID": "F1", "Code": "0100", "Description": "Single Family"}
USE_ROW_2 = {"FOLIOID": "F2", "Code": "0400", "Description": "Condominium"}

VALUE_ROW_1 = {
    "FOLIOID": "F1", "Just": 425000, "Market": 430000, "Assessed": 380000,
    "Taxable": 330000, "SOHCap": 50000, "Building": 280000, "Land": 145000,
    "CapDifference": 45000,
}
VALUE_ROW_2 = {
    "FOLIOID": "F2", "Just": 312000, "Market": 315000, "Assessed": 312000,
    "Taxable": 287000, "SOHCap": 25000, "Building": 220000, "Land": 92000,
    "CapDifference": 0,
}
VALUE_ROW_ORPHAN = {  # has FOLIOID but no use_code / no last_sale → tests left-join NULLs
    "FOLIOID": "F3", "Just": 198000, "Market": 200000, "Assessed": 198000,
    "Taxable": 198000, "SOHCap": 0, "Building": 145000, "Land": 53000,
    "CapDifference": 0,
}

# DoS comes back as epoch milliseconds in f=json (2024-06-15T00:00:00 UTC).
SALE_ROW_1 = {
    "FOLIOID": "F1", "Amount": 410000, "DoS": 1718409600000,
    "Instrument": "WD", "ORBookPage": "5012/3456",
}


class TestIngestLeepaParcels:
    """The original Layer 0 ingest — unchanged. Tests retained as regression guards."""

    def test_uploads_to_tabular_cold(self):
        from ingest.pipelines.leepa.resources import ingest_leepa_parcels
        with patch("ingest.pipelines.leepa.resources.paginate_arcgis", return_value=iter([FAKE_PARCEL])), \
             patch("ingest.pipelines.leepa.resources.upload_geojson_gz") as mock_upload, \
             patch("ingest.pipelines.leepa.resources.upsert_inventory_row"):
            ingest_leepa_parcels(MagicMock())
        assert mock_upload.call_args[0][0] == "raw-tabular-cold"

    def test_object_path_pattern(self):
        from ingest.pipelines.leepa.resources import ingest_leepa_parcels
        with patch("ingest.pipelines.leepa.resources.paginate_arcgis", return_value=iter([FAKE_PARCEL])), \
             patch("ingest.pipelines.leepa.resources.upload_geojson_gz") as mock_upload, \
             patch("ingest.pipelines.leepa.resources.upsert_inventory_row"):
            ingest_leepa_parcels(MagicMock())
        path = mock_upload.call_args[0][1]
        assert "leepa/parcels/" in path and path.endswith(".geojson.gz")

    def test_writes_tier1_pointer(self):
        from ingest.pipelines.leepa.resources import ingest_leepa_parcels
        with patch("ingest.pipelines.leepa.resources.paginate_arcgis", return_value=iter([FAKE_PARCEL])), \
             patch("ingest.pipelines.leepa.resources.upload_geojson_gz"), \
             patch("ingest.pipelines.leepa.resources.upsert_inventory_row") as mock_ptr:
            ingest_leepa_parcels(MagicMock())
        assert mock_ptr.call_args.kwargs["pack_id"] == "properties-lee-value"

    def test_no_bbox_filter(self):
        from ingest.pipelines.leepa.resources import ingest_leepa_parcels
        with patch("ingest.pipelines.leepa.resources.paginate_arcgis", return_value=iter([FAKE_PARCEL])) as mock_pag, \
             patch("ingest.pipelines.leepa.resources.upload_geojson_gz"), \
             patch("ingest.pipelines.leepa.resources.upsert_inventory_row"):
            ingest_leepa_parcels(MagicMock())
        call_kwargs = mock_pag.call_args[1] if mock_pag.call_args else {}
        assert "bbox" not in call_kwargs


class TestCoercion:
    def test_float_passthrough_int(self):
        from ingest.pipelines.leepa.resources import _coerce_float
        assert _coerce_float(123) == 123.0
        assert isinstance(_coerce_float(123), float)

    def test_float_passthrough_string(self):
        from ingest.pipelines.leepa.resources import _coerce_float
        assert _coerce_float("123.45") == 123.45

    def test_float_none_and_empty(self):
        from ingest.pipelines.leepa.resources import _coerce_float
        assert _coerce_float(None) is None
        assert _coerce_float("") is None

    def test_esri_date_epoch_millis(self):
        from ingest.pipelines.leepa.resources import _coerce_esri_date
        # 2024-06-15 00:00:00 UTC
        assert _coerce_esri_date(1718409600000) == "2024-06-15"

    def test_esri_date_iso_string(self):
        from ingest.pipelines.leepa.resources import _coerce_esri_date
        assert _coerce_esri_date("2024-06-15T00:00:00Z") == "2024-06-15"
        assert _coerce_esri_date("2024-06-15") == "2024-06-15"

    def test_esri_date_none_and_empty(self):
        from ingest.pipelines.leepa.resources import _coerce_esri_date
        assert _coerce_esri_date(None) is None
        assert _coerce_esri_date("") is None


class TestJoinLeepa:
    def test_value_layer_is_spine(self):
        from ingest.pipelines.leepa.resources import _join_leepa
        # Two values; one use (F1 only); one sale (F1 only). Spine = value, so F2 stays even
        # though it has no use or sale match.
        joined = _join_leepa([USE_ROW_1], [VALUE_ROW_1, VALUE_ROW_2], [SALE_ROW_1])
        assert len(joined) == 2
        folios = {r["folioid"] for r in joined}
        assert folios == {"F1", "F2"}

    def test_use_left_join_nulls_when_no_match(self):
        from ingest.pipelines.leepa.resources import _join_leepa
        joined = _join_leepa([USE_ROW_1], [VALUE_ROW_1, VALUE_ROW_ORPHAN], [SALE_ROW_1])
        by_folio = {r["folioid"]: r for r in joined}
        assert by_folio["F1"]["use_code"] == "0100"
        assert by_folio["F3"]["use_code"] is None
        assert by_folio["F3"]["use_description"] is None

    def test_sale_left_join_nulls_when_no_match(self):
        from ingest.pipelines.leepa.resources import _join_leepa
        joined = _join_leepa([USE_ROW_1, USE_ROW_2], [VALUE_ROW_1, VALUE_ROW_2], [SALE_ROW_1])
        by_folio = {r["folioid"]: r for r in joined}
        assert by_folio["F1"]["last_sale_amount"] == 410000.0
        assert by_folio["F1"]["last_sale_date"] == "2024-06-15"
        assert by_folio["F2"]["last_sale_amount"] is None
        assert by_folio["F2"]["last_sale_date"] is None

    def test_value_fields_coerced_to_float(self):
        from ingest.pipelines.leepa.resources import _join_leepa
        joined = _join_leepa([USE_ROW_1], [VALUE_ROW_1], [SALE_ROW_1])
        r = joined[0]
        for k in ("just_value", "market_value", "assessed_value", "taxable_value",
                  "soh_cap", "building_value", "land_value", "cap_difference",
                  "last_sale_amount"):
            assert isinstance(r[k], float), f"{k} should be float"

    def test_drops_rows_without_folioid(self):
        from ingest.pipelines.leepa.resources import _join_leepa
        bad = {**VALUE_ROW_1, "FOLIOID": None}
        joined = _join_leepa([USE_ROW_1], [bad, VALUE_ROW_2], [SALE_ROW_1])
        assert len(joined) == 1
        assert joined[0]["folioid"] == "F2"


class TestIngestLeepaParcelsValue:
    def _stub_paginator(self, monkeypatch_target="ingest.pipelines.leepa.resources.paginate_arcgis_tabular"):
        # Returned in the same layer order the function pulls: just_value, use_codes, last_sale.
        return [iter([VALUE_ROW_1, VALUE_ROW_2]), iter([USE_ROW_1, USE_ROW_2]), iter([SALE_ROW_1])]

    def test_three_tier1_uploads_one_per_layer(self):
        from ingest.pipelines.leepa.resources import ingest_leepa_parcels_value
        with patch("ingest.pipelines.leepa.resources.paginate_arcgis_tabular",
                   side_effect=self._stub_paginator()), \
             patch("ingest.pipelines.leepa.resources.upload_csv_gz") as mock_upload, \
             patch("ingest.pipelines.leepa.resources.upsert_inventory_row"), \
             patch("ingest.pipelines.leepa.resources.arcgis_count", return_value=2), \
             patch("ingest.pipelines.leepa.resources._promote_leepa_to_tier2"):
            ingest_leepa_parcels_value(MagicMock())
        assert mock_upload.call_count == 3
        paths = [call.args[1] for call in mock_upload.call_args_list]
        assert any("leepa/just_value/" in p for p in paths)
        assert any("leepa/use_codes/" in p for p in paths)
        assert any("leepa/last_sale/" in p for p in paths)
        assert all(p.endswith(".csv.gz") for p in paths)

    def test_three_pointer_rows(self):
        from ingest.pipelines.leepa.resources import ingest_leepa_parcels_value
        with patch("ingest.pipelines.leepa.resources.paginate_arcgis_tabular",
                   side_effect=self._stub_paginator()), \
             patch("ingest.pipelines.leepa.resources.upload_csv_gz"), \
             patch("ingest.pipelines.leepa.resources.upsert_inventory_row") as mock_ptr, \
             patch("ingest.pipelines.leepa.resources.arcgis_count", return_value=2), \
             patch("ingest.pipelines.leepa.resources._promote_leepa_to_tier2"):
            ingest_leepa_parcels_value(MagicMock())
        paths = {call.kwargs["path"] for call in mock_ptr.call_args_list}
        assert any("just_value" in p for p in paths)
        assert any("use_codes" in p for p in paths)
        assert any("last_sale" in p for p in paths)

    def test_tier2_called_with_joined_rows(self):
        from ingest.pipelines.leepa.resources import ingest_leepa_parcels_value
        with patch("ingest.pipelines.leepa.resources.paginate_arcgis_tabular",
                   side_effect=self._stub_paginator()), \
             patch("ingest.pipelines.leepa.resources.upload_csv_gz"), \
             patch("ingest.pipelines.leepa.resources.upsert_inventory_row"), \
             patch("ingest.pipelines.leepa.resources.arcgis_count", return_value=2), \
             patch("ingest.pipelines.leepa.resources._promote_leepa_to_tier2") as mock_promote:
            ingest_leepa_parcels_value(MagicMock())
        assert mock_promote.called
        joined = mock_promote.call_args[0][0]
        assert len(joined) == 2
        folios = {r["folioid"] for r in joined}
        assert folios == {"F1", "F2"}

    def test_skips_promotion_when_layer_returns_zero_rows(self):
        from ingest.pipelines.leepa.resources import ingest_leepa_parcels_value
        # just_value returns 0 — entire function returns early
        with patch("ingest.pipelines.leepa.resources.paginate_arcgis_tabular",
                   side_effect=[iter([]), iter([]), iter([])]), \
             patch("ingest.pipelines.leepa.resources.upload_csv_gz") as mock_upload, \
             patch("ingest.pipelines.leepa.resources.upsert_inventory_row"), \
             patch("ingest.pipelines.leepa.resources.arcgis_count", return_value=100), \
             patch("ingest.pipelines.leepa.resources._promote_leepa_to_tier2") as mock_promote:
            ingest_leepa_parcels_value(MagicMock())
        assert not mock_upload.called
        assert not mock_promote.called

    def test_aborts_when_pagination_under_90_pct_canonical(self):
        from ingest.pipelines.leepa.resources import ingest_leepa_parcels_value
        # Pulled 2 just_value rows; canonical reports 1000 → 0.2% coverage → must raise
        with patch("ingest.pipelines.leepa.resources.paginate_arcgis_tabular",
                   side_effect=self._stub_paginator()), \
             patch("ingest.pipelines.leepa.resources.upload_csv_gz"), \
             patch("ingest.pipelines.leepa.resources.upsert_inventory_row"), \
             patch("ingest.pipelines.leepa.resources.arcgis_count", return_value=1000), \
             patch("ingest.pipelines.leepa.resources._promote_leepa_to_tier2") as mock_promote:
            try:
                ingest_leepa_parcels_value(MagicMock())
            except RuntimeError as e:
                assert "aborting" in str(e).lower()
            else:
                raise AssertionError("expected RuntimeError when pagination < 90% canonical")
        assert not mock_promote.called


class TestPromoteLeepaToTier2:
    JOINED = [{
        "folioid": "F1", "just_value": 425000.0, "market_value": 430000.0,
        "assessed_value": 380000.0, "taxable_value": 330000.0, "soh_cap": 50000.0,
        "building_value": 280000.0, "land_value": 145000.0, "cap_difference": 45000.0,
        "use_code": "0100", "use_description": "Single Family",
        "last_sale_amount": 410000.0, "last_sale_date": "2024-06-15",
        "last_sale_instrument": "WD", "last_sale_book_page": "5012/3456",
    }]

    def test_pipeline_named_leepa_t2(self):
        from ingest.pipelines.leepa.resources import _promote_leepa_to_tier2
        mock_pipeline_instance = MagicMock()
        with patch("ingest.pipelines.leepa.resources.dlt") as mock_dlt:
            mock_dlt.pipeline.return_value = mock_pipeline_instance
            mock_dlt.resource = lambda **kwargs: (lambda fn: fn)
            _promote_leepa_to_tier2(self.JOINED)
        call_kwargs = mock_dlt.pipeline.call_args.kwargs
        assert call_kwargs["pipeline_name"].startswith("leepa_t2_")
        assert call_kwargs["destination"] == "postgres"
        assert call_kwargs["dataset_name"] == "data_lake"

    def test_table_named_leepa_parcels_with_merge(self):
        from ingest.pipelines.leepa.resources import _promote_leepa_to_tier2
        captured = {}
        def capture_resource(**kwargs):
            captured.update(kwargs)
            return lambda fn: fn
        with patch("ingest.pipelines.leepa.resources.dlt") as mock_dlt:
            mock_dlt.pipeline.return_value = MagicMock()
            mock_dlt.resource = capture_resource
            _promote_leepa_to_tier2(self.JOINED)
        assert captured["table_name"] == "leepa_parcels"
        assert captured["write_disposition"] == "merge"
        assert "columns" in captured
        assert len(captured["columns"]) == 15
        assert captured["columns"]["folioid"].get("primary_key") is True

    def test_raises_on_failed_jobs(self):
        from ingest.pipelines.leepa.resources import _promote_leepa_to_tier2
        mock_pipeline_instance = MagicMock()
        mock_load_info = MagicMock()
        mock_pipeline_instance.run.return_value = mock_load_info
        with patch("ingest.pipelines.leepa.resources.dlt") as mock_dlt:
            mock_dlt.pipeline.return_value = mock_pipeline_instance
            mock_dlt.resource = lambda **kwargs: (lambda fn: fn)
            _promote_leepa_to_tier2(self.JOINED)
        mock_load_info.raise_on_failed_jobs.assert_called_once()

    def test_propagates_failed_job_exception(self):
        from ingest.pipelines.leepa.resources import _promote_leepa_to_tier2
        mock_pipeline_instance = MagicMock()
        mock_load_info = MagicMock()
        mock_load_info.raise_on_failed_jobs.side_effect = RuntimeError("simulated dlt job failure")
        mock_pipeline_instance.run.return_value = mock_load_info
        with patch("ingest.pipelines.leepa.resources.dlt") as mock_dlt:
            mock_dlt.pipeline.return_value = mock_pipeline_instance
            mock_dlt.resource = lambda **kwargs: (lambda fn: fn)
            try:
                _promote_leepa_to_tier2(self.JOINED)
            except RuntimeError as e:
                assert "simulated dlt job failure" in str(e)
            else:
                raise AssertionError("expected _promote_leepa_to_tier2 to re-raise the failed-job exception")
