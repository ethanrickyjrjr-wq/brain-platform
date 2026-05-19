from unittest.mock import MagicMock, patch

from ingest.lib.tier1_inventory import upsert_inventory_row


def test_upsert_inventory_row_builds_correct_upsert_sql():
    """The helper builds a parameterized UPSERT against data_lake._tier1_inventory."""
    mock_conn = MagicMock()
    mock_cursor = MagicMock()
    mock_conn.cursor.return_value.__enter__.return_value = mock_cursor

    with patch("ingest.lib.tier1_inventory._get_connection", return_value=mock_conn):
        upsert_inventory_row(
            bucket="lake-tier1",
            path="environmental/storm_events_swfl.parquet",
            vintage="1996-2025",
            byte_size=12345,
            pack_id="storm-history-swfl",
            source_url="https://www.ncei.noaa.gov/data/storm-events/csvfiles/",
        )

    assert mock_cursor.execute.call_count == 1
    sql, params = mock_cursor.execute.call_args[0]
    assert "INSERT INTO data_lake._tier1_inventory" in sql
    assert "ON CONFLICT (id) DO UPDATE" in sql
    assert params["id"] == "lake-tier1/environmental/storm_events_swfl.parquet"
    assert params["bucket"] == "lake-tier1"
    assert params["pack_id"] == "storm-history-swfl"
    mock_conn.commit.assert_called_once()
