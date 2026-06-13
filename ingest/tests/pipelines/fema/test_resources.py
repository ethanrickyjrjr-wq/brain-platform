from unittest.mock import patch, MagicMock

FAKE_FEATURE = {"type": "Feature", "geometry": None, "properties": {"OBJECTID": 1}}
FAKE_CLAIM   = {"id": "1", "countyCode": "12071", "buildingDamageAmount": "5000"}

# A realistic OpenFEMA FimaNfipClaims row with all 16 pinned fields populated.
# v2 has NO `floodZone` field — it carries `ratedFloodZone` + `floodZoneCurrent`.
# Distinct values here prove each maps to its own column.
FAKE_NFIP_RAW = {
    "id": "abc-123",
    "yearOfLoss": 2022,
    "dateOfLoss": "2022-09-28T00:00:00.000Z",
    "state": "FL",
    "countyCode": "12071",
    "reportedCity": "FORT MYERS",
    "reportedZipCode": "33901",
    "ratedFloodZone": "AE",
    "floodZoneCurrent": "X",
    "occupancyType": 1,
    "numberOfFloorsInTheInsuredBuilding": 1,
    "amountPaidOnBuildingClaim": "125000.50",
    "amountPaidOnContentsClaim": "30000.0",
    "amountPaidOnIncreasedCostOfComplianceClaim": "0.0",
    "buildingPropertyValue": "350000",
    "buildingDamageAmount": "180000",
    # Fields outside the pinned 15 — must be dropped from normalized output.
    "repetitiveLossIndicator": True,
    "policyCount": 1,
}


class TestIngestNfhlLayer:
    def test_uploads_to_geometry_bucket(self):
        from ingest.pipelines.fema.resources import ingest_nfhl_layer
        layer = {"name": "flood_zones", "url": "https://hazards.fema.gov/..."}
        with patch("ingest.pipelines.fema.resources.paginate_arcgis", return_value=iter([FAKE_FEATURE])), \
             patch("ingest.pipelines.fema.resources.upload_geojson_gz") as mock_upload, \
             patch("ingest.pipelines.fema.resources.write_tier1_pointer"):
            ingest_nfhl_layer(MagicMock(), layer)
        assert mock_upload.call_args[0][0] == "raw-geometry"

    def test_object_path_contains_layer_name_and_date(self):
        from ingest.pipelines.fema.resources import ingest_nfhl_layer
        layer = {"name": "lomr", "url": "https://hazards.fema.gov/..."}
        with patch("ingest.pipelines.fema.resources.paginate_arcgis", return_value=iter([FAKE_FEATURE])), \
             patch("ingest.pipelines.fema.resources.upload_geojson_gz") as mock_upload, \
             patch("ingest.pipelines.fema.resources.write_tier1_pointer"):
            ingest_nfhl_layer(MagicMock(), layer)
        path = mock_upload.call_args[0][1]
        assert "lomr" in path and path.endswith(".geojson.gz")

    def test_writes_tier1_pointer_with_correct_table_name(self):
        from ingest.pipelines.fema.resources import ingest_nfhl_layer
        layer = {"name": "bfe", "url": "https://hazards.fema.gov/..."}
        mock_pipeline = MagicMock()
        with patch("ingest.pipelines.fema.resources.paginate_arcgis", return_value=iter([FAKE_FEATURE])), \
             patch("ingest.pipelines.fema.resources.upload_geojson_gz"), \
             patch("ingest.pipelines.fema.resources.write_tier1_pointer") as mock_ptr:
            ingest_nfhl_layer(mock_pipeline, layer)
        assert mock_ptr.call_args[0][1] == "fema_bfe"


class TestIngestNfipClaims:
    def test_uploads_csv_gz_to_tabular_cold(self):
        from ingest.pipelines.fema.resources import ingest_nfip_claims
        with patch("ingest.pipelines.fema.resources._fetch_all_nfip_claims", return_value=[FAKE_CLAIM]), \
             patch("ingest.pipelines.fema.resources.assert_min_rows"), \
             patch("ingest.pipelines.fema.resources._current_tier2_count", return_value=None), \
             patch("ingest.pipelines.fema.resources.upload_csv_gz") as mock_upload, \
             patch("ingest.pipelines.fema.resources.write_tier1_pointer"), \
             patch("ingest.pipelines.fema.resources._promote_nfip_to_tier2"):
            ingest_nfip_claims(MagicMock())
        assert mock_upload.call_args[0][0] == "raw-tabular-cold"
        assert "nfip_claims" in mock_upload.call_args[0][1]

    def test_skips_when_no_claims(self):
        from ingest.pipelines.fema.resources import ingest_nfip_claims
        with patch("ingest.pipelines.fema.resources._fetch_all_nfip_claims", return_value=[]), \
             patch("ingest.pipelines.fema.resources.upload_csv_gz") as mock_upload, \
             patch("ingest.pipelines.fema.resources.write_tier1_pointer"), \
             patch("ingest.pipelines.fema.resources._promote_nfip_to_tier2") as mock_tier2:
            ingest_nfip_claims(MagicMock())
        assert not mock_upload.called
        assert not mock_tier2.called

    def test_tier2_promotion_fires_after_tier1(self):
        from ingest.pipelines.fema.resources import ingest_nfip_claims
        with patch("ingest.pipelines.fema.resources._fetch_all_nfip_claims", return_value=[FAKE_CLAIM]), \
             patch("ingest.pipelines.fema.resources.assert_min_rows"), \
             patch("ingest.pipelines.fema.resources._current_tier2_count", return_value=None), \
             patch("ingest.pipelines.fema.resources.upload_csv_gz"), \
             patch("ingest.pipelines.fema.resources.write_tier1_pointer"), \
             patch("ingest.pipelines.fema.resources._promote_nfip_to_tier2") as mock_tier2:
            ingest_nfip_claims(MagicMock())
        assert mock_tier2.called
        rows_arg = mock_tier2.call_args[0][0]
        assert rows_arg[0]["id"] == "1"

    def test_tier1_uses_fema_nfip_claims_table_name(self):
        from ingest.pipelines.fema.resources import ingest_nfip_claims
        with patch("ingest.pipelines.fema.resources._fetch_all_nfip_claims", return_value=[FAKE_CLAIM]), \
             patch("ingest.pipelines.fema.resources.assert_min_rows"), \
             patch("ingest.pipelines.fema.resources._current_tier2_count", return_value=None), \
             patch("ingest.pipelines.fema.resources.upload_csv_gz"), \
             patch("ingest.pipelines.fema.resources.write_tier1_pointer") as mock_ptr, \
             patch("ingest.pipelines.fema.resources._promote_nfip_to_tier2"):
            ingest_nfip_claims(MagicMock())
        assert mock_ptr.call_args[0][1] == "fema_nfip_claims"


class TestNormalizeNfip:
    """_normalize_nfip() pins the 15 columns of the OpenFEMA FimaNfipClaims schema to Tier 2 types.
    Fields outside the pinned set (repetitive-loss indicator, policy counts, modifier dates) are dropped.
    """

    def test_pins_16_columns_and_drops_extras(self):
        from ingest.pipelines.fema.resources import _normalize_nfip, _TIER2_NFIP_COLUMNS
        out = _normalize_nfip(FAKE_NFIP_RAW)
        assert set(out.keys()) == set(_TIER2_NFIP_COLUMNS.keys())
        assert "repetitiveLossIndicator" not in out
        assert "policyCount" not in out
        assert len(_TIER2_NFIP_COLUMNS) == 16

    def test_id_is_primary_key_non_nullable(self):
        from ingest.pipelines.fema.resources import _TIER2_NFIP_COLUMNS
        id_col = _TIER2_NFIP_COLUMNS["id"]
        assert id_col["primary_key"] is True
        assert id_col["nullable"] is False
        assert id_col["data_type"] == "text"

    def test_integer_coercion(self):
        from ingest.pipelines.fema.resources import _normalize_nfip
        out = _normalize_nfip(FAKE_NFIP_RAW)
        assert out["year_of_loss"] == 2022
        assert isinstance(out["year_of_loss"], int)
        assert out["occupancy_type"] == 1
        assert isinstance(out["occupancy_type"], int)
        assert out["number_of_floors_insured"] == 1

    def test_double_coercion(self):
        from ingest.pipelines.fema.resources import _normalize_nfip
        out = _normalize_nfip(FAKE_NFIP_RAW)
        assert out["amount_paid_on_building_claim"] == 125000.50
        assert out["amount_paid_on_contents_claim"] == 30000.0
        assert out["amount_paid_on_ico_claim"] == 0.0
        assert out["building_property_value"] == 350000.0
        assert out["building_damage_amount"] == 180000.0
        for k in ("amount_paid_on_building_claim", "amount_paid_on_contents_claim",
                  "amount_paid_on_ico_claim", "building_property_value", "building_damage_amount"):
            assert isinstance(out[k], float), f"{k} should be float"

    def test_date_coercion_strips_time_component(self):
        """OpenFEMA returns ISO-8601 with a T-separator; Postgres `date` wants YYYY-MM-DD only."""
        from ingest.pipelines.fema.resources import _normalize_nfip
        out = _normalize_nfip(FAKE_NFIP_RAW)
        assert out["date_of_loss"] == "2022-09-28"

    def test_text_passthrough(self):
        from ingest.pipelines.fema.resources import _normalize_nfip
        out = _normalize_nfip(FAKE_NFIP_RAW)
        assert out["id"] == "abc-123"
        assert out["state"] == "FL"
        assert out["county_code"] == "12071"
        assert out["reported_city"] == "FORT MYERS"
        assert out["reported_zipcode"] == "33901"
        assert out["flood_zone"] == "AE"            # from ratedFloodZone
        assert out["flood_zone_current"] == "X"     # from floodZoneCurrent

    def test_null_paid_amounts_preserved(self):
        """Some claims have no contents coverage; null must propagate, not coerce to 0."""
        from ingest.pipelines.fema.resources import _normalize_nfip
        raw = {**FAKE_NFIP_RAW, "amountPaidOnContentsClaim": None}
        out = _normalize_nfip(raw)
        assert out["amount_paid_on_contents_claim"] is None

    def test_empty_string_treated_as_null(self):
        from ingest.pipelines.fema.resources import _normalize_nfip
        raw = {**FAKE_NFIP_RAW, "amountPaidOnBuildingClaim": "", "yearOfLoss": ""}
        out = _normalize_nfip(raw)
        assert out["amount_paid_on_building_claim"] is None
        assert out["year_of_loss"] is None

    def test_missing_field_yields_none(self):
        from ingest.pipelines.fema.resources import _normalize_nfip
        raw = {k: v for k, v in FAKE_NFIP_RAW.items() if k != "ratedFloodZone"}
        out = _normalize_nfip(raw)
        assert out["flood_zone"] is None


class TestTier2PromotionNfip:
    def test_tier2_uses_replace_write_disposition(self):
        from ingest.pipelines.fema.resources import _promote_nfip_to_tier2
        mock_pipeline_instance = MagicMock()
        with patch("ingest.pipelines.fema.resources.dlt") as mock_dlt:
            mock_dlt.pipeline.return_value = mock_pipeline_instance
            mock_dlt.resource = lambda **kwargs: (lambda fn: fn)
            _promote_nfip_to_tier2([FAKE_NFIP_RAW])
        mock_dlt.pipeline.assert_called_once()
        call_kwargs = mock_dlt.pipeline.call_args.kwargs
        assert call_kwargs["pipeline_name"] == "fema_nfip_tier2"
        assert call_kwargs["destination"] == "postgres"
        assert call_kwargs["dataset_name"] == "data_lake"
        mock_pipeline_instance.run.assert_called_once()

    def test_tier2_raises_on_failed_jobs(self):
        """dlt swallows per-job failures into LoadInfo. Mirror fdot — call raise_on_failed_jobs()
        so Tier 2 can never silently half-load while the process exits 0."""
        from ingest.pipelines.fema.resources import _promote_nfip_to_tier2
        mock_pipeline_instance = MagicMock()
        mock_load_info = MagicMock()
        mock_pipeline_instance.run.return_value = mock_load_info
        with patch("ingest.pipelines.fema.resources.dlt") as mock_dlt:
            mock_dlt.pipeline.return_value = mock_pipeline_instance
            mock_dlt.resource = lambda **kwargs: (lambda fn: fn)
            _promote_nfip_to_tier2([FAKE_NFIP_RAW])
        mock_load_info.raise_on_failed_jobs.assert_called_once()

    def test_tier2_propagates_failed_job_exception(self):
        from ingest.pipelines.fema.resources import _promote_nfip_to_tier2
        mock_pipeline_instance = MagicMock()
        mock_load_info = MagicMock()
        mock_load_info.raise_on_failed_jobs.side_effect = RuntimeError("simulated dlt job failure")
        mock_pipeline_instance.run.return_value = mock_load_info
        with patch("ingest.pipelines.fema.resources.dlt") as mock_dlt:
            mock_dlt.pipeline.return_value = mock_pipeline_instance
            mock_dlt.resource = lambda **kwargs: (lambda fn: fn)
            try:
                _promote_nfip_to_tier2([FAKE_NFIP_RAW])
            except RuntimeError as e:
                assert "simulated dlt job failure" in str(e)
            else:
                raise AssertionError("expected _promote_nfip_to_tier2 to re-raise the failed-job exception")

    def test_tier2_table_named_fema_nfip_claims(self):
        from ingest.pipelines.fema.resources import _promote_nfip_to_tier2
        captured_kwargs = {}
        def capture_resource(**kwargs):
            captured_kwargs.update(kwargs)
            return lambda fn: fn
        with patch("ingest.pipelines.fema.resources.dlt") as mock_dlt:
            mock_dlt.pipeline.return_value = MagicMock()
            mock_dlt.resource = capture_resource
            _promote_nfip_to_tier2([FAKE_NFIP_RAW])
        assert captured_kwargs["table_name"] == "fema_nfip_claims"
        assert captured_kwargs["write_disposition"] == "replace"
        assert "columns" in captured_kwargs
        assert len(captured_kwargs["columns"]) == 16

    def test_null_zip_rate_guard_aborts_before_replace(self):
        """Tripwire: if the zip column comes back all-null (a silent vendor field-name
        break — exactly how reportedZipCode->reportedZipcode hid), abort BEFORE the
        destructive replace rather than wipe the table with zip-less data."""
        from ingest.pipelines.fema.resources import _promote_nfip_to_tier2
        from ingest.lib.guards import VolumeGuardError
        rows = [{**FAKE_NFIP_RAW, "reportedZipCode": None} for _ in range(10)]
        try:
            _promote_nfip_to_tier2(rows)
        except VolumeGuardError as e:
            assert "reported_zipcode" in str(e)
        else:
            raise AssertionError("expected the NULL-zip-rate guard to abort the promote")

    def test_null_flood_zone_rate_guard_aborts_before_replace(self):
        """Same tripwire for the rated flood zone: reading the dead `floodZone` key
        (OpenFEMA v2 renamed it to ratedFloodZone) nulled the column for weeks. The
        guard must abort BEFORE the destructive replace. zip is set here so the
        earlier zip guard passes and we reach the flood-zone guard."""
        from ingest.pipelines.fema.resources import _promote_nfip_to_tier2
        from ingest.lib.guards import VolumeGuardError
        rows = [{**FAKE_NFIP_RAW, "ratedFloodZone": None} for _ in range(10)]
        try:
            _promote_nfip_to_tier2(rows)
        except VolumeGuardError as e:
            assert "flood_zone" in str(e)
        else:
            raise AssertionError("expected the NULL-flood-zone-rate guard to abort the promote")
