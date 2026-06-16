"""Generic crawl4ai primitives (UndetectedAdapter) — the Firecrawl replacement for
interactive/stealth Accela scraping. No Accela-specific knowledge lives here.

Two surfaces:
  Crawl4aiSession — one persistent browser; chain steps by session_id (SEQUENTIAL only).
  fetch_many      — arun_many for INDEPENDENT parallel page fetches (e.g. detail pages).
"""
from __future__ import annotations

from typing import Iterable, Optional

from crawl4ai import (
    AsyncWebCrawler,
    BrowserConfig,
    CacheMode,
    CrawlerRunConfig,
    UndetectedAdapter,
)
from crawl4ai.async_crawler_strategy import AsyncPlaywrightCrawlerStrategy


class Crawl4aiError(RuntimeError):
    """A crawl4ai step failed (navigation error, timeout, or unsuccessful result)."""


class Crawl4aiSession:
    """One persistent AsyncWebCrawler + UndetectedAdapter. Steps share session_id so the
    same page persists across calls (js_only=True applies JS without re-navigating).
    SEQUENTIAL only — never issue concurrent steps on one session."""

    def __init__(self, *, session_id: str = "accela", headless: bool = True) -> None:
        self.session_id = session_id
        self.headless = headless
        self._crawler: Optional[AsyncWebCrawler] = None

    async def __aenter__(self) -> "Crawl4aiSession":
        adapter = UndetectedAdapter()
        bc = BrowserConfig(headless=self.headless, enable_stealth=True)
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

    async def __aexit__(self, *exc) -> None:
        if self._crawler is not None:
            try:
                await self._crawler.crawler_strategy.kill_session(self.session_id)
            finally:
                await self._crawler.close()


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
        semaphore_count=concurrency,
    )
    out: dict[str, str] = {}
    async with AsyncWebCrawler(crawler_strategy=strategy, config=bc) as crawler:
        results = await crawler.arun_many(urls=url_list, config=cfg)
        for r in results:
            out[getattr(r, "url", "")] = (r.html or "") if getattr(r, "success", False) else ""
    return out
