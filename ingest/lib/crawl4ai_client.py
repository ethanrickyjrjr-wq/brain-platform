"""Generic crawl4ai primitives — the Firecrawl/Spider replacement for all scraping.

Three surfaces:
  Crawl4aiSession  — one persistent browser + UndetectedAdapter; stealth interactive
                     scraping (Accela, Qlik). SEQUENTIAL only. Supports file downloads
                     via accept_downloads=True + download_step().
  fetch_many       — arun_many for INDEPENDENT parallel page fetches (e.g. detail pages).
  fetch_page_markdown / fetch_page_html
                   — simple sync helpers for static pages (no stealth needed).
"""
from __future__ import annotations

import asyncio
import shutil
import tempfile
from pathlib import Path
from typing import Iterable, Optional

from crawl4ai import (
    AsyncWebCrawler,
    BrowserConfig,
    CacheMode,
    CrawlerRunConfig,
    MemoryAdaptiveDispatcher,
    RateLimiter,
    UndetectedAdapter,
)
from crawl4ai.async_crawler_strategy import AsyncPlaywrightCrawlerStrategy


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
    ) -> None:
        self.session_id = session_id
        self.headless = headless
        self.accept_downloads = accept_downloads
        self._downloads_dir: Optional[str] = (
            tempfile.mkdtemp(prefix="crawl4ai_dl_") if accept_downloads else None
        )
        self._crawler: Optional[AsyncWebCrawler] = None

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


async def _scrape_page(url: str) -> tuple[str, str]:
    """Fetch a static page without stealth. Returns (html, markdown)."""
    bc = BrowserConfig(headless=True)
    strategy = AsyncPlaywrightCrawlerStrategy(browser_config=bc)
    cfg = CrawlerRunConfig(cache_mode=CacheMode.BYPASS, delay_before_return_html=1.0)
    async with AsyncWebCrawler(crawler_strategy=strategy, config=bc) as crawler:
        r = await crawler.arun(url=url, config=cfg)
    if not getattr(r, "success", False):
        raise Crawl4aiError(f"scrape failed for {url}: {getattr(r, 'error_message', '?')}")
    html = r.html or ""
    md_obj = getattr(r, "markdown", None)
    if md_obj is None:
        md = ""
    elif hasattr(md_obj, "raw_markdown"):
        md = md_obj.raw_markdown or ""
    else:
        md = str(md_obj)
    return html, md


def fetch_page_markdown(url: str) -> str:
    """Sync: fetch a static page, return markdown. No stealth."""
    _, md = asyncio.run(_scrape_page(url))
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
) -> dict[str, str]:
    """Fetch INDEPENDENT urls concurrently via arun_many (separate contexts, no shared
    session). Concurrency capped to limit burst-block risk. Returns {url: html}; failed
    urls map to ''."""
    url_list = list(urls)
    if not url_list:
        return {}
    adapter = UndetectedAdapter()
    bc = BrowserConfig(headless=headless, enable_stealth=True)
    strategy = AsyncPlaywrightCrawlerStrategy(browser_adapter=adapter, browser_config=bc)
    cfg = CrawlerRunConfig(
        cache_mode=CacheMode.BYPASS,
        wait_for=wait_for,
        page_timeout=timeout,
        delay_before_return_html=1.0,
    )
    # MemoryAdaptiveDispatcher + RateLimiter replace the legacy `semaphore_count` knob: it caps
    # concurrent sessions at `concurrency`, backs off on 429/503 (base 1-3s, cap 60s, 3 retries),
    # and throttles under memory pressure so a big batch can't OOM a constrained GHA runner.
    dispatcher = MemoryAdaptiveDispatcher(
        max_session_permit=concurrency,
        rate_limiter=RateLimiter(
            base_delay=(1.0, 3.0),
            max_delay=60.0,
            max_retries=3,
            rate_limit_codes=[429, 503],
        ),
    )
    out: dict[str, str] = {}
    async with AsyncWebCrawler(crawler_strategy=strategy, config=bc) as crawler:
        results = await crawler.arun_many(urls=url_list, config=cfg, dispatcher=dispatcher)
        for r in results:
            out[getattr(r, "url", "")] = (r.html or "") if getattr(r, "success", False) else ""
    return out
