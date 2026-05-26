"""Unit tests for ingest/lib/firecrawl_client.py.

Mocks the firecrawl-py SDK at the import boundary inside agent() so no
network is hit. Covers happy path, failed-job surfacing, legacy response
shapes for the extractor, empty data, and missing API key.
"""
from __future__ import annotations

from types import SimpleNamespace
from typing import Any
from unittest.mock import patch

import pytest

from ingest.lib.firecrawl_client import (
    FirecrawlError,
    agent,
    extract_agent_rows,
)


class _FakeAgentResponse:
    """Stand-in for firecrawl.v2.types.AgentResponse.

    Real AgentResponse is a Pydantic model; we just need .model_dump() to
    return the shape our wrapper consumes.
    """

    def __init__(self, payload: dict[str, Any]):
        self._payload = payload

    def model_dump(self, **_: Any) -> dict[str, Any]:
        return dict(self._payload)


class _FakeFirecrawl:
    """Stand-in for firecrawl.Firecrawl. Captures kwargs for assertions."""

    last_init: dict[str, Any] | None = None
    last_call: dict[str, Any] | None = None
    response: _FakeAgentResponse | None = None

    def __init__(self, *, api_key: str) -> None:
        type(self).last_init = {"api_key": api_key}

    def agent(self, urls, **kwargs):  # noqa: ANN001 — mirrors SDK loose typing
        type(self).last_call = {"urls": urls, **kwargs}
        assert self.response is not None, "test forgot to set _FakeFirecrawl.response"
        return self.response


@pytest.fixture(autouse=True)
def _reset_fake():
    _FakeFirecrawl.last_init = None
    _FakeFirecrawl.last_call = None
    _FakeFirecrawl.response = None
    yield


@pytest.fixture
def _api_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("FIRECRAWL_API_KEY", "fc-test-key")


def _patch_sdk():
    """Inject _FakeFirecrawl into the firecrawl import inside agent()."""
    fake_module = SimpleNamespace(Firecrawl=_FakeFirecrawl)
    return patch.dict("sys.modules", {"firecrawl": fake_module})


# ─── Case 1: happy path ─────────────────────────────────────────────────────
def test_agent_happy_path_returns_dict_with_rows(_api_key):
    _FakeFirecrawl.response = _FakeAgentResponse({
        "success": True,
        "id": "job-abc",
        "status": "completed",
        "data": {"rows": [{"a": 1}, {"a": 2}]},
        "error": None,
        "credits_used": 7,
    })
    with _patch_sdk():
        result = agent(
            "extract things",
            urls=["https://example.com"],
            schema={"type": "object"},
            max_credits=500,
            strict_constrain_to_urls=True,
        )

    assert isinstance(result, dict)
    assert result["status"] == "completed"
    assert extract_agent_rows(result) == [{"a": 1}, {"a": 2}]
    # SDK was called with our remapped kwargs.
    assert _FakeFirecrawl.last_init == {"api_key": "fc-test-key"}
    assert _FakeFirecrawl.last_call["urls"] == ["https://example.com"]
    assert _FakeFirecrawl.last_call["prompt"] == "extract things"
    assert _FakeFirecrawl.last_call["max_credits"] == 500
    assert _FakeFirecrawl.last_call["strict_constrain_to_urls"] is True


# ─── Case 2: failed job raises FirecrawlError ───────────────────────────────
def test_agent_failed_status_raises(_api_key):
    _FakeFirecrawl.response = _FakeAgentResponse({
        "success": False,
        "id": "job-bad",
        "status": "failed",
        "data": None,
        "error": "rate limited",
        "credits_used": 0,
    })
    with _patch_sdk():
        with pytest.raises(FirecrawlError) as excinfo:
            agent("extract things", urls=["https://example.com"])

    msg = str(excinfo.value)
    assert "failed" in msg
    assert "rate limited" in msg
    assert "job-bad" in msg


# ─── Case 3: legacy extractor shapes ────────────────────────────────────────
def test_extract_agent_rows_legacy_data_result():
    # Older /v2 shipped data.result.rows
    response = {"data": {"result": {"rows": [{"x": 1}]}}}
    assert extract_agent_rows(response) == [{"x": 1}]


def test_extract_agent_rows_legacy_top_result():
    # Some preview tiers shipped result.rows at top level
    response = {"result": {"rows": [{"y": 2}]}}
    assert extract_agent_rows(response) == [{"y": 2}]


def test_extract_agent_rows_prefers_current_shape_over_legacy():
    response = {
        "data": {"rows": [{"new": True}], "result": {"rows": [{"legacy": True}]}},
        "result": {"rows": [{"older": True}]},
    }
    assert extract_agent_rows(response) == [{"new": True}]


# ─── Case 4: empty completed ────────────────────────────────────────────────
def test_extract_agent_rows_empty_data_returns_empty():
    assert extract_agent_rows({"status": "completed", "data": {}}) == []
    assert extract_agent_rows({"status": "completed", "data": {"rows": []}}) == []
    assert extract_agent_rows({"status": "completed", "data": None}) == []
    assert extract_agent_rows({}) == []


# ─── Case 5: missing API key ────────────────────────────────────────────────
def test_agent_missing_api_key_raises(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.delenv("FIRECRAWL_API_KEY", raising=False)
    with _patch_sdk():
        with pytest.raises(FirecrawlError) as excinfo:
            agent("extract things", urls=["https://example.com"])
    assert "FIRECRAWL_API_KEY" in str(excinfo.value)
