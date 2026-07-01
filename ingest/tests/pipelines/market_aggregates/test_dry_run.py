"""`--dry-run` must make ZERO network calls and ZERO DB writes (safe against the live budget)."""
from unittest.mock import patch

from ingest.pipelines.market_aggregates import pipeline


def test_histogram_dry_run_no_network_no_write():
    # Patch the names the fetchers actually call (resources.get_json) + the DB connection.
    with patch("ingest.pipelines.market_aggregates.resources.get_json") as mget, \
         patch("ingest.pipelines.market_aggregates.db._get_conn") as mconn:
        rc = pipeline.main(["--resource", "histogram", "--dry-run"])
    assert rc == 0
    mget.assert_not_called()
    mconn.assert_not_called()


def test_details_dry_run_no_network_no_write():
    with patch("ingest.pipelines.market_aggregates.resources.get_json") as mget, \
         patch("ingest.pipelines.market_aggregates.db._get_conn") as mconn:
        rc = pipeline.main(["--resource", "details", "--dry-run"])
    assert rc == 0
    mget.assert_not_called()
    mconn.assert_not_called()
