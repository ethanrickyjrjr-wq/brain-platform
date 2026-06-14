"""Listing-page parser and XLSX downloader for Collier County building permits.

The download URL for each month is unpredictable (filename suffixes vary, base
path changed Oct 2025), so every run must parse the listing page to discover links.

Both the listing page (colliercountyfl.gov) and the XLSX file host
(www.collier.gov) sit behind an Akamai bot-wall that blocks plain HTTP clients by
TLS/fingerprint — from datacenter AND residential IPs (verified 2026-06-14: a clean
curl 403s from a home IP, identical to the GitHub runner). So BOTH fetches go
through a proxy:
  - listing HTML  -> Firecrawl stealth   (scrape_with_actions, proxy="stealth")
  - XLSX binary   -> Spider residential  (download_binary; request="http",
                     return_format="bytes"). Firecrawl has no raw-bytes format, so
                     it cannot serve the binary — Spider is the only path.
"""
from __future__ import annotations

import re
from typing import NamedTuple

from bs4 import BeautifulSoup

from ingest.lib.firecrawl_client import scrape_with_actions
from ingest.lib.spider_client import download_binary

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


def _fetch_listing_html() -> str:
    """Fetch the listing page HTML via Firecrawl stealth (bypasses WAF)."""
    resp = scrape_with_actions(LISTING_PAGE_URL, [], proxy="stealth", formats=["html"], wait_for_ms=5000)
    return (resp.get("data") or {}).get("html") or ""


def discover_issued_reports() -> list[MonthlyReport]:
    """Parse the listing page and return all issued-series XLSX entries, newest first."""
    html = _fetch_listing_html()
    soup = BeautifulSoup(html, "html.parser")
    reports: list[MonthlyReport] = []

    for a in soup.find_all("a", href=True):
        href: str = a["href"]
        if not href.endswith(".xlsx"):
            continue
        href_lower = href.lower()
        # Must contain the series keyword; must NOT be the applied series.
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
    # Akamai bot-wall blocks a direct requests.get (any IP, by TLS fingerprint) —
    # fetch through Spider's residential proxy, which returns the raw bytes losslessly.
    xlsx_bytes = download_binary(hit.url)
    if xlsx_bytes[:4] != b"PK\x03\x04":
        raise ValueError(
            f"Collier XLSX download for {filename} did not return a ZIP/xlsx "
            f"(first bytes {xlsx_bytes[:8]!r}) — the proxy likely served an error page."
        )
    return xlsx_bytes, filename


def download_latest_issued() -> tuple[bytes, str]:
    """Download the most recent issued XLSX from the listing page."""
    reports = discover_issued_reports()
    if not reports:
        raise ValueError("No issued XLSX reports found on listing page.")
    latest = reports[0]
    return download_month(latest.year, latest.month)
