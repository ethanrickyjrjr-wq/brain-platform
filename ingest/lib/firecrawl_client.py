"""Thin Firecrawl client used by GitHub Actions ingest jobs.

`/v2/agent` is asynchronous (POST → job id → poll GET /v2/agent/<id> until
status terminal). The vendor `firecrawl-py` SDK already implements that polling
loop correctly; this module delegates `agent()` to the SDK. The `/v2/scrape`
paths stay on bare `requests` because we need stealth-proxy + actions support
that the SDK's scrape surface does not expose flag-for-flag (used by
lee_permits).

Env: FIRECRAWL_API_KEY — repo secret + local .env.local.
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
    poll_interval: int = 2,
    timeout: int = 900,
) -> dict[str, Any]:
    """Run an autonomous /v2/agent extraction and wait for completion.

    Delegates to `firecrawl-py`'s `Firecrawl.agent(...)`, which starts the job
    and polls `/v2/agent/<id>` until terminal status. Returns the completed
    AgentResponse as a plain dict (via Pydantic `model_dump`) so downstream
    code keeps seeing a dict.

    Raises `FirecrawlError` on a terminal non-completed status — silent empty
    rows on a failed job is the trap that wasted three sessions; surface the
    failure loudly. Network/API errors from the SDK propagate as-is.
    """
    try:
        from firecrawl import Firecrawl  # type: ignore[import-not-found]
    except ImportError as exc:  # pragma: no cover — packaging error, not runtime
        raise FirecrawlError(
            "firecrawl-py is not installed — add `firecrawl-py>=4.28.0` to ingest/requirements.txt"
        ) from exc

    client = Firecrawl(api_key=_api_key())
    response = client.agent(
        list(urls) if urls is not None else None,
        prompt=prompt,
        schema=schema,
        model=model,  # type: ignore[arg-type]  # SDK Literal narrower than our str default
        max_credits=max_credits,
        strict_constrain_to_urls=strict_constrain_to_urls,
        poll_interval=poll_interval,
        timeout=timeout,
    )
    payload = response.model_dump(by_alias=False, exclude_none=False, mode="json")

    status = payload.get("status")
    if status and status != "completed":
        error = payload.get("error") or "(no error message)"
        credits = payload.get("credits_used")
        raise FirecrawlError(
            f"/v2/agent terminal status={status!r} — {error} "
            f"(credits_used={credits}, job_id={payload.get('id')!r})"
        )
    return payload


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
    """Pull the rows array out of a completed /v2/agent response.

    The SDK returns the raw schema-shaped extraction output at `data` — for
    our `{rows: [...]}` schemas the path is `response.data.rows`. Two legacy
    shapes also recognized as defensive fallbacks (`data.result.rows`,
    `result.rows`). Returns [] when nothing is found; callers decide whether
    empty is fatal.
    """
    data = response.get("data") or {}
    # Current shape: data.rows
    if isinstance(data, dict):
        rows = data.get(rows_key)
        if isinstance(rows, list):
            return rows
        # Legacy: data.result.rows
        result = data.get("result")
        if isinstance(result, dict):
            rows = result.get(rows_key)
            if isinstance(rows, list):
                return rows
    # Legacy: result.rows at top level
    top_result = response.get("result")
    if isinstance(top_result, dict):
        rows = top_result.get(rows_key)
        if isinstance(rows, list):
            return rows
    return []
