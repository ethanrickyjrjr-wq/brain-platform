"""Thin spider.cloud client used as the fallback vendor for /ai/scrape.

Spider is our second extraction vendor. It exists in this codebase for one
reason: when firecrawl's /v2/agent silently returns `data=null` on a completed
job, spider's /ai/scrape returns either real rows or a structured HTTP error
(e.g. 404 on dead URLs, 525 on anti-bot blocks). That visibility is the whole
point of having a fallback — silent empty rows is the trap that wasted three
sessions.

Vendor contract verified in-session 2026-05-26 (against spider.cloud/openapi.yaml):
    POST https://api.spider.cloud/ai/scrape
    Auth: Authorization: Bearer sk-...
    Body (allOf RequestParams + AIRequestExtras — subset we use):
        url                : string   (required — single URL per call)
        prompt             : string   (required — natural-language extraction goal)
        extraction_schema  : object   (plain JSON Schema describing desired shape)
        cleaning_intent    : enum     ("extraction" | "action" | "general")
        stealth            : boolean  (top-level RequestParams flag)
        anti_bot           : boolean  (top-level RequestParams flag)
        proxy_enabled      : boolean  (top-level RequestParams flag)

    NOTE: `extraction_schema` is a raw JSON Schema **object** — NOT the
    OpenAI-style `{name, description, schema: JSON-string, strict: bool}`
    wrapper. An earlier draft of this client sent that shape; spider returned
    HTTP 400 with empty body. Fixed 2026-05-26 after re-reading the openapi.

The response body shape is **undocumented** in the public OpenAPI spec — we
parse defensively (`extract_rows()` walks common locations) and the smoke
script at `scripts/firecrawl_agent_smoke.py --vendor=spider` is how we
confirm the live shape per call.

Env: SPIDER_API_KEY — repo secret + local .env.local.
"""
from __future__ import annotations

import os
import time
from typing import Any, Optional

import requests


_BASE = "https://api.spider.cloud"
_DEFAULT_TIMEOUT_SECONDS = 180


class SpiderError(RuntimeError):
    """Raised when spider returns a non-2xx or a body that we cannot parse."""


def _api_key() -> str:
    key = os.environ.get("SPIDER_API_KEY")
    if not key:
        raise SpiderError(
            "SPIDER_API_KEY not set — add it to GitHub Actions repo secrets "
            "and to local .env.local. Spider is the fallback vendor for /ai/scrape."
        )
    return key


def _post(path: str, body: dict[str, Any], *, max_attempts: int = 3) -> Any:
    url = f"{_BASE}{path}"
    headers = {
        "Authorization": f"Bearer {_api_key()}",
        "Content-Type": "application/json",
    }
    last_text = ""
    for attempt in range(max_attempts):
        try:
            resp = requests.post(
                url, json=body, headers=headers, timeout=_DEFAULT_TIMEOUT_SECONDS
            )
        except (requests.Timeout, requests.ConnectionError) as exc:
            last_text = repr(exc)
            if attempt < max_attempts - 1:
                time.sleep(5 * (attempt + 1))
                continue
            raise SpiderError(f"{path}: network error after retries — {exc}")
        if resp.status_code < 400:
            try:
                return resp.json()
            except ValueError as exc:
                raise SpiderError(
                    f"{path} returned 2xx but body was not JSON — {exc}; head={resp.text[:300]!r}"
                ) from exc
        last_text = resp.text
        if resp.status_code >= 500 or resp.status_code == 429:
            if attempt < max_attempts - 1:
                time.sleep(10 * (attempt + 1))
                continue
        # Surface a useful diagnostic even when the response body is empty —
        # spider returns bare HTTP 400s on malformed bodies, and a quiet
        # "returned 400: " message wastes operator time.
        body_excerpt = resp.text[:500] if resp.text else "<empty body>"
        body_keys: list[str] = []
        try:
            parsed = resp.json()
            if isinstance(parsed, dict):
                body_keys = list(parsed.keys())[:8]
        except ValueError:
            pass
        keys_hint = f" (parsed keys: {body_keys})" if body_keys else ""
        raise SpiderError(
            f"{path} returned {resp.status_code}: {body_excerpt}{keys_hint} | "
            f"request body keys={list(body.keys())}"
        )
    raise SpiderError(f"{path}: exhausted retries — last response: {last_text[:500]}")


def ai_scrape(
    prompt: str,
    *,
    url: str,
    schema: Optional[dict[str, Any]] = None,
    cleaning_intent: str = "extraction",
    stealth: bool = True,
    anti_bot: bool = True,
    proxy_enabled: bool = True,
) -> list[dict[str, Any]]:
    """Run spider.cloud /ai/scrape against a single URL.

    Returns the response as a list of result objects — spider returns an
    array even for single-URL calls. Use `extract_rows()` to pull the rows
    out of `metadata.extracted_data` (the canonical extraction path,
    confirmed live 2026-05-26).

    `schema` is currently a no-op. Spider's `/ai/scrape` accepts
    `extraction_schema` per its OpenAPI spec but rejects every JSON Schema
    we send with HTTP 400 (empty body, no diagnostic). The live MCP server
    omits `extraction_schema` entirely and relies on the natural-language
    prompt to shape extraction — we do the same here. Kept as a parameter
    so the caller signature stays stable; revisit if spider publishes a
    working schema example.

    The `stealth` / `anti_bot` / `proxy_enabled` flags are RequestParams that
    spider's /unblocker endpoint enables behind the scenes — setting them on
    /ai/scrape directly does the unblock-then-extract in one round-trip, which
    is what we want for the 525-blocked broker pages in our pipelines. Defaults
    are aggressive (all-on) because the only callers today are pipelines that
    have already had firecrawl fail; we are in last-resort territory.
    """
    body: dict[str, Any] = {
        "url": url,
        "prompt": prompt,
        "cleaning_intent": cleaning_intent,
        "stealth": stealth,
        "anti_bot": anti_bot,
        "proxy_enabled": proxy_enabled,
    }
    # NOTE: `schema` intentionally NOT forwarded — see docstring.
    _ = schema
    response = _post("/ai/scrape", body)
    # Spider returns a list for /ai/scrape even when there's one URL.
    if isinstance(response, dict):
        return [response]
    return response if isinstance(response, list) else []


def scrape(
    url: str,
    *,
    return_format: str = "markdown",
    proxy_enabled: bool = True,
    request: str = "smart",
    stealth: bool = True,
    timeout_ms: Optional[int] = None,
) -> dict[str, Any]:
    """Run spider.cloud /scrape against a single URL — plain markdown/raw fetch.

    This is the fallback target for plain `firecrawl_client.scrape()`. It is
    NOT a replacement for /ai/scrape (which is LLM-extraction); use ai_scrape()
    for that.

    Vendor contract (spider.cloud/openapi.yaml, RequestParams shape):
        POST https://api.spider.cloud/scrape
        Body (subset we use):
            url             : str   (required)
            return_format   : str   ("markdown" | "raw" | "text" | "html2text" | ...)
            proxy_enabled   : bool  (1.5x cost; needed for blocked pages)
            request         : str   ("http" | "chrome" | "smart" — default "smart")
            stealth         : bool  (fingerprint detection bypass)
            request_timeout : int   (ms — passed through when set)

    Response shape (verified via WebFetch against spider.cloud openapi):
        {"result": "<formatted page content as string>"}

    We normalize this into a firecrawl-/v2/scrape-compatible shape so
    `extract_client.scrape_with_fallback()` callers can read
    `response["data"]["markdown"]` regardless of which vendor served the URL:

        {"data": {"markdown": "<page>", "metadata": {}}}

    Metadata is intentionally empty — spider's /scrape does not surface
    title / publishedTime fields the way firecrawl /v2/scrape does. Callers
    that depend on metadata should treat absence as "spider served this URL"
    and accept the degraded experience (better than zero rows).
    """
    body: dict[str, Any] = {
        "url": url,
        "return_format": return_format,
        "proxy_enabled": proxy_enabled,
        "request": request,
        "stealth": stealth,
    }
    if timeout_ms is not None:
        body["request_timeout"] = timeout_ms

    response = _post("/scrape", body)
    # Spider /scrape returns {"result": "..."} per the openapi spec. Be
    # defensive: a 2xx with an unexpected shape gets normalized to empty
    # markdown so callers see the "vendor returned no rows" path, not a
    # KeyError.
    markdown = ""
    if isinstance(response, dict):
        result = response.get("result")
        if isinstance(result, str):
            markdown = result
        # Some spider responses (when return_format is a list) wrap content
        # by format key. Tolerate that too.
        elif isinstance(result, dict):
            for key in (return_format, "markdown", "text", "raw"):
                value = result.get(key)
                if isinstance(value, str):
                    markdown = value
                    break
    return {
        "data": {
            "markdown": markdown,
            "metadata": {},
        },
        "_raw": response,
    }


def download_binary(
    url: str,
    *,
    request: str = "http",
    stealth: bool = True,
    proxy_enabled: bool = True,
) -> bytes:
    """Download a binary file (xlsx / pdf / zip) through Spider's residential proxy.

    WHY this exists: some county/vendor file servers sit behind an Akamai/Cloudflare
    bot-wall that blocks a plain `requests.get` by TLS/HTTP fingerprint — from
    datacenter AND residential IPs alike (verified 2026-06-14 against the Collier
    permits xlsx: a clean curl 403s from a home IP, identical to the GitHub runner).
    Spider's residential proxy + `stealth` clears the wall.

    `return_format="bytes"` returns the response body as a JSON array of byte values
    (0-255) — lossless. Do NOT use `return_format="raw"` (text-decodes the bytes and
    corrupts the binary) or `request="chrome"/"smart"` (wraps the file in an HTML
    viewer page). Only `request="http"` + `return_format="bytes"` round-trips a
    binary intact (verified live: a 901,189-byte xlsx, openpyxl-parseable).

    There is intentionally NO Firecrawl-primary fallback here (unlike
    `scrape_with_fallback`): Firecrawl's scrape API has no raw-bytes format
    (verified against its docs 2026-06-14), so it cannot return a binary file.

    Returns the raw file bytes. Raises `SpiderError` on a transport error, an
    upstream status >= 400, or a missing / non-list / empty content payload.
    """
    body: dict[str, Any] = {
        "url": url,
        "request": request,
        "return_format": "bytes",
        "stealth": stealth,
        "proxy_enabled": proxy_enabled,
    }
    # NOTE: do not forward a request_timeout here — Spider types it as a u8
    # (0-255), NOT milliseconds; passing ms (e.g. 120000) returns HTTP 400
    # "expected u8". The _post() HTTP-level timeout (180s) bounds the call.
    response = _post("/scrape", body)
    # Spider returns a list of result objects even for a single URL.
    items = response if isinstance(response, list) else [response]
    if not items or not isinstance(items[0], dict):
        raise SpiderError(
            f"/scrape(bytes): unexpected response shape for {url} "
            f"(got {type(response).__name__})"
        )
    elem = items[0]

    upstream = elem.get("status")
    if isinstance(upstream, int) and upstream >= 400:
        raise SpiderError(
            f"/scrape(bytes): upstream returned {upstream} for {url} "
            f"(error={elem.get('error')!r}) — the bot-wall proxy did not clear it."
        )

    content = elem.get("content")
    if not isinstance(content, list) or not content:
        # A non-list content means the proxy fell back to a rendered page
        # (chrome/smart) or the fetch failed — either way it is not the file.
        head = repr(content)[:120] if content is not None else "None"
        raise SpiderError(
            f"/scrape(bytes): expected a non-empty byte list for {url}, got "
            f"{type(content).__name__} (head={head}, error={elem.get('error')!r})"
        )
    try:
        return bytes(content)
    except (ValueError, TypeError) as exc:
        raise SpiderError(
            f"/scrape(bytes): content was not a valid 0-255 byte array for {url} — {exc}"
        ) from exc


def extract_rows(
    response: Any,
    *,
    rows_key: str = "rows",
) -> list[dict[str, Any]]:
    """Pull rows out of a spider /ai/scrape response.

    Live response shape (verified 2026-05-26 via spider MCP server):

        [{"status": 200, "metadata": {"extracted_data": {...}}, ...}]

    `metadata.extracted_data` is the canonical home of the LLM's output. It
    may be a dict matching the prompt's requested shape, or a list if the
    prompt asked for an array. We try `extracted_data[rows_key]` first,
    then `extracted_data` itself if it's a list.

    Defensive fallbacks (legacy paths kept in case spider's response shape
    drifts) handle the case where the array element is a dict and the rows
    live under `extraction`/`data`/`result`/`output`/`content`.

    Returns [] when no rows are found at any path.
    """
    # Spider returns a list — walk every result element looking for rows.
    items = response if isinstance(response, list) else [response]
    out: list[dict[str, Any]] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        metadata = item.get("metadata")
        if isinstance(metadata, dict):
            extracted = metadata.get("extracted_data")
            if isinstance(extracted, dict):
                rows = extracted.get(rows_key)
                if isinstance(rows, list):
                    out.extend(r for r in rows if isinstance(r, dict))
                    continue
                # Single-object extracted_data — treat as one row.
                out.append(extracted)
                continue
            if isinstance(extracted, list):
                out.extend(r for r in extracted if isinstance(r, dict))
                continue
        # Defensive legacy paths — used only if metadata.extracted_data is absent.
        for cand in (
            item.get("extraction"),
            item.get("data"),
            item.get("result"),
            item.get("output"),
            item.get("content"),
        ):
            if isinstance(cand, dict):
                rows = cand.get(rows_key)
                if isinstance(rows, list):
                    out.extend(r for r in rows if isinstance(r, dict))
                    break
            elif isinstance(cand, list):
                out.extend(r for r in cand if isinstance(r, dict))
                break
    return out
