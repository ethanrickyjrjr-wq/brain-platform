"""Unit tests for ingest/lib/extract_client.py — firecrawl→spider fallback.

Mocks both vendor wrappers at the import boundary so no network hits.
Cases cover: firecrawl wins, firecrawl empty→spider rescues,
firecrawl errors→spider rescues, both empty (no errors), both fail loudly,
spider missing API key disables fallback.
"""
from __future__ import annotations

from typing import Any
from unittest.mock import patch

import pytest

from ingest.lib.extract_client import ExtractError, extract
from ingest.lib.firecrawl_client import FirecrawlError
from ingest.lib.spider_client import SpiderError


# ─── Shared helpers ─────────────────────────────────────────────────────────
def _fc_response(rows: list[dict[str, Any]], *, status: str = "completed") -> dict[str, Any]:
    return {
        "success": status == "completed",
        "id": "fc-job",
        "status": status,
        "data": {"rows": rows},
        "credits_used": 1,
    }


def _spider_response(rows: list[dict[str, Any]]) -> dict[str, Any]:
    # Spider's response shape is undocumented; our extractor walks several
    # paths. Use the most-likely shape (`{extraction: {rows: [...]}}`) for
    # tests — extractor still resolves it.
    return {"extraction": {"rows": rows}}


@pytest.fixture(autouse=True)
def _spider_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SPIDER_API_KEY", "sp-test-key")


# ─── Case 1: firecrawl returns rows → spider not called ────────────────────
def test_firecrawl_wins_no_spider_call():
    with patch("ingest.lib.extract_client.firecrawl_agent") as fc, \
         patch("ingest.lib.extract_client.spider_ai_scrape") as sp:
        fc.return_value = _fc_response([{"a": 1}, {"a": 2}])
        result = extract(
            "prompt",
            urls=["https://example.com"],
            schema={"type": "object"},
            strict_constrain_to_urls=True,
        )

    assert result["status"] == "completed"
    assert result["data"]["rows"] == [{"a": 1}, {"a": 2}]
    assert sp.call_count == 0
    prov = result["_provenance"]
    assert len(prov) == 1
    assert prov[0]["vendor"] == "firecrawl"
    assert prov[0]["ok"] is True


# ─── Case 2: firecrawl empty → spider rescues ───────────────────────────────
def test_firecrawl_empty_spider_rescues():
    with patch("ingest.lib.extract_client.firecrawl_agent") as fc, \
         patch("ingest.lib.extract_client.spider_ai_scrape") as sp:
        fc.return_value = _fc_response([])  # completed but empty
        sp.return_value = _spider_response([{"b": 1}])
        result = extract(
            "prompt",
            urls=["https://a.example", "https://b.example"],
            schema={"type": "object"},
        )

    # Spider called once per URL.
    assert sp.call_count == 2
    # Rows from spider only (firecrawl returned 0).
    assert result["data"]["rows"] == [{"b": 1}, {"b": 1}]
    vendors = [p["vendor"] for p in result["_provenance"]]
    assert vendors == ["firecrawl", "spider", "spider"]


# ─── Case 3: firecrawl errors → spider rescues ─────────────────────────────
def test_firecrawl_error_spider_rescues():
    with patch("ingest.lib.extract_client.firecrawl_agent") as fc, \
         patch("ingest.lib.extract_client.spider_ai_scrape") as sp:
        fc.side_effect = FirecrawlError("agent failed: rate limited")
        sp.return_value = _spider_response([{"c": 1}])
        result = extract(
            "prompt",
            urls=["https://a.example"],
            schema={"type": "object"},
        )

    assert result["data"]["rows"] == [{"c": 1}]
    fc_prov = result["_provenance"][0]
    assert fc_prov["vendor"] == "firecrawl"
    assert fc_prov["ok"] is False
    assert "rate limited" in fc_prov["error"]


# ─── Case 4: both vendors fail per-URL → loud ExtractError ─────────────────
def test_both_fail_raises_extract_error_with_url_details():
    with patch("ingest.lib.extract_client.firecrawl_agent") as fc, \
         patch("ingest.lib.extract_client.spider_ai_scrape") as sp:
        fc.return_value = _fc_response([])
        sp.side_effect = SpiderError("/ai/scrape returned 404: Not Found")
        with pytest.raises(ExtractError) as excinfo:
            extract(
                "prompt",
                urls=["https://dead-1.example", "https://dead-2.example"],
                schema={"type": "object"},
            )

    msg = str(excinfo.value)
    assert "dead-1.example" in msg
    assert "dead-2.example" in msg
    assert "404" in msg


# ─── Case 5: both empty, no errors → return empty rows, no raise ───────────
def test_both_empty_returns_empty_quiet():
    with patch("ingest.lib.extract_client.firecrawl_agent") as fc, \
         patch("ingest.lib.extract_client.spider_ai_scrape") as sp:
        fc.return_value = _fc_response([])
        sp.return_value = _spider_response([])
        result = extract(
            "prompt",
            urls=["https://a.example"],
            schema={"type": "object"},
        )

    # Caller decides whether empty is fatal (matches pre-fallback contract).
    assert result["data"]["rows"] == []
    assert result["status"] == "completed"


# ─── Case 6: SPIDER_API_KEY missing → fallback disabled ────────────────────
def test_missing_spider_key_disables_fallback(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.delenv("SPIDER_API_KEY", raising=False)
    with patch("ingest.lib.extract_client.firecrawl_agent") as fc, \
         patch("ingest.lib.extract_client.spider_ai_scrape") as sp:
        fc.return_value = _fc_response([])
        result = extract(
            "prompt",
            urls=["https://a.example"],
            schema={"type": "object"},
        )

    assert sp.call_count == 0
    assert result["data"]["rows"] == []
    spider_prov = [p for p in result["_provenance"] if p["vendor"] == "spider"]
    assert spider_prov and spider_prov[0].get("skipped") is True


# ─── Case 7: missing spider key + firecrawl error → re-raises FirecrawlError ─
def test_missing_spider_key_with_fc_error_reraises():
    import os

    if "SPIDER_API_KEY" in os.environ:
        # Defensive: monkeypatch in fixture set it; clear for this test.
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("SPIDER_API_KEY", None)
            with patch("ingest.lib.extract_client.firecrawl_agent") as fc:
                fc.side_effect = FirecrawlError("agent failed: unauthorized")
                with pytest.raises(FirecrawlError) as excinfo:
                    extract(
                        "prompt",
                        urls=["https://a.example"],
                        schema={"type": "object"},
                    )
            assert "unauthorized" in str(excinfo.value)
