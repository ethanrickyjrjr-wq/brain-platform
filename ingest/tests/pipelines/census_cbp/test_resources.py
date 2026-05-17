from unittest.mock import patch, MagicMock

from ingest.pipelines.census_cbp.constants import CBP_YEARS

FAKE_RESPONSE = [
    ["NAICS2017", "NAICS2017_LABEL", "ESTAB", "EMP", "PAYANN", "NAME", "state", "county"],
    ["--", "Total for all sectors", "50000", "500000", "10000000", "Lee County", "12", "071"],
    ["44-45", "Retail trade", "5000", "50000", "1000000", "Lee County", "12", "071"],
]


def _mock_get():
    m = MagicMock()
    m.json.return_value = FAKE_RESPONSE
    m.raise_for_status = MagicMock()
    return m


class TestCensusCbpFl:
    def test_yields_one_row_per_naics_per_year(self):
        from ingest.pipelines.census_cbp.resources import census_cbp_fl
        with patch("requests.get", return_value=_mock_get()):
            rows = list(census_cbp_fl())
        assert len(rows) == 2 * len(CBP_YEARS)

    def test_field_mapping(self):
        from ingest.pipelines.census_cbp.resources import census_cbp_fl
        with patch("requests.get", return_value=_mock_get()):
            rows = list(census_cbp_fl())
        row = next(r for r in rows if r["naics_code"] == "--")
        assert row["establishment_count"] == 50000
        assert row["employment"] == 500000
        assert row["annual_payroll"] == 10000000
        assert row["fips_state"] == "12"
        assert row["fips_county"] == "071"
        assert row["county_name"] == "Lee County"

    def test_natural_key_fields_present(self):
        from ingest.pipelines.census_cbp.resources import census_cbp_fl
        with patch("requests.get", return_value=_mock_get()):
            rows = list(census_cbp_fl())
        for row in rows:
            for key in ("naics_code", "year", "fips_state", "fips_county"):
                assert key in row, f"missing key: {key}"

    def test_loops_all_cbp_years(self):
        from ingest.pipelines.census_cbp.resources import census_cbp_fl
        with patch("requests.get", return_value=_mock_get()):
            rows = list(census_cbp_fl())
        years = sorted({r["year"] for r in rows})
        assert years == sorted(CBP_YEARS)

    def test_int_coercion(self):
        from ingest.pipelines.census_cbp.resources import census_cbp_fl
        with patch("requests.get", return_value=_mock_get()):
            rows = list(census_cbp_fl())
        row = rows[0]
        assert isinstance(row["establishment_count"], int)
        assert isinstance(row["employment"], int)
        assert isinstance(row["year"], int)

    def test_ingested_at_present(self):
        from ingest.pipelines.census_cbp.resources import census_cbp_fl
        with patch("requests.get", return_value=_mock_get()):
            rows = list(census_cbp_fl())
        assert all("ingested_at" in r for r in rows)
