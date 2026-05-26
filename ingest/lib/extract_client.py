"""Two-vendor extraction layer: firecrawl /v2/agent → spider /ai/scrape fallback.

Why this exists: firecrawl's /v2/agent can quietly return `status=completed`
with `data=null` on dead/blocked URLs. Spider's /ai/scrape on the same URL
either returns real rows or surfaces a structured HTTP error (404/525) that
tells the operator the URL needs auditing. Wrapping both behind one call site
means pipelines stop silently producing zero rows.

Contract preserved from `firecrawl_client.agent()`:
    extract(prompt, *, urls=[...], schema={...}, max_credits=N,
            strict_constrain_to_urls=bool) -> dict

The returned dict carries the firecrawl response shape (so existing call sites
that use `extract_agent_rows` keep working) plus a `_provenance` list documenting
which vendor served which URL — useful for both debugging and the per-URL
"this URL is dead, audit it" message we want surfaced.

Fallback policy (per-call, not per-URL — firecrawl agent accepts a list):
    1. Try firecrawl across all URLs at once.
    2. If firecrawl returns ≥1 row → return it. (Firecrawl is primary; trust it
       when it works.)
    3. If firecrawl returns 0 rows OR raises FirecrawlError → fall back to
       spider /ai/scrape per URL. Collect rows + per-URL errors.
    4. If spider yields ≥1 row → return combined.
    5. If both vendors yield 0 rows AND we have at least one spider error,
       raise ExtractError summarizing each URL's failure. This is the
       "loud failure" outcome that makes URL audits actionable.

Env: FIRECRAWL_API_KEY (primary), SPIDER_API_KEY (fallback). If
SPIDER_API_KEY is missing, the fallback step is skipped with a warning —
pipelines stay running on firecrawl alone (preserves the pre-spider behavior
when an operator has not provisioned spider).
"""
from __future__ import annotations

import os
from typing import Any, Iterable, Optional

from ingest.lib.firecrawl_client import (
    FirecrawlError,
    agent as firecrawl_agent,
    extract_agent_rows,
)
from ingest.lib.spider_client import (
    SpiderError,
    ai_scrape as spider_ai_scrape,
    extract_rows as spider_extract_rows,
)


class ExtractError(RuntimeError):
    """Raised when every vendor returned zero rows AND at least one errored.

    The exception message itemizes each vendor + URL + error so the operator
    knows exactly which URLs need auditing.
    """


def extract(
    prompt: str,
    *,
    urls: Iterable[str],
    schema: Optional[dict[str, Any]] = None,
    model: str = "spark-1-mini",
    max_credits: int = 1000,
    strict_constrain_to_urls: bool = False,
    poll_interval: int = 2,
    timeout: int = 900,
) -> dict[str, Any]:
    """Try firecrawl /v2/agent first, fall back to spider /ai/scrape per URL.

    Returns a dict with the firecrawl response shape so `extract_agent_rows`
    still works:

        {
          "status": "completed",
          "data": {"rows": [...]},
          "_provenance": [
              {"vendor": "firecrawl", "urls": [...], "rows": N, "ok": bool, ...},
              {"vendor": "spider",    "url":  "...", "rows": N, "ok": bool, ...},
          ],
        }
    """
    url_list = list(urls)
    provenance: list[dict[str, Any]] = []
    rows: list[dict[str, Any]] = []

    # ── 1. Firecrawl primary attempt ────────────────────────────────────────
    fc_error: Optional[str] = None
    try:
        fc_response = firecrawl_agent(
            prompt,
            urls=url_list,
            schema=schema,
            model=model,
            max_credits=max_credits,
            strict_constrain_to_urls=strict_constrain_to_urls,
            poll_interval=poll_interval,
            timeout=timeout,
        )
        fc_rows = extract_agent_rows(fc_response)
        provenance.append({
            "vendor": "firecrawl",
            "urls": url_list,
            "rows": len(fc_rows),
            "ok": True,
            "job_id": fc_response.get("id"),
            "credits_used": fc_response.get("credits_used"),
        })
        if fc_rows:
            return {
                "status": "completed",
                "data": {"rows": fc_rows},
                "_provenance": provenance,
            }
    except FirecrawlError as exc:
        fc_error = str(exc)
        provenance.append({
            "vendor": "firecrawl",
            "urls": url_list,
            "rows": 0,
            "ok": False,
            "error": fc_error,
        })

    # ── 2. Spider per-URL fallback ──────────────────────────────────────────
    if not os.environ.get("SPIDER_API_KEY"):
        # No spider key → preserve pre-fallback behavior: re-raise firecrawl's
        # error if it failed, otherwise return the empty firecrawl response.
        if fc_error is not None:
            raise FirecrawlError(fc_error)
        return {
            "status": "completed",
            "data": {"rows": []},
            "_provenance": provenance + [{
                "vendor": "spider",
                "ok": False,
                "skipped": True,
                "reason": "SPIDER_API_KEY not set; fallback disabled.",
            }],
        }

    spider_errors: list[tuple[str, str]] = []
    for url in url_list:
        try:
            sp_response = spider_ai_scrape(prompt, url=url, schema=schema)
            sp_rows = spider_extract_rows(sp_response)
            provenance.append({
                "vendor": "spider",
                "url": url,
                "rows": len(sp_rows),
                "ok": True,
            })
            rows.extend(sp_rows)
        except SpiderError as exc:
            err = str(exc)
            spider_errors.append((url, err))
            provenance.append({
                "vendor": "spider",
                "url": url,
                "rows": 0,
                "ok": False,
                "error": err,
            })

    # ── 3. Outcome ──────────────────────────────────────────────────────────
    if rows:
        return {
            "status": "completed",
            "data": {"rows": rows},
            "_provenance": provenance,
        }

    if spider_errors:
        details = "\n  - ".join(f"{u}: {e}" for u, e in spider_errors)
        prefix = f"firecrawl: {fc_error}\n  - " if fc_error else ""
        raise ExtractError(
            f"Both vendors returned zero rows. Per-URL failures:\n  - {prefix}{details}"
        )

    # Spider didn't error per-URL but also returned no rows. This is the
    # "URLs aren't dead, they just don't contain the data we asked for" case —
    # callers should treat this the same as firecrawl returning empty.
    return {
        "status": "completed",
        "data": {"rows": []},
        "_provenance": provenance,
    }
