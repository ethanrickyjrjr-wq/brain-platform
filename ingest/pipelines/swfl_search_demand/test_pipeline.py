"""Unit tests for swfl_search_demand — pure logic, no network, no DB."""
from __future__ import annotations

from ingest.pipelines.swfl_search_demand import pipeline, seeds
from ingest.pipelines.swfl_search_demand.providers import (
    normalize_result_row,
    parse_search_volume_response,
)

# A trimmed but shape-accurate DataForSEO search_volume response.
FIXTURE_BODY = {
    "status_code": 20000,
    "status_message": "Ok.",
    "tasks": [
        {
            "status_code": 20000,
            "result": [
                {
                    "keyword": "Cape Coral Flood Insurance",
                    "competition": "HIGH",
                    "competition_index": 80,
                    "search_volume": 320,
                    "cpc": 12.5,
                    "monthly_searches": [
                        {"year": 2026, "month": 3, "search_volume": 300},
                        {"year": 2026, "month": 4, "search_volume": 340},
                    ],
                },
                {
                    "keyword": "naples cap rate",
                    "competition": "LOW",
                    "search_volume": 70,
                    "cpc": 4.0,
                    "monthly_searches": [{"year": 2026, "month": 4, "search_volume": 70}],
                },
                {  # empty keyword — must be dropped
                    "keyword": "",
                    "search_volume": 10,
                    "monthly_searches": [],
                },
            ],
        }
    ],
}


def test_parse_maps_fields_and_stamps_provenance():
    rows = parse_search_volume_response(
        FIXTURE_BODY,
        source="dataforseo",
        location_label="state:fl",
        fetched_at="2026-06-03T00:00:00+00:00",
        is_bucketed=False,
    )
    assert len(rows) == 2  # empty-keyword row dropped
    first = rows[0]
    assert first["keyword"] == "cape coral flood insurance"  # lowercased
    assert first["source"] == "dataforseo"  # STRUCTURAL provenance
    assert first["location"] == "state:fl"
    assert first["avg_monthly_searches"] == 320
    assert first["competition"] == "HIGH"
    assert first["cpc"] == 12.5
    assert first["is_bucketed"] is False
    assert first["monthly_searches"][-1]["search_volume"] == 340


def test_captured_month_picks_latest_month():
    row = normalize_result_row(
        FIXTURE_BODY["tasks"][0]["result"][0],
        source="dataforseo",
        location_label="state:fl",
        fetched_at="2026-06-03T00:00:00+00:00",
        is_bucketed=False,
    )
    assert row["captured_month"] == "2026-04-01"  # latest of {2026-03, 2026-04}


def test_captured_month_falls_back_to_fetched_month_when_empty():
    row = normalize_result_row(
        {"keyword": "x", "search_volume": 5, "monthly_searches": []},
        source="dataforseo",
        location_label="state:fl",
        fetched_at="2026-06-03T12:00:00+00:00",
        is_bucketed=False,
    )
    assert row["captured_month"] == "2026-06-01"


def test_null_search_volume_is_none_not_zero():
    row = normalize_result_row(
        {"keyword": "rare term", "search_volume": None, "monthly_searches": []},
        source="dataforseo",
        location_label="state:fl",
        fetched_at="2026-06-03T00:00:00+00:00",
        is_bucketed=False,
    )
    assert row["avg_monthly_searches"] is None


def test_make_id_is_stable_and_month_sensitive():
    a = pipeline._make_id("cape coral flood insurance", "dataforseo", "state:fl", "2026-04-01")
    b = pipeline._make_id("cape coral flood insurance", "dataforseo", "state:fl", "2026-04-01")
    c = pipeline._make_id("cape coral flood insurance", "dataforseo", "state:fl", "2026-05-01")
    assert a == b
    assert a != c  # a new data-month is a new row, not an overwrite


def test_upsert_sql_has_all_columns():
    for col in (
        "id", "keyword", "source", "location", "captured_month",
        "avg_monthly_searches", "competition", "cpc", "monthly_searches",
        "is_bucketed", "fetched_at",
    ):
        assert f"%({col})s" in pipeline.UPSERT_SQL
    assert "public.swfl_search_demand" in pipeline.UPSERT_SQL


def test_build_seeds_dedups_lowercases_and_caps():
    out = seeds.build_seeds(max_keywords=10)
    assert len(out) == 10
    assert out == [s.lower() for s in out]
    assert len(set(out)) == len(out)  # no dupes
    # a full build is the place x template grid plus the core terms
    full = seeds.build_seeds(max_keywords=10_000)
    assert len(full) == len(set(full))
    assert "cape coral flood insurance" in full
