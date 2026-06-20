# crawl4ai self-improvement research — 2026-06-20

> Output of a 7-lens research workflow ("send crawl4ai out to make itself better"): 1 local
> code-probe + 5 WebFetch lenses (extraction / release / scale-deploy / antibot-data / what's-new)
> + 1 live dogfood run (our own `fetch_page_markdown` against `docs.crawl4ai.com` + a `pip` version
> probe). Grounded against the actual repo, not memory. The #1 finding (dead `/search` path) was
> re-verified by hand against `lib/email/data-readiness.ts` after the workflow returned.
>
> Scope note: covers BOTH crawl4ai modes in the repo — the in-process SDK (`ingest/lib/crawl4ai_client.py`)
> AND the remote server consumed via `CRAWL4AI_API_URL` (`lib/email/*`). The three tracked checks
> only named the SDK; the server path is in scope for "crons / running better."

## TL;DR

- **C3 (version bump): SHIP IT, low risk.** Latest is `0.9.0` (released 2026-06-18). All 0.9.0 breaking changes are scoped to the self-hosted Docker HTTP server; the vendor states verbatim "The core pip library (SDK / in-process use) is unchanged." Every symbol we import in `ingest/lib/crawl4ai_client.py` (`AsyncWebCrawler`, `BrowserConfig`, `CacheMode`, `CrawlerRunConfig`, `UndetectedAdapter`, `AsyncPlaywrightCrawlerStrategy`) and every kwarg/result-attr we use is unchanged. **Effort S.** The dogfood lens confirmed our `0.8.9` integration works end-to-end locally (3.56s, real Chromium, clean markdown).
- **C1 (extract rewire): GENERALIZE THE CREXI DIY PATTERN, not LLMExtractionStrategy.** Both run through UndetectedAdapter stealth equally (orthogonal config — proven), so stealth is a non-differentiator. The deciding factors are all in our repo: native `LLMExtractionStrategy` routes our Anthropic call through `unclecode-litellm` (a new transitive dep + a second model-drift surface), its docs warn of invalid-JSON output, and it returns per-page `extracted_content` we'd have to re-aggregate into our firecrawl-shaped `{rows}` contract. The crexi path already does fetch→strip→Haiku→`json.loads`→`{rows}` and is battle-tested (2026-06-16). **Effort M.** Steal exactly ONE idea from native: kill the silent 28000-char truncation (`crexi/extract.py:83`).
- **C2 (test trees): CLEANUP, confirmed NOT a collision.** Both trees test genuinely different surfaces (`ingest/lib/`: download_step guards + `extract()` firecrawl-fallback; `ingest/tests/lib/`: `raw://` `session.step` + lee_permits JS builders + `scrape_with_fallback`). No `testpaths`, no CI pytest step → they currently gate nothing. Consolidate into `ingest/tests/lib/` + add a real CI pytest invocation. **Effort S–M.**
- **The single highest-leverage move is NOT any of the three checks — it's the dead remote-server path.** `lib/email/data-readiness.ts:95` POSTs to a `/search` endpoint with a `{type:"cosine"}` extraction_config that **does not exist in any crawl4ai version since ~0.4** and is wrapped in a silent `catch { return null }`. The data-readiness verification ladder's Tier-1/Tier-2 crawl tiers are dead in prod today and silently degrade every metric to Sonnet-only, burning tokens and losing the two-source consensus the design promises. Three lenses independently flagged this; re-verified by hand. Fix it before anything else.
- **fetch_many is fragile.** It uses the legacy `semaphore_count` knob with zero rate-limiting or memory-adaptive throttling. Adopting `MemoryAdaptiveDispatcher` + `RateLimiter` gives free 429/503 backoff and OOM protection on GHA runners. Available in 0.8.9 already; pairs naturally with the bump. **Effort M.**
- **The GHA datacenter-IP gap is real and only partially escapable.** UndetectedAdapter fixes browser fingerprinting, NOT datacenter-ASN reputation. Accela is proven to clear GHA IPs (`crawl4ai_accela_gha_ip` CLOSED, run 27602909470) but that does NOT generalize to Crexi. The only documented escape is a validated `proxy_config` (residential) or a self-hosted runner — **needs a live GHA probe per target**, do not assume.
- **Our GHA install steps are inconsistent in a way easy to under-state:** `crawl4ai-setup` (news workflow) provisions Playwright but **NOT patchright** — and UndetectedAdapter drives patchright (`python -m patchright install chromium` in lee-permits). Standardizing blindly on `crawl4ai-setup` would BREAK the stealth jobs. See the GHA section.

## The 3 tracked checks — verdicts

### C1 `crawl4ai_native_extract_rewire` — VERDICT: generalize the crexi DIY pattern; LLMExtractionStrategy is opt-in only

**Decision: rebuild `extract_client.extract()` by generalizing the proven crexi DIY pattern, NOT by adopting `LLMExtractionStrategy`.**

Evidence-weighted, against our actual code:

| Factor | DIY crexi pattern | Native `LLMExtractionStrategy` | Winner |
|---|---|---|---|
| Stealth | runs through `Crawl4aiSession` UndetectedAdapter | also runs through it (orthogonal: `extraction_strategy` is a `CrawlerRunConfig` kwarg; `UndetectedAdapter` is on `crawler_strategy` — independent objects) | **tie** (stealth is NOT a differentiator — verified) |
| Model control | direct `anthropic` SDK, `model="claude-haiku-4-5-20251001"` (crexi/extract.py:97) | routes through `unclecode-litellm==1.81.13` — a NEW transitive dep + second drift surface; docs pin stale `claude-3-x` ids | **DIY** |
| JSON reliability | defensive fence-strip + `json.loads` + graceful empty-return (extract.py:101-118), battle-tested 2026-06-16 | docs warn "if the model returns invalid JSON, partial extraction might happen, or you might get an error" | **DIY** |
| Contract fit | crexi already emits `{rows:[...]}`; extract()'s firecrawl-shape is a near lift-and-shift | returns per-page `extracted_content` we'd re-aggregate into `{rows}` | **DIY** |
| Long-page handling | hard-truncates to `[:28000]` (extract.py:83) — silently drops overflow | built-in `apply_chunking` + `chunk_token_threshold` + `overlap_rate` | **native** (the one genuine win) |
| Cost | one model, one token cost | identical model cost, but chunking can RAISE it (multiple calls + overlap) | **DIY** |

**Build outline:**
1. Rewrite `extract()` in `ingest/lib/extract_client.py`: loop `urls` → `Crawl4aiSession` stealth fetch → BeautifulSoup strip → `anthropic` SDK `claude-haiku-4-5-20251001` (temp 0) → `json.loads` → accumulate into `{status, data:{rows}, _provenance}`. Lift the fence-strip + graceful-empty logic verbatim from `crexi/extract.py:101-118`.
2. **Steal one idea from native:** replace the silent `[:28000]` truncation with simple token-aware chunk-and-merge so long pages don't lose rows.
3. **Delete the inert Firecrawl-primary branch** (extract.py:80-117) — it has zero production callers (confirmed in the module docstring) and contradicts the crawl4ai-only decree.
4. Keep `LLMExtractionStrategy` documented as opt-in for genuinely nested/knowledge-graph schemas where chunking + Pydantic enforcement earns the dependency.

**Effort: M. Risk: low.** **Live battle-test target: the Crexi lease scrape (Estero + Fort Myers Beach)** — it's the one live consumer of the DIY pattern and the SPA where extract() would actually be exercised. Run it locally before closing the check (`public.checks` is prod evidence, not "code looks right").

**Contradiction to flag:** two lenses pushed `JsonCssExtractionStrategy.generate_schema` (one-time LLM → free deterministic CSS thereafter) as superior to per-row Haiku. They're RIGHT — but for a different problem. That's a **per-source "right tool" note** for stable-layout government/MLS portals, NOT a change to `extract()`, whose contract targets unstructured JS SPAs like Crexi. Don't let it derail the C1 rewire; file it as a separate pattern for future fixed-layout targets.

### C2 `ingest_test_tree_consolidation` — VERDICT: merge into `ingest/tests/lib/`, decouple, then actually CI-gate

**Confirmed by reading all four files: NOT a collision, NOT CI-gated → pure cleanup.** The two trees test different surfaces:

- `ingest/lib/test_crawl4ai_client.py` — `download_step()` guard behavior (mocked crawler, 3 cases)
- `ingest/lib/test_extract_client.py` — `extract()` firecrawl→spider fallback (7 cases)
- `ingest/tests/lib/test_crawl4ai_client.py` — `session.step` against `raw://` HTML **+ `lee_permits.scraper` JS builders** (date-search/next-page/wait predicates)
- `ingest/tests/lib/test_extract_client.py` — `scrape_with_fallback()` (8 cases)

So `test_crawl4ai_client.py` exists in BOTH trees but tests non-overlapping things (download guards vs raw:// + JS builders), and `test_extract_client.py` exists in both but tests different functions (`extract()` vs `scrape_with_fallback()`). This is a merge, not a dedupe-and-delete. (Both collect cleanly today — each dir has `__init__.py`, distinct module paths, no import-mismatch error.)

**Canonical layout + exact moves:**
- Canonical home: **`ingest/tests/lib/`** (conventional `tests/` layout).
- Move `ingest/lib/test_crawl4ai_client.py`'s 3 download_step tests → merge INTO `ingest/tests/lib/test_crawl4ai_client.py`. Result: one file covering download_step guards + session.step.
- Move `ingest/lib/test_extract_client.py` (the 7 `extract()` fallback cases) → `ingest/tests/lib/test_extract_client.py` alongside the existing `scrape_with_fallback()` cases, OR split into `test_extract_client_extract.py` + `test_extract_client_scrape.py` for clarity.
- Delete the two emptied `ingest/lib/test_*.py` files.

**What to decouple:** `ingest/tests/lib/test_crawl4ai_client.py` imports from `ingest.pipelines.lee_permits.scraper` (lines 4-10: `build_date_search_js`, `build_next_page_js`, etc.). A generic-client test should not depend on a specific pipeline. Move those JS-builder assertions to `ingest/tests/pipelines/test_lee_permits_scraper.py`; keep `test_crawl4ai_client.py` testing only the generic `step()`/`download_step()`/`fetch_many()` surface.

**Then make it gate:** add `[tool.pytest.ini_options] testpaths = ["ingest/tests"]` to `pyproject.toml` (or `pytest.ini`) and a CI pytest step. Today no workflow runs pytest against these — they protect nothing. **Effort S–M, risk low.** Do it as its own commit; touches no production crawl4ai code, independent of C1/C3.

### C3 `crawl4ai_090_verify_bump` — VERDICT: bump to `0.9.0`, in-process surface unchanged, one pre-req per-workflow

- **Latest version (verbatim):** `0.9.0`, "Released: Jun 18, 2026". Confirmed by the dogfood `pip index versions crawl4ai` (`LATEST 0.9.0, INSTALLED 0.8.9`) and three web lenses (PyPI project page, GitHub /releases, CHANGELOG). No intermediate version between 0.8.9 and 0.9.0.
- **Is our imported-symbol surface unchanged?** Yes. CHANGELOG verbatim: *"This release contains breaking changes for the self-hosted HTTP server only. The core pip library (SDK / in-process use) is unchanged."* None of our exact imports (`crawl4ai_client.py:19-26`) appear in any 0.9.0 breaking-change list. `requires_python` is now `>=3.10`; we run 3.12/3.13, fine.
- **Safe target:** `crawl4ai==0.9.0`, in-process (Mode 1). No code edit to `crawl4ai_client.py`.

**Reconciling pip-probe (dogfood) vs changelog (release lens):** they **agree** — 0.9.0 exists, SDK unchanged, bump is safe. No disagreement on the core fact. The web lenses' "GHA `>=0.8.9` silently resolves to 0.9.0 → drift" claim is only **partially** true for our repo:
- `ingest-crexi-listings.yml:36` and `marketbeat-pdf-ingest.yml:41` install `"crawl4ai>=0.8.9"` inline → these DO float to 0.9.0 on the next runner build.
- `lee-permits-weekly.yml`, `collier-permits-monthly.yml`, `dbpr-sirs-monthly.yml`, `news-swfl-ingest.yml` install via `pip install -r ingest/requirements.txt` which pins `crawl4ai==0.8.9` → **already pinned, no drift.**

**Pre-req before closing C3:**
1. Set `ingest/requirements.txt:16` → `crawl4ai==0.9.0`.
2. Change the two inline `"crawl4ai>=0.8.9"` installs → `pip install -r ingest/requirements.txt` so there's ONE pin (kills the `>=` float).
3. Battle-test locally after the bump: crexi extract + a `Crawl4aiSession` `download_step` + lee-permits scraper before pushing.
4. **Do NOT touch the remote Docker server version** — gated separately (see server-mode landmines).
5. **Patchright note:** lee-permits/collier install `patchright` browsers separately because UndetectedAdapter drives patchright, not vanilla Playwright. Verify patchright still works with the 0.9.0 SDK in the local battle-test — it's the actual stealth engine.

## Beyond the checks — improvements

### User experience

- **Probe + fix Crexi single-scroll under-capture.** `crexi/extract.py:42` does ONE `window.scrollTo(0, document.body.scrollHeight)` then captures once. If Crexi's lease grid is virtualized (renders only visible cards, replaces on scroll), a single scroll captures one viewport. Fix: `CrawlerRunConfig(virtual_scroll_config=VirtualScrollConfig(container_selector="<grid>", scroll_count=20, scroll_by="container_height", wait_after_scroll=0.5))` if virtualized, or `scan_full_page=True` with `max_scroll_steps` if it accumulates. **Probe first (RULE 0.5):** does an early card's DOM node disappear after scrolling? Don't guess. **Effort M, risk low. Touches: crexi.** Likely raises listings-per-city yield — but the yield gain is "needs a live check."

### Correct data

- **FIX THE DEAD REMOTE-SERVER PATH (highest leverage in the whole report).** `data-readiness.ts:95` POSTs to `${CRAWL4AI_API_URL}/search` with `extraction_config:{type:"cosine"}`. This is the only TS caller of `/search` (`verification-sources.ts:101` only *builds* the query string, it doesn't POST). **No `/search` endpoint and no `"cosine"` type exist in the 0.9.x Docker server** (endpoints are `/crawl`, `/crawl/stream`, `/md`, `/html`, `/screenshot`, `/pdf`, `/execute_js`, `/token`, `/health`, `/metrics`, `/mcp/*`). It's a ~v0.4-era shape. Combined with `if (!res.ok) return null` + outer `catch { return null }` (lines 108, 115), **Tier-1 and Tier-2 of the verification ladder return null in prod and silently degrade every metric to Sonnet-only.** Fix: either (a) re-point at `/md` against a constructed search-results URL and read `result.markdown`, or (b) move verification fully in-process (the operator-blessed primary anyway). **Make the failure LOUD** — log when `res.status===404` so a misconfigured server can't silently downgrade the ladder. **Effort M, risk med. Touches: data-readiness.** First step is "needs a live check": `GET /health` on whatever `CRAWL4AI_API_URL` actually serves in prod (defaults to `http://localhost:11235`, unreachable from Vercel if unset).
- **Use `result.tables` for HTML tabular sources instead of an LLM round-trip.** crawl4ai auto-extracts data tables into `result.tables` (dicts with `headers`, `rows`, `metadata`; `table_score_threshold` default 7). For any SWFL source publishing clean HTML tables (county dashboards, BLS/Census HTML, broker stat pages), `pd.DataFrame(table['rows'], columns=table['headers'])` is deterministic, zero-cost, zero-hallucination — exactly Brain Factory rule 2 (numbers in code, LLM for prose). We use `result.tables` nowhere today. **Effort M, risk low. Touches: scrape_with_fallback consumers / future pack ingest.** Per-source pattern, not an extract() change.

### Running better

- **fetch_many → `MemoryAdaptiveDispatcher` + `RateLimiter`.** `crawl4ai_client.py:190` uses `semaphore_count=concurrency` — the legacy knob, zero throttling. Rewrite the `arun_many` call: `rate_limiter = RateLimiter(base_delay=(1.0,3.0), max_delay=60.0, max_retries=3, rate_limit_codes=[429,503]); dispatcher = MemoryAdaptiveDispatcher(max_session_permit=concurrency, rate_limiter=rate_limiter); await crawler.arun_many(urls=url_list, config=cfg, dispatcher=dispatcher)` and drop `semaphore_count` from cfg. Keeps the `{url: html}` return contract. Free 429/503 backoff + OOM protection on constrained GHA runners. **Available in 0.8.9 already** (no bump required) but pairs with it. **Effort M, risk low. Touches: fetch_many** (and every cron that fans out detail pages — lee-permits detail fetches).
- **Optional streaming variant of fetch_many.** `CrawlerRunConfig(stream=True)` turns `arun_many` into an async generator (`async for result in await crawler.arun_many(...)`), bounding peak memory on large batches. Low priority, cheap once the dispatcher refactor lands. **Effort S, risk low. Touches: fetch_many.**
- **Wider randomized pacing for stealth crons.** For Accela/Crexi, a `RateLimiter` with `base_delay=(2.0,5.0)` via the dispatcher looks less robotic and absorbs 429/503. In-process only — do NOT send per-request js over a 0.9.0 remote server (rejected with 400). **Effort S, risk low. Touches: lee-permits / crexi.**

### Crons / scheduling / server-mode

- **Standardize GHA browser install — but carefully.** "Standardize on `crawl4ai-setup` everywhere" **would break stealth jobs.** `crawl4ai-setup` (used in `news-swfl-ingest.yml:34`) provisions Playwright but NOT patchright, and UndetectedAdapter drives patchright (`lee-permits-weekly.yml:42`: `python -m patchright install chromium`). Correct standardization: **stealth/UndetectedAdapter jobs (lee-permits, collier, dbpr, crexi) need BOTH `playwright install --with-deps chromium` AND `patchright install chromium`**; non-stealth jobs (news) can use `crawl4ai-setup`. Add `crawl4ai-doctor` as a fast preflight everywhere to fail loud on a broken runner env. **Effort S, risk med. Touches: all crawl4ai crons.**
- **Pin all crawl4ai installs to `==0.9.0` via requirements.txt.** Replace the two inline `"crawl4ai>=0.8.9"` installs (crexi, marketbeat) with `pip install -r ingest/requirements.txt`. One pin, reproducible. **Effort S, risk low.**
- **AdaptiveCrawler / BestFirst for the news-crawl path — enhancement, brainstorm first.** `verification-sources.ts` builds `site:`-scoped queries to govt/RE/financial domains. `AdaptiveCrawler(strategy='statistical')` (no API cost) stops at saturation instead of fixed `max_results=3`; or `BestFirstCrawlingStrategy + KeywordRelevanceScorer + DomainFilter`. SDK-side (sidesteps the /search problem entirely). **Effort L, risk low. Touches: news-crawl.** Not urgent; gate behind brainstorming (RULE 3.5).

## The GHA datacenter-IP gap — best available answer

**Home-IP-only is NOT fully escapable, but it's not a hard wall either — it's per-target and must be probed.**

- **What UndetectedAdapter does and doesn't do:** it defeats browser fingerprinting (the WebDriver/automation tells). It does **NOT** change your egress IP. GHA runners use well-known Azure/datacenter ASN ranges that many anti-bot WAFs (Akamai, Cloudflare bot-mgmt) block at the network layer regardless of how human the browser looks.
- **What's proven:** Accela clears GHA IPs — `crawl4ai_accela_gha_ip` CLOSED (run 27602909470, per `lee-permits-weekly.yml:6`). **This does NOT generalize.** Crexi runs active anti-bot; collier-permits is explicitly HELD pending a green GHA dry-run probe (`collier-permits-monthly.yml:4-5`).
- **The documented escapes (in order of preference):**
  1. **Validated `proxy_config` (residential/rotating).** Add an optional `CRAWL4AI_PROXY` env passed via `CrawlerRunConfig(proxy_config=...)`. **Critical:** must be the structured `proxy_config`, NOT the raw `--proxy-server` flag in `extra_args` — 0.8.9+ ignores raw proxy flags (SSRF hardening).
  2. **Self-hosted / home runner** for the specific scraper that's blocked.
- **Process rule:** probe each new target from a GHA runner before trusting it. The home-IP success does NOT transfer. **For Crexi specifically: needs a live GHA probe.**
- **One more landmine:** the 0.9.0 remote server rejects `js_code`/`js_code_before_wait`/`proxy`/`cookies` over the network with HTTP 400. Our stealth path depends on exactly those (`crawl4ai_client.py:84` passes `js_code_before_wait`). **Interactive/stealth scraping can NEVER move to the 0.9.0 remote server — it stays in-process SDK forever.** Document this where `CRAWL4AI_API_URL` is consumed so no future session tries to "consolidate" onto the server and silently loses stealth.

## Prioritized action list

| Rank | Action | Check/area | Effort | Risk | Confidence |
|---|---|---|---|---|---|
| 1 | Fix/replace the dead `/search`+cosine call in `data-readiness.ts`; make 404 LOUD | Correct data | M | med | high |
| 2 | Bump `crawl4ai==0.9.0` in requirements.txt + align crexi/marketbeat `>=` to the pinned install; local battle-test | C3 | S | low | high |
| 3 | fetch_many → `MemoryAdaptiveDispatcher` + `RateLimiter`; drop `semaphore_count` | Running better | M | low | high |
| 4 | Rewrite `extract()` from crexi DIY pattern; kill 28000-char truncation; delete inert Firecrawl branch | C1 | M | low | high |
| 5 | Consolidate test trees into `ingest/tests/lib/`, decouple lee_permits JS tests, add CI pytest + testpaths | C2 | S–M | low | high |
| 6 | Fix GHA browser-install: stealth jobs need playwright+patchright (NOT just crawl4ai-setup); add crawl4ai-doctor preflight | Crons | S | med | high |
| 7 | Probe Crexi virtual-scroll; switch to VirtualScrollConfig/scan_full_page if under-capturing | UX / crexi | M | low | med |
| 8 | Add optional `CRAWL4AI_PROXY` via structured `proxy_config` for datacenter-blocked targets | Crons / GHA IP | M | med | med |
| 9 | Use `result.tables` for clean HTML tabular SWFL sources (deterministic, no LLM) | Correct data | M | low | med |
| 10 | Document the in-process-vs-remote-server split + 0.9.0 server hardening where CRAWL4AI_API_URL is consumed | Server-mode | S | low | high |
| 11 | AdaptiveCrawler/BestFirst for news-crawl (brainstorm first, RULE 3.5) | Running better | L | low | low |

Why #1 > #2: the bump is the named check, but the dead verification ladder is actively wrong in prod every blast. Highest leverage. #3 (dispatcher) ranks above #4 (extract rewire) because it hardens every cron for less effort and `extract()` has zero production callers today — the rewire is enabling, not fixing a live bug.

## Verbatim verification appendix

| Claim | Verbatim string | Source |
|---|---|---|
| Latest version | `0.9.0` — "Released: Jun 18, 2026" | https://pypi.org/project/crawl4ai/ |
| SDK unchanged | "This release contains breaking changes for the self-hosted HTTP server only. The core pip library (SDK / in-process use) is unchanged." | https://github.com/unclecode/crawl4ai/blob/main/CHANGELOG.md |
| SDK unchanged (mirror) | "these migration requirements apply exclusively to the self-hosted Docker HTTP server. In-process SDK usage remains unaffected." | https://github.com/unclecode/crawl4ai/blob/main/deploy/docker/MIGRATION.md |
| Stealth pattern (our import) | `strategy = AsyncPlaywrightCrawlerStrategy(browser_config=browser_config, browser_adapter=adapter)` ; `async with AsyncWebCrawler(crawler_strategy=strategy, config=browser_config) as crawler:` | https://docs.crawl4ai.com/advanced/undetected-browser/ |
| Our kwarg confirmed | "js_code_before_wait: JavaScript to run before wait_for" | https://docs.crawl4ai.com/api/parameters/ |
| 0.9.0 rejects over network | "js_code, js_code_before_wait, c4a_script, proxy / proxy_config, extra_args, user_data_dir, cdp_url, cookies, headers, init_scripts, base_url, deep_crawl_strategy, simulate_user, magic, process_in_browser, and nested LLM config objects" | https://github.com/unclecode/crawl4ai/blob/main/deploy/docker/MIGRATION.md |
| 0.9.0 auth-mandatory | "the server no longer serves an unauthenticated API on 0.0.0.0"; "the JWT implementation changed and tokens from older versions are no longer valid" | https://github.com/unclecode/crawl4ai/blob/main/CHANGELOG.md |
| Server endpoints (no /search) | POST `/crawl`, `/crawl/stream`, `/md`, `/html`, `/screenshot`, `/pdf`, `/execute_js`, `/token`; GET `/health`, `/metrics`; `/mcp/*` | https://github.com/unclecode/crawl4ai/blob/main/deploy/docker/README.md |
| LLMExtractionStrategy via LiteLLM | "unclecode-litellm==1.81.13"; provider=`anthropic/claude-3-5-sonnet-20240620`; "Any model that LiteLLM supports is fair game"; `extra_args={"temperature":0.0,"max_tokens":800}`; `extraction_type="schema"` | https://docs.crawl4ai.com/extraction/llm-strategies/ |
| LLMExtractionStrategy JSON caveat | "if the model returns invalid JSON, partial extraction might happen, or you might get an error" | https://docs.crawl4ai.com/extraction/llm-strategies/ |
| no-LLM strategy | `JsonCssExtractionStrategy.generate_schema(html=..., query=..., schema_type="css", llm_config=..., validate=True)`; `RegexExtractionStrategy(pattern=RegexExtractionStrategy.Email \| RegexExtractionStrategy.PhoneUS)` | https://docs.crawl4ai.com/extraction/no-llm-strategies/ |
| Dispatcher signatures | `MemoryAdaptiveDispatcher(memory_threshold_percent=90.0, check_interval=1.0, max_session_permit=10, ...)`; `RateLimiter(base_delay=(1.0, 3.0), max_delay=60.0, max_retries=3, rate_limit_codes=[429, 503])`; `await crawler.arun_many(urls=urls, config=run_config, dispatcher=dispatcher)` | https://docs.crawl4ai.com/advanced/multi-url-crawling/ |
| Streaming | `run_config = CrawlerRunConfig(stream=True)` | https://docs.crawl4ai.com/advanced/multi-url-crawling/ |
| VirtualScroll | `VirtualScrollConfig(container_selector="#feed", scroll_count=20, scroll_by="container_height", wait_after_scroll=0.5)` | https://docs.crawl4ai.com/advanced/virtual-scroll/ |
| Table extraction | `df = pd.DataFrame(table_data['rows'], columns=table_data['headers'])`; `table_score_threshold` default 7 | https://docs.crawl4ai.com/core/table_extraction/ |
| AdaptiveCrawler | `await adaptive.digest(start_url="...", query="...")`; confidence_threshold default 0.7, max_pages default 20 | https://docs.crawl4ai.com/core/adaptive-crawling/ |
| GHA setup step | "After installing, call: crawl4ai-setup"; "crawl4ai-setup should automatically install and set up Playwright" | https://docs.crawl4ai.com/core/installation/ , https://pypi.org/project/crawl4ai/ |
| Available versions (dogfood) | "0.9.0, 0.8.9, 0.8.8, 0.8.7, 0.8.6, 0.8.5, 0.8.0, 0.7.8 …" from `pip index versions crawl4ai`; INSTALLED 0.8.9, LATEST 0.9.0 | dogfood run (live, this session) |

**Code-path facts verified in our repo this session (not from memory):**
- `ingest/lib/crawl4ai_client.py:19-26` — exact import list bumped against 0.9.0 changelog; `:190` uses `semaphore_count`; `:84` passes `js_code_before_wait`.
- `ingest/pipelines/crexi_listings/extract.py:42` single scroll; `:83` `[:28000]` truncation; `:97` `model="claude-haiku-4-5-20251001"`.
- `ingest/lib/extract_client.py:80-117` inert Firecrawl-primary branch with zero callers (per its own docstring).
- `lib/email/data-readiness.ts:95` POSTs `/search` with `:101-104` `extraction_config:{type:"cosine"}`; `:108`/`:115` silent null returns. Only TS `/search` caller (verified `verification-sources.ts:101` only builds the query, no POST). [Re-verified by hand 2026-06-20.]
- `ingest/requirements.txt:16` pins `crawl4ai==0.8.9`.
- GHA: `ingest-crexi-listings.yml:36` + `marketbeat-pdf-ingest.yml:41` use `"crawl4ai>=0.8.9"` (float to 0.9.0); lee-permits/collier/dbpr/news use `pip install -r ingest/requirements.txt` (pinned 0.8.9). lee-permits/collier install `patchright install chromium` separately; news uses `crawl4ai-setup` (no patchright). Accela GHA-IP CLOSED (run 27602909470); collier schedule HELD pending GHA probe.
- C2: both test trees read; `ingest/tests/lib/test_crawl4ai_client.py:4-10` imports `lee_permits.scraper` (the coupling to decouple).
