"""crawl4ai extraction of active residential listings from John R. Wood (FGCMLS IDX).

Strategy (probed live 2026-06-25 — design: docs/superpowers/specs/2026-06-25-jrw-active-listings-residential-design.md):
  - JRW's list at /listings/ is SERVER-RENDERED HTML. A browser render VIRTUALIZES the list to
    ~4 visible cards and adds a Google-Maps price-pin layer (abbreviated "$271M") — noise. So we
    fetch the RAW server HTML via crawl4ai's AsyncHTTPCrawlerStrategy (HTTP strategy, no browser):
    all 12 cards/page, full prices, every field, ~1.5s, and rule-compliant (still crawl4ai, the
    only sanctioned crawl tool).
  - robots.txt allows /listings/ + /listing/* for User-agent:*. ?page=N paginates; ?county=Lee|
    Collier|... filters. We walk the SWFL counties JRW covers and dedup by mls_id.
  - Card = a.listing__link[href*='/listing/']; the href is /listing/{MLS_ID}/{street}-{city}-fl-{ZIP}/.
    Per-field detail comes from the .listing__property-details aggregate string (regex), which is
    robust to the per-detail class names (bed/bath/lot-size/sqft/days-on-market) changing.

NOTE on CI: the HTTP strategy has no browser stealth, so a GitHub datacenter IP may be WAF-blocked
(the recurring scraper failure — Collier, Crexi). The cron is therefore PARKED (probe_mode:
odd_window) until a green runner proves the IP is clear; seed runs locally (home IP). A residential
proxy can be supplied via CRAWL4AI_PROXY if the runner is blocked.
"""
from __future__ import annotations

import asyncio
import json
import re
from pathlib import Path
from typing import Any

from bs4 import BeautifulSoup
from crawl4ai import AsyncWebCrawler, CacheMode, CrawlerRunConfig, HTTPCrawlerConfig
from crawl4ai.async_crawler_strategy import AsyncHTTPCrawlerStrategy

from ingest.lib.crawl4ai_client import Crawl4aiError

# JRW covers Naples/Fort Myers heavily; the rural pair (Glades/Hendry) returns 0 and is harmless.
SWFL_COUNTIES: list[str] = ["Collier", "Lee", "Charlotte", "Sarasota", "Glades", "Hendry"]

_BASE = "https://www.johnrwood.com/listings/"
_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
)
_MAX_PAGES = 300  # runaway backstop (~3,600/county); real counties exhaust ~120-200 pages
_PAGE_DELAY = 1.0  # inter-page politeness (JRW 403-throttles sustained bursts ~420+ reqs)
_FETCH_ATTEMPTS = 3  # per-page retries with backoff before giving up the page
_DETAIL_RE = re.compile(r"/listing/([A-Za-z0-9]+)/.*?-fl-(\d{5})", re.I)


def _ascii(s: str) -> str:
    """ASCII-fold for safe printing on a Windows cp1252 console (crawl4ai error strings carry a
    U+2192 arrow that crashes a raw print there — the bug that lost the first 4,691-row seed)."""
    return s.encode("ascii", "replace").decode("ascii")


def _swfl_zips() -> set[str]:
    """ZIPs inside the 6-county SWFL footprint — the scope guard (never invent geo)."""
    fx = json.loads(Path("fixtures/swfl-zip-county.json").read_text())
    return {e["zip"] for e in fx.get("entries", [])}


def _text(node, sel: str) -> str | None:
    el = node.select_one(sel)
    return el.get_text(" ", strip=True) if el else None


def _parse_cards(html: str, county: str) -> list[dict[str, Any]]:
    soup = BeautifulSoup(html, "html.parser")
    rows: list[dict[str, Any]] = []
    for a in soup.select("a.listing__link[href*='/listing/']"):
        if not a.select_one(".listing__city"):
            continue  # skip non-list anchors (map pins / nav)
        href = a.get("href", "")
        m = _DETAIL_RE.search(href)
        if not m:
            continue
        details = _text(a, ".listing__property-details") or ""
        rows.append(
            {
                "mls_id": m.group(1),
                "zip_code": m.group(2),
                "county": county,
                "list_price": _text(a, ".listing__price-value"),
                "street_address": _text(a, ".listing__address-display")
                or _text(a, ".listing__address-l2"),
                "city": _text(a, ".listing__city"),
                "state": _text(a, ".listing__state"),
                "community": _text(a, ".listing__subdivision"),
                "details": details,
                "listing_url": "https://www.johnrwood.com" + href
                if href.startswith("/")
                else href,
            }
        )
    return rows


async def _fetch_html(url: str) -> str:
    """Fetch one page's raw HTML via crawl4ai's HTTP strategy, with retry + escalating backoff.
    Raises Crawl4aiError only after all attempts fail (a 403 is JRW throttling sustained load —
    the backoff usually clears it; a sustained block ends the county gracefully upstream)."""
    cfg = HTTPCrawlerConfig(
        method="GET", headers={"User-Agent": _UA}, follow_redirects=True, verify_ssl=True
    )
    last = "?"
    for attempt in range(_FETCH_ATTEMPTS):
        try:
            strategy = AsyncHTTPCrawlerStrategy(browser_config=cfg)
            async with AsyncWebCrawler(crawler_strategy=strategy) as crawler:
                r = await crawler.arun(url=url, config=CrawlerRunConfig(cache_mode=CacheMode.BYPASS))
            if getattr(r, "success", False):
                return r.html or ""
            last = str(getattr(r, "error_message", "?"))
        except Exception as exc:  # noqa: BLE001 — retry any transient fetch error
            last = str(exc)
        if attempt < _FETCH_ATTEMPTS - 1:
            await asyncio.sleep(10.0 * (attempt + 1))  # 10s, 20s — let a 403/rate-limit clear
    raise Crawl4aiError(
        f"jrw: fetch failed for {url} after {_FETCH_ATTEMPTS} attempts: {_ascii(last)}"
    )


async def _fetch_county(county: str, in_scope: set[str]) -> list[dict[str, Any]]:
    """Paginate one county until a page yields no NEW mls_id (or the page cap). A persistent page
    failure (e.g. a 403 that backoff can't clear) ENDS the county keeping the rows gathered so far —
    it never raises out, so other counties continue and the partial result still upserts."""
    seen: set[str] = set()
    out: list[dict[str, Any]] = []
    for page in range(1, _MAX_PAGES + 1):
        url = f"{_BASE}?county={county}&page={page}"
        try:
            html = await _fetch_html(url)
        except Crawl4aiError as exc:
            print(
                f"[warn] {county}: stopping at page {page} after fetch failures "
                f"({len(out)} rows kept): {_ascii(str(exc))}",
                flush=True,
            )
            break
        cards = _parse_cards(html, county)
        new = [c for c in cards if c["mls_id"] not in seen]
        if not new:
            break  # exhausted (empty page, or all duplicates = past the last real page)
        for c in new:
            seen.add(c["mls_id"])
            if c["zip_code"] in in_scope:
                out.append(c)
        await asyncio.sleep(_PAGE_DELAY)  # polite crawl delay (robots sets none for User-agent:*)
    else:
        # No silent truncation: the loop exhausted the page cap without a natural stop.
        print(
            f"[warn] {county}: hit _MAX_PAGES={_MAX_PAGES} cap — result set may be TRUNCATED. "
            "Raise the cap if this county legitimately has more.",
            flush=True,
        )
    return out


def fetch_listings_for_county(county: str) -> list[dict[str, Any]]:
    """Scrape JRW for one SWFL county. Returns raw rows (empty on failure; the pipeline's
    total-empty guard fails the run loud if EVERY county returns nothing)."""
    in_scope = _swfl_zips()
    try:
        return asyncio.run(_fetch_county(county, in_scope))
    except Crawl4aiError as exc:
        print(f"[warn] JRW crawl error for {county}: {_ascii(str(exc))}", flush=True)
        return []
    except Exception as exc:  # noqa: BLE001 — one county must not kill the others
        print(f"[warn] JRW error for {county}: {_ascii(str(exc))}", flush=True)
        return []
