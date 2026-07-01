"""County-form pagination must walk every page and stop cleanly at meta.total — the live discovery
(07/01) that made the per-Lee-city sweep unnecessary. These tests lock that contract in code so a
future regression (e.g. an off-by-one that loops forever or drops the last page) fails loud."""
from unittest.mock import patch

from ingest.pipelines.rentals.resources import fetch_rentals_county


def _page(offset: int, returned: int, total: int) -> dict:
    body = [{"property_id": str(offset + i), "price": {}, "description": {}, "address": {}}
            for i in range(returned)]
    return {"meta": {"total": total, "returned": returned, "limit": 20, "offset": offset}, "body": body}


def test_fetch_rentals_county_walks_every_page_and_stops_at_total():
    # 45 rows total @ 20/page -> pages of 20, 20, 5, then stop (no 4th call).
    pages = [
        (200, _page(0, 20, 45)),
        (200, _page(20, 20, 45)),
        (200, _page(40, 5, 45)),
    ]
    with patch("ingest.pipelines.rentals.resources.get_json", side_effect=pages) as mget:
        res = fetch_rentals_county("Lee", captured="2026-07-01")
    assert mget.call_count == 3
    assert res["calls"] == 3
    assert res["total"] == 45
    assert len(res["rows"]) == 45


def test_fetch_rentals_county_stops_on_non_200_mid_sweep():
    pages = [(200, _page(0, 20, 100)), (500, None)]
    with patch("ingest.pipelines.rentals.resources.get_json", side_effect=pages) as mget:
        res = fetch_rentals_county("Lee", captured="2026-07-01")
    assert mget.call_count == 2
    assert len(res["rows"]) == 20  # first page kept; sweep stops, never fabricates the rest


def test_fetch_rentals_county_dry_run_makes_zero_calls():
    with patch("ingest.pipelines.rentals.resources.get_json") as mget:
        res = fetch_rentals_county("Lee", captured="2026-07-01", dry_run=True)
    mget.assert_not_called()
    assert res["calls"] > 0  # intended page count, not a real call
