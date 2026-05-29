"""Unit tests for corridor_grounded pipeline (no network, no Supabase)."""
from __future__ import annotations

import json
from unittest.mock import MagicMock, patch

import pytest

from ingest.pipelines.corridor_grounded.pipeline import (
    _extract_citations,
    build_record,
    get_corridors,
    slug,
    to_ndjson,
)


def _make_content(
    *,
    with_citations: bool = True,
    cited_text_count: int = 2,
) -> list[dict]:
    blocks = [
        {"type": "text", "text": "No citations here.", "citations": None},
    ]
    if with_citations:
        citations = [
            {
                "cited_text": f"Cited text {i} from a source document.",
                "url": f"https://gulfshorebusiness.com/article-{i}",
                "title": f"Article {i}",
                "type": "web_search_result_location",
                "encrypted_index": f"enc{i}",
            }
            for i in range(cited_text_count)
        ]
        blocks.append(
            {"type": "text", "text": "Some sourced claim.", "citations": citations}
        )
    return blocks


def _make_response_dump(content: list[dict]) -> dict:
    return {
        "id": "msg_test",
        "content": content,
        "stop_reason": "end_turn",
        "usage": {"input_tokens": 1000, "output_tokens": 200},
    }


# ── slug ─────────────────────────────────────────────────────────────────────

def test_slug_basic():
    assert slug("Pine Ridge Rd Naples") == "pine-ridge-rd-naples"


def test_slug_special_chars():
    assert slug("Cleveland Ave Fort Myers") == "cleveland-ave-fort-myers"


def test_slug_consecutive_non_alnum():
    assert slug("Airport-Pulling  Naples") == "airport-pulling-naples"


# ── _extract_citations ────────────────────────────────────────────────────────

def test_extract_citations_returns_flat_list():
    content = _make_content(with_citations=True, cited_text_count=3)
    citations = _extract_citations(content)
    assert len(citations) == 3
    assert all("url" in c and "cited_text" in c and "title" in c for c in citations)


def test_extract_citations_deduplicates():
    dup_citation = {
        "cited_text": "Same text repeated.",
        "url": "https://example.com/article",
        "title": "Same article",
        "type": "web_search_result_location",
    }
    content = [
        {"type": "text", "text": "A", "citations": [dup_citation]},
        {"type": "text", "text": "B", "citations": [dup_citation]},
    ]
    citations = _extract_citations(content)
    assert len(citations) == 1


def test_extract_citations_no_citations():
    content = _make_content(with_citations=False)
    citations = _extract_citations(content)
    assert citations == []


def test_extract_citations_null_citations_field():
    content = [{"type": "text", "text": "Only text.", "citations": None}]
    citations = _extract_citations(content)
    assert citations == []


# ── build_record ─────────────────────────────────────────────────────────────

def test_build_record_shape():
    content = _make_content(with_citations=True, cited_text_count=2)
    dump = _make_response_dump(content)
    record = build_record("Pine Ridge Rd Naples", "test query", dump, "2026-05-26T00:00:00Z")

    assert record["corridor_name"] == "Pine Ridge Rd Naples"
    assert record["corridor_slug"] == "pine-ridge-rd-naples"
    assert record["query"] == "test query"
    assert record["tool_version"] == "web_search_20250305"
    assert record["cited_text_count"] == 2
    assert len(record["citations"]) == 2
    assert record["input_tokens"] == 1000
    assert record["output_tokens"] == 200
    assert record["stop_reason"] == "end_turn"
    assert "response" in record


def test_build_record_zero_citations():
    content = _make_content(with_citations=False)
    dump = _make_response_dump(content)
    record = build_record("Daniels Parkway Fort Myers", "q", dump, "2026-05-26T00:00:00Z")

    assert record["cited_text_count"] == 0
    assert record["citations"] == []


def test_build_record_preserves_full_response():
    content = _make_content(with_citations=True, cited_text_count=1)
    dump = _make_response_dump(content)
    record = build_record("Immokalee Rd North Naples", "q", dump, "2026-05-26T00:00:00Z")

    assert record["response"]["id"] == "msg_test"
    assert len(record["response"]["content"]) == len(content)


# ── to_ndjson ────────────────────────────────────────────────────────────────

def test_to_ndjson_produces_valid_ndjson():
    records = [
        {"a": 1, "b": "hello"},
        {"a": 2, "b": "world"},
    ]
    out = to_ndjson(records).decode("utf-8")
    lines = [l for l in out.splitlines() if l.strip()]
    assert len(lines) == 2
    assert json.loads(lines[0]) == records[0]
    assert json.loads(lines[1]) == records[1]


def test_to_ndjson_unicode_preserved():
    records = [{"text": "SWFL — Southwest Florida ©"}]
    out = to_ndjson(records).decode("utf-8")
    assert json.loads(out.strip())["text"] == records[0]["text"]


# ── storage key URL-safety ───────────────────────────────────────────────────


# ── slug parity (Python ↔ TS) ────────────────────────────────────────────────


def test_slug_parity_python_side():
    """Load fixtures/corridor-slug-parity.json and verify Python slug()
    matches every expected value. The TS slug() in
    refinery/tools/synthesize-corridor-character.mts is verified against the
    same fixture in refinery/tools/corridor-slug-parity.test.mts. If either
    suite trips, the two implementations have drifted and Stage C's
    grounded-NDJSON lookup will silently miss for any corridor whose slug
    diverges.
    """
    from pathlib import Path

    # Walk from this test file's location up to repo root then into fixtures/.
    fixture_path = (
        Path(__file__).resolve().parents[3] / "fixtures" / "corridor-slug-parity.json"
    )
    with fixture_path.open("r", encoding="utf-8") as f:
        fixture = json.load(f)

    assert isinstance(fixture.get("cases"), list)
    assert len(fixture["cases"]) >= 26, (
        f"expected at least 26 cases (one per verified corridor); "
        f"got {len(fixture['cases'])}"
    )

    mismatches = []
    for c in fixture["cases"]:
        actual = slug(c["input"])
        if actual != c["expected"]:
            mismatches.append((c["input"], c["expected"], actual))

    assert not mismatches, (
        "Python slug() diverged from the fixture. If you changed the rule, "
        "update the TS copy in refinery/tools/synthesize-corridor-character.mts "
        "AND regenerate the fixture's 'expected' values.\n"
        + "\n".join(
            f"  input={inp!r} expected={exp!r} actual={act!r}"
            for inp, exp, act in mismatches
        )
    )


def test_get_corridors_no_filter_sql_only_references_existing_columns():
    """Regression: the no-filter SELECT path used `ORDER BY county` but
    corridor_profiles has no `county` column (county is derived in code via
    CITY_TO_COUNTY in refinery/sources/cre-source.mts). This test exercises
    the no-filter branch — the --corridor=<NAME> branch dodged the bug
    because it had no ORDER BY clause, so a Pine Ridge smoke went green
    while --all blew up at SQL parse time. Pin the no-filter SQL shape.
    """
    fake_cur = MagicMock()
    fake_cur.fetchall.return_value = [
        ("Pine Ridge Rd Naples",),
        ("Coconut Point Mall",),
    ]
    fake_cur_ctx = MagicMock()
    fake_cur_ctx.__enter__ = MagicMock(return_value=fake_cur)
    fake_cur_ctx.__exit__ = MagicMock(return_value=False)
    fake_conn = MagicMock()
    fake_conn.cursor.return_value = fake_cur_ctx

    with patch(
        "ingest.pipelines.corridor_grounded.pipeline._inventory_get_connection",
        return_value=fake_conn,
    ):
        result = get_corridors(corridor_filter=None)

    assert result == ["Pine Ridge Rd Naples", "Coconut Point Mall"]

    executed_sql = fake_cur.execute.call_args[0][0]
    assert "county" not in executed_sql.lower(), (
        f"get_corridors no-filter SQL must not reference 'county' column — "
        f"corridor_profiles has no such column. Got SQL: {executed_sql!r}"
    )
    assert "ORDER BY city" in executed_sql, (
        f"get_corridors no-filter SQL should ORDER BY city for spread. "
        f"Got: {executed_sql!r}"
    )


def test_storage_key_run_component_is_url_safe():
    """The `run-XXX.ndjson` path component must contain no `:` or `+` —
    Supabase Storage URL-encodes `+` to `%2B` in the object key, which breaks
    any tool that reads the path back literally. We use strftime
    `%Y%m%dT%H%M%SZ` for the key and keep full ISO in the NDJSON payload.
    """
    from datetime import datetime, timezone

    now = datetime(2026, 5, 26, 14, 30, 0, tzinfo=timezone.utc)
    run_key = now.strftime("%Y%m%dT%H%M%SZ")
    path = f"corridor_grounded/pine-ridge-rd-naples/year=2026/month=05/run-{run_key}.ndjson"
    assert ":" not in path
    assert "+" not in path
    assert run_key == "20260526T143000Z"
