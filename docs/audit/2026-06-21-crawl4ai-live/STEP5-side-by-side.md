# Step 5 — Side by side: authoritative crawl4ai (v0.9.x) vs. what brain-platform built

> **Recommended model:** ⚡ Sonnet — 6 tasks, keywords: schema

> Left column = the live docs (captured 2026-06-21 via the repo's own in-process SDK into `round1/` +
> `round2/`) and two live GHA logs. Right column = the repo (`file:line`). Verdict = ✅ correct /
> ⚠️ divergent / ❌ wrong. No opinions — every cell is grounded.

---

## A. Stealth / anti-bot

| Dimension | Authoritative answer (doc / live) | What the repo does | Verdict + fix |
|---|---|---|---|
| Undetected adapter wiring | `UndetectedAdapter()` → `AsyncPlaywrightCrawlerStrategy(browser_config, browser_adapter)` → `AsyncWebCrawler(crawler_strategy, config)` (06-undetected-browser.md:181-221) | `crawl4ai_client.py:65-75` builds exactly this | ✅ correct |
| Max evasion = stealth + undetected combined | "Combine stealth mode with undetected browser" → `enable_stealth=True` + `UndetectedAdapter` (06-undetected:223-251) | `BrowserConfig(enable_stealth=True)` + `UndetectedAdapter()` (client.py:66-73) | ✅ correct (strongest tier) |
| Headless | **Best-practice #1: "Avoid Headless Mode — detection is easier" → `headless=False`** (06-undetected:362-366) | defaults `headless=True`; CI runs headless | ⚠️ unavoidable on CI (no display). **Fix:** for the hardest stealth targets, run headful under `xvfb-run` on the runner, or accept home-IP/self-hosted-only. This is *why* stealth is "home-IP-proven." |
| Anti-bot verify-or-fail gate | Hook `after_goto(page, context, url, response, **kwargs)` is "right after navigation completes"; check `response.status` there; `crawler_strategy.set_hook("after_goto", fn)` (11-hooks-auth.md:102,190,240) | no hooks; `Crawl4aiSession.step` only checks `r.success` after capture (client.py:101-102) | ⚠️ **add** an `after_goto` status gate so a 403/challenge fails fast & loud instead of returning thin HTML |
| Auth / warmed identity | log in inside `on_page_context_created` (NOT `on_browser_created`); `storage_state` / `user_data_dir` + `use_managed_browser` for warm sessions (11-hooks-auth:107-109; 13-identity-based-crawling) | none wired (no auth'd SWFL source yet) | ✅ N/A today — the right home is documented for when one lands |
| Escalation knobs | `simulate_user=True`, `magic=True` (popups/consent), `override_navigator=True` (05-parameters.md:250-252; 06-undetected:457-467) | none set | ⚠️ available if a target still blocks after UndetectedAdapter |

## B. Waiting / timing

| Dimension | Authoritative answer | What the repo does | Verdict + fix |
|---|---|---|---|
| Execution order | `goto → js_code_before_wait → wait_for → delay_before_return_html → js_code → capture` (08-page-interaction.md:155-167) | `Crawl4aiSession.step` passes `js_before`→`wait_for`→`delay_after` in this order (client.py:91-99) | ✅ correct ordering |
| The real settle mechanism | **`wait_for="js:() => {…}"` POLLS until true or timeout**; `delay_before_return_html` is "an extra safety margin" (08-page-interaction:209-223, 296-308) | `lee_permits` uses a `js:` settle predicate ✅; **`dbpr_sirs` `delay_after=16s`** + **`crexi` `delay_after=5s+4s`** use the safety margin as the primary wait ❌ | ❌ **fix dbpr_sirs/crexi**: replace blind sleeps with a `js:` "row count stopped growing" `wait_for` + small `delay_before_return_html` |
| `page_timeout` unit | **milliseconds** (08-page-interaction:296; 05-parameters.md) | `extract()` `timeout=480`(s) → `fetch_many(timeout*1000)` = **480000ms = 8 min/page** (extract_client.py:195) | ❌ **fix**: separate job budget from per-page timeout; set `page_timeout=60-90s` |
| `wait_until` | navigation-complete condition, default `domcontentloaded`, or `networkidle` (05-parameters.md:225) | not set (uses default) | ✅ default fine; `networkidle` available for XHR-heavy pages |

## C. Concurrency / scale (`arun_many`)

| Dimension | Authoritative answer | What the repo does | Verdict + fix |
|---|---|---|---|
| Dispatcher | advanced path = `MemoryAdaptiveDispatcher(memory_threshold_percent=…, max_session_permit=…)` + `RateLimiter`; simple = `semaphore_count` (default 5) (10-multi-url-crawling.md:120-196; 05-parameters.md:233) | `fetch_many` uses `MemoryAdaptiveDispatcher(max_session_permit=concurrency, rate_limiter=…)` (client.py:206-214) | ✅ correct (advanced, OOM-safe) |
| RateLimiter signature | `RateLimiter(base_delay=(1.0,3.0), max_delay, max_retries, rate_limit_codes=[429,503])` (10-multi-url:120-191) | exact same call (client.py:208-213) | ✅ correct |
| Pre-emptive jitter | `mean_delay`/`max_range` (default 0.1/0.3s) add random delay **between** requests "to avoid detection or rate limits" (05-parameters.md:232) | `fetch_many` sets neither → RateLimiter only backs off **after** a 429/503 | ⚠️ **add** `mean_delay`/`max_range` for the first-burst pacing stealth targets need |
| Streaming | `stream=True` → async generator: bounded memory + partial results on a stuck page (04-browser-crawler-config.md:294,348) | `fetch_many` collects all, then returns | ⚠️ **add** `stream=True` so one hung detail page can't block the batch |
| Telemetry | `CrawlerMonitor(...)` + `result.dispatch_result` (per-URL memory/timing) (10-multi-url:198-202) | none | ⚠️ **add** for diagnosing GHA hangs/OOMs (the missing daily-breakage diagnostic) |

## D. Install / CI (the daily-breakage surface)

| Dimension | Authoritative answer | What the repo does | Verdict + fix |
|---|---|---|---|
| One-command browser install | `crawl4ai-setup` installs deps for **both regular AND undetected** modes; **live-verified 0.9.0 installs Patchright too** ("Installing Patchright browsers for undetected mode" — local + GHA logs) | 4 different `playwright install`+`patchright install` spellings across 11 jobs; only `news` uses `crawl4ai-setup` | ⚠️ **collapse to one `crawl4ai-setup`** per job. **The 06-20 note "crawl4ai-setup skips patchright" is outdated for 0.9.0.** |
| Preflight | `crawl4ai-doctor` (Python/Playwright/env, fail-fast) (02-installation.md:118-127) | advisory on 7 jobs; **missing on `dbpr-press-releases`, `fgcu`, `swfl-inc`, `rsw`** | ⚠️ **add doctor to all 11 crawl jobs** |
| Dependency weight | basic `pip install crawl4ai` = no torch/transformers (those are `[torch]`/`[transformer]`/`[all]` extras) (02-installation.md:107,151-183) | pins bare `crawl4ai==0.9.0` (no extras) ✅ — but pulls `unclecode-litellm==1.81.13`, playwright, patchright, scipy/shapely/trimesh/pymupdf as core/transitive | ⚠️ correct pin, but **every daily cron installs the full tree** (incl. `freshness-probe`, which needs only `psycopg`+`pyyaml`). **Fix:** a minimal `requirements-probe.txt` for probe/gate-class jobs |
| litellm rationale | `crawl4ai` core depends on `unclecode-litellm` (both 06-18 + 06-20 logs) | 06-20 research chose DIY-extract "to avoid the litellm transitive dep" | ❌ **moot** — litellm installs regardless |

## E. Extraction / content quality

| Dimension | Authoritative answer | What the repo does | Verdict + fix |
|---|---|---|---|
| Long/lazy lists | `VirtualScrollConfig(container_selector, scroll_count=10, scroll_by="container_height", wait_after_scroll=0.5)` via `CrawlerRunConfig(virtual_scroll_config=…)`; or `scan_full_page` for accumulating lists (17-virtual-scroll.md:138-163) | `crexi/extract.py` does ONE manual `_SCROLL_JS` + `soup.get_text()[:28000]` truncation (extract.py:42,83) | ❌ **highest-volume LLM source silently amputates rows.** Fix: probe virtualized-vs-accumulating, adopt VirtualScroll or scan_full_page, drop `[:28000]`, chunk the full text |
| Deterministic tables | `result.tables` (list of `{headers, rows, caption}`), `table_score_threshold` default 7 (round3 22-table_extraction.md:133-191,296) | not used anywhere; `dbpr_sirs` hand-walks the Qlik grid with positional `parse_*_rows` | ⚠️ **adopt `result.tables`** for clean HTML tables (zero-LLM, Brain-Factory rule 2) — built in `supercrawl4ai.fetch_tables` but unwired |
| Denoise before LLM | `PruningContentFilter` → `fit_markdown`; `DefaultMarkdownGenerator(ignore_links/ignore_images/body_width:0)` (16-fit-markdown.md; 19-markdown-generation.md) | `_scrape_page` returns raw markdown; no content filter | ⚠️ **add** a pruning filter on static fetches → cleaner parse + fewer LLM tokens |
| Content scoping | `css_selector`/`target_elements`/`excluded_tags`/`word_count_threshold` (15-content-selection.md) | not used | ⚠️ scope to the listing/article region before the LLM (kills the arbitrary char-cut) |
| Zero-LLM CSS extraction | `JsonCssExtractionStrategy.generate_schema` — run the LLM ONCE on a sample, cache the schema, extract deterministic rows free thereafter (round3 23-no-llm-strategies.md:111-163) | crexi runs per-run Haiku on every listing | ⚠️ **for stable-layout sources**, cache a CSS schema once → kill per-run LLM cost + hallucination |
| Network-XHR capture | `capture_network_requests=True` → `result.network_requests` (read a site's JSON API directly) (round3 24-network-console-capture.md:107-146) | not used | ⚠️ highest-ceiling Crexi fix if the listing JSON XHR is reachable — no scroll, no LLM |
| Proxy (datacenter-IP escape) | `CrawlerRunConfig.proxy_config` **recommended (per-request)**; `BrowserConfig.proxy` **deprecated**; `ProxyConfig.from_string/from_env` (12-proxy-security.md:106-201) | no proxy wired; plumbing exists in `supercrawl4ai` but unused | ⚠️ **the only in-process lever for the GHA datacenter-ASN block** (collier/crexi). Wire `CRAWL4AI_PROXY`→per-request `proxy_config`, default-off |
| Cache | `CacheMode.BYPASS` skips cache (09-cache-modes.md:103) | `BYPASS` everywhere | ✅ correct for per-run-fresh |

## F. The daily-breakage roots (logs vs. the ledger)

| Cron | What the ledger records | Real root (live log) | Fix |
|---|---|---|---|
| `freshness-probe` | "Traceback" → RESOLVED (auto) | `UndefinedTable: data_lake.collier_parcels` (+ 06-05 noaa, 05-29 `KeyError dlt_schema_name`, 06-02 timeout). `check_tier1_entry`/`run_probe` are **unguarded** → the "always exit 0" promise is false | guard `run_probe`/`check_tier1_entry` |
| `daily-rebuild` | "exit code 1" → RESOLVED (auto) | master **deterministic HOLD** — `_build-report.json` `reason: <input-brain>.md not found` (sources[]≠input_brains[] drift). Correct loud behavior, never triaged | echo the build-report reason before exit; add the sources⇆input_brains load-time invariant |
| `news-swfl` | "exit code 1" → OPEN | crawl **succeeded**; dlt LOAD `DatatypeMismatch: published_date date vs character varying`. **Misattributed to crawl4ai** | dlt schema contract (`data_type: evolve`/`freeze`) or ALTER COLUMN |
| **all of them** | symptom only, auto-healed | **`cron-run.mjs fetchLogTail` reads a 30-line tail → `classify-cron-failure.mjs` buckets unknowns as UNKNOWN → ledger writes `_auto-captured; pending triage_` → next green run auto-flips to RESOLVED.** The root is never written. | widen the tail; add classifier rules (DatatypeMismatch, deterministic HOLD); make each cron echo its own reason |

## One-line scorecard
- **Got right:** the hard part — UndetectedAdapter strategy assembly, the MemoryAdaptiveDispatcher+RateLimiter exact signatures, `CacheMode.BYPASS`, the no-extras pin, the execution order.
- **Got wrong / divergent:** blind `delay_after` as the wait (dbpr_sirs/crexi), 8-min `page_timeout` unit bug, Crexi `[:28000]`+single-scroll, redundant 4-spelling installs (0.9.0 `crawl4ai-setup` does both now), doctor missing on 4 jobs, no jitter/stream/monitor, no `after_goto` gate, proxy + tables + fit_markdown built-but-unwired (supercrawl4ai), the moot litellm rationale, and the full-tree install on probe-class crons.
