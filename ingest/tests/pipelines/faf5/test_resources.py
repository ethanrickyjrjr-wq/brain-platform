import io
import csv
import zipfile
from unittest.mock import patch

from ingest.pipelines.faf5.constants import FL_ZONE_IDS


def _make_fake_zip(rows: list[dict]) -> bytes:
    csv_buf = io.StringIO()
    if rows:
        writer = csv.DictWriter(csv_buf, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)
    zip_buf = io.BytesIO()
    with zipfile.ZipFile(zip_buf, "w") as zf:
        zf.writestr("faf5_flows.csv", csv_buf.getvalue())
    return zip_buf.getvalue()


FL_ORIG_ROW = {
    "dms_orig": "129", "dms_dest": "51", "sctg2": "12", "trade_type": "1",
    "tons_2017": "100.5", "tons_2022": "110.0", "tons_2024": "120.0",
    "value_2017": "500.0", "value_2022": "550.0", "value_2024": "600.0",
    "tmiles_2017": "10.0", "tmiles_2022": "11.0", "tmiles_2024": "12.0",
}
FL_DEST_ROW = {
    "dms_orig": "51", "dms_dest": "124", "sctg2": "31", "trade_type": "1",
    "tons_2017": "50.0", "tons_2022": "55.0", "tons_2024": "60.0",
    "value_2017": "300.0", "value_2022": "320.0", "value_2024": "340.0",
    "tmiles_2017": "5.0", "tmiles_2022": "5.5", "tmiles_2024": "6.0",
}
NON_FL_ROW = {
    "dms_orig": "21", "dms_dest": "51", "sctg2": "32", "trade_type": "1",
    "tons_2017": "200.0", "tons_2022": "210.0", "tons_2024": "220.0",
    "value_2017": "700.0", "value_2022": "750.0", "value_2024": "800.0",
    "tmiles_2017": "15.0", "tmiles_2022": "16.0", "tmiles_2024": "17.0",
}

_PATCH = "ingest.pipelines.faf5.resources._fetch_zip_bytes"


class TestFafFlows:
    def test_yields_fl_origin_rows(self):
        from ingest.pipelines.faf5.resources import faf_flows
        with patch(_PATCH, return_value=_make_fake_zip([FL_ORIG_ROW, NON_FL_ROW])):
            rows = list(faf_flows())
        assert len(rows) == 1
        assert rows[0]["dms_orig"] == 129

    def test_yields_fl_destination_rows(self):
        from ingest.pipelines.faf5.resources import faf_flows
        with patch(_PATCH, return_value=_make_fake_zip([FL_DEST_ROW, NON_FL_ROW])):
            rows = list(faf_flows())
        assert len(rows) == 1
        assert rows[0]["dms_dest"] == 124

    def test_excludes_non_fl_rows(self):
        from ingest.pipelines.faf5.resources import faf_flows
        with patch(_PATCH, return_value=_make_fake_zip([NON_FL_ROW])):
            rows = list(faf_flows())
        assert rows == []

    def test_coerces_int_fields(self):
        from ingest.pipelines.faf5.resources import faf_flows
        with patch(_PATCH, return_value=_make_fake_zip([FL_ORIG_ROW])):
            row = list(faf_flows())[0]
        assert isinstance(row["dms_orig"], int)
        assert isinstance(row["dms_dest"], int)
        assert isinstance(row["sctg2"], int)
        assert isinstance(row["trade_type"], int)

    def test_coerces_float_fields(self):
        from ingest.pipelines.faf5.resources import faf_flows
        with patch(_PATCH, return_value=_make_fake_zip([FL_ORIG_ROW])):
            row = list(faf_flows())[0]
        assert isinstance(row["tons_2017"], float)
        assert isinstance(row["value_2022"], float)
        assert isinstance(row["tmiles_2024"], float)


class TestFafZoneLookup:
    def test_yields_all_fl_zones(self):
        from ingest.pipelines.faf5.resources import faf_zone_lookup
        zone_ids = {r["zone_id"] for r in faf_zone_lookup()}
        assert FL_ZONE_IDS.issubset(zone_ids), f"Missing FL zones: {FL_ZONE_IDS - zone_ids}"

    def test_zone_129_is_remainder_of_florida(self):
        from ingest.pipelines.faf5.resources import faf_zone_lookup
        rows = {r["zone_id"]: r for r in faf_zone_lookup()}
        assert rows[129]["zone_name"] == "Remainder of Florida"
        assert rows[129]["state_abbr"] == "FL"

    def test_all_rows_have_required_keys(self):
        from ingest.pipelines.faf5.resources import faf_zone_lookup
        for row in faf_zone_lookup():
            assert "zone_id" in row
            assert "zone_name" in row
            assert "state_abbr" in row


class TestFafSctgLookup:
    def test_yields_swfl_target_commodities(self):
        from ingest.pipelines.faf5.resources import faf_sctg_lookup
        codes = {r["sctg_code"] for r in faf_sctg_lookup()}
        for target in (12, 31, 32, 33):
            assert target in codes, f"SCTG code {target} missing"

    def test_all_rows_have_required_keys(self):
        from ingest.pipelines.faf5.resources import faf_sctg_lookup
        for row in faf_sctg_lookup():
            assert "sctg_code" in row
            assert "commodity_name" in row

    def test_sctg_code_is_int(self):
        from ingest.pipelines.faf5.resources import faf_sctg_lookup
        for row in faf_sctg_lookup():
            assert isinstance(row["sctg_code"], int)
