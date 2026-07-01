"""`--dry-run` must make ZERO network calls and ZERO DB writes (safe against the live budget)."""
from unittest.mock import patch

from ingest.pipelines.rentals import pipeline


def test_dry_run_no_network_no_write():
    with patch("ingest.pipelines.rentals.resources.get_json") as mget, \
         patch("ingest.pipelines.rentals.db._get_conn") as mconn:
        rc = pipeline.main(["--dry-run"])
    assert rc == 0
    mget.assert_not_called()
    mconn.assert_not_called()
