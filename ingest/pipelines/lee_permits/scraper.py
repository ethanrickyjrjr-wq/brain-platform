"""Firecrawl-driven Lee County Accela permit scraper.

Two entry points:
  - fetch_permit_pages(start_date, end_date) -> list[str]  : pulls raw HTML via Firecrawl
  - parse_accela_result_page(html: str) -> list[PermitRow]  : pure parser, no I/O

v1 (Lean) — 2026-05-25
----------------------
Single-call `app.scrape(url, actions=[...])` against the real portal at
`aca-prod.accela.com/LEECO/`. Stealth proxy handles the Angular SPA;
`actions=[wait, write, write, click, wait, scrape]` fills the search form
and captures the post-submit HTML.

Returns first page only (10 rows). Sufficient for a daily/short-window run
where row count <= 10. For backfills or large windows this WILL undercount.

TODO v2 (tracked in MEMORY [[permits-swfl-v2-pagination-detail]]):
  - Pagination loop (Lee shows 10/page; 7-day window has 100+ permits)
  - Per-permit detail-page fetch for issued_date + declared_value
    (the list view does NOT carry either column)
  - Filter to issued permits only (drop `26TMP-*` temporary applications)
"""
from __future__ import annotations
from dataclasses import dataclass
from datetime import date
from typing import Optional
import logging
import os
import re
from bs4 import BeautifulSoup


@dataclass
class PermitRow:
    permit_id: str
    issued_date: str  # ISO YYYY-MM-DD; v1 sets to search end_date (list view lacks the column)
    permit_type_raw: str  # v1 always "" — list view has no permit-type column
    permit_description_raw: str
    address: str
    zip_code: Optional[str]
    lat: Optional[float]
    lon: Optional[float]
    declared_value_usd: Optional[float]
    status: Optional[str]


# Real column order on aca-prod.accela.com/LEECO/ Permitting search results:
#   [_, Record Number, Address, Description, Status, Action, Related Records, Submittal Type, _]
# Confirmed against live portal 2026-05-25.
_COL_PERMIT_ID = 1
_COL_ADDRESS = 2
_COL_DESCRIPTION = 3
_COL_STATUS = 4


def parse_accela_result_page(html: str, issued_date_fallback: str = "") -> list[PermitRow]:
    """Pure parser. No network. Test against captured fixtures.

    `issued_date_fallback` is set on every row because the Accela list view
    does NOT carry an issued-date column (v1 limitation — see module docstring).
    """
    if not html or not html.strip():
        return []
    soup = BeautifulSoup(html, "html.parser")
    # Lee's permit grid: <table id="...gdvPermitList..." class="ACA_GridView ...">
    table = soup.find("table", id=re.compile(r"gdvPermitList"))
    if table is None:
        # Fallback: any GridView (defensive — Accela ships several grid IDs across modules)
        table = soup.find("table", class_=re.compile(r"GridView|ResultGrid"))
    if table is None:
        return []

    rows: list[PermitRow] = []
    for tr in table.find_all("tr"):
        cells = tr.find_all("td")
        if len(cells) <= _COL_STATUS:
            continue  # header rows / pager rows / short rows
        permit_id = cells[_COL_PERMIT_ID].get_text(" ", strip=True)
        # Skip non-data rows: header ("Record Number"), pager rows (< Prev / Next >),
        # and any cell that doesn't look like a Lee permit identifier.
        if not _PERMIT_ID_RE.match(permit_id):
            continue
        address = cells[_COL_ADDRESS].get_text(" ", strip=True)
        description = cells[_COL_DESCRIPTION].get_text(" ", strip=True)
        status = cells[_COL_STATUS].get_text(" ", strip=True)
        rows.append(
            PermitRow(
                permit_id=permit_id,
                issued_date=issued_date_fallback,
                permit_type_raw="",
                permit_description_raw=description,
                address=address,
                zip_code=_extract_zip(address),
                lat=None,
                lon=None,
                declared_value_usd=None,
                status=status or None,
            )
        )
    return rows


_ZIP_RE = re.compile(r"\b(\d{5})(?:-\d{4})?\b")

# Lee permit IDs: BLD2026-NNNNN, RES2026-NNNNN, MEC2026-NNNNN-R01, 26TMP-NNNNNN, etc.
_PERMIT_ID_RE = re.compile(r"^[A-Z]{2,5}\d{4}-\d{3,6}(?:-R\d+)?$|^\d{2}TMP-\d{4,6}$")


def _extract_zip(address: str) -> Optional[str]:
    m = _ZIP_RE.search(address or "")
    return m.group(1) if m else None


_ACCELA_SEARCH_URL = (
    "https://aca-prod.accela.com/LEECO/Cap/CapHome.aspx"
    "?module=Permitting&TabName=Permitting"
)


def fetch_permit_pages(start_date: date, end_date: date) -> list[str]:
    """Live Firecrawl scrape with actions. Returns a single-element list
    containing the first results page HTML.

    v1 limitation: first page only (10 rows max). See module docstring for the
    v2 pagination + detail-page enrichment plan.
    """
    from firecrawl import FirecrawlApp
    from firecrawl.v2.types import WaitAction, WriteAction, ClickAction, ScrapeAction

    log = logging.getLogger(__name__)
    if not log.handlers:
        logging.basicConfig(level=logging.INFO, format="[%(name)s] %(message)s")

    api_key = os.environ.get("FIRECRAWL_API_KEY")
    if not api_key:
        raise RuntimeError(
            "FIRECRAWL_API_KEY missing — invoke firecrawl-build-onboarding first"
        )
    app = FirecrawlApp(api_key=api_key)

    start_str = start_date.strftime("%m/%d/%Y")
    end_str = end_date.strftime("%m/%d/%Y")
    log.info("scraping Lee Accela permits %s -> %s", start_str, end_str)

    doc = app.scrape(
        _ACCELA_SEARCH_URL,
        formats=["html"],
        proxy="stealth",
        wait_for=5000,
        timeout=180000,
        actions=[
            WaitAction(type="wait", selector='input[id$="txtGSStartDate"]'),
            WriteAction(type="write", text=start_str, selector='input[id$="txtGSStartDate"]'),
            WriteAction(type="write", text=end_str, selector='input[id$="txtGSEndDate"]'),
            WaitAction(type="wait", milliseconds=1000),
            ClickAction(type="click", selector="#ctl00_PlaceHolderMain_btnNewSearch"),
            WaitAction(type="wait", milliseconds=12000),
            ScrapeAction(type="scrape"),
        ],
    )
    html = doc.html or ""
    log.info(
        "scrape returned html_len=%d, has_grid=%s, credits=%s",
        len(html),
        "gdvPermitList" in html,
        getattr(doc.metadata, "credits_used", None),
    )
    if "gdvPermitList" not in html:
        raise RuntimeError(
            "Post-submit HTML has no gdvPermitList grid. Form submission likely failed. "
            f"Preview: {html[:400]!r}"
        )
    return [html]
