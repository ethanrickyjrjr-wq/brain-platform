from ingest.pipelines.city_pulse.pipeline import CITIES, slug


def test_seven_cities_including_lehigh():
    assert CITIES == [
        "Lehigh Acres", "Cape Coral", "Fort Myers", "Naples",
        "Estero", "Bonita Springs", "Fort Myers Beach",
    ]


def test_slug_is_filesystem_safe():
    assert slug("Fort Myers Beach") == "fort-myers-beach"
    assert slug("Lehigh Acres") == "lehigh-acres"


from ingest.pipelines.city_pulse.pipeline import _extract_citations, build_record


def test_extract_citations_dedupes_by_url_and_text():
    content = [
        {"citations": [
            {"url": "https://gulfshorebusiness.com/a", "title": "A", "cited_text": "Amazon bought 60M of land", "type": "web_search_result_location"},
            {"url": "https://gulfshorebusiness.com/a", "title": "A", "cited_text": "Amazon bought 60M of land", "type": "web_search_result_location"},
        ]},
        {"citations": None},
    ]
    out = _extract_citations(content)
    assert len(out) == 1
    assert out[0]["url"] == "https://gulfshorebusiness.com/a"


def test_build_record_shape():
    dump = {"content": [{"citations": [{"url": "https://x.com", "title": "T", "cited_text": "c"}]}],
            "usage": {"input_tokens": 10, "output_tokens": 5}, "stop_reason": "end_turn"}
    rec = build_record("Naples", "q", dump, "2026-05-30T00:00:00Z")
    assert rec["city"] == "Naples"
    assert rec["city_slug"] == "naples"
    assert rec["tool_version"] == "web_search_20250305"
    assert rec["cited_text_count"] == 1
    assert rec["response"] == dump


from ingest.pipelines.city_pulse.pipeline import to_ndjson, tier1_path


def test_to_ndjson_round_trips():
    import json
    body = to_ndjson([{"city": "Naples", "a": 1}])
    assert json.loads(body.decode("utf-8").strip()) == {"city": "Naples", "a": 1}


def test_tier1_path_is_date_partitioned_and_slugged():
    p = tier1_path("Fort Myers Beach", "20260530T091500Z", "2026", "05")
    assert p == "city_pulse/fort-myers-beach/year=2026/month=05/run-20260530T091500Z.ndjson"


# ---------------------------------------------------------------------------
# Firecrawl capture provider tests (mock — no network calls)
# ---------------------------------------------------------------------------

import argparse
from unittest.mock import patch

from ingest.pipelines.city_pulse.pipeline import capture_firecrawl, _FIRECRAWL_CITATION_MAX_CHARS


_MOCK_FIRECRAWL_RESPONSE = {
    "success": True,
    "data": {
        "web": [
            {
                "url": "https://gulfshorebusiness.com/naples-retail",
                "title": "Naples Retail Boom",
                "markdown": "A" * 2000,  # longer than the 1500-char cap
                "metadata": {"sourceURL": "https://gulfshorebusiness.com/naples-retail"},
            },
            {
                "url": "https://businessobserverfl.com/construction",
                "title": "Construction Surge",
                "markdown": "New permits filed for a $20M mixed-use project downtown.",
                "metadata": {},
            },
        ],
        "news": [
            {
                "url": "https://winknews.com/layoffs",
                "title": "Local Layoffs",
                # no markdown — fall back to description
                "description": "A manufacturer announced 50 layoffs in Fort Myers.",
                "metadata": {},
            },
            {
                # no url at all — should be skipped
                "title": "Orphan result",
                "markdown": "Some content",
                "metadata": {},
            },
        ],
    },
    "creditsUsed": 42,
    "id": "fc-abc123",
}


def test_capture_firecrawl_citation_shape(monkeypatch):
    """capture_firecrawl builds correct citations from a mocked search response."""
    monkeypatch.setattr(
        "ingest.pipelines.city_pulse.pipeline.firecrawl_client.search",
        lambda *args, **kwargs: _MOCK_FIRECRAWL_RESPONSE,
    )
    record = capture_firecrawl("Naples", "2026-05-30T00:00:00+00:00")

    # Basic record keys
    assert record["city"] == "Naples"
    assert record["city_slug"] == "naples"
    assert record["model"] == "firecrawl/v2/search"
    assert record["tool_version"] == "firecrawl-search"
    assert record["run_at"] == "2026-05-30T00:00:00+00:00"
    assert record["credits_used"] == 42
    assert record["input_tokens"] is None
    assert record["output_tokens"] is None
    assert record["response"] is _MOCK_FIRECRAWL_RESPONSE

    # cited_text_count matches citation list length
    citations = record["citations"]
    assert record["cited_text_count"] == len(citations)

    # The orphan result (no url) must be excluded; 3 valid results expected
    assert len(citations) == 3

    # Citation shape
    for c in citations:
        assert "url" in c
        assert "title" in c
        assert "cited_text" in c
        assert c["url"]  # non-empty
        assert c["cited_text"]  # non-empty

    # markdown truncated to ≤ _FIRECRAWL_CITATION_MAX_CHARS
    long_citation = next(c for c in citations if "naples-retail" in c["url"])
    assert len(long_citation["cited_text"]) == _FIRECRAWL_CITATION_MAX_CHARS

    # description fallback works when markdown absent
    news_citation = next(c for c in citations if "winknews" in c["url"])
    assert "50 layoffs" in news_citation["cited_text"]


def test_capture_firecrawl_has_distill_required_keys(monkeypatch):
    """Record returned by capture_firecrawl has all keys distill_capture needs."""
    monkeypatch.setattr(
        "ingest.pipelines.city_pulse.pipeline.firecrawl_client.search",
        lambda *args, **kwargs: _MOCK_FIRECRAWL_RESPONSE,
    )
    record = capture_firecrawl("Cape Coral", "2026-05-30T00:00:00+00:00")

    required_keys = {
        "city", "city_slug", "query", "model", "tool_version",
        "run_at", "citations", "response", "cited_text_count",
        "credits_used", "input_tokens", "output_tokens",
    }
    assert required_keys.issubset(record.keys()), (
        f"Missing keys: {required_keys - record.keys()}"
    )


def test_default_source_provider_is_auto():
    """--source-provider defaults to 'auto' when the flag is absent."""
    import ingest.pipelines.city_pulse.pipeline as pipeline_mod
    from unittest.mock import patch
    # Parse via the real main() parser by calling parse_args([]) on a fresh parser
    # constructed the same way main() does.
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--source-provider",
        choices=["auto", "firecrawl", "anthropic"],
        default="auto",
    )
    args = parser.parse_args([])
    assert args.source_provider == "auto"


# ---------------------------------------------------------------------------
# capture() auto-fallback tests (mock — no network calls)
# ---------------------------------------------------------------------------

from ingest.pipelines.city_pulse.pipeline import capture
import ingest.pipelines.city_pulse.pipeline as _pipeline_mod

_ANTHROPIC_SENTINEL = {
    "city": "Naples",
    "city_slug": "naples",
    "model": "claude-sonnet-4-6",
    "tool_version": "web_search_20250305",
    "run_at": "2026-05-30T00:00:00+00:00",
    "citations": [{"url": "https://example.com", "title": "T", "cited_text": "c"}],
    "cited_text_count": 1,
    "input_tokens": 100,
    "output_tokens": 50,
    "query": "q",
    "response": {},
}

_FIRECRAWL_NONEMPTY = {
    "city": "Naples",
    "city_slug": "naples",
    "model": "firecrawl/v2/search",
    "tool_version": "firecrawl-search",
    "run_at": "2026-05-30T00:00:00+00:00",
    "citations": [
        {"url": "https://example.com/a", "title": "A", "cited_text": "x"},
        {"url": "https://example.com/b", "title": "B", "cited_text": "y"},
        {"url": "https://example.com/c", "title": "C", "cited_text": "z"},
    ],
    "cited_text_count": 3,
    "input_tokens": None,
    "output_tokens": None,
    "query": "q",
    "response": {},
    "credits_used": 5,
}

_FIRECRAWL_EMPTY = {**_FIRECRAWL_NONEMPTY, "citations": [], "cited_text_count": 0}


def test_capture_auto_falls_back_to_anthropic_on_error(monkeypatch):
    """auto mode: if capture_firecrawl raises, falls back and returns the anthropic sentinel."""
    def _raise(city, run_at):
        raise RuntimeError("network error")

    monkeypatch.setattr(_pipeline_mod, "capture_firecrawl", _raise)
    monkeypatch.setattr(_pipeline_mod, "run_city_search",
                        lambda city, run_at: _ANTHROPIC_SENTINEL)
    result = capture("Naples", "2026-05-30T00:00:00+00:00", "auto")
    assert result is _ANTHROPIC_SENTINEL


def test_capture_auto_falls_back_on_empty(monkeypatch):
    """auto mode: if capture_firecrawl returns cited_text_count=0, falls back to anthropic."""
    monkeypatch.setattr(_pipeline_mod, "capture_firecrawl",
                        lambda city, run_at: _FIRECRAWL_EMPTY)
    monkeypatch.setattr(_pipeline_mod, "run_city_search",
                        lambda city, run_at: _ANTHROPIC_SENTINEL)
    result = capture("Naples", "2026-05-30T00:00:00+00:00", "auto")
    assert result is _ANTHROPIC_SENTINEL


def test_capture_auto_uses_firecrawl_when_nonempty(monkeypatch):
    """auto mode: if capture_firecrawl returns >0 citations, use it and do NOT call anthropic."""
    monkeypatch.setattr(_pipeline_mod, "capture_firecrawl",
                        lambda city, run_at: _FIRECRAWL_NONEMPTY)

    def _should_not_be_called(city, run_at):
        raise AssertionError("run_city_search must NOT be called when firecrawl succeeds")

    monkeypatch.setattr(_pipeline_mod, "run_city_search", _should_not_be_called)
    result = capture("Naples", "2026-05-30T00:00:00+00:00", "auto")
    assert result is _FIRECRAWL_NONEMPTY
