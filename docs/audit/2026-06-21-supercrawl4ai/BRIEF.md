# supercrawl4ai — research brief (crawl4ai 0.9.0, in-process SDK)

**Written 2026-06-21.** Output of a throttled 16-agent workflow: 9 capability lenses over live
crawl4ai docs + 6 per-item verify/plan agents (#6–#11) + 1 synthesis/completeness-critic pass.
Every capability/claim carries a live vendor URL (Vendor-First). Companion to the prior
`docs/audit/2026-06-20-crawl4ai/` (HANDOFF + research) — that one shipped #1–#5; this one scopes
the enhancement tail + the broader "what else can crawl4ai do for us" sweep.

Verified this session against live code: `crexi_listings/extract.py` `[:28000]` cut + single
`_SCROLL_JS`, the 7 GHA install matrices, `requirements.txt:19` pin `crawl4ai==0.9.0`, and **zero
live `CRAWL4AI_API_URL` consumers** (the only grep hits are stale `.claude/worktrees/` copies).
crawl4ai is the **only** crawl tool; Firecrawl/Spider stay dormant key-gated fallbacks (keys unset)
and are never the path forward.

## Already shipped (#1–#5)

- **#1** — Dead `/search`+cosine ladder in `lib/email/data-readiness.ts` replaced with Anthropic `web_search` grounding (commit `32b4eb5b`). Removed the **last** `CRAWL4AI_API_URL` consumer.
- **#2** — `crawl4ai` bumped + pinned to `==0.9.0`, single source at `ingest/requirements.txt:19`.
- **#3** — `fetch_many` hardened with `MemoryAdaptiveDispatcher`+`RateLimiter` (`ingest/lib/crawl4ai_client.py:196-204`).
- **#4** — `extract_client.extract()` rewired to the crexi DIY pattern + token-aware chunking; no silent `[:28000]`-style cut in that path.
- **#5** — Test-tree consolidation (commit `24dfbf1b`).

## supercrawl4ai — NEW capabilities to adopt

Ranked by value-to-us. Deduped across 8 capability lenses; every row carries a vendor URL.
"Overlaps" ties a capability to its #6–#11 tail item.

| # | Capability | What it buys us | Where it applies | Effort | Overlaps | Vendor URL |
|---|---|---|---|---|---|---|
| 1 | **`result.tables` (DefaultTableExtraction, ON by default)** + `table_score_threshold=7` | Zero-LLM, header-keyed `{headers,rows,caption,summary}` from any `<table>`; kills positional-index parsers that silently shift on layout drift. Brain Factory rule 2. | `dbpr_sirs/pipeline.py` (Qlik grid hand-walked by `parse_*_rows`); new `fetch_tables()` on `crawl4ai_client.py` | S–M | **#9** | https://docs.crawl4ai.com/core/table_extraction/ |
| 2 | **`VirtualScrollConfig`** (replaced-DOM capture + text dedup) | Biggest Crexi yield lever IF the grid virtualizes: stitches every recycled card window into one `result.html`. In-process-only. | `crexi_listings/extract.py:63-83` | M | **#7** | https://docs.crawl4ai.com/advanced/virtual-scroll/ |
| 3 | **`scan_full_page` + `scroll_delay` + `max_scroll_steps`** (append-style auto-scroll) | One-flag full-page lazy-load for accumulating lists, bounded so it can't hang. Every future list pack inherits it. | `crawl4ai_client.py` `step()`/`_scrape_page` | S | **#7** | https://docs.crawl4ai.com/api/parameters/ |
| 4 | **`JsonCssExtractionStrategy.generate_schema`** (one-time LLM → cached free CSS) | Run LLM once on a sample Crexi card, cache the schema, extract deterministic rows with **zero** LLM per run. Kills per-run Haiku cost + hallucination on the highest-volume source. | `crexi_listings/extract.py:86-118` | M | **#7** | https://docs.crawl4ai.com/extraction/no-llm-strategies/ |
| 5 | **`crawl4ai-doctor` preflight + patchright import smoke** | Turns a silent mid-run "browser not installed" empty-HTML failure into a <30s fail-fast. **Caveat: doctor verifies Playwright only, NOT patchright** — stealth proof needs the explicit `patchright` import smoke. | All 7 crawl crons (doctor in zero today) | S | **#6** | https://docs.crawl4ai.com/core/installation/ |
| 6 | **`capture_network_requests`** (read Crexi listing JSON XHR) | Crexi renders cards from a JSON API — capture that JSON for structured rows, no scroll, no Haiku. Highest-ceiling Crexi fix if the XHR is reachable. | `crexi_listings/extract.py` `_scrape_city` | M | #7-adj | https://docs.crawl4ai.com/api/parameters/ |
| 7 | **`PruningContentFilter` → `fit_markdown`** on static fetches | One change to `_scrape_page` denoises **every** static pipeline (drops nav/footer/ads): cleaner regex parse + fewer LLM tokens, no per-pipeline edits. | `crawl4ai_client.py` `_scrape_page` | S | — | https://docs.crawl4ai.com/core/fit-markdown/ |
| 8 | **`RegexExtractionStrategy`** (built-in Email/PhoneUS/DateUS/Currency/PostalUS) | Deterministic span-anchored tokens (+ provenance) for load-bearing notice/permit fields — replaces an LLM/handwritten pass. | `dbpr_public_notices/`, `dbpr_press_releases/`; `fetch_many` passthrough | M | — | https://docs.crawl4ai.com/extraction/no-llm-strategies/ |
| 9 | **`BestFirstCrawlingStrategy` + `KeywordRelevanceScorer` + `FilterChain`** | Replaces the fixed 4-source/~40-article cap + regex relevance with a scored, depth-limited frontier. **Pure keyword math, zero API cost**, deterministic. | `news_swfl/fetcher.py` | M | **#11** | https://docs.crawl4ai.com/core/deep-crawling/ |
| 10 | **`storage_state` / `user_data_dir`+`use_managed_browser`** (warmed identity) | Turns a cold anti-bot challenge into a warm session — the vendor's headline anti-bot posture for Crexi/Akamai. Needs an out-of-band capture (ODD-style graduation). | `crawl4ai_client.py` `BrowserConfig` | M–L | #8-adj | https://docs.crawl4ai.com/advanced/identity-based-crawling/ |
| 11 | **Per-request `proxy_config` + `RoundRobinProxyStrategy`** | The **only** in-process lever for Crexi's datacenter-ASN block. Per-request `CrawlerRunConfig.proxy_config` is recommended (legacy `BrowserConfig.proxy` deprecated). Needs a proxy vendor + secret. | `crawl4ai_client.py` (Session + `fetch_many`) | S (wiring) / gated | **#8** | https://docs.crawl4ai.com/advanced/proxy-security/ |
| 12 | **`AdaptiveCrawler.digest()` (`strategy="statistical"`)** | Confidence-gated stop: walks from a seed toward a query, stops at saturation — auto-discovers rotating-URL docs (MarketBeat/county portals) spending minimum pages. No embedding dep, no LLM. | A future ODD discovery pack | L | #11-B | https://docs.crawl4ai.com/core/adaptive-crawling/ |
| 13 | **Native PDF fetch (`PDFCrawlerStrategy` + `PDFContentScrapingStrategy`)** | Routes a PDF GET through the **stealth session** (cookies/Referer intact) — recovers form/CDN-gated Colliers PDFs the bare `curl` concedes on. Adopt the FETCH; benchmark pdfplumber vs crawl4ai for the PARSE. | `marketbeat_pdf/downloader.py`, `dbpr_public_notices` | M | — | https://docs.crawl4ai.com/advanced/pdf-parsing/ |
| 14 | **`mean_delay` / `max_range`** (jittered inter-request delay) | One-line add to the `fetch_many` config; jitters **before** the first block (complements RateLimiter, which only backs off **after** a 429/503). Free, no dep. | `crawl4ai_client.py:187-192` | S | — | https://docs.crawl4ai.com/api/parameters/ |
| 15 | **`CrawlerMonitor` + `result.dispatch_result`** | Free per-URL memory/timing telemetry already attached to each result. The missing diagnostic when a GHA stealth batch hangs or OOMs. | `crawl4ai_client.py` `fetch_many` | S | — | https://docs.crawl4ai.com/advanced/multi-url-crawling/ |
| 16 | **`MemoryAdaptiveDispatcher` full params** (`memory_threshold_percent`, `check_interval`, `memory_wait_timeout`) | Runner-sized memory ceiling — graceful throttle vs a killed nightly on a constrained GHA runner (patchright Chromium is heavy). | `crawl4ai_client.py:196-204` | S | — | https://docs.crawl4ai.com/advanced/multi-url-crawling/ |
| 17 | **`CrawlerRunConfig` content scoping** (`css_selector`/`target_elements`/`excluded_tags`/`word_count_threshold`) | Narrows captured content to the listing/article region **before** the LLM — shrinks Haiku payload, kills the arbitrary char-cut that amputates rows. | `crexi`, `news_swfl`, `report_design_research` | M | — | https://docs.crawl4ai.com/core/content-selection/ |
| 18 | **`stream=True` + async-for `arun_many`** | One stuck Accela/Crexi detail page no longer blocks the rest; per-result progress + partial results on timeout. | `crawl4ai_client.py` `fetch_many` | M | — | https://docs.crawl4ai.com/api/parameters/ |
| 19 | **`remove_overlay_elements` / `remove_consent_popups`** | One flag removes cookie/consent walls **before** capture → the LLM sees listings not a banner. Less token waste, fewer empty-row blanks. | `extract_client.py` `fetch_many`, crexi | S | — | https://docs.crawl4ai.com/api/parameters/ |
| 20 | **`wait_for` js row-COUNT settle predicate** | Replaces a blind `delay_after=16s` (dbpr_sirs) / `5s+4s` (crexi) with "rows stop growing" — fast on fast loads, won't under-wait on slow ones. | `dbpr_sirs/pipeline.py:54-58`, `crexi/extract.py:69` | S | — | https://docs.crawl4ai.com/core/page-interaction/ |
| 21 | **`markdown_with_citations` / `references_markdown`** | Deterministic, deduped per-page source-URL list — replaces the brittle `LINK_RE` sieve, feeds the Data-Provenance rule for free. | `news_swfl/fetcher.py:27,36` | M | — | https://docs.crawl4ai.com/core/markdown-generation/ |
| 22 | **`DefaultMarkdownGenerator` options** (`ignore_links`/`ignore_images`/`body_width:0`) | Strips `[text](url)`/`![](img)` token noise before an LLM call — direct cost cut on link-heavy listing pages, no yield loss. | `extract_client.py:122-129`, dbpr summarize | S | — | https://docs.crawl4ai.com/core/markdown-generation/ |
| 23 | **`after_goto` / `before_retrieve_html` / `on_page_context_created` hooks** | Vendor-blessed insertion points: verify-or-fail anti-bot gate (`after_goto` + `response.status`), uniform lazy-load trigger, pre-`goto` cookie set. The right home for any future auth-gated SWFL source. | `crawl4ai_client.py` `Crawl4aiSession.__aenter__` | M | #8/#10-adj | https://docs.crawl4ai.com/advanced/hooks-auth/ |
| 24 | **`CacheMode.WRITE_ONLY`/`READ_ONLY`** | De-dupes same-URL refetch **within a job** while staying per-run fresh. Keep `BYPASS` on the per-run-fresh permit search. | `crawl4ai_client.py` | S | — | https://docs.crawl4ai.com/core/browser-crawler-config/ |
| 25 | **`screenshot=True`/`capture_mhtml=True`** provenance artifacts | A frozen DOM/visual receipt keyed to `source_url` for LLM-extraction sources we can't make deterministic — audit a disputed Crexi PSF without a re-scrape. Selective (heavy). | `extract_client.py`, crexi (LLM paths only) | S | — | https://docs.crawl4ai.com/core/crawler-result/ |
| 26 | **`LLMExtractionStrategy` `overlap_rate` idea (PORT, don't adopt)** | Our `_chunk_text` (`extract_client.py:64-79`) has **zero** overlap → a record straddling a 24k boundary loses fields. Port a ~10% tail carry (dedup on row id); keep our own engine (no litellm/model-drift dep). | `extract_client.py` `_chunk_text` | S | — | https://docs.crawl4ai.com/extraction/llm-strategies/ |

**Deliberately NOT adopted:** `LLMExtractionStrategy` wholesale (litellm dep + model drift — port the overlap idea only), the embedding adaptive/deep strategy (per-run API cost for a signal `KeywordRelevanceScorer` already approximates), `c4a_script` rewrite of the battle-tested Accela JS (`lee_permits/scraper.py` — pure risk), and **any remote-server consolidation** (the 400-reject landmine).

## The #6–#11 tail — verified plans (premise corrections in bold)

### #6 — `crawl4ai-doctor` preflight + patchright smoke
**PREMISE DRIFT (the scout's two latent-bug alarms are FALSE, verified live):** `dbpr-sirs-monthly.yml` **does** install both browsers (`:32-33`); `dbpr-public-notices` + `marketbeat` are **non-stealth** (`fetch_page_*` only — never touch UndetectedAdapter), so their missing patchright is **correct, not a bug**. **Zero patchright coverage gap** among the 7 jobs. Real gap: `crawl4ai-doctor` is in **zero** workflows.
**Plan:** add a non-fatal `crawl4ai-doctor` preflight to all 7 crons; for the 4 stealth jobs append the load-bearing `python -c "from patchright.async_api import async_playwright"` smoke (hard-fail) — doctor verifies Playwright only, NOT patchright. Ship doctor `continue-on-error: true` one cycle, then flip to hard-fail. Don't standardize on `crawl4ai-setup` (strips patchright). No new dep.
**Effort:** S. **Risk:** low-med (cannot validate locally; needs a live `workflow_dispatch`).
**Rule gates:** RULE 3.5 (short — advisory vs hard-fail decision); RULE 1 (>5 files → diff). Close on a green dispatch of ≥1 stealth + 1 non-stealth job (prod evidence).
**Recommendation: build-now** (advisory-first, confirm exit codes on one live dispatch before hard-failing).

### #7 — Crexi under-capture
**PREMISE DRIFT (important): "route crexi through the shipped `extract()`" is HALF-WRONG.** `extract()` fetches via `fetch_many` (separate contexts, **no shared session, no scroll**) — adopting it verbatim **deletes** the scroll and makes under-capture **worse**. The two losses (single scroll, then `[:28000]` at `:83`) are coupled: scroll must stay in a stateful `Crawl4aiSession`, chunking applied to full captured text. `ingest-crexi-listings.yml` **does** install both browsers (`:39,:42`).
**Plan:** **PHASE 0 PROBE (blocks everything):** P0a home-IP DOM-shape — is the grid **virtualized** (→ Branch A `VirtualScrollConfig`) or **accumulating** (→ Branch B `scan_full_page`)? P0b GHA dry-run IP probe — Crexi active anti-bot blocks datacenter ASNs; a perfect scroll fix may still yield **zero** from a runner (Accela's GHA-IP clearance does NOT generalize). Then: additive-with-defaults `step()` params (6 callers stay byte-identical), swap the chosen branch, delete `[:28000]` + apply the shipped chunker to full text.
**Effort:** M (S code; weight is the live probe). **Risk:** code low; outcome med-high, unresolvable from here.
**Rule gates:** RULE 0.5 (code ok, build gated on probe); RULE 3.5; RULE 1 (ingest write + shared lib → diff). 
**Recommendation: probe-first.**

### #8 — optional `CRAWL4AI_PROXY` (default-off `ProxyConfig` wiring)
**PREMISE DRIFT (two, both narrow the win): Collier is NOT a proxy target.** `collier_permits/fetcher.py:6-9` documents an Akamai **TLS/JA3 fingerprint** block from **any** IP — a residential proxy changes the IP, not the JA3. Honest target = **Crexi only** (datacenter-ASN reputation). Also: wire the **per-request `CrawlerRunConfig.proxy_config`** (recommended), not the deprecated `BrowserConfig.proxy`. Verified live on 0.9.0: `ProxyConfig` imports, fields `server/username/password/ip`, `from_string`/`from_env` exist.
**Plan:** `_proxy_from_env()` reading `CRAWL4AI_PROXY` (unset → `None`, zero behavior change); thread `proxy_config` into each per-step `CrawlerRunConfig` + `fetch_many`; offline tests prove default-off + `from_string` round-trip; do not touch the remote-server path. ~30–40 lines, one file.
**Effort:** S. **Risk:** low code / med outcome (empirical — needs a live GHA probe with a real credential).
**Rule gates:** RULE 3.5; keep the check OPEN until a measured Crexi yield probe.
**Recommendation: probe-first** (build default-off wiring after brainstorm; no vendor/cron flip until a live Crexi probe confirms the block lifts).

### #9 — `fetch_tables()` helper (deterministic table capture)
**PREMISE DRIFT (candidate-source correction): FGCU RERI is PDF-only** (already pdfplumber-handled) and **LeePA PropertySearch is a search FORM** — neither is a `result.tables` retrofit. The helper is for a **NEW class** (government summary tables), not existing pipelines. Verified on 0.9.0: `CrawlResult.tables` exists (`List[Dict]`, default `[]`), `table_score_threshold == 7`; used **nowhere** in the repo.
**Plan:** STEP 1 add additive `_scrape_tables()` + sync `fetch_tables()` (DataFrame per table, `df.attrs` provenance, empty-tolerant) — nothing existing modified. STEP 2 offline HTML-fixture test. STEP 3 wire the **first** consuming pipeline + brain **same PR** (brain-first), gated on a GHA-runner fetch probe — **BLS LAUS county HTML + Census QuickFacts both 403'd WebFetch this session** (datacenter-ASN), so the first source is unproven until probed.
**Effort:** S (helper+test) / M–L (first source). **Risk:** low helper / med STEP 3.
**Rule gates:** RULE 3.5 (STEP 3); brain-first (Gate 5 catalog-mirror + per-pack test); vocab gate on any new slug; Gate 4; RULE 1 on STEP 3.
**Recommendation: build-now the helper (S, low-risk); probe-first the first source.**

### #10 — document the in-process-SDK-only split + landmine
**PREMISE DRIFT (lowers effort): there is NO live remote-server consumer to document around.** `CRAWL4AI_API_URL` is consumed **nowhere** (only stale `.claude/worktrees/` copies; email path moved to `web_search` on `32b4eb5b`). So #10 = document that crawl4ai is **in-process SDK ONLY**, no server consumer, and **stealth can never move to the 0.9.0 server**. The "0.9.0 server hardening" sub-task is moot.
**Landmine (live MIGRATION.md):** the 0.9.0 remote server **rejects with HTTP 400** over the network: `js_code, js_code_before_wait, c4a_script, proxy/proxy_config, extra_args, cookies, simulate_user, magic, ...` — and `Crawl4aiSession.step` depends on `js_code_before_wait` (`crawl4ai_client.py:84`). "The core pip library (SDK / in-process use) is **unchanged**." (https://github.com/unclecode/crawl4ai/blob/main/deploy/docker/MIGRATION.md)
**Plan:** re-grep `CRAWL4AI_API_URL` (must be zero); add a <12-line canonical paragraph to the `crawl4ai_client.py` module docstring; append correcting notes (don't delete) to the two stale audit docs (`2026-06-20-crawl4ai/HANDOFF.md:24`, `research.md:121`); optional BIBLE cross-ref.
**Effort:** S. **Risk:** low (doc-only).
**Rule gates:** RULE 1 doc bucket; RULE 3.5 not triggered (documenting reality).
**Recommendation: build-now** — the landmine stops a future "consolidate onto the server" from silently losing stealth.

### #11 — `BestFirst`/Adaptive for the news path
**PREMISE DRIFT (significant): the "sidesteps the #1 server problem" justification is DEAD** — #1 was fixed by Anthropic `web_search`, not by moving to crawl4ai. #11 must stand on its own. News **does not** use the shared lib — `news_swfl/fetcher.py` rolls its own `AsyncWebCrawler()` (non-stealth; GHA installs `crawl4ai-setup` only). Live-probed on 0.9.0: `BestFirstCrawlingStrategy`/`KeywordRelevanceScorer` import; scorer is keyword+weight only (zero API cost).
**Plan:** **Option A (recommended):** new `adaptive_fetcher.py` behind a `NEWS_ADAPTIVE` env flag (default off), `BestFirstCrawlingStrategy(max_depth=1, url_scorer=KeywordRelevanceScorer(...), filter_chain=[DomainFilter, URLPatternFilter])`, returns the **same** `ArticleRow` via existing `normalize()`, fixture test, then a **mandatory local battle-test** measuring yield/freshness/precision vs the ~40-cap baseline before any check closes. Preserve the dlt `primary_key=article_url` contract. **Option B (defer):** `AdaptiveCrawler.digest()` saturation. **Option C (reject):** embedding strategy (per-run cost).
**Effort:** M (code S; the M is the dry-run). **Risk:** code low / med empirical.
**Rule gates:** RULE 3.5 (the gate); battle-test required before close.
**Recommendation: brainstorm-first.**

## Recommended build order

1. **#10 — in-process-only doc + landmine** `[build-now]` (RULE 1 doc bucket). Cheapest, highest protective value. (re-grep `CRAWL4AI_API_URL` first.)
2. **#6 — doctor preflight + patchright smoke** `[build-now]` after short RULE 3.5 — 7 YAML inserts; doctor advisory-first, hard-fail the patchright smoke, confirm on one live dispatch.
3. **`result.tables` helper (#9 STEP 1–2)** `[build-now]` — additive `fetch_tables()` + offline fixture test. Pure Brain Factory rule 2.
4. **Cheap free-wins bundle** `[build-now]` (RULE 3.5 short, single-file lib): Cap #14 `mean_delay/max_range`, #15 `CrawlerMonitor`/`dispatch_result`, #16 dispatcher memory params, #19 `remove_overlay_elements`, #26 chunk-overlap port — all additive, no contract change, no probe.
5. **Cap #7 `PruningContentFilter → fit_markdown` on `_scrape_page`** `[build-now]` after RULE 3.5 — one change denoises every static pipeline.
6. **#7 Crexi under-capture** `[probe-first]` — P0a (virtualized vs accumulating) + P0b (GHA-IP) BEFORE the branch. Highest yield ceiling, highest uncertainty.
7. **#9 STEP 3 first table source** `[probe-first]` — GHA fetch probe (BLS LAUS/Census both 403'd) → brainstorm → brain-first pack same PR.
8. **#8 proxy wiring** `[probe-first]` — default-off after RULE 3.5; no vendor/cron flip until a live Crexi-with-credential probe. Crexi only (not Collier — JA3).
9. **#11 news BestFirst** `[brainstorm-first]` — Option A to brainstorming, then local yield/precision dry-run.
10. **Cap #4 cached JsonCss / #6 network-XHR capture / #13 stealth PDF fetch / #12 Adaptive ODD discovery** `[defer]` — each carries a live probe or a future ODD pack; sequence after #7's probe resolves whether Crexi is reachable from GHA.

## Completeness critic — unverified, needs a live browser/GHA probe

- **Whether the Crexi grid is virtualized vs accumulating** (#7 P0a) — decides Branch A vs B; wrong branch silently captures nothing extra.
- **Whether GHA datacenter ASNs can reach Crexi at all** (#7 P0b / #8 / #9 STEP 3) — Crexi active anti-bot blocks datacenter IPs; **Accela's GHA-IP clearance does NOT generalize.** BLS LAUS + Census QuickFacts both returned **403 to WebFetch this session.** No yield number can be promised for any GHA-side fix.
- **Whether `crawl4ai-doctor` exits 0 and `patchright` imports on a clean `ubuntu-latest` runner** (#6) — needs a `workflow_dispatch`.
- **Whether a residential proxy lifts the Crexi block** (#8) — empirical, needs a real credential. (Collier is conclusively NOT proxy-fixable — JA3/TLS.)

**Single highest-leverage next move:** run the **Crexi GHA-IP probe** (`ingest-crexi-listings` `workflow_dispatch --dry-run`, compare raw count vs a home-IP run). It gates the most downstream work — #7, #8, and #9 STEP 3 all collapse to "needs residential egress / self-hosted runner" if datacenter-ASN targets return zero from a GHA runner. Everything tagged `[build-now]` is independent of that probe and should ship in parallel.
