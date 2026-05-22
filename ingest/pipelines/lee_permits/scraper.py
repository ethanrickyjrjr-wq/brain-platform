"""Firecrawl-driven Lee County Accela permit scraper.

Two entry points:
  - fetch_permit_pages(start_date, end_date) -> list[str]  : pulls raw HTML/markdown via Firecrawl
  - parse_accela_result_page(html: str) -> list[PermitRow]  : pure parser, no I/O

The Firecrawl session pattern handles Accela's ASP.NET viewstate + cookie session
(the search form is a POST, not a GET, so /scrape alone is insufficient — use
/interact for the form submission, then /scrape on the result page).

See: firecrawl-build-interact skill for the interact pattern.
"""
from __future__ import annotations
from dataclasses import dataclass
from datetime import date
from typing import Optional
import os
import re
from bs4 import BeautifulSoup


@dataclass
class PermitRow:
    permit_id: str
    issued_date: str  # ISO YYYY-MM-DD
    permit_type_raw: str
    permit_description_raw: str
    address: str
    zip_code: Optional[str]
    lat: Optional[float]
    lon: Optional[float]
    declared_value_usd: Optional[float]
    status: Optional[str]


def parse_accela_result_page(html: str) -> list[PermitRow]:
    """Pure parser. No network. Test against captured fixtures."""
    if not html or not html.strip():
        return []
    soup = BeautifulSoup(html, "html.parser")
    # Accela result list lives in a <table> with class "ACA_GridView" (or similar).
    # The exact selector is captured at fixture-time — adjust if Accela changes shape.
    table = soup.find("table", class_=re.compile(r"GridView|ResultGrid"))
    if table is None:
        return []
    rows: list[PermitRow] = []
    for tr in table.find_all("tr")[1:]:  # skip header row
        cells = [td.get_text(strip=True) for td in tr.find_all("td")]
        if len(cells) < 5:
            continue
        # Column order is captured at fixture-time. Confirm against the fixture HTML
        # before relying on this in live mode. Typical Accela layout:
        #   [select, permit_id, permit_type, status, address, issued_date]
        try:
            permit_id = cells[1]
            permit_type_raw = cells[2]
            status = cells[3]
            address = cells[4]
            issued_date_raw = cells[5] if len(cells) > 5 else ""
        except IndexError:
            continue
        if not permit_id:
            continue
        issued_date = _to_iso_date(issued_date_raw)
        rows.append(
            PermitRow(
                permit_id=permit_id,
                issued_date=issued_date,
                permit_type_raw=permit_type_raw,
                permit_description_raw="",  # list page rarely carries description; populated by detail fetch
                address=address,
                zip_code=_extract_zip(address),
                lat=None,
                lon=None,
                declared_value_usd=None,
                status=status,
            )
        )
    return rows


_DATE_RE = re.compile(r"(\d{1,2})/(\d{1,2})/(\d{4})")
_ZIP_RE = re.compile(r"\b(\d{5})(?:-\d{4})?\b")


def _to_iso_date(raw: str) -> str:
    """MM/DD/YYYY -> YYYY-MM-DD. Returns empty string on parse failure."""
    m = _DATE_RE.search(raw or "")
    if not m:
        return ""
    mm, dd, yyyy = m.groups()
    return f"{yyyy}-{int(mm):02d}-{int(dd):02d}"


def _extract_zip(address: str) -> Optional[str]:
    m = _ZIP_RE.search(address or "")
    return m.group(1) if m else None


def fetch_permit_pages(start_date: date, end_date: date) -> list[str]:
    """Live Firecrawl call. Returns HTML for each result page in the date range.

    Pagination: Accela returns ~50 permits/page. Walk pages until "next" disappears.
    See firecrawl-build-interact for the form-submit + pagination pattern.
    """
    from firecrawl import FirecrawlApp  # imported lazily so tests don't need the SDK

    api_key = os.environ.get("FIRECRAWL_API_KEY")
    if not api_key:
        raise RuntimeError("FIRECRAWL_API_KEY missing — invoke firecrawl-build-onboarding first")
    app = FirecrawlApp(api_key=api_key)

    # The /interact endpoint script is captured at implementation time once the
    # actual portal interaction is verified end-to-end. See ingest/pipelines/lee_permits/README.md
    # for the captured interact recipe. For v1, this function is a stub the
    # pipeline.py runner orchestrates.
    raise NotImplementedError(
        "Live Firecrawl pagination recipe is captured during the first end-to-end run. "
        "See firecrawl-build-interact skill for the pattern; record the working recipe here."
    )
