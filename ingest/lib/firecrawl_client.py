"""Thin Firecrawl REST client used by GitHub Actions ingest jobs.

Direct calls to /v2/agent + /v2/scrape via `requests` — avoids firecrawl-py
SDK version drift. The agent body schema was verified against live Firecrawl
docs (2026-05-25); see plan notes in
docs/superpowers/plans/2026-05-25-firecrawl-pipeline-skeleton/README.md.

Env: FIRECRAWL_API_KEY — same key the SDK clients use; set in GitHub Actions
repo secrets.
"""
from __future__ import annotations

import os
import time
from typing import Any, Iterable, Optional

import requests


_BASE = "https://api.firecrawl.dev"
_DEFAULT_TIMEOUT_SECONDS = 180


class FirecrawlError(RuntimeError):
    """Raised when Firecrawl returns a non-2xx response after retries."""


def _api_key() -> str:
    key = os.environ.get("FIRECRAWL_API_KEY")
    if not key:
        raise FirecrawlError(
            "FIRECRAWL_API_KEY not set — add it to GitHub Actions repo secrets."
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
            raise FirecrawlError(f"{path}: network error after retries — {exc}")
        if resp.status_code < 400:
            return resp.json()
        last_text = resp.text
        # Retry on 5xx + 429; surface 4xx immediately.
        if resp.status_code >= 500 or resp.status_code == 429:
            if attempt < max_attempts - 1:
                time.sleep(10 * (attempt + 1))
                continue
        raise FirecrawlError(
            f"{path} returned {resp.status_code}: {resp.text[:500]}"
        )
    raise FirecrawlError(f"{path}: exhausted retries — last response: {last_text[:500]}")


def agent(
    prompt: str,
    *,
    urls: Optional[Iterable[str]] = None,
    schema: Optional[dict[str, Any]] = None,
    model: str = "spark-1-mini",
    max_credits: int = 1000,
    strict_constrain_to_urls: bool = False,
) -> dict[str, Any]:
    """POST /v2/agent — autonomous extraction with optional structured output.

    Returns the parsed JSON response. The agent's structured output sits at
    `response["data"]["result"]` for schema-driven calls. Callers should defend
    against shape drift (older API responses sometimes used `result` at the
    top level).
    """
    body: dict[str, Any] = {
        "prompt": prompt,
        "model": model,
        "maxCredits": max_credits,
    }
    if urls is not None:
        body["urls"] = list(urls)
    if schema is not None:
        body["schema"] = schema
    if strict_constrain_to_urls:
        body["strictConstrainToURLs"] = True
    return _post("/v2/agent", body)


def scrape(
    url: str,
    *,
    formats: Iterable[str] = ("markdown",),
    only_main_content: bool = True,
) -> dict[str, Any]:
    """POST /v2/scrape — single-URL extract to markdown / HTML / etc."""
    body = {
        "url": url,
        "formats": list(formats),
        "onlyMainContent": only_main_content,
    }
    return _post("/v2/scrape", body)


def scrape_with_actions(
    url: str,
    actions: list[dict[str, Any]],
    *,
    proxy: str = "stealth",
    formats: Iterable[str] = ("html",),
    wait_for_ms: int = 5000,
    timeout: int = 180_000,
) -> dict[str, Any]:
    """POST /v2/scrape with an actions array, proxy support, and configurable timeout.

    Used by pipelines that need browser automation (clicks, form fills) and/or
    stealth proxy — features the firecrawl-py SDK lacks via its CLI flag surface.
    Pass actions=[] for a plain stealth scrape of a direct URL.

    Response shape: {"success": True, "data": {"html": "...", "metadata": {...}}}
    Extract HTML with: response["data"]["html"]
    """
    body: dict[str, Any] = {
        "url": url,
        "formats": list(formats),
        "proxy": proxy,
        "waitFor": wait_for_ms,
        "timeout": timeout,
        "actions": actions,
    }
    return _post("/v2/scrape", body)


def extract_agent_rows(
    response: dict[str, Any],
    *,
    rows_key: str = "rows",
) -> list[dict[str, Any]]:
    """Pull the rows array out of an /v2/agent structured-output response.

    Tolerates the two shapes Firecrawl has shipped:
      - response["data"]["result"][rows_key]   (current /v2 schema)
      - response["result"][rows_key]           (older /v2 + some preview tiers)
    Returns [] when nothing is found; callers decide whether empty is fatal.
    """
    root = response.get("data", {}).get("result") or response.get("result") or {}
    rows = root.get(rows_key)
    if isinstance(rows, list):
        return rows
    return []
