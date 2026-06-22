"""Generic crawl4ai primitives — the Firecrawl/Spider replacement for all scraping.

Three surfaces:
  Crawl4aiSession  — one persistent browser + UndetectedAdapter; stealth interactive
                     scraping (Accela, Qlik). SEQUENTIAL only. Supports file downloads
                     via accept_downloads=True + download_step().
  fetch_many       — arun_many for INDEPENDENT parallel page fetches (e.g. detail pages).
  fetch_page_markdown / fetch_page_html
                   — simple sync helpers for static pages (no stealth needed).

RUNTIME MODE — IN-PROCESS SDK ONLY (verified 2026-06-21). crawl4ai runs here only as the
in-process Python SDK. There is NO live remote-server consumer: the former email data-readiness
ladder (CRAWL4AI_API_URL -> /search) was replaced by Anthropic web_search on 2026-06-21 (commit
32b4eb5b), and CRAWL4AI_API_URL is now referenced nowhere in the live tree.
LANDMINE: stealth/interactive crawling can NEVER move to the 0.9.0 remote server. The server
rejects js_code / js_code_before_wait / proxy / proxy_config / cookies / extra_args /
simulate_user / magic over the network with HTTP 400 (deploy/docker/MIGRATION.md), and
Crawl4aiSession.step depends on js_code_before_wait. Do not "consolidate onto the server".
The enhanced surface (ingest/lib/supercrawl4ai.py) is also in-process SDK — same constraint.
"""
from __future__ import annotations

import asyncio
import inspect
import logging
import shutil
import tempfile
from pathlib import Path
from typing import Iterable, Optional

from crawl4ai import (
    AsyncWebCrawler,
    BrowserConfig,
    CacheMode,
    CrawlerMonitor,
    CrawlerRunConfig,
    DefaultMarkdownGenerator,
    MemoryAdaptiveDispatcher,
    PruningContentFilter,
    RateLimiter,
    UndetectedAdapter,
)
from crawl4ai.async_crawler_strategy import AsyncPlaywrightCrawlerStrategy

logger = logging.getLogger(__name__)


class Crawl4aiError(RuntimeError):
    """A crawl4ai step failed (navigation error, timeout, or unsuccessful result)."""


class Crawl4aiSession:
    """One persistent AsyncWebCrawler + UndetectedAdapter. Steps share session_id so the
    same page persists across calls (js_only=True applies JS without re-navigating).
    SEQUENTIAL only — never issue concurrent steps on one session."""

    def __init__(
        self,
        *,
        session_id: str = "accela",
        headless: bool = True,
        accept_downloads: bool = False,
        anti_bot_gate: bool = False,
        gate_status_codes: tuple[int, ...] = (403, 429, 503),
    ) -> None:
        self.session_id = session_id
        self.headless = headless
        self.accept_downloads = accept_downloads
        # anti_bot_gate (default OFF = byte-identical): when True, an after_goto hook fails
        # fast/loud on a challenge status instead of letting thin HTML through as "success".
        self.anti_bot_gate = anti_bot_gate
        self.gate_status_codes = gate_status_codes
        self._downloads_dir: Optional[str] = (
            tempfile.mkdtemp(prefix="crawl4ai_dl_") if accept_downloads else None
        )
        self._crawler: Optional[AsyncWebCrawler] = None

    async def _after_goto_gate(self, page, context, url, response, **kwargs):
        """after_goto hook (only attached when anti_bot_gate=True). Raises Crawl4aiError on
        a 403/challenge so a soft-block surfaces loud instead of as thin-HTML "success".
        Fires only on real navigation — js_only steps (e.g. download_step) skip it."""
        status = getattr(response, "status", None)
        if status in self.gate_status_codes:
            raise Crawl4aiError(
                f"anti-bot gate: {url} returned HTTP {status} (challenge/block) — "
                "refusing thin capture"
            )
        return page

    async def __aenter__(self) -> "Crawl4aiSession":
        adapter = UndetectedAdapter()
        bc = BrowserConfig(
            headless=self.headless,
            enable_stealth=True,
            accept_downloads=self.accept_downloads,
            downloads_path=self._downloads_dir,
        )
        strategy = AsyncPlaywrightCrawlerStrategy(browser_adapter=adapter, browser_config=bc)
        self._crawler = AsyncWebCrawler(crawler_strategy=strategy, config=bc)
        if self.anti_bot_gate:
            self._crawler.crawler_strategy.set_hook("after_goto", self._after_goto_gate)
        await self._crawler.start()
        return self

    async def step(
        self,
        url: str,
        *,
        js_before: Optional[str] = None,
        wait_for: Optional[str] = None,
        js_only: bool = False,
        timeout: int = 90_000,
        delay_after: float = 1.0,
    ) -> str:
        """Run one arun(): navigate (unless js_only) -> js_before -> wait_for ->
        delay_after -> capture. Returns result.html. Raises Crawl4aiError on failure."""
        assert self._crawler is not None, "use within 'async with'"
        cfg = CrawlerRunConfig(
            session_id=self.session_id,
            cache_mode=CacheMode.BYPASS,
            js_code_before_wait=js_before,
            wait_for=wait_for,
            js_only=js_only,
            page_timeout=timeout,
            delay_before_return_html=delay_after,
        )
        r = await self._crawler.arun(url=url, config=cfg)
        if not getattr(r, "success", False):
            raise Crawl4aiError(f"step failed for {url}: {getattr(r, 'error_message', '?')}")
        return r.html or ""

    async def download_step(
        self,
        *,
        click_js: str,
        wait_seconds: float = 10.0,
    ) -> bytes:
        """Click a download anchor in the current session page and return file bytes.

        Must be called after a step() that navigated to the page containing the anchor.
        Uses js_only=True — the page is NOT re-navigated. The browser clicks the anchor
        and the file lands in self._downloads_dir (set at __init__ time).

        Guard: raises Crawl4aiError if downloaded_files is empty after wait_seconds.
        The caller must have opened this session with accept_downloads=True.
        """
        assert self._crawler is not None, "use within 'async with'"
        cfg = CrawlerRunConfig(
            session_id=self.session_id,
            cache_mode=CacheMode.BYPASS,
            js_code_before_wait=click_js,
            js_only=True,
            page_timeout=int(wait_seconds * 1_000) + 10_000,
            delay_before_return_html=wait_seconds,
        )
        r = await self._crawler.arun(url="", config=cfg)
        files = getattr(r, "downloaded_files", None) or []
        if not files:
            raise Crawl4aiError(
                f"download_step: no file in downloaded_files after {wait_seconds:.0f}s — "
                "anchor may not have been found or clicked"
            )
        return Path(files[0]).read_bytes()

    async def __aexit__(self, *exc) -> None:
        if self._crawler is not None:
            try:
                await self._crawler.crawler_strategy.kill_session(self.session_id)
            finally:
                await self._crawler.close()
        if self._downloads_dir:
            shutil.rmtree(self._downloads_dir, ignore_errors=True)


async def _scrape_page(url: str, *, fit_markdown: bool = False) -> tuple[str, str]:
    """Fetch a static page without stealth. Returns (html, markdown).

    fit_markdown (default OFF = byte-identical): attaches a PruningContentFilter denoiser
    (drops nav/footer/ads) and returns the fit/denoised markdown — cleaner parse, fewer LLM
    tokens. Off => the same raw_markdown capture as before."""
    bc = BrowserConfig(headless=True)
    strategy = AsyncPlaywrightCrawlerStrategy(browser_config=bc)
    cfg_kwargs = dict(cache_mode=CacheMode.BYPASS, delay_before_return_html=1.0)
    if fit_markdown:
        cfg_kwargs["markdown_generator"] = DefaultMarkdownGenerator(
            content_filter=PruningContentFilter()
        )
    cfg = CrawlerRunConfig(**cfg_kwargs)
    async with AsyncWebCrawler(crawler_strategy=strategy, config=bc) as crawler:
        r = await crawler.arun(url=url, config=cfg)
    if not getattr(r, "success", False):
        raise Crawl4aiError(f"scrape failed for {url}: {getattr(r, 'error_message', '?')}")
    html = r.html or ""
    md_obj = getattr(r, "markdown", None)
    if md_obj is None:
        md = ""
    elif fit_markdown and getattr(md_obj, "fit_markdown", None):
        md = md_obj.fit_markdown or ""
    elif hasattr(md_obj, "raw_markdown"):
        md = md_obj.raw_markdown or ""
    else:
        md = str(md_obj)
    return html, md


def fetch_page_markdown(url: str, *, fit_markdown: bool = False) -> str:
    """Sync: fetch a static page, return markdown. No stealth.
    fit_markdown=True denoises via PruningContentFilter (default off = raw_markdown)."""
    _, md = asyncio.run(_scrape_page(url, fit_markdown=fit_markdown))
    return md


def fetch_page_html(url: str) -> str:
    """Sync: fetch a static page, return raw HTML. No stealth."""
    html, _ = asyncio.run(_scrape_page(url))
    return html


async def fetch_many(
    urls: Iterable[str],
    *,
    wait_for: Optional[str] = None,
    concurrency: int = 5,
    timeout: int = 60_000,
    headless: bool = True,
    jitter: tuple[float, float] = (0.0, 0.0),
    memory_threshold_percent: Optional[float] = None,
    check_interval: Optional[float] = None,
    memory_wait_timeout: Optional[float] = None,
    monitor: bool = False,
    stream: bool = False,
) -> dict[str, str]:
    """Fetch INDEPENDENT urls concurrently via arun_many (separate contexts, no shared
    session). Concurrency capped to limit burst-block risk. Returns {url: html}; failed
    urls map to ''.

    Every keyword below defaults to the existing effective behavior (byte-identical):
      jitter=(mean_delay, max_range)  pre-emptive inter-request jitter; RateLimiter only backs
                                      off AFTER a 429/503. Applied only when non-zero.
      memory_threshold_percent / check_interval / memory_wait_timeout
                                      MemoryAdaptiveDispatcher hardening so a constrained runner
                                      throttles instead of being OOM-killed. Passed only when set.
      monitor=True                    attach a CrawlerMonitor + log per-url dispatch_result
                                      (memory/peak) — the missing diagnostic when a batch hangs.
      stream=True                     consume results as they arrive (one stuck detail page can't
                                      block the whole batch). Collect-all stays the default."""
    url_list = list(urls)
    if not url_list:
        return {}
    adapter = UndetectedAdapter()
    bc = BrowserConfig(headless=headless, enable_stealth=True)
    strategy = AsyncPlaywrightCrawlerStrategy(browser_adapter=adapter, browser_config=bc)
    cfg_kwargs = dict(
        cache_mode=CacheMode.BYPASS,
        wait_for=wait_for,
        page_timeout=timeout,
        delay_before_return_html=1.0,
    )
    mean_delay, max_range = jitter
    if mean_delay or max_range:
        cfg_kwargs["mean_delay"] = mean_delay
        cfg_kwargs["max_range"] = max_range
    if stream:
        cfg_kwargs["stream"] = True
    cfg = CrawlerRunConfig(**cfg_kwargs)
    # MemoryAdaptiveDispatcher + RateLimiter replace the legacy `semaphore_count` knob: it caps
    # concurrent sessions at `concurrency`, backs off on 429/503 (base 1-3s, cap 60s, 3 retries),
    # and throttles under memory pressure so a big batch can't OOM a constrained GHA runner.
    disp_kwargs = dict(
        max_session_permit=concurrency,
        rate_limiter=RateLimiter(
            base_delay=(1.0, 3.0),
            max_delay=60.0,
            max_retries=3,
            rate_limit_codes=[429, 503],
        ),
    )
    if memory_threshold_percent is not None:
        disp_kwargs["memory_threshold_percent"] = memory_threshold_percent
    if check_interval is not None:
        disp_kwargs["check_interval"] = check_interval
    if memory_wait_timeout is not None:
        disp_kwargs["memory_wait_timeout"] = memory_wait_timeout
    if monitor and "monitor" in inspect.signature(MemoryAdaptiveDispatcher.__init__).parameters:
        disp_kwargs["monitor"] = CrawlerMonitor()
    dispatcher = MemoryAdaptiveDispatcher(**disp_kwargs)
    out: dict[str, str] = {}

    def _record(r) -> None:
        out[getattr(r, "url", "")] = (r.html or "") if getattr(r, "success", False) else ""
        if monitor:
            dr = getattr(r, "dispatch_result", None)
            if dr is not None:
                logger.info(
                    "fetch_many %s mem=%sMB peak=%sMB",
                    getattr(r, "url", "?"),
                    getattr(dr, "memory_usage", "?"),
                    getattr(dr, "peak_memory", "?"),
                )

    async with AsyncWebCrawler(crawler_strategy=strategy, config=bc) as crawler:
        result_obj = await crawler.arun_many(urls=url_list, config=cfg, dispatcher=dispatcher)
        if stream:
            async for r in result_obj:
                _record(r)
        else:
            for r in result_obj:
                _record(r)
    return out
