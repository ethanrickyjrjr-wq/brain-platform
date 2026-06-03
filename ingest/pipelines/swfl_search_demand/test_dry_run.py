"""--dry-run must fetch + print but write NOTHING (no DB, no Tier-1).

Mirrors ingest/duckdb_pipelines/redfin_swfl/test_dry_run.py: inject a fake
provider so no network is hit, and monkeypatch every write path to explode if
reached.
"""
from __future__ import annotations

import pytest

from ingest.pipelines.swfl_search_demand import pipeline
from ingest.pipelines.swfl_search_demand.providers import NormalizedRow


class _FakeProvider:
    name = "fake"

    def fetch(
        self, keywords: list[str], location_label: str, location_query
    ) -> list[NormalizedRow]:
        # One deterministic row, stamped with the requested location label.
        return [
            {
                "keyword": "cape coral flood insurance",
                "source": "fake",
                "location": location_label,
                "captured_month": "2026-04-01",
                "avg_monthly_searches": 320,
                "competition": "HIGH",
                "cpc": 12.5,
                "monthly_searches": [{"year": 2026, "month": 4, "search_volume": 320}],
                "is_bucketed": False,
                "fetched_at": "2026-06-03T00:00:00+00:00",
            }
        ]


def _boom(*_a, **_k):
    raise AssertionError("a write path was reached during --dry-run")


def test_dry_run_writes_nothing(monkeypatch):
    monkeypatch.setattr(pipeline, "upload_ndjson", _boom)
    monkeypatch.setattr(pipeline, "upsert_inventory_row", _boom)
    monkeypatch.setattr(pipeline, "upsert_rows", _boom)

    # No exception (and none of the boom paths hit) = pass.
    pipeline.run(
        dry_run=True,
        conn_str=None,
        provider=_FakeProvider(),
        locations={"state:fl": "Florida,United States"},
    )


def test_live_run_without_conn_str_raises_before_any_write(monkeypatch):
    monkeypatch.setattr(pipeline, "upload_ndjson", _boom)
    monkeypatch.setattr(pipeline, "upsert_rows", _boom)

    with pytest.raises(RuntimeError, match="DESTINATION__POSTGRES__CREDENTIALS"):
        pipeline.run(
            dry_run=False,
            conn_str=None,
            provider=_FakeProvider(),
            locations={"state:fl": "Florida,United States"},
        )


def test_all_locations_empty_raises(monkeypatch):
    class _Empty:
        name = "empty"

        def fetch(self, *_a, **_k):
            return []

    with pytest.raises(RuntimeError, match="every location returned 0 rows"):
        pipeline.run(
            dry_run=True,
            conn_str=None,
            provider=_Empty(),
            locations={"state:fl": "Florida,United States"},
        )
