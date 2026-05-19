"""Tests for the HURDAT2 parser.

Covers: header/obs alternation, lat/lon decoder, -999 sentinel, UNNAMED
storms, landfall record_id, category derivation, and count mismatch.
"""
import pytest

from ingest.duckdb_pipelines.hurdat2_fl.parse_hurdat2 import (
    TrackPoint,
    _decode_lat,
    _decode_lon,
    _saffir_category,
    parse_hurdat2,
)


# Two minimal storms — IAN 2022 (1 landfall obs) and an UNNAMED 1851 storm
# (1 obs, missing pressure sentinel). Header counts must match.
SAMPLE_HURDAT2 = """\
AL092022,                IAN,    1,
20220928, 1905,  L, HU, 26.7N,  82.1W, 130,  937,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,   10,
AL011851,            UNNAMED,    1,
18510625, 0000,   , HU, 28.0N,  94.8W,  80, -999,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0, -999,
"""


def test_parse_alternation_yields_two_points() -> None:
    points = list(parse_hurdat2(SAMPLE_HURDAT2.splitlines()))
    assert len(points) == 2


def test_first_point_is_ian_landfall() -> None:
    points = list(parse_hurdat2(SAMPLE_HURDAT2.splitlines()))
    ian = points[0]
    assert ian.storm_id == "AL092022"
    assert ian.storm_name == "IAN"
    assert ian.storm_year == 2022
    assert ian.obs_date == "2022-09-28"
    assert ian.obs_time == "19:05"
    assert ian.record_id == "L"            # landfall
    assert ian.status == "HU"
    assert ian.lat == pytest.approx(26.7)
    assert ian.lon == pytest.approx(-82.1)
    assert ian.max_wind_kt == 130
    assert ian.min_pressure_mb == 937
    assert ian.category_saffir == 4         # 130 kt = cat 4


def test_pressure_sentinel_becomes_none() -> None:
    points = list(parse_hurdat2(SAMPLE_HURDAT2.splitlines()))
    unnamed = points[1]
    assert unnamed.storm_name == "UNNAMED"
    assert unnamed.min_pressure_mb is None  # -999 -> None
    assert unnamed.record_id is None        # blank field -> None


def test_decode_lat_lon_signed() -> None:
    assert _decode_lat("26.7N") == pytest.approx(26.7)
    assert _decode_lat("12.3S") == pytest.approx(-12.3)
    assert _decode_lon("82.5W") == pytest.approx(-82.5)
    assert _decode_lon("10.1E") == pytest.approx(10.1)


def test_saffir_category_cuts() -> None:
    # NHC cuts: 74/96/111/130/157
    assert _saffir_category(None) is None
    assert _saffir_category(33) is None       # TS strength, below cat 1
    assert _saffir_category(74) == 1
    assert _saffir_category(95) == 1
    assert _saffir_category(96) == 2
    assert _saffir_category(111) == 3
    assert _saffir_category(130) == 4
    assert _saffir_category(157) == 5
    assert _saffir_category(200) == 5


def test_count_mismatch_raises() -> None:
    # Header claims 2 obs but only 1 follows.
    bad = "AL012020,            TEST,    2,\n20200101, 0000,   , TD, 20.0N,  60.0W,  30,  999,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,    0,\n"
    with pytest.raises(ValueError, match="ended mid-storm"):
        list(parse_hurdat2(bad.splitlines()))
