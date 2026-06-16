# crawl4ai → Accela port (lee_permits first) — design

**Date:** 2026-06-16
**Status:** Approved (brainstorm), pre-implementation spike pending
**Scope owner:** Ricky Cooper

## Problem

Firecrawl is gone (operator, 2026-06-16). Three pipelines drive Accela portals through
`ingest/lib/firecrawl_client.scrape_with_actions` — `lee_permits`, `collier_permits`,
`dbpr_sirs`. That call is **Firecrawl-direct with no Spider fallback**, so all three are
**dead** without Firecrawl. Confirmed against code (2026-06-16): all three import
`scrape_with_actions` directly from `ingest.lib.firecrawl_client` (`lee_permits/scraper.py:52`,
`collier_permits/fetcher.py:23`, `dbpr_sirs/pipeline.py:25`), bypassing the Spider-fallback
`extract_client`; `firecrawl_client` contains no `spider` reference, and `extract_client`'s
docstring records "firecrawl actions ← (no spider analogue) → call firecrawl direct".

A scratch spike (`C:\Users\ethan\Downloads\crawl4ai-test\fix_accela3.py`) proved that
**crawl4ai 0.8.9 + `UndetectedAdapter` drives the live Lee Accela portal end-to-end** —
cold URL → form fill → search → results grid (`gdvPermitList`, 631 KB, pagecount 11) —
on a plain residential IP, no proxy, status 200, zero WAF markers.

This spec ports **`lee_permits` only** to crawl4ai. `collier_permits` and `dbpr_sirs`
are deliberate follow-ons (one `.step()` call each).

## Scope

**In:**
- New `ingest/lib/crawl4ai_client.py` — reusable crawl4ai-native primitives + Accela JS helpers.
- Rewrite of `lee_permits/scraper.py` network functions (`fetch_permit_pages`,
  `enrich_rows_with_details`) to use crawl4ai. Parsers and `pipeline.py` orchestration unchanged.
- Add `crawl4ai` to `ingest/requirements.txt`.

**Out (deferred, not this build):**
- `collier_permits` / `dbpr_sirs` cutover (follow-on).
- GHA cron + datacenter-IP strategy (self-hosted runner / residential proxy). **Local-first.**
- Removing `firecrawl_client` (left intact — other pipelines still import it; it's our rollback path).
- Stateful-pagination perf tuning beyond the single-session reuse specified here.

**Success criteria:** running `python -m ingest.pipelines.lee_permits.pipeline --start … --end …`
locally lands correct rows in `data_lake.lee_building_permits` — dates exact, grid fully
paginated, CapDetail fields enriched.

## Why not the alternatives

- **A (faithful `scrape_with_actions` emulator)** — rejected. crawl4ai has no Firecrawl-style
  action list and exactly **one wait gate per `arun()`**; an interleaved
  write/click/wait/click/wait/scrape sequence cannot flatten into one call, so a faithful
  emulator is impossible.
- **B (full native rewrite of `scraper.py`)** — more code churn on proven logic and zero reuse
  for collier/dbpr_sirs.
- **A′ (this spec)** — reusable crawl4ai primitives + a small session-loop rewrite of lee's two
  network functions. Delivers single-browser efficiency (B-level) with contained change, and
  makes collier/dbpr_sirs single-call follow-ons.

## Architecture

### Wiring (precise)
`UndetectedAdapter()` → `AsyncPlaywrightCrawlerStrategy(browser_adapter=adapter)` →
`AsyncWebCrawler(crawler_strategy=…)`. The adapter is browser/stealth wiring only; **all
interaction is expressed in `CrawlerRunConfig`** (`js_code_before_wait`, `wait_for`,
`delay_before_return_html`), not in the adapter and not via Playwright hooks.

### Per-`arun()` execution order (verified, crawl4ai 0.8.x)
`navigate → js_code_before_wait → wait_for → delay_before_return_html → js_code → capture`.
One wait gate. The form fill + click goes in **`js_code_before_wait`** (runs *before* the gate),
NOT `js_code` (runs *after* the gate — too late to trigger the grid).

### `ingest/lib/crawl4ai_client.py`
- `Crawl4aiSession` — async context manager. Holds one `AsyncWebCrawler` + `UndetectedAdapter`.
  - `.step(url, *, js_before=None, wait_for=None, js_only=False, timeout=…) -> str` (html).
    Wraps `arun()` with a shared `session_id`; `js_before` → `js_code_before_wait`.
  - On exit: `await crawler.crawler_strategy.kill_session(session_id)`.
  - **Sequential only** — sessions are not safe for concurrent `arun()`.
- `fetch_many(urls, *, wait_for=None, concurrency=5, timeout=…) -> dict[str, str]` — `arun_many`
  for independent parallel page fetches (CapDetail enrichment). Concurrency capped at ~5 to
  reduce burst-block risk.
- Accela JS builders (pure string functions, unit-testable):
  - `accela_date_fill_and_search_js(start, end)` — set both date inputs via `.value` +
    dispatch `input`/`change`/`keyup`/`blur`; **bounded readback-verify-force-set** (retry ≤ 3,
    then throw a clear error — never search a silently-wrong date); then click
    `#ctl00_PlaceHolderMain_btnNewSearch`.
  - `accela_next_page_js()` — stash `window.__prevPage` = active page marker AND
    `window.__prevFirstRow` = first grid row id; then click the pager Next
    (`td.aca_pagination_PrevNext:last-child > a`).
  - `accela_grid_or_terminal_wait` (page 1) — `js:` predicate true when the grid is present
    OR a "no records" message OR an error banner ("unable to proceed" / "valid DateTime").
  - `accela_page_changed_wait` (pages 2..N) — `js:` predicate. **Markers MUST be defined before
    comparing.** A bare `live !== window.__prevPage` resolves TRUE instantly when `__prevPage` is
    `undefined` (window wiped, or stash JS never ran) → the STALE grid is re-captured with **no
    error and no timeout** (silent duplicate/missing rows — the exact failure class we guard
    against). Predicate: `window.__prevPage !== undefined && window.__prevFirstRow !== undefined &&
    live_page !== window.__prevPage && live_firstRow !== window.__prevFirstRow`. An undefined
    marker = NOT ready → keep polling → timeout → clear error (never resolve true).
    **`window.__prevFirstRow` (first-row id) is the primary, stronger content signal**; if the
    spike shows the page-marker selector is unreliable, demote page-marker to advisory (logged) and
    gate on first-row id alone.

### `lee_permits/scraper.py` (rewrite of network fns only)
- `fetch_permit_pages(start, end) -> list[str]` — `asyncio.run` of a `Crawl4aiSession` loop:
  - Page 1: `.step(URL, js_before=accela_date_fill_and_search_js(s,e),
    wait_for=accela_grid_or_terminal_wait)`. Read `pagecount` from the returned HTML
    (existing `parse_page_count`).
  - Pages 2..N: `.step(URL, js_only=True, js_before=accela_next_page_js(),
    wait_for=accela_page_changed_wait)`. Stop early if a page has no grid (existing behavior).
  - Relies on partial UpdatePanel postback preserving `window` across the click (confirmed —
    Accela pagination is a `PageRequestManager` async postback, not a full reload).
- `enrich_rows_with_details(rows)` — replace `ThreadPoolExecutor` + per-URL
  `scrape_with_actions` with `crawl4ai_client.fetch_many(cap_detail_urls, concurrency=5)`.
  Parser `parse_cap_detail_html` unchanged. **(See Spike #2 — falls back to sequential on the
  pagination session if CapDetail proves session-gated.)**
- Parsers (`parse_accela_result_page`, `parse_cap_detail_html`, `parse_page_count`) — unchanged.

### `pipeline.py`
- `_ingest_metadata.scraped_via` → `"crawl4ai"`. No other change.

## Pre-implementation spike (≤ 10 min, before writing the loop)

1. **js_code mechanism reproduces fix3.** `UndetectedAdapter` + `CrawlerRunConfig`
   `js_code_before_wait` (date fill + verify + click) + `wait_for` grid renders `gdvPermitList`
   with **exact** dates. (Bot-block clearance for search→grid is already proven in fix3 via
   hooks; this re-confirms it under the js_code mechanism, which uses the same browser.)
   **Window-survival assertion (gates the whole change-detection scheme):** after a `js_only=True`
   Next click, confirm `window.__prevPage` still reads back — i.e. the partial UpdatePanel postback
   did NOT wipe `window`. If it does not survive `js_only`, change-detection must be redesigned —
   find out here, not in a corrupt run. (My obs run showed a `[FETCH]` line on the `js_only` step;
   confirm empirically that it is not a window-wiping navigation.)
2. **CapDetail addressability.** A CapDetail URL loads in a **clean** crawl4ai context with no
   prior search session. Pass → `arun_many` (parallel). Fail (session-gated) → sequential on the
   kept-alive pagination session. (Strong prior: existing Firecrawl enrich fetches these
   independently + in parallel and succeeds.)
3. **Not settleable in the spike (observe in first real run):** sustained-volume / concurrent
   blocking across a full 11-page + ~100-detail-page run.

## Error handling

- Wait predicates carry **terminal conditions**: resolve on grid OR no-records OR error banner.
  Error banner ("unable to proceed" / "valid DateTime") → raise with the banner text. No-records
  → empty result (not an error).
- Date entry: bounded readback (≤ 3 retries) then **raise** a clear error — never a silent
  wrong-date search.
- **Pages 2..N have no terminal-condition escape** — only the change-detection predicate or
  timeout. A predicate that never resolves (selector drift, postback failed to advance) → timeout
  → **raise a clear error**. This is distinct from the clean stop at `pagecount` (we only click Next
  up to the known page count — that's not a timeout). Never silently return partial pages.
- Per-page grid-missing *within* `pagecount` → loud error, not a silent early stop (a missing grid
  mid-range is an anomaly, not end-of-results — `pagecount` already tells us where results end).
- Each `.step` honors `timeout`; a timeout surfaces as a clear error, not a silent empty page.

## Testing

- **Parsers** — already pure-unit-tested; unchanged, tests stay green.
- **`crawl4ai_client` JS builders** — unit-test their string output (selectors, event dispatch,
  readback loop shape, marker stash) without a browser.
- **Session wiring** — light unit test against a local fixture HTML page (no live network).
- **Live Accela** — manual/local only; cannot run in CI (needs a real browser + non-datacenter
  IP). The end-to-end acceptance is a manual local pipeline run asserting rows land + dates exact.

## Risks

- **GHA datacenter IP** — deferred (local-first). Fallbacks if/when needed: self-hosted/residential
  runner, or residential proxy via crawl4ai `proxy_config` (crawl4ai is a browser, not a proxy fleet).
- **Sustained-volume blocking** — observe during the first real local run.
- **Per-page browser startup cost** — mitigated by single-session reuse; acceptable for a cron job.

## Rollback

`firecrawl_client` is untouched. Revert = restore the `lee_permits/scraper.py` imports and delete
`crawl4ai_client.py`; `requirements.txt` line is additive. No schema or lake changes.
