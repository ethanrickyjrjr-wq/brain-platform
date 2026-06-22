# crawl4ai usage reference — authoritative docs vs. our implementation (3 live rounds)

**Date:** 2026-06-21. crawl4ai was sent out **3 times (30 doc pages, 30/30 OK)** against its own live docs
(docs.crawl4ai.com v0.9.x) via the repo's OWN in-process SDK (`ingest/lib/crawl4ai_client.fetch_page_markdown`)
— dogfooding the tool while pulling the answers. Every answer is from a live capture or a live GHA log, cited.

> NOTE: This folder is the **crawl4ai-tool usage reference** (how to use crawl4ai correctly + where our
> crawl4ai integration diverges). It is NOT the broader "best practices for building what we're building"
> research — that lives in `docs/audit/2026-06-21-best-practices-research/`.

## Artifacts in this folder
- `round1|2|3/` — 30 captured doc pages + `index.json` each (the crawl4ai reference itself).
- `STEP3-what-is-wrong-round1.md` — round-1 comparison (repo vs docs).
- `STEP5-side-by-side.md` — the full side-by-side table.
- `VERIFICATION.md` — **independent 2026-06-22 re-check** of every claim here + in `NOTES.md`/`BRIEF.md`
  (8-cluster read-only pass + Vendor-First package/PyPI checks); correction table + the resolved
  `crawl4ai-setup`-patchright contradiction. The build plan acting on it: `../2026-06-21-full-platform-audit/PLAN/`.
- `__scratch__/crawl4ai_doc_harvest.py` — the harvester (re-runnable: `python … round1|round2|round3`).

## crawl4ai 0.9.0 — how to do it right (the authoritative answer)

### The version truth (CHANGELOG, verbatim)
> "0.9.0 … This release contains **breaking changes for the self-hosted HTTP server only. The core pip
> library (SDK / in-process use) is unchanged.**" — github CHANGELOG, captured this run.

- **0.9.0 is the current latest** (`pip index versions crawl4ai` → LATEST 0.9.0, INSTALLED 0.9.0).
- The repo runs the **in-process SDK**, so 0.9.0 is **safe and correct** — the breaking changes (auth-on,
  loopback bind, SSRF proxy hardening, `output_path`→`artifact_id`) are all Docker-server-only.
- The SSRF fix (CWE-918) is **why** the 0.9.0 server 400-rejects `proxy/js_code/cookies` over the network
  — so the repo's "stealth can never move to the server" landmine is vendor-confirmed and current.

### The canonical stealth pattern (and the repo matches it)
```python
adapter = UndetectedAdapter()
bc = BrowserConfig(headless=False, enable_stealth=True)        # combine both = max evasion
strategy = AsyncPlaywrightCrawlerStrategy(browser_config=bc, browser_adapter=adapter)
async with AsyncWebCrawler(crawler_strategy=strategy, config=bc) as crawler: ...
```
The repo's `Crawl4aiSession.__aenter__` (`crawl4ai_client.py:65-75`) is this exactly — **the hard part is right.** The one doc-divergence: **"Avoid Headless Mode — detection is easier" (`headless=False`)**; the repo defaults `headless=True` and CI is headless. That, plus datacenter IPs, is why stealth is "home-IP-proven."

### Install / CI
- `crawl4ai-setup` installs browser deps for **both regular AND undetected** modes. **Package-source
  proof (2026-06-22 re-verify, not just a log):** installed `crawl4ai/install.py` `post_install()` →
  `install_playwright()` runs **both** `playwright install --with-deps --force chromium` (98-107) **and**
  `patchright install --with-deps --force chromium` (126-135); line 124 prints "Installing Patchright
  browsers for undetected mode...". PyPI: `patchright>=1.49.0`+`playwright>=1.49.0` hard deps, 0.9.0 latest.
  → **The 06-20 note "crawl4ai-setup skips patchright" is OUTDATED, and `supercrawl4ai/BRIEF.md` #6's "don't
  standardize on crawl4ai-setup (strips patchright)" is WRONG** (resolved in `VERIFICATION.md`). The repo's
  4–5 explicit `playwright/patchright install` spellings can collapse to one `crawl4ai-setup` +
  `crawl4ai-doctor` per job — *stricter*, since the live `patchright install chromium` step omits
  `--with-deps`. **Caveat:** `crawl4ai-setup` skips installs if `CRAWL4AI_MODE=api` (install.py:52-57) —
  keep it unset on crawl jobs.
- torch/transformers are **optional extras** — the repo's bare `crawl4ai==0.9.0` pin is correct/lean.

### The knobs, stated correctly
- **Wait:** `wait_for="js:() => {…}"` **polls until true or timeout** = the settle mechanism;
  `delay_before_return_html` is "an extra safety margin." `page_timeout` is **milliseconds**.
- **Scale:** `MemoryAdaptiveDispatcher` + `RateLimiter(base_delay=(1.0,3.0), rate_limit_codes=[429,503])`
  (the repo uses this exact signature); `mean_delay`/`max_range` add pre-emptive jitter; `stream=True`
  bounds memory; `CrawlerMonitor`/`result.dispatch_result` give telemetry.
- **Anti-bot gate:** hook `after_goto(page, context, url, response)` + `result.status_code` (302 vs
  `redirected_status_code` 200) — fail fast on a 403/challenge instead of returning thin HTML as "success."
- **Zero-LLM extraction:** `result.tables` (`{headers, rows, metadata}`, `table_score_threshold=7`);
  `JsonCssExtractionStrategy.generate_schema` (LLM once → cache → free CSS forever);
  `RegexExtractionStrategy` (emails/phones/URLs/dates); `capture_network_requests` → `result.network_requests`
  (read a site's JSON XHR directly).
- **Datacenter-IP escape (the only in-process one):** `CrawlerRunConfig.proxy_config` (per-request,
  **recommended**); `BrowserConfig.proxy` is **deprecated**; `ProxyConfig.from_string/from_env`.

## What's wrong in our crawl4ai integration (the fix list)
1. ❌ **Crexi `[:28000]` truncation + single scroll** (`crexi_listings/extract.py:42,83` — dir is
   `crexi_listings/`, re-verified) — highest-volume LLM source silently amputates rows. Fix =
   `VirtualScrollConfig`/`scan_full_page` + drop the cut + chunk full text.
2. ❌ **Blind `delay_after` as the wait** — `dbpr_sirs` 16s, `crexi` 5s+4s use the safety margin as the
   settle. Fix = `js:` row-count-settle `wait_for`.
3. ❌ **8-minute `page_timeout`** — `extract()` `timeout=480`(s)×1000 = 480000ms (`extract_client.py:195`).
4. ⚠️ **Redundant 4-spelling installs** — 0.9.0 `crawl4ai-setup` does both browsers now; `crawl4ai-doctor`
   missing on `dbpr-press-releases`, `fgcu`, `swfl-inc`, `rsw`.
5. ⚠️ **No jitter / no stream / no monitor / no `after_goto` gate** — all available, none wired.
6. ⚠️ **supercrawl4ai built but wired into ZERO pipelines** — proxy (the only datacenter-IP escape),
   tables, fit_markdown, virtual_scroll all dormant. Either adopt into Crexi or park/remove.
7. ❌ **Moot litellm rationale** — DIY-extract was chosen to "avoid the litellm dep," but `crawl4ai` pulls
   `unclecode-litellm==1.81.13` regardless. The DIY-vs-native call should rest on JSON-reliability, not the dep.

**Got right (the hard parts):** UndetectedAdapter strategy assembly · MemoryAdaptiveDispatcher+RateLimiter
exact signatures · `CacheMode.BYPASS` for per-run-fresh · the no-extras pin · the execution order · the
in-process-only landmine (vendor-confirmed).
