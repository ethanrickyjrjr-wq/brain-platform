"""Thin spider.cloud client used as the fallback vendor for /ai/scrape.

Spider is our second extraction vendor. It exists in this codebase for one
reason: when firecrawl's /v2/agent silently returns `data=null` on a completed
job, spider's /ai/scrape returns either real rows or a structured HTTP error
(e.g. 404 on dead URLs, 525 on anti-bot blocks). That visibility is the whole
point of having a fallback — silent empty rows is the trap that wasted three
sessions.

Vendor contract verified in-session 2026-05-26:
    POST https://api.spider.cloud/ai/scrape
    Auth: Authorization: Bearer sk-...
    Body (subset we use):
        url                : string  (required — single URL per call)
        prompt             : string  (required — natural-language extraction goal)
        extraction_schema  : object  ({name, description, schema: JSON-encoded string, strict: bool})

The response body shape is **undocumented** in the public OpenAPI spec — we
parse defensively (`extract_rows()` walks common locations) and the smoke
script at `scripts/firecrawl_agent_smoke.py --vendor=spider` is how we
confirm the live shape per call.

Env: SPIDER_API_KEY — repo secret + local .env.local.
"""
from __future__ import annotations

import json
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


def _post(path: str, body: dict[str, Any], *, max_attempts: int = 3) -> dict[str, Any]:
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
        raise SpiderError(
            f"{path} returned {resp.status_code}: {resp.text[:500]}"
        )
    raise SpiderError(f"{path}: exhausted retries — last response: {last_text[:500]}")


def ai_scrape(
    prompt: str,
    *,
    url: str,
    schema: Optional[dict[str, Any]] = None,
    schema_name: str = "extraction",
    schema_description: str = "Structured extraction matching the provided JSON schema.",
    cleaning_intent: str = "extraction",
) -> dict[str, Any]:
    """Run spider.cloud /ai/scrape against a single URL.

    Spider's structured-output contract takes `extraction_schema.schema` as a
    JSON-encoded **string**, not a JSON object — same shape OpenAI uses for
    response_format. We do the encode here so callers can pass a plain dict.

    Returns the raw response body as a dict. Use `extract_rows()` to pull the
    rows array out — response shape is undocumented so the path walk is
    defensive.
    """
    body: dict[str, Any] = {
        "url": url,
        "prompt": prompt,
        "cleaning_intent": cleaning_intent,
    }
    if schema is not None:
        body["extraction_schema"] = {
            "name": schema_name,
            "description": schema_description,
            "schema": json.dumps(schema),
            "strict": True,
        }
    return _post("/ai/scrape", body)


def extract_rows(
    response: dict[str, Any],
    *,
    rows_key: str = "rows",
) -> list[dict[str, Any]]:
    """Pull rows out of a spider /ai/scrape response — defensive path walk.

    The response shape is undocumented in spider's public OpenAPI spec; we try
    every reasonable location and return the first list we find at `rows_key`.
    If the smoke script confirms a single canonical path, this function should
    be tightened to that path (and the legacy fallbacks kept as a defensive net).

    Returns [] when no rows are found at any path. Callers decide whether
    empty is fatal.
    """
    if not isinstance(response, dict):
        return []
    # Candidate containers, ordered most-likely → least-likely. Each is either a
    # dict (look up rows_key) or a list (assume it IS the rows array).
    candidates: list[Any] = [
        response.get("extraction"),
        response.get("data"),
        response.get("result"),
        response.get("output"),
        response.get("content"),
        response,  # top-level: response may itself be the schema-shaped object
    ]
    for cand in candidates:
        if isinstance(cand, dict):
            rows = cand.get(rows_key)
            if isinstance(rows, list):
                return rows
        if isinstance(cand, list):
            # Tolerate the case where the API returns the rows array directly.
            return cand
    return []
