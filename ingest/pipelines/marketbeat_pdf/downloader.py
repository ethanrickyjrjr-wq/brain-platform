"""
Auto-download new MarketBeat PDF reports.

C&W MarketBeat (cpswfl.com):
  Scrapes the CPSWFL research page to find the latest industrial report PDF link.

Colliers International (colliers.com):
  Tries the known /media/files/ URL pattern (works for most historical quarters).
  Falls back to scraping the research page for a download link.
  Form-gated reports (newer quarters via cloud.usa.colliers.com) cannot be
  auto-downloaded; this function returns None and the caller creates a GH issue.
"""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

# Regex to match year/quarter from a URL slug or filename
_Q_IN_URL = re.compile(r"(\d{4})[_\-]?q([1-4])", re.IGNORECASE)
_Q_IN_SLUG = re.compile(r"q([1-4])[_\-]?(\d{4})", re.IGNORECASE)

_COLLIERS_MEDIA_PATTERN = (
    "https://www.colliers.com/-/media/files/unitedstates/markets/"
    "fort-myers/market-reports/{year}/industrial/"
    "sw-florida-industrial-market-report--{quarter_lower}.ashx"
    "?sc_lang=en"
)

_COLLIERS_RESEARCH_URL = (
    "https://www.colliers.com/en/research/ft-myers/"
    "southwest-fl-industrial-market-report-{quarter_lower}"
)

_CW_RESEARCH_URL = "https://www.cpswfl.com/research"

_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
)


def _curl_download(url: str, dest: Path, referer: str = "") -> bool:
    """Download url → dest via curl. Returns True on success (PDF-sized file)."""
    cmd = [
        "curl", "-sL", "-A", _UA,
        "-H", f"Referer: {referer or url}",
        "-o", str(dest),
        "-w", "%{http_code}|%{size_download}",
        url,
    ]
    try:
        out = subprocess.check_output(cmd, text=True, stderr=subprocess.DEVNULL)
    except subprocess.CalledProcessError:
        return False
    parts = out.strip().split("|")
    if len(parts) != 2:
        return False
    http, size = parts
    if http == "200" and int(size) > 50_000:
        return True
    dest.unlink(missing_ok=True)
    return False


def _firecrawl_scrape(url: str) -> str:
    """Scrape a URL and return raw HTML for PDF link extraction."""
    try:
        from ingest.lib.crawl4ai_client import fetch_page_html
        return fetch_page_html(url)
    except Exception:
        return ""


def _extract_pdf_url(html: str) -> str | None:
    """
    Look for a PDF link in scraped HTML.
    Returns the URL string or None.
    """
    # Direct .pdf or .ashx link
    m = re.search(r'href=["\']([^"\']*\.(?:pdf|ashx)[^"\']*)["\']', html, re.I)
    if m:
        url = m.group(1)
        if not url.startswith("http"):
            url = "https://www.colliers.com" + url
        return url
    # RelatedAsset= attribute (Colliers CMS)
    m = re.search(r"RelatedAsset=(https?://[^\"'<>\s]+)", html)
    if m:
        return m.group(1)
    return None


def _quarter_to_slug(quarter: str) -> str:
    """'2025-Q4' → '25q4'  (Colliers media URL style)"""
    m = re.match(r"(\d{4})-Q(\d)", quarter)
    if not m:
        return quarter.lower()
    return f"{m.group(1)[2:]}q{m.group(2)}"


def _quarter_to_colliers_slug(quarter: str) -> str:
    """'2025-Q4' → 'q4-2025'  (Colliers research page URL style)"""
    m = re.match(r"(\d{4})-Q(\d)", quarter)
    if not m:
        return quarter.lower()
    return f"q{m.group(2)}-{m.group(1)}"


def try_download_colliers(quarter: str, dest_dir: Path) -> Path | None:
    """
    Try to download the Colliers SWFL Industrial PDF for the given quarter.
    Returns the downloaded Path on success, None on failure.
    """
    m = re.match(r"(\d{4})-Q(\d)", quarter)
    if not m:
        return None
    year, qn = m.group(1), m.group(2)

    # Build destination filename
    dest = dest_dir / f"Colliers_Industrial_Q{qn}{year}_SWFL.pdf"
    if dest.exists():
        print(f"[colliers] already exists: {dest.name}", flush=True)
        return dest

    # Strategy 1: try the /media/files/ direct URL (works for older quarters)
    # Known pattern variants observed in actual URLs
    slug_variants = [
        f"--{year[2:]}q{qn}",
        f"_{year[2:]}q{qn}",
        f"--{year[2:]}q{qn.zfill(2)}",
        f"--{year}q{qn}",
    ]
    for slug in slug_variants:
        url = (
            f"https://www.colliers.com/-/media/files/unitedstates/markets/"
            f"fort-myers/market-reports/{year}/industrial/"
            f"sw-florida-industrial-market-report{slug}.ashx?sc_lang=en"
        )
        if _curl_download(url, dest, referer="https://www.colliers.com/"):
            print(f"[colliers] downloaded via media URL: {dest.name}", flush=True)
            return dest

    # Strategy 2: scrape the research page to find the actual media URL
    research_url = _COLLIERS_RESEARCH_URL.format(
        quarter_lower=_quarter_to_colliers_slug(quarter)
    )
    html = _firecrawl_scrape(research_url)
    if html:
        pdf_url = _extract_pdf_url(html)
        if pdf_url and "colliers.com" in pdf_url:
            if "cloud.usa.colliers.com" in pdf_url:
                print(
                    f"[colliers] Q{qn} {year} is form-gated "
                    f"(cloud.usa.colliers.com). Manual download required.",
                    flush=True,
                )
                return None
            if _curl_download(pdf_url, dest, referer=research_url):
                print(f"[colliers] downloaded via scraped URL: {dest.name}", flush=True)
                return dest

    print(
        f"[colliers] could not auto-download Q{qn} {year}. "
        "Page may be deleted or form-gated.",
        flush=True,
    )
    return None


def try_download_cw(quarter: str, dest_dir: Path) -> Path | None:
    """
    Try to download the C&W MarketBeat SWFL Industrial PDF for the given quarter.
    Scrapes cpswfl.com/research to find the latest PDF link.
    Returns the downloaded Path on success, None on failure.
    """
    m = re.match(r"(\d{4})-Q(\d)", quarter)
    if not m:
        return None
    year, qn = m.group(1), m.group(2)

    dest = dest_dir / f"MarketBeat_Industrial_Q{qn}{year}_FortMyers_Naples.pdf"
    if dest.exists():
        print(f"[cw] already exists: {dest.name}", flush=True)
        return dest

    # Scrape the research page for a PDF link matching this quarter
    html = _firecrawl_scrape(_CW_RESEARCH_URL)
    if not html:
        print(f"[cw] could not scrape {_CW_RESEARCH_URL}", flush=True)
        return None

    # Look for a PDF link whose URL suggests this quarter
    q_pattern = re.compile(
        rf"Q{qn}.*{year}|{year}.*Q{qn}|Q{qn}{year[2:]}|{year[2:]}Q{qn}", re.I
    )
    for m_url in re.finditer(r'href=["\']([^"\']*\.pdf[^"\']*)["\']', html, re.I):
        url = m_url.group(1)
        if q_pattern.search(url):
            if not url.startswith("http"):
                url = "https://www.cpswfl.com" + url
            if _curl_download(url, dest, referer=_CW_RESEARCH_URL):
                print(f"[cw] downloaded: {dest.name}", flush=True)
                return dest

    print(f"[cw] could not find Q{qn} {year} PDF on cpswfl.com", flush=True)
    return None


if __name__ == "__main__":
    # Quick test: python -m ingest.pipelines.marketbeat_pdf.downloader 2025-Q4
    import sys
    q = sys.argv[1] if len(sys.argv) > 1 else "2025-Q4"
    drop_dir = Path("ingest/drops/marketbeat_pdf")
    drop_dir.mkdir(parents=True, exist_ok=True)
    result = try_download_colliers(q, drop_dir)
    print(f"Colliers: {result}")
    result = try_download_cw(q, drop_dir)
    print(f"C&W: {result}")
