"""Firecrawl-driven Lee County Accela permit scraper.

Public API:
  fetch_permit_pages(start_date, end_date) -> list[str]
      Fetches all paginated results via Firecrawl REST (stealth proxy). Returns
      one HTML string per page.

  parse_accela_result_page(html, issued_date_fallback) -> list[PermitRow]
      Pure parser — no network. Extracts permit rows including cap_detail_url.
      Filters out 26TMP-* temporary applications (no issued date, no detail link).

  parse_page_count(html) -> int
      Reads pagecount attribute from the Accela GridView table.

  parse_cap_detail_html(html) -> dict
      Pure parser for CapDetail.aspx. Extracts issued_date, declared_value_usd,
      permit_type_raw.

  enrich_rows_with_details(rows, max_workers) -> list[PermitRow]
      Parallel-fetches each row's CapDetail.aspx URL and fills issued_date,
      declared_value_usd, permit_type_raw in place.

v2 — 2026-05-26
----------------
Migrated from firecrawl-py SDK to the shared REST client
(ingest.lib.firecrawl_client.scrape_with_actions). Stealth proxy is required
for the Accela portal and the SDK lacks the proxy flag in its CLI surface.

Pagination: repeated /v2/scrape calls — each call for page K re-submits the
search form then clicks the "Next >" pager link K-1 times before scraping.
pagecount is read from the table's pagecount="N" attribute on page 1.
Wait budget: Firecrawl caps total wait actions at 60 s. Base actions consume
~13 s; each next-click adds _PAGER_NEXT_WAIT_MS. At 4 000 ms/click the cap
hits at page 15 (13 + 14×4 = 69 s). Monthly cron handles ≤4 pages; a 90-day
backfill needs 11 pages (53 s total). Longer ranges require date-range chunking.

Per-permit detail: after pagination, (permit_id, cap_detail_url) tuples are
parallel-scraped via /v2/scrape with stealth proxy to extract issued_date,
declared_value_usd, and permit_type_raw. Stealth assumed until proven otherwise.
"""
from __future__ import annotations

import logging
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from datetime import date
from typing import Any, Optional

from bs4 import BeautifulSoup

from ingest.lib.firecrawl_client import FirecrawlError, scrape_with_actions

log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Data model
# ---------------------------------------------------------------------------

@dataclass
class PermitRow:
    permit_id: str
    issued_date: str           # ISO YYYY-MM-DD; fallback = search end_date until enriched
    permit_type_raw: str       # empty until enriched from detail page
    permit_description_raw: str
    address: str
    zip_code: Optional[str]
    lat: Optional[float]
    lon: Optional[float]
    declared_value_usd: Optional[float]
    status: Optional[str]
    cap_detail_url: Optional[str] = field(default=None)  # CapDetail.aspx href from list view


# ---------------------------------------------------------------------------
# Column indices (confirmed against live portal 2026-05-25)
# ---------------------------------------------------------------------------

_COL_PERMIT_ID  = 1
_COL_ADDRESS    = 2
_COL_DESCRIPTION = 3
_COL_STATUS     = 4

# ---------------------------------------------------------------------------
# Regex helpers
# ---------------------------------------------------------------------------

_ZIP_RE = re.compile(r"\b(\d{5})(?:-\d{4})?\b")

# Lee permit IDs: BLD2026-NNNNN, MEC2026-NNNNN-R01, 26TMP-NNNNNN, etc.
_PERMIT_ID_RE = re.compile(
    r"^[A-Z]{2,5}\d{4}-\d{3,6}(?:-R\d+)?$"
    r"|^\d{2}TMP-\d{4,6}$"
)
_TMP_PREFIX_RE = re.compile(r"^\d{2}TMP-", re.IGNORECASE)


def _extract_zip(address: str) -> Optional[str]:
    m = _ZIP_RE.search(address or "")
    return m.group(1) if m else None


def _parse_mm_dd_yyyy(value: str) -> Optional[str]:
    """Convert MM/DD/YYYY → YYYY-MM-DD; None on failure."""
    m = re.fullmatch(r"(\d{1,2})/(\d{1,2})/(\d{4})", (value or "").strip())
    if not m:
        return None
    return f"{m.group(3)}-{m.group(1).zfill(2)}-{m.group(2).zfill(2)}"


# ---------------------------------------------------------------------------
# List-page parsers
# ---------------------------------------------------------------------------

def parse_page_count(html: str) -> int:
    """Read pagecount="N" from the Accela GridView table. Returns 1 if absent."""
    m = re.search(r'pagecount="(\d+)"', html)
    return int(m.group(1)) if m else 1


def parse_accela_result_page(html: str, issued_date_fallback: str = "") -> list[PermitRow]:
    """Pure parser. No network. Safe to call with captured fixture HTML.

    Extracts permit_id, address, description, status, and cap_detail_url.
    Rows matching 26TMP-* are excluded (temporary applications, not issued permits).
    issued_date_fallback is stamped on every row; real dates are filled later by
    enrich_rows_with_details().
    """
    if not html or not html.strip():
        return []
    soup = BeautifulSoup(html, "html.parser")
    table = soup.find("table", id=re.compile(r"gdvPermitList"))
    if table is None:
        table = soup.find("table", class_=re.compile(r"GridView|ResultGrid"))
    if table is None:
        return []

    rows: list[PermitRow] = []
    for tr in table.find_all("tr"):
        cells = tr.find_all("td")
        if len(cells) <= _COL_STATUS:
            continue

        permit_cell = cells[_COL_PERMIT_ID]
        permit_id = permit_cell.get_text(" ", strip=True)
        if not _PERMIT_ID_RE.match(permit_id):
            continue  # header / pager row

        # 26TMP-* rows are temporary applications — no detail URL, no issued date
        if _TMP_PREFIX_RE.match(permit_id):
            continue

        # Harvest CapDetail.aspx URL from the <a href="..."> around the permit number
        a_tag = permit_cell.find("a", href=lambda h: h and "CapDetail.aspx" in h)
        cap_detail_url = a_tag["href"] if a_tag else None

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
                cap_detail_url=cap_detail_url,
            )
        )
    return rows


# ---------------------------------------------------------------------------
# Detail-page parser
# ---------------------------------------------------------------------------

def parse_cap_detail_html(html: str) -> dict[str, Any]:
    """Pure parser for a CapDetail.aspx page.

    Returns {"issued_date": str|None, "declared_value_usd": float|None,
             "permit_type_raw": str|None}.

    Two strategies per field:
      1. ID-based: look for a <span id="...lblIssuedDate"> etc.
      2. Label-based: find a <td> whose text is "Issue Date" and read the next <td>.
    Falls back to None when field is absent.
    """
    if not html:
        return {"issued_date": None, "declared_value_usd": None, "permit_type_raw": None}

    soup = BeautifulSoup(html, "html.parser")

    def _span_text(id_pattern: str) -> Optional[str]:
        tag = soup.find(id=re.compile(id_pattern, re.IGNORECASE))
        return (tag.get_text(strip=True) or None) if tag else None

    def _label_neighbor(label_re: str) -> Optional[str]:
        """Find a label text node and return the value from its sibling container.

        Handles two DOM patterns on Accela LEECO CapDetail.aspx:
        1. Table pattern: <td>Label</td><td>Value</td>
        2. MoreDetail pattern (Application Information section):
               <div class="MoreDetail_ItemCol1"><span>Label</span></div>
               <div class="MoreDetail_ItemCol2"><span>Value</span></div>
        The valuation field (Est Const. Value / Construction Value) only appears
        in the MoreDetail pattern — the td pattern returns None for it.
        """
        cell = soup.find(string=re.compile(label_re, re.IGNORECASE))
        if not cell:
            return None
        # Pattern 1: td sibling
        parent_td = cell.find_parent("td")
        if parent_td:
            sibling = parent_td.find_next_sibling("td")
            if sibling:
                return sibling.get_text(strip=True) or None
        # Pattern 2: MoreDetail_ItemColN div sibling
        parent_div = cell.find_parent(
            class_=re.compile(r"MoreDetail_ItemCol", re.IGNORECASE)
        )
        if parent_div:
            sibling = parent_div.find_next_sibling()
            if sibling:
                return sibling.get_text(strip=True) or None
        return None

    # --- issued_date ---
    issued_date: Optional[str] = None
    for pat in ["lblIssuedDate", "lblIssueDate", "lblIssDate"]:
        raw = _span_text(pat)
        if raw:
            issued_date = _parse_mm_dd_yyyy(raw)
            if issued_date:
                break
    if not issued_date:
        for label in [r"Issue\s+Date", r"Issued\s+Date", r"Date\s+Issued"]:
            raw = _label_neighbor(label)
            if raw:
                issued_date = _parse_mm_dd_yyyy(raw)
                if issued_date:
                    break

    # --- declared_value_usd ---
    declared_value_usd: Optional[float] = None
    for pat in ["lblDeclaredValuation", "lblJobValue", "lblProjectValue", "lblValuation"]:
        raw = _span_text(pat)
        if raw:
            cleaned = re.sub(r"[,$\s]", "", raw)
            try:
                declared_value_usd = float(cleaned)
                break
            except ValueError:
                pass
    if declared_value_usd is None:
        for label in [
            # LEECO live patterns (confirmed 2026-06-08 against COM2026-00865 / FNC2026-02222)
            r"Est\s+Const\.\s+Value",      # commercial alterations, new construction
            r"Construction\s+Value",        # residential fence, misc residential
            # Generic fallbacks for other Accela agency patterns
            r"Declared\s+Valuation",
            r"Job\s+Value",
            r"Project\s+Value",
            r"Valuation",
        ]:
            raw = _label_neighbor(label)
            if raw:
                cleaned = re.sub(r"[,$\s]", "", raw)
                try:
                    declared_value_usd = float(cleaned)
                    break
                except ValueError:
                    pass

    # --- permit_type_raw ---
    permit_type_raw: Optional[str] = (
        _span_text("lblPermitType")
        or _span_text("lblRecordType")
        or _span_text("lblType")
    )

    return {
        "issued_date": issued_date,
        "declared_value_usd": declared_value_usd,
        "permit_type_raw": permit_type_raw or "",
    }


# ---------------------------------------------------------------------------
# Live fetching — requires FIRECRAWL_API_KEY
# ---------------------------------------------------------------------------

_ACCELA_SEARCH_URL = (
    "https://aca-prod.accela.com/LEECO/Cap/CapHome.aspx"
    "?module=Permitting&TabName=Permitting"
)

# "Next >" pager link. Pager row structure (confirmed live 2026-06-06):
#   [ACA_Hide] [td.aca_pagination_PrevNext: < Prev] [td: 1][td: 2]...[td: ...]
#   [td.aca_pagination_PrevNext: Next >]
# "Next >" is always the last td in the row AND the last td.aca_pagination_PrevNext.
# href is always empty so text is not selectable via attribute; positional works.
_PAGER_NEXT_SELECTOR = "td.aca_pagination_PrevNext:last-child > a"

# Wait after clicking "Next >" before scraping (ms).
# Keep (13_000 + (page_count-1) * _PAGER_NEXT_WAIT_MS) < 60_000 — Firecrawl cap.
_PAGER_NEXT_WAIT_MS = 4000


def _base_search_actions(start_str: str, end_str: str) -> list[dict]:
    """Action sequence that fills and submits the Accela date-range search form."""
    return [
        {"type": "wait",  "selector": 'input[id$="txtGSStartDate"]'},
        {"type": "write", "text": start_str, "selector": 'input[id$="txtGSStartDate"]'},
        {"type": "write", "text": end_str,   "selector": 'input[id$="txtGSEndDate"]'},
        {"type": "wait",  "milliseconds": 1000},
        {"type": "click", "selector": "#ctl00_PlaceHolderMain_btnNewSearch"},
        {"type": "wait",  "milliseconds": 12000},
    ]


def _extract_html(resp: dict) -> str:
    """Pull HTML from a /v2/scrape REST response."""
    return (resp.get("data") or {}).get("html") or ""


def fetch_permit_pages(start_date: date, end_date: date) -> list[str]:
    """Live Firecrawl scrape — returns one HTML string per results page.

    Page 1: form-fill + search-click + wait + scrape.
    Page K (K > 1): same form re-submit then (click Next + wait) × (K-1) + scrape.

    Falls back gracefully if a page scrape fails (logs a warning, stops early).
    Requires FIRECRAWL_API_KEY in the environment.
    """
    import os

    if not os.environ.get("FIRECRAWL_API_KEY"):
        raise RuntimeError(
            "FIRECRAWL_API_KEY missing — invoke firecrawl-build-onboarding first"
        )

    if not log.handlers:
        logging.basicConfig(level=logging.INFO, format="[%(name)s] %(message)s")

    start_str = start_date.strftime("%m/%d/%Y")
    end_str   = end_date.strftime("%m/%d/%Y")
    log.info("fetching Lee Accela permits %s → %s", start_str, end_str)

    base_actions = _base_search_actions(start_str, end_str)

    # --- Page 1 ---
    resp       = scrape_with_actions(_ACCELA_SEARCH_URL, base_actions + [{"type": "scrape"}])
    page1_html = _extract_html(resp)
    log.info(
        "page 1: html_len=%d  has_grid=%s",
        len(page1_html),
        "gdvPermitList" in page1_html,
    )
    if "gdvPermitList" not in page1_html:
        raise RuntimeError(
            "Page 1 HTML has no gdvPermitList grid — form submission likely failed. "
            f"Preview: {page1_html[:400]!r}"
        )

    page_count = parse_page_count(page1_html)
    log.info("pagecount=%d", page_count)
    pages: list[str] = [page1_html]

    # --- Pages 2..N ---
    for page_num in range(2, page_count + 1):
        # Build (click Next + wait) repeated K-1 times to reach page K
        next_actions: list[dict] = []
        for _ in range(page_num - 1):
            next_actions.extend([
                {"type": "click", "selector": _PAGER_NEXT_SELECTOR},
                {"type": "wait",  "milliseconds": _PAGER_NEXT_WAIT_MS},
            ])

        actions = base_actions + next_actions + [{"type": "scrape"}]
        try:
            resp = scrape_with_actions(_ACCELA_SEARCH_URL, actions)
            html = _extract_html(resp)
            log.info(
                "page %d: html_len=%d  has_grid=%s",
                page_num,
                len(html),
                "gdvPermitList" in html,
            )
            if "gdvPermitList" not in html:
                log.warning("page %d has no grid — stopping early", page_num)
                break
            pages.append(html)
        except FirecrawlError as exc:
            log.warning("page %d fetch failed (%s) — stopping early", page_num, exc)
            break

    return pages


def enrich_rows_with_details(
    rows: list[PermitRow],
    *,
    max_workers: int = 10,
) -> list[PermitRow]:
    """Parallel-fetch each row's CapDetail.aspx URL and fill issued_date,
    declared_value_usd, permit_type_raw in place.

    Rows without cap_detail_url are skipped (already filtered TMP rows won't
    appear here). On fetch failure the row keeps its fallback values.
    """
    detail_targets = [(i, r.cap_detail_url) for i, r in enumerate(rows) if r.cap_detail_url]
    if not detail_targets:
        return rows

    log.info(
        "enriching %d/%d rows from CapDetail pages (workers=%d)",
        len(detail_targets),
        len(rows),
        max_workers,
    )

    def _fetch_one(idx: int, url: str) -> tuple[int, dict]:
        try:
            resp = scrape_with_actions(url, [], proxy="stealth", wait_for_ms=3000, timeout=60_000)
            html = _extract_html(resp)
            return idx, parse_cap_detail_html(html)
        except Exception as exc:
            log.warning("detail fetch failed idx=%d url=%s: %s", idx, url, exc)
            return idx, {}

    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        futures = {pool.submit(_fetch_one, i, url): i for i, url in detail_targets}
        for fut in as_completed(futures):
            idx, detail = fut.result()
            if detail.get("issued_date"):
                rows[idx].issued_date = detail["issued_date"]
            if detail.get("declared_value_usd") is not None:
                rows[idx].declared_value_usd = detail["declared_value_usd"]
            if detail.get("permit_type_raw"):
                rows[idx].permit_type_raw = detail["permit_type_raw"]

    return rows
