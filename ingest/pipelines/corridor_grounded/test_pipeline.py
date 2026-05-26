"""Unit tests for corridor_grounded pipeline (no network, no Supabase)."""
from __future__ import annotations

import json

import pytest

from ingest.pipelines.corridor_grounded.pipeline import (
    _extract_citations,
    build_record,
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
    assert slug("US-41 / Cleveland Ave Fort Myers") == "us-41-cleveland-ave-fort-myers"


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
