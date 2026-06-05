from unittest.mock import MagicMock, patch

import pytest

from ingest.pipelines.fred_laus_alfred.constants import SERIES_AREA_MAP
from ingest.pipelines.fred_laus_alfred.resources import fetch_alfred_laus


def _fake_response(observations: list[dict]) -> MagicMock:
    mock = MagicMock()
    mock.raise_for_status.return_value = None
    mock.json.return_value = {"observations": observations}
    return mock


_SAMPLE_OBS = [
    {
        "date": "2024-01-01",
        "value": "3.5",
        "realtime_start": "2024-02-20",
        "realtime_end": "2024-03-14",
    },
    {
        "date": "2024-02-01",
        "value": "3.4",
        "realtime_start": "2024-03-15",
        "realtime_end": "9999-12-31",
    },
    # Missing value — must be excluded
    {
        "date": "2023-12-01",
        "value": ".",
        "realtime_start": "2024-01-22",
        "realtime_end": "2024-02-19",
    },
]


class TestFetchAlfredLaus:
    def test_missing_dot_values_excluded(self):
        with patch("ingest.pipelines.fred_laus_alfred.resources.os.environ", {"FRED_API_KEY": "test_key"}):
            with patch("ingest.pipelines.fred_laus_alfred.resources.requests.get") as mock_get:
                mock_get.return_value = _fake_response(_SAMPLE_OBS)
                rows = fetch_alfred_laus()

        # 3 obs × 2 series, 1 "." per series filtered → 4 rows total
        observation_dates = [r["observation_date"] for r in rows]
        assert "2023-12-01" not in observation_dates

    def test_value_coerced_to_float(self):
        with patch("ingest.pipelines.fred_laus_alfred.resources.os.environ", {"FRED_API_KEY": "test_key"}):
            with patch("ingest.pipelines.fred_laus_alfred.resources.requests.get") as mock_get:
                mock_get.return_value = _fake_response(_SAMPLE_OBS)
                rows = fetch_alfred_laus()

        for row in rows:
            assert isinstance(row["value"], float), (
                f"Expected float, got {type(row['value'])}: {row['value']!r}"
            )

    def test_both_series_present(self):
        with patch("ingest.pipelines.fred_laus_alfred.resources.os.environ", {"FRED_API_KEY": "test_key"}):
            with patch("ingest.pipelines.fred_laus_alfred.resources.requests.get") as mock_get:
                mock_get.return_value = _fake_response(_SAMPLE_OBS)
                rows = fetch_alfred_laus()

        series_ids = {r["series_id"] for r in rows}
        assert series_ids == set(SERIES_AREA_MAP.keys())

    def test_area_derived_from_series_map(self):
        with patch("ingest.pipelines.fred_laus_alfred.resources.os.environ", {"FRED_API_KEY": "test_key"}):
            with patch("ingest.pipelines.fred_laus_alfred.resources.requests.get") as mock_get:
                mock_get.return_value = _fake_response(_SAMPLE_OBS)
                rows = fetch_alfred_laus()

        for row in rows:
            assert row["area"] == SERIES_AREA_MAP[row["series_id"]], (
                f"area mismatch for {row['series_id']}: got {row['area']!r}"
            )

    def test_realtime_fields_in_every_row(self):
        with patch("ingest.pipelines.fred_laus_alfred.resources.os.environ", {"FRED_API_KEY": "test_key"}):
            with patch("ingest.pipelines.fred_laus_alfred.resources.requests.get") as mock_get:
                mock_get.return_value = _fake_response(_SAMPLE_OBS)
                rows = fetch_alfred_laus()

        for row in rows:
            assert "realtime_start" in row, "realtime_start missing"
            assert "realtime_end" in row, "realtime_end missing"
            assert len(row["realtime_start"]) == 10, f"bad realtime_start: {row['realtime_start']!r}"
            assert len(row["realtime_end"]) == 10, f"bad realtime_end: {row['realtime_end']!r}"

    def test_http_error_propagates(self):
        mock = MagicMock()
        mock.raise_for_status.side_effect = RuntimeError("HTTP 429 Too Many Requests")

        with patch("ingest.pipelines.fred_laus_alfred.resources.os.environ", {"FRED_API_KEY": "test_key"}):
            with patch("ingest.pipelines.fred_laus_alfred.resources.requests.get", return_value=mock):
                with pytest.raises(RuntimeError, match="HTTP 429"):
                    fetch_alfred_laus()

    def test_alfred_params_sent_in_request(self):
        """realtime_start/realtime_end must reach EVERY FRED API call, not just the last one."""
        with patch("ingest.pipelines.fred_laus_alfred.resources.os.environ", {"FRED_API_KEY": "test_key"}):
            with patch("ingest.pipelines.fred_laus_alfred.resources.requests.get") as mock_get:
                mock_get.return_value = _fake_response([])
                fetch_alfred_laus()

        assert mock_get.call_count == len(SERIES_AREA_MAP)
        for single_call in mock_get.call_args_list:
            _, kwargs = single_call
            params = kwargs.get("params", {})
            assert "realtime_start" in params, "realtime_start missing from API call"
            assert "realtime_end" in params, "realtime_end missing from API call"
            assert params["realtime_start"] == "1776-07-04"


class TestSeriesAreaMapInvariants:
    def test_all_areas_known(self):
        for series_id, area in SERIES_AREA_MAP.items():
            assert area in {"lee", "collier"}, f"{series_id} has unknown area {area!r}"

    def test_series_ids_start_with_fl(self):
        for series_id in SERIES_AREA_MAP:
            assert series_id.startswith("FL"), (
                f"Expected FRED FL unemployment series, got {series_id!r}"
            )
