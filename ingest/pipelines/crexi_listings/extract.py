"""
crawl4ai extraction of active commercial listings from Crexi.

Coverage: Estero FL and Fort Myers Beach FL — two SWFL submarkets with
no MarketBeat broker-survey coverage.

Strategy:
  1. Crawl4aiSession + UndetectedAdapter navigates to the Crexi lease search
     (Crexi is a JS SPA with anti-bot protection).
  2. Scroll JS loads additional listing cards.
  3. BeautifulSoup strips scripts/styles → plain text sent to Anthropic Haiku
     for structured extraction.

Previously used Firecrawl /v2/agent for autonomous browsing. Both Firecrawl
and Spider are gone; this is the replacement.
"""
from __future__ import annotations

import asyncio
import json
import os
from typing import Any

from bs4 import BeautifulSoup

from ingest.lib.crawl4ai_client import Crawl4aiSession, Crawl4aiError

SEARCH_TARGETS: list[dict[str, str]] = [
    {
        "city": "Estero",
        "label": "Estero FL",
    },
    {
        "city": "Fort Myers Beach",
        "label": "Fort Myers Beach FL",
    },
]

_BASE_URL = "https://www.crexi.com/lease"

# Single scroll to trigger lazy-load; synchronous so no async IIFE needed.
_SCROLL_JS = "window.scrollTo(0, document.body.scrollHeight);"

_EXTRACT_PROMPT = """\
Extract all commercial real estate listings from the page text below.
For each listing return these fields (omit nulls):
  address       — street address
  city          — city name
  property_type — retail/industrial/office/mixed/land/other
  sqft          — square footage as a number
  asking_price_psf — price per sqft as a number
  status        — available/leased/sale  (default "available" if unclear)
  listed_date   — ISO date or month/year string
  source_url    — URL of the individual listing page

Return ONLY valid JSON with a single key: {"rows": [...]}
Do not include markdown fences. If no listings found, return {"rows": []}.

Page text:
"""


async def _scrape_city(city: str) -> str:
    """Use stealth browser to load Crexi lease search and return stripped page text."""
    async with Crawl4aiSession(session_id=f"crexi_{city.replace(' ', '_').lower()}") as sess:
        # Step 1: navigate and wait for the page to hydrate
        await sess.step(
            _BASE_URL,
            wait_for="js:document.querySelectorAll('[class*=\"property\"], [class*=\"listing\"], article').length > 0",
            delay_after=5.0,
        )
        # Step 2: scroll to trigger lazy-loaded cards, then re-capture
        html = await sess.step(
            _BASE_URL,
            js_only=True,
            js_before=_SCROLL_JS,
            delay_after=4.0,
        )

    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(["script", "style", "svg", "noscript", "meta", "link", "header", "footer", "nav"]):
        tag.decompose()
    return soup.get_text(separator="\n", strip=True)[:28000]


def _extract_with_llm(text: str, city: str) -> list[dict[str, Any]]:
    """Anthropic Haiku structured extraction from page text."""
    import anthropic

    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        print(f"[warn] ANTHROPIC_API_KEY not set — skipping extraction for {city}", flush=True)
        return []

    client = anthropic.Anthropic(api_key=api_key)
    msg = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=4096,
        messages=[{"role": "user", "content": _EXTRACT_PROMPT + text}],
    )
    raw = msg.content[0].text.strip()
    # Strip accidental markdown fences
    if "```" in raw:
        parts = raw.split("```")
        raw = parts[1] if len(parts) > 1 else parts[0]
        if raw.startswith("json"):
            raw = raw[4:]

    try:
        rows: list[dict[str, Any]] = json.loads(raw).get("rows", [])
    except (json.JSONDecodeError, AttributeError):
        print(f"[warn] Crexi: LLM returned unparseable JSON for {city}", flush=True)
        return []

    for row in rows:
        if not row.get("city"):
            row["city"] = city
    return rows


def fetch_listings_for_city(city_meta: dict[str, str]) -> list[dict[str, Any]]:
    """Scrape Crexi + LLM-extract listings for one city. Returns raw listing rows."""
    city = city_meta["city"]
    label = city_meta["label"]
    try:
        text = asyncio.run(_scrape_city(city))
        if not text.strip():
            print(f"[warn] Crexi: empty page for {label}", flush=True)
            return []
        return _extract_with_llm(text, city)
    except Crawl4aiError as exc:
        print(f"[warn] Crexi crawl error for {label}: {exc}", flush=True)
        return []
    except Exception as exc:
        print(f"[warn] Crexi error for {label}: {exc}", flush=True)
        return []
