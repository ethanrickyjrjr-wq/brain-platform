import json

import pytest

from ingest.duckdb_pipelines.usgs.fetch import (
    coerce_float,
    coerce_int_str,
    parse_dv_response,
    parse_rdb,
    _rdb_row_to_site,
    year_chunks,
)


# ── coerce_float ─────────────────────────────────────────────────────────────


@pytest.mark.parametrize("raw,expected", [
    ("1.23",       1.23),
    (" 1.23 ",     1.23),
    ("0",          0.0),
    (0.5,          0.5),
    (-999999.0,    None),   # NODATA_SENTINEL
    ("-999999",    None),   # NODATA_SENTINEL as string
    ("",           None),
    (" ",          None),
    (None,         None),
    ("banana",     None),
])
def test_coerce_float(raw, expected):
    assert coerce_float(raw) == expected


# ── coerce_int_str ───────────────────────────────────────────────────────────


@pytest.mark.parametrize("raw,expected", [
    ("02292900",  "02292900"),
    (" USGS ",    "USGS"),
    ("",          None),
    (" ",         None),
    (None,        None),
])
def test_coerce_int_str(raw, expected):
    assert coerce_int_str(raw) == expected


# ── year_chunks ──────────────────────────────────────────────────────────────


def test_year_chunks_bounds():
    chunks = year_chunks(2000, 2002)
    assert chunks == [
        ("2000-01-01", "2000-12-31"),
        ("2001-01-01", "2001-12-31"),
        ("2002-01-01", "2002-12-31"),
    ]


def test_year_chunks_single_year():
    assert year_chunks(2020, 2020) == [("2020-01-01", "2020-12-31")]


# ── parse_dv_response ────────────────────────────────────────────────────────


_DV_FIXTURE = {
    "value": {
        "timeSeries": [
            {
                "sourceInfo": {"siteCode": [{"value": "02292900"}]},
                "variable": {
                    "unit": {"unitCode": "ft"},
                    "noDataValue": -999999.0,
                },
                "values": [{
                    "value": [
                        {"dateTime": "2000-01-01T00:00:00.000", "value": "1.23", "qualifiers": ["A"]},
                        {"dateTime": "2000-01-02T00:00:00.000", "value": "-999999", "qualifiers": []},
                        {"dateTime": "2000-01-03T00:00:00.000", "value": None,       "qualifiers": ["P"]},
                    ]
                }]
            }
        ]
    }
}


def test_parse_dv_response_row_count():
    rows = list(parse_dv_response(_DV_FIXTURE, "72019", "http://example.com", "2026-05-19T00:00:00+00:00"))
    assert len(rows) == 3


def test_parse_dv_response_sentinel_coerced_to_none():
    rows = list(parse_dv_response(_DV_FIXTURE, "72019", "http://example.com", "2026-05-19T00:00:00+00:00"))
    assert rows[1]["value"] is None   # -999999 → None


def test_parse_dv_response_none_value_passthrough():
    rows = list(parse_dv_response(_DV_FIXTURE, "72019", "http://example.com", "2026-05-19T00:00:00+00:00"))
    assert rows[2]["value"] is None   # null string → None


def test_parse_dv_response_valid_value():
    rows = list(parse_dv_response(_DV_FIXTURE, "72019", "http://example.com", "2026-05-19T00:00:00+00:00"))
    assert rows[0]["value"] == pytest.approx(1.23)


def test_parse_dv_response_obs_date_truncated():
    rows = list(parse_dv_response(_DV_FIXTURE, "72019", "http://example.com", "2026-05-19T00:00:00+00:00"))
    assert rows[0]["obs_date"] == "2000-01-01"


def test_parse_dv_response_qualifiers_json_encoded():
    rows = list(parse_dv_response(_DV_FIXTURE, "72019", "http://example.com", "2026-05-19T00:00:00+00:00"))
    assert json.loads(rows[0]["qualifiers"]) == ["A"]
    assert json.loads(rows[1]["qualifiers"]) == []


def test_parse_dv_response_datum_from_parameter_cd():
    rows = list(parse_dv_response(_DV_FIXTURE, "72019", "http://example.com", "2026-05-19T00:00:00+00:00"))
    assert rows[0]["datum"] == "LAND_SURFACE"


def test_parse_dv_response_empty_timeseries():
    payload = {"value": {"timeSeries": []}}
    rows = list(parse_dv_response(payload, "72019", "http://example.com", "2026-05-19T00:00:00+00:00"))
    assert rows == []


def test_parse_dv_response_missing_site_code_skipped():
    payload = {
        "value": {"timeSeries": [
            {"sourceInfo": {"siteCode": []}, "variable": {}, "values": []}
        ]}
    }
    rows = list(parse_dv_response(payload, "72019", "http://example.com", "2026-05-19T00:00:00+00:00"))
    assert rows == []


# ── parse_rdb ────────────────────────────────────────────────────────────────


_RDB_FIXTURE = """\
# Comment line 1
# Comment line 2
agency_cd\tsite_no\tstation_nm\tsite_tp_cd\tdec_lat_va\tdec_long_va\tdec_coord_datum_cd\talt_va\talt_datum_cd\thuc_cd\tstate_cd\tcounty_cd
5s\t15s\t50s\t7s\t16n\t16n\t20s\t8s\t12s\t16s\t3s\t3s
USGS\t02292900\tS-79 CALOOSAHATCHEE NEAR OLGA, FL\tST\t26.72389\t-81.74250\tNAD83\t5.48\tNGVD29\t03100101\t12\t071
USGS\t263819081260600\tLEE CO SITE B\tGW\t26.63861\t-81.43500\tNAD83\t\t\t03100101\t12\t071
"""


def test_parse_rdb_row_count():
    rows = list(parse_rdb(_RDB_FIXTURE))
    assert len(rows) == 2


def test_parse_rdb_field_values():
    rows = list(parse_rdb(_RDB_FIXTURE))
    assert rows[0]["site_no"] == "02292900"
    assert rows[0]["agency_cd"] == "USGS"
    assert rows[0]["station_nm"] == "S-79 CALOOSAHATCHEE NEAR OLGA, FL"


def test_parse_rdb_short_row_padded():
    rows = list(parse_rdb(_RDB_FIXTURE))
    # Second row has empty alt_va and alt_datum_cd
    assert rows[1]["alt_va"] == ""
    assert rows[1]["alt_datum_cd"] == ""


# ── _rdb_row_to_site ─────────────────────────────────────────────────────────


def test_rdb_row_to_site_full_row():
    raw = {
        "site_no": "02292900", "agency_cd": "USGS",
        "station_nm": "Test Station", "site_tp_cd": "ST",
        "dec_lat_va": "26.72389", "dec_long_va": "-81.74250",
        "dec_coord_datum_cd": "NAD83", "alt_va": "5.48",
        "alt_datum_cd": "NGVD29", "huc_cd": "03100101",
        "state_cd": "12", "county_cd": "071",
    }
    site = _rdb_row_to_site(raw, "http://example.com", "2026-05-19T00:00:00+00:00")
    assert site is not None
    assert site["site_no"] == "02292900"
    assert site["latitude"] == pytest.approx(26.72389)
    assert site["longitude"] == pytest.approx(-81.74250)
    assert site["parameter_cds"] is None  # populated by pipeline after daily load
    assert site["site_status"] == "active"


def test_rdb_row_to_site_missing_site_no_returns_none():
    assert _rdb_row_to_site({"site_no": ""}, "http://x.com", "2026-05-19T00:00:00+00:00") is None


def test_rdb_row_to_site_empty_alt_coerced_to_none():
    raw = {"site_no": "02292900", "alt_va": "", "alt_datum_cd": ""}
    site = _rdb_row_to_site(raw, "http://x.com", "2026-05-19T00:00:00+00:00")
    assert site["alt_va"] is None
