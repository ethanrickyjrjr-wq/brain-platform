from unittest.mock import MagicMock, patch


def _fake_census_response():
    m = MagicMock()
    m.status_code = 200
    m.text = '[["NAICS2017","NAICS2017_LABEL","ESTAB","EMP","PAYANN","NAME","state","county"],["00","Total","100","1000","50000","Lee County, Florida","12","071"]]'
    m.json.return_value = [
        ["NAICS2017", "NAICS2017_LABEL", "ESTAB", "EMP", "PAYANN", "NAME", "state", "county"],
        ["00", "Total", "100", "1000", "50000", "Lee County, Florida", "12", "071"],
    ]
    return m


def test_dry_run_skips_dlt():
    with patch("dlt.pipeline") as mock_pipeline, \
         patch("requests.get", return_value=_fake_census_response()):
        from ingest.pipelines.census_cbp.pipeline import main

        result = main(["--dry-run"])

    assert result == 0
    mock_pipeline.assert_not_called()
