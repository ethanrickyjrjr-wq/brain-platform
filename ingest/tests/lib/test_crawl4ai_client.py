"""Unit tests for ingest/lib/crawl4ai_client.py (canonical location — C2 consolidation).

Covers the generic crawl4ai client surface only:
  - Crawl4aiSession.step()         — raw:// page (real browser, no network)
  - Crawl4aiSession.download_step() — guard behavior (fully mocked, no browser)

Pipeline-specific JS-builder assertions (lee_permits) live in
ingest/tests/pipelines/test_lee_permits_scraper.py — a generic-client test must not import a
specific pipeline.
"""
import asyncio
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest

import ingest.lib.crawl4ai_client as mod
from ingest.lib.crawl4ai_client import (
    Crawl4aiError,
    Crawl4aiSession,
    fetch_many,
    fetch_page_markdown,
)

# Local raw-HTML page (no network). crawl4ai accepts raw:// HTML.
_FIXTURE = "raw://<html><body><div id='target'>hello</div></body></html>"


def test_session_step_returns_html_for_raw_page():
    async def run():
        async with Crawl4aiSession(headless=True) as s:
            return await s.step(_FIXTURE, wait_for="css:#target")

    html = asyncio.run(run())
    assert "hello" in html


# ─── download_step() guards (mocked crawler — no browser) ────────────────────


def _make_session_with_mock_crawler(downloaded_files) -> Crawl4aiSession:
    """Build a Crawl4aiSession with a mocked crawler returning the given downloaded_files."""
    mock_result = MagicMock()
    mock_result.downloaded_files = downloaded_files
    mock_result.success = True
    mock_result.html = ""

    session = Crawl4aiSession(session_id="test_dl", accept_downloads=True)
    session._crawler = MagicMock()
    session._crawler.arun = AsyncMock(return_value=mock_result)
    return session


def test_download_step_returns_file_bytes_when_files_present(tmp_path: Path) -> None:
    xlsx = tmp_path / "test.xlsx"
    xlsx.write_bytes(b"PK\x03\x04" + b"\x00" * 10)

    session = _make_session_with_mock_crawler([str(xlsx)])
    result = asyncio.run(session.download_step(click_js="(() => {})()", wait_seconds=1.0))

    assert result[:4] == b"PK\x03\x04"


def test_download_step_raises_crawl4ai_error_when_no_files() -> None:
    session = _make_session_with_mock_crawler([])
    with pytest.raises(Crawl4aiError, match="no file in downloaded_files"):
        asyncio.run(session.download_step(click_js="(() => {})()", wait_seconds=1.0))


def test_download_step_raises_when_downloaded_files_is_none() -> None:
    session = _make_session_with_mock_crawler(None)
    with pytest.raises(Crawl4aiError, match="no file in downloaded_files"):
        asyncio.run(session.download_step(click_js="(() => {})()", wait_seconds=1.0))


# ─── build 07: after_goto anti-bot gate (default OFF) ────────────────────────


def test_anti_bot_gate_raises_on_challenge_status() -> None:
    session = Crawl4aiSession(anti_bot_gate=True)
    resp = MagicMock(status=403)
    with pytest.raises(Crawl4aiError, match="anti-bot gate"):
        asyncio.run(session._after_goto_gate(MagicMock(), MagicMock(), "https://x", resp))


def test_anti_bot_gate_passes_on_ok_status() -> None:
    session = Crawl4aiSession(anti_bot_gate=True)
    page = MagicMock()
    resp = MagicMock(status=200)
    result = asyncio.run(session._after_goto_gate(page, MagicMock(), "https://x", resp))
    assert result is page


def test_anti_bot_gate_passes_when_response_is_none() -> None:
    # js_only steps (e.g. download_step) carry no navigation response — gate must not raise.
    session = Crawl4aiSession(anti_bot_gate=True)
    page = MagicMock()
    result = asyncio.run(session._after_goto_gate(page, MagicMock(), "", None))
    assert result is page


# ─── build 07: fit_markdown denoiser on _scrape_page (default OFF) ────────────


class _FakeArunCrawler:
    """Stands in for AsyncWebCrawler in _scrape_page — no browser; arun returns a canned result."""

    def __init__(self, result, **_):
        self._result = result

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def arun(self, url, config):
        return self._result


def test_fetch_page_markdown_fit_vs_raw(monkeypatch) -> None:
    md_obj = MagicMock()
    md_obj.raw_markdown = "RAW nav footer ads"
    md_obj.fit_markdown = "FIT clean"
    result = MagicMock(success=True, html="<h>", markdown=md_obj)
    monkeypatch.setattr(mod, "AsyncWebCrawler", lambda **kw: _FakeArunCrawler(result))

    assert fetch_page_markdown("https://x") == "RAW nav footer ads"
    assert fetch_page_markdown("https://x", fit_markdown=True) == "FIT clean"


# ─── build 07: fetch_many knobs (jitter / memory / monitor / stream) ──────────


class _FakeResult:
    def __init__(self, url, html="<html>ok</html>", success=True):
        self.url = url
        self.html = html
        self.success = success
        self.dispatch_result = MagicMock(memory_usage=12.5, peak_memory=20.0)


class _FakeManyCrawler:
    """Stands in for AsyncWebCrawler in fetch_many — no browser. Returns a list, or an
    async-generator when cfg.stream is set, mirroring crawl4ai's arun_many contract."""

    def __init__(self, results, **_):
        self._results = results

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def arun_many(self, urls, config, dispatcher):
        if getattr(config, "stream", False):

            async def _agen():
                for r in self._results:
                    yield r

            return _agen()
        return list(self._results)


def _patch_many(monkeypatch, results) -> None:
    monkeypatch.setattr(mod, "AsyncWebCrawler", lambda **kw: _FakeManyCrawler(results))


def test_fetch_many_default_collects_html(monkeypatch) -> None:
    _patch_many(monkeypatch, [_FakeResult("https://a", "<a>"), _FakeResult("https://b", "<b>")])
    out = asyncio.run(fetch_many(["https://a", "https://b"]))
    assert out == {"https://a": "<a>", "https://b": "<b>"}


def test_fetch_many_failed_url_maps_to_empty(monkeypatch) -> None:
    _patch_many(
        monkeypatch,
        [_FakeResult("https://a", "<a>"), _FakeResult("https://b", "x", success=False)],
    )
    out = asyncio.run(fetch_many(["https://a", "https://b"]))
    assert out == {"https://a": "<a>", "https://b": ""}


def test_fetch_many_stream_collects_same_html(monkeypatch) -> None:
    # stream=True consumes via async-for but yields the identical {url: html} map.
    _patch_many(monkeypatch, [_FakeResult("https://a", "<a>"), _FakeResult("https://b", "<b>")])
    out = asyncio.run(fetch_many(["https://a", "https://b"], stream=True))
    assert out == {"https://a": "<a>", "https://b": "<b>"}


def test_fetch_many_jitter_and_memory_and_monitor_knobs_reachable(monkeypatch) -> None:
    _patch_many(monkeypatch, [_FakeResult("https://a", "<a>")])
    out = asyncio.run(
        fetch_many(
            ["https://a"],
            jitter=(0.5, 1.0),
            memory_threshold_percent=70.0,
            check_interval=2.0,
            memory_wait_timeout=120.0,
            monitor=True,
        )
    )
    assert out == {"https://a": "<a>"}
