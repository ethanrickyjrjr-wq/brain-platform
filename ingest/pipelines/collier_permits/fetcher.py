"""Listing-page parser and XLSX downloader for Collier County building permits.

The download URL for each month is unpredictable (filename suffixes vary, base path
changed Oct 2025), so every run must parse the listing page to discover links.

Uses crawl4ai UndetectedAdapter to bypass the Akamai bot-wall that blocks
colliercountyfl.gov and www.collier.gov by TLS/JA3 fingerprint from any IP
(datacenter and residential; confirmed 2026-06-14). Replaces Firecrawl stealth +
Spider residential, which were removed in this migration.

Two-session pattern (spec NIT-2):
  discover_issued_reports(): session_id="collier_listing"  — listing page only
  download_month():          session_id="collier_download" — listing nav + click download

Both sessions use `async with` (spec NIT-1). The download session is opened AFTER
the listing session is fully closed (sessions are sequential, never concurrent).
"""
from __future__ import annotations

import asyncio
import json
import re
from typing import NamedTuple

from bs4 import BeautifulSoup

from ingest.lib.crawl4ai_client import Crawl4aiSession

from .constants import BASE_URL, LISTING_PAGE_URL, SERIES

_MONTH_NAMES = {
    "january": 1, "february": 2, "march": 3, "april": 4,
    "may": 5, "june": 6, "july": 7, "august": 8,
    "september": 9, "october": 10, "november": 11, "december": 12,
}


class MonthlyReport(NamedTuple):
    year: int
    month: int
    label: str
    url: str


# ---------------------------------------------------------------------------
# Pure functions (no network — fully unit-testable)
# ---------------------------------------------------------------------------

def _parse_listing_html(html: str) -> list[MonthlyReport]:
    """Parse listing page HTML and return issued-series XLSX entries, newest first."""
    if not html:
        return []
    soup = BeautifulSoup(html, "html.parser")
    reports: list[MonthlyReport] = []

    for a in soup.find_all("a", href=True):
        href: str = a["href"]
        if not href.endswith(".xlsx"):
            continue
        href_lower = href.lower()
        if f"-{SERIES}" not in href_lower and f"_{SERIES}" not in href_lower:
            continue
        if "applied" in href_lower:
            continue

        label = a.get_text(strip=True)
        match = re.match(r"([A-Za-z]+)\s+(\d{4})", label)
        if not match:
            continue
        month_num = _MONTH_NAMES.get(match.group(1).lower())
        if month_num is None:
            continue

        url = (BASE_URL + href) if href.startswith("/") else href
        reports.append(MonthlyReport(
            year=int(match.group(2)),
            month=month_num,
            label=label,
            url=url,
        ))

    reports.sort(key=lambda rep: (rep.year, rep.month), reverse=True)
    return reports


def _build_click_js(xlsx_url: str) -> str:
    """Build JS that finds and clicks the XLSX download anchor on the current listing page.

    Tries both the full absolute URL and the root-relative href attribute value.
    Logs to console.error if anchor not found (guard is on result.downloaded_files,
    not on JS return value — crawl4ai js_code is execute-only).
    """
    rel = xlsx_url[len(BASE_URL):] if xlsx_url.startswith(BASE_URL) else xlsx_url
    return f"""(() => {{
  const a = Array.from(document.querySelectorAll('a[href]')).find(
    el => el.getAttribute('href') === {json.dumps(xlsx_url)} ||
          el.getAttribute('href') === {json.dumps(rel)}
  );
  if (a) {{ a.click(); }}
  else {{ console.error('collier_permits: XLSX anchor not found for href: ' + {json.dumps(xlsx_url)}); }}
}})();"""


# ---------------------------------------------------------------------------
# Async internals
# ---------------------------------------------------------------------------

async def _fetch_listing_html_async() -> str:
    """Navigate to the listing page. Returns raw HTML. Session closed on exit."""
    async with Crawl4aiSession(session_id="collier_listing") as s:
        return await s.step(LISTING_PAGE_URL)


async def _download_async(hit: MonthlyReport) -> bytes:
    """One browser session: navigate to listing page (authenticated context),
    click the XLSX anchor, return downloaded file bytes."""
    async with Crawl4aiSession(session_id="collier_download", accept_downloads=True) as s:
        await s.step(LISTING_PAGE_URL)
        click_js = _build_click_js(hit.url)
        return await s.download_step(click_js=click_js, wait_seconds=10.0)


# ---------------------------------------------------------------------------
# Public API — signatures unchanged; pipeline.py requires zero edits
# ---------------------------------------------------------------------------

def discover_issued_reports() -> list[MonthlyReport]:
    """Parse the listing page and return all issued-series XLSX entries, newest first."""
    html = asyncio.run(_fetch_listing_html_async())
    return _parse_listing_html(html)


def download_month(year: int, month: int) -> tuple[bytes, str]:
    """Download the issued XLSX for (year, month). Returns (xlsx_bytes, filename)."""
    reports = discover_issued_reports()
    hit = next((rep for rep in reports if rep.year == year and rep.month == month), None)
    if hit is None:
        available = [(rep.year, rep.month) for rep in reports[:6]]
        raise ValueError(
            f"No issued XLSX found for {year}-{month:02d}. "
            f"Most recent 6 available: {available}"
        )

    filename = hit.url.rsplit("/", 1)[-1]
    xlsx_bytes = asyncio.run(_download_async(hit))
    if xlsx_bytes[:4] != b"PK\x03\x04":
        raise ValueError(
            f"Collier XLSX download for {filename} did not return a ZIP/xlsx "
            f"(first bytes {xlsx_bytes[:8]!r}) — browser may have served an error page"
        )
    return xlsx_bytes, filename


def download_latest_issued() -> tuple[bytes, str]:
    """Download the most recent issued XLSX from the listing page."""
    reports = discover_issued_reports()
    if not reports:
        raise ValueError("No issued XLSX reports found on listing page.")
    latest = reports[0]
    return download_month(latest.year, latest.month)
