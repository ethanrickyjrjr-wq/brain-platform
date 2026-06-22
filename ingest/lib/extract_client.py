"""Extraction layer — crawl4ai is the live scraper; Firecrawl/Spider are dormant.

scrape_with_fallback()  — plain page→markdown:    crawl4ai (primary, live) → spider → firecrawl
extract()               — AI structured rows:     crawl4ai stealth fetch → BeautifulSoup strip
                          → Anthropic Haiku JSON (generalizes the proven crexi DIY pattern)

crawl4ai is the ONLY live scraper (operator decree 2026-06-16): it runs locally (no API
credits) and handles JS-rendered pages. Spider and Firecrawl remain only as DORMANT paid
fallbacks for scrape_with_fallback() — each gated on its API key (SPIDER_API_KEY /
FIRECRAWL_API_KEY, both unset); `firecrawl-py` is not a dependency. Neither fires today.

extract() was rewired off the inert firecrawl-primary path (2026-06-20, check
crawl4ai_native_extract_rewire). It now mirrors ingest/pipelines/crexi_listings/extract.py:
fetch → strip → Haiku → json.loads → {rows}, with token-aware chunking (no silent truncation)
instead of the old [:28000] cut. Decision: generalize the crexi pattern rather than crawl4ai's
LLMExtractionStrategy (which would add a litellm dep + model-drift + invalid-JSON risk for no
stealth gain — see docs/audit/2026-06-20-crawl4ai/research.md C1). LLMExtractionStrategy stays
opt-in for genuinely nested/knowledge-graph schemas. STILL OPEN: a live Crexi battle-test
before closing the check.

Contract (preserved so existing callers keep working):
    extract(prompt, *, urls=[...], schema={...}, model="claude-haiku-...") -> dict
    Response shape: {"status": "completed", "data": {"rows": [...]}, "_provenance": [...]}
    firecrawl-era kwargs (max_credits / strict_constrain_to_urls / poll_interval) are inert.
"""
from __future__ import annotations

import asyncio
import json
import os
from typing import Any, Iterable, Optional

from bs4 import BeautifulSoup

from ingest.lib.crawl4ai_client import Crawl4aiError, fetch_many, fetch_page_markdown
from ingest.lib.firecrawl_client import FirecrawlError, scrape as firecrawl_scrape
from ingest.lib.spider_client import SpiderError, scrape as spider_scrape


class ExtractError(RuntimeError):
    """Raised when every vendor returned zero rows AND at least one errored.

    The exception message itemizes each vendor + URL + error so the operator
    knows exactly which URLs need auditing.
    """


# Chunk size for the LLM call — ~24k chars (~6k tokens) leaves Haiku room for the
# instruction + JSON output. Replaces the old silent [:28000] truncation: long pages are
# split on paragraph boundaries and each chunk is extracted, then rows are merged.
_CHUNK_CHARS = 24_000

_STRIP_TAGS = ["script", "style", "svg", "noscript", "meta", "link", "header", "footer", "nav"]


def _strip_html(html: str) -> str:
    """Drop scripts/styles/chrome and return readable page text (mirrors crexi)."""
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(_STRIP_TAGS):
        tag.decompose()
    return soup.get_text(separator="\n", strip=True)


_OVERLAP_FRAC = 0.1  # carry ~10% of the prior chunk's tail so a boundary-straddling row survives


def _chunk_text(text: str, *, size: int = _CHUNK_CHARS, overlap: float = _OVERLAP_FRAC) -> list[str]:
    """Split on paragraph boundaries; carry an ~overlap tail into the next chunk so a record
    straddling a boundary appears whole in at least one chunk. No truncation. Duplicate rows the
    overlap introduces are removed at merge by _dedup_rows."""
    if len(text) <= size:
        return [text]
    overlap_chars = int(size * overlap)
    chunks: list[str] = []
    cur: list[str] = []
    cur_len = 0
    for para in text.split("\n"):
        if cur and cur_len + len(para) + 1 > size:
            chunks.append("\n".join(cur))
            # seed the next chunk with the trailing paragraphs (~overlap_chars) of the flushed one
            tail: list[str] = []
            tail_len = 0
            for p in reversed(cur):
                if tail_len + len(p) + 1 > overlap_chars:
                    break
                tail.insert(0, p)
                tail_len += len(p) + 1
            cur, cur_len = list(tail), tail_len
        cur.append(para)
        cur_len += len(para) + 1
    if cur:
        chunks.append("\n".join(cur))
    return chunks


def _dedup_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Drop exact-duplicate row dicts introduced by chunk overlap, preserving order."""
    seen: set[str] = set()
    out: list[dict[str, Any]] = []
    for r in rows:
        key = json.dumps(r, sort_keys=True, default=str)
        if key not in seen:
            seen.add(key)
            out.append(r)
    return out


def _build_instruction(prompt: str, schema: Optional[dict[str, Any]]) -> str:
    base = prompt.strip()
    if schema:
        base += "\n\nSchema (fields to extract per row):\n" + json.dumps(schema)
    base += (
        '\n\nReturn ONLY valid JSON with a single key: {"rows": [...]}. '
        'No markdown fences. If nothing matches, return {"rows": []}.'
    )
    return base


def _parse_rows(raw: str) -> list[dict[str, Any]]:
    """Defensive JSON parse lifted from crexi: strip accidental fences, never throw."""
    raw = raw.strip()
    if "```" in raw:
        parts = raw.split("```")
        raw = parts[1] if len(parts) > 1 else parts[0]
        if raw.startswith("json"):
            raw = raw[4:]
    try:
        data = json.loads(raw)
    except (json.JSONDecodeError, AttributeError):
        return []
    rows = data.get("rows", []) if isinstance(data, dict) else []
    return [r for r in rows if isinstance(r, dict)]


def _llm_extract_rows(
    prompt: str,
    text: str,
    *,
    schema: Optional[dict[str, Any]],
    model: str,
) -> list[dict[str, Any]]:
    """Anthropic Haiku structured extraction, chunk-and-merge for long pages."""
    import anthropic

    client = anthropic.Anthropic()  # reads ANTHROPIC_API_KEY from env
    instruction = _build_instruction(prompt, schema)
    rows: list[dict[str, Any]] = []
    for chunk in _chunk_text(text):
        msg = client.messages.create(
            model=model,
            max_tokens=4096,
            temperature=0,
            messages=[{"role": "user", "content": f"{instruction}\n\nPage text:\n{chunk}"}],
        )
        rows.extend(_parse_rows(msg.content[0].text))
    return _dedup_rows(rows)


def extract(
    prompt: str,
    *,
    urls: Iterable[str],
    schema: Optional[dict[str, Any]] = None,
    model: str = "claude-haiku-4-5-20251001",
    max_credits: int = 1000,  # firecrawl-era kwargs kept for signature compat; now inert
    strict_constrain_to_urls: bool = False,  # inert
    poll_interval: int = 2,  # inert
    timeout: int = 480,  # inert — firecrawl-era job-budget; per-page timeout is fixed at 75 s below
) -> dict[str, Any]:
    """crawl4ai-native structured extraction — generalizes the proven crexi DIY pattern.

    Per URL: stealth-fetch HTML (fetch_many / UndetectedAdapter) → BeautifulSoup strip →
    token-aware chunk → Anthropic Haiku JSON extraction → merge rows. Returns the
    firecrawl-compatible shape so existing callers keep working:

        {"status": "completed", "data": {"rows": [...]}, "_provenance": [...]}

    Raises ExtractError only when EVERY url errored AND zero rows were produced. A URL that
    is reachable but holds no matching rows yields an empty result (not an error) — the
    caller decides whether empty is fatal.

    The legacy firecrawl-primary path is gone (crawl4ai-only decree 2026-06-16). The old
    firecrawl-era kwargs (max_credits / strict_constrain_to_urls / poll_interval) are
    accepted but inert so existing call sites don't break. `model` is an Anthropic model id.
    """
    url_list = list(urls)
    if not url_list:
        return {"status": "completed", "data": {"rows": []}, "_provenance": []}

    if not os.environ.get("ANTHROPIC_API_KEY"):
        raise ExtractError("ANTHROPIC_API_KEY not set — crawl4ai-native extract() requires it")

    # 1. Stealth-fetch all URLs in parallel (dispatcher-hardened fetch_many).
    try:
        htmls = asyncio.run(fetch_many(url_list, timeout=75_000))  # 75 s/page in ms; legacy `timeout` is inert
    except Crawl4aiError as exc:
        raise ExtractError(f"crawl4ai fetch failed for all urls: {exc}") from exc

    provenance: list[dict[str, Any]] = []
    rows: list[dict[str, Any]] = []
    errors: list[tuple[str, str]] = []

    # fetch_many keys by the crawler-resolved url; iterate what came back.
    for url, html in htmls.items():
        if not html:
            errors.append((url, "empty html (fetch failed or blocked)"))
            provenance.append({"vendor": "crawl4ai", "url": url, "rows": 0, "ok": False,
                               "error": "empty html"})
            continue
        try:
            url_rows = _llm_extract_rows(prompt, _strip_html(html), schema=schema, model=model)
        except Exception as exc:  # LLM / parsing failure for this url
            errors.append((url, f"llm extract: {exc}"))
            provenance.append({"vendor": "crawl4ai", "url": url, "rows": 0, "ok": False,
                               "error": str(exc)})
            continue
        provenance.append({"vendor": "crawl4ai", "url": url, "rows": len(url_rows), "ok": True})
        rows.extend(url_rows)

    if rows:
        return {"status": "completed", "data": {"rows": rows}, "_provenance": provenance}

    if errors:
        details = "\n  - ".join(f"{u}: {e}" for u, e in errors)
        raise ExtractError(
            f"crawl4ai-native extract produced zero rows. Per-URL failures:\n  - {details}"
        )

    # Reachable but no matching rows — not an error (caller decides).
    return {"status": "completed", "data": {"rows": []}, "_provenance": provenance}


def scrape_with_fallback(
    url: str,
    *,
    only_main_content: bool = True,
    formats: Iterable[str] = ("markdown",),
) -> dict[str, Any]:
    """Plain page-to-markdown: crawl4ai primary → spider fallback → firecrawl last-resort.

    Response shape (firecrawl-/v2/scrape-compatible):
        {
          "data": {"markdown": "...", "metadata": {}},
          "_provenance": [{"vendor": "crawl4ai"|"spider"|"firecrawl", "url": "...", ...}],
        }
    """
    provenance: list[dict[str, Any]] = []

    # ── 1. crawl4ai primary (no API credits) ───────────────────────────────
    c4_error: Optional[str] = None
    try:
        md = fetch_page_markdown(url)
        provenance.append({"vendor": "crawl4ai", "url": url, "ok": True, "bytes": len(md)})
        if md:
            return {"data": {"markdown": md, "metadata": {}}, "_provenance": provenance}
        provenance[-1]["ok"] = False
        provenance[-1]["reason"] = "empty markdown"
    except Crawl4aiError as exc:
        c4_error = str(exc)
        provenance.append({"vendor": "crawl4ai", "url": url, "ok": False, "error": c4_error})

    # ── 2. Spider fallback ──────────────────────────────────────────────────
    if os.environ.get("SPIDER_API_KEY"):
        spider_error: Optional[str] = None
        try:
            sp_response = spider_scrape(url)
            sp_data = sp_response.get("data", {}) if isinstance(sp_response, dict) else {}
            sp_markdown = sp_data.get("markdown", "") if isinstance(sp_data, dict) else ""
            provenance.append({"vendor": "spider", "url": url, "ok": True, "bytes": len(sp_markdown)})
            if sp_markdown:
                return {"data": sp_data, "_provenance": provenance}
        except SpiderError as exc:
            spider_error = str(exc)
            provenance.append({"vendor": "spider", "url": url, "ok": False, "error": spider_error})

    # ── 3. Firecrawl last-resort ────────────────────────────────────────────
    if os.environ.get("FIRECRAWL_API_KEY"):
        fc_error: Optional[str] = None
        try:
            fc_response = firecrawl_scrape(url, formats=formats, only_main_content=only_main_content)
            fc_data = fc_response.get("data", fc_response) if isinstance(fc_response, dict) else {}
            fc_markdown = fc_data.get("markdown", "") if isinstance(fc_data, dict) else ""
            provenance.append({"vendor": "firecrawl", "url": url, "ok": True, "bytes": len(fc_markdown)})
            if fc_markdown:
                return {"data": fc_data, "_provenance": provenance}
        except FirecrawlError as exc:
            fc_error = str(exc)
            provenance.append({"vendor": "firecrawl", "url": url, "ok": False, "error": fc_error})

    # ── 4. All vendors empty or errored ────────────────────────────────────
    errors = [e["error"] for e in provenance if not e.get("ok") and "error" in e]
    if errors:
        raise ExtractError(f"All vendors failed for {url}. " + "; ".join(errors))
    return {"data": {"markdown": "", "metadata": {}}, "_provenance": provenance}
