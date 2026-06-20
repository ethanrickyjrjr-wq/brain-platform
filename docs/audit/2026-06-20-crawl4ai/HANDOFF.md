# HANDOFF — crawl4ai improvements & fixes (next Claude)

**Written 2026-06-20.** Companion to `research.md` in this folder (full evidence + verbatim-source appendix).
This file is the action plan; `research.md` is the proof. Read this first, open `research.md` when you
need the receipts for a specific claim.

**How you found this:** it's linked from four `checks` rows (`crawl4ai_search_ladder_dead`,
`crawl4ai_090_verify_bump`, `crawl4ai_native_extract_rewire`, `ingest_test_tree_consolidation`) and the
2026-06-20 SESSION_LOG entry. That's the discoverability spine — do the same when you ship a piece.

---

## 0. Orient before you touch anything (RULE 0.5 — probe first)

crawl4ai is the **only** web-crawl tool for ingest here (operator decree 2026-06-16). **Firecrawl is NOT
installed; never reintroduce it.** Spider + Firecrawl survive only as dormant, key-gated fallbacks
(`SPIDER_API_KEY` / `FIRECRAWL_API_KEY`, both unset). Do not propose them as the path forward.

There are **TWO crawl4ai modes** in this repo — keep them straight:

| Mode | Where | Used by | Notes |
|---|---|---|---|
| **In-process SDK** (Python) | `ingest/lib/crawl4ai_client.py` | crexi, lee-permits, collier, dbpr, news, detail-page fans | This is the real workhorse. Pinned `crawl4ai==0.8.9` in `ingest/requirements.txt`. |
| **Remote HTTP server** | consumed in `lib/email/data-readiness.ts` + `verification-sources.ts` via `CRAWL4AI_API_URL` | the email data-readiness verification ladder | Default URL `http://localhost:11235`. **Currently calls a dead endpoint — see #1.** |

The SDK has three surfaces in `crawl4ai_client.py`:
- `Crawl4aiSession` — persistent `AsyncWebCrawler` + `UndetectedAdapter`, `enable_stealth=True`, **sequential**, shared `session_id`, file downloads via `accept_downloads` + `download_step()`. Stealth/interactive (Accela, Crexi).
- `fetch_many` — `arun_many` for independent parallel pages (legacy `semaphore_count` knob — see #3).
- `fetch_page_markdown` / `fetch_page_html` — sync helpers for static pages, no stealth.

**Stealth engine = patchright, not vanilla Playwright.** `UndetectedAdapter` drives patchright; lee-permits/collier
GHA jobs run `python -m patchright install chromium` separately. This bites in #2 and #6.

**Run the tests / battle-tests locally (everything here is in-process, no network mocks needed for the smoke):**
```bash
# dogfood smoke (proves the SDK works end-to-end; ~3-4s, real Chromium):
PYTHONPATH=. python -c "from ingest.lib.crawl4ai_client import fetch_page_markdown as f; print(len(f('https://docs.crawl4ai.com/')))"
# the crawl4ai/extract unit trees:
python -m pytest ingest/lib/test_crawl4ai_client.py ingest/lib/test_extract_client.py ingest/tests/lib -q
# version truth (authoritative, no web):
python -m pip index versions crawl4ai
```

---

## 1. 🔴 FIX THE DEAD `/search` VERIFICATION LADDER — highest leverage, do first

**Not one of the three tracked checks; it's the only thing actively wrong in prod.** Check key:
`crawl4ai_search_ladder_dead`.

`lib/email/data-readiness.ts:88-118` (`crawl4aiSearch`) POSTs to `${CRAWL4AI_API_URL}/search` with
`extraction_config:{ type:"cosine", ... }`. **Neither `/search` nor the `cosine` extraction type exists in
crawl4ai since ~v0.4.** The 0.9.x server endpoints are `/crawl`, `/crawl/stream`, `/md`, `/html`,
`/screenshot`, `/pdf`, `/execute_js`, `/token`, `/health`, `/metrics`, `/mcp/*` (see research.md appendix).
The call is wrapped in `if (!res.ok) return null` (108) + `catch { return null }` (115) — so Tier-1/Tier-2 of
the data-readiness verification ladder **return null silently and degrade every metric to Sonnet-only**,
losing the two-source consensus and burning tokens. `verification-sources.ts:101` only *builds* the query
string; `data-readiness.ts:95` is the sole live POST.

**Do, in order:**
1. **Live check first (don't guess):** find what `CRAWL4AI_API_URL` actually points to in prod (Vercel env). `GET <url>/health`. If unset → it's hitting `localhost:11235`, unreachable from Vercel → confirmed dead.
2. Pick the fix:
   - (a) Re-point at `/md` (or `/crawl`) against a constructed search-results URL and read `result.markdown`; **or**
   - (b) move verification fully **in-process** (SDK is the operator-blessed primary anyway) — `AdaptiveCrawler`/`BestFirst` sidesteps the server entirely (see #11).
3. **Make failure LOUD.** Log `res.status===404` instead of silent null, so a misconfigured server can't downgrade the ladder unnoticed.

Effort M, risk med. Touches: `lib/email/*`. **This is a behavioral change to a live `/api`-adjacent path → RULE 1 says diff-review before push.**

---

## 2. Bump `crawl4ai==0.9.0` + unify the pin (check `crawl4ai_090_verify_bump`)

0.9.0 (released 2026-06-18) is verified safe for us: **all breaking changes are Docker-server-only.** Vendor
verbatim: *"The core pip library (SDK / in-process use) is unchanged."* Every symbol/kwarg/result-attr we
import (`crawl4ai_client.py:19-26`) is unchanged. `requires_python` now `>=3.10` (we're on 3.12 — fine).

**Do:**
1. `ingest/requirements.txt:16` → `crawl4ai==0.9.0`.
2. Kill the pin drift: `ingest-crexi-listings.yml:36` and `marketbeat-pdf-ingest.yml:41` install `"crawl4ai>=0.8.9"` inline (they float free). Switch both to `pip install -r ingest/requirements.txt` so there is ONE pin. (lee-permits/collier/dbpr/news already use requirements.txt.)
3. **Battle-test locally after the bump** (`public.checks` = prod evidence, not "code looks right"): crexi extract + a `Crawl4aiSession.download_step` + the lee-permits scraper. **Verify patchright still works with 0.9.0** — it's the actual stealth engine.
4. **Do NOT touch the remote Docker server version** — its 0.9.0 migration (mandatory auth, JWT change, rejected over-the-wire params) is a separate landmine; gate it with #1.

Effort S, risk low. Touches: `ingest/requirements.txt` + 2 workflow YMLs. (Dep change → lockfile gate is bun-only; this is pip, but still battle-test.)

---

## 3. Harden `fetch_many` — `MemoryAdaptiveDispatcher` + `RateLimiter`

`crawl4ai_client.py:190` uses `semaphore_count=concurrency` — legacy, zero throttling. Available in 0.8.9
already (no bump needed; pairs with #2). Rewrite the `arun_many` call, keep the `{url: html}` contract:
```python
from crawl4ai import RateLimiter, MemoryAdaptiveDispatcher  # verify import path against installed pkg
rate_limiter = RateLimiter(base_delay=(1.0, 3.0), max_delay=60.0, max_retries=3, rate_limit_codes=[429, 503])
dispatcher = MemoryAdaptiveDispatcher(max_session_permit=concurrency, rate_limiter=rate_limiter)
results = await crawler.arun_many(urls=url_list, config=cfg, dispatcher=dispatcher)  # drop semaphore_count from cfg
```
Free 429/503 backoff + OOM protection on constrained GHA runners. Optional follow-on: `CrawlerRunConfig(stream=True)`
to bound peak memory on big batches. Effort M, risk low. Touches: `fetch_many` + every detail-page fan (lee-permits).

---

## 4. Rewire `extract()` — generalize the crexi DIY pattern, NOT `LLMExtractionStrategy` (check `crawl4ai_native_extract_rewire`)

**Verdict (full reasoning in research.md C1):** native `LLMExtractionStrategy` buys nothing here — stealth is
a wash (orthogonal config), and it adds a `unclecode-litellm` transitive dep + a second model-drift surface +
invalid-JSON risk + a `{rows}` re-aggregation step. The crexi path (`ingest/pipelines/crexi_listings/extract.py`)
already does `Crawl4aiSession → BeautifulSoup strip → Haiku (claude-haiku-4-5-20251001) → json.loads → {rows}`
and is battle-tested (2026-06-16).

**Do:**
1. Rewrite `extract()` in `ingest/lib/extract_client.py` from the crexi pattern; lift the fence-strip + graceful-empty logic verbatim from `crexi/extract.py:101-118`. Preserve the firecrawl-shaped `{status, data:{rows}, _provenance}` contract so `extract_agent_rows` still works.
2. **Steal one idea from native:** replace the silent `[:28000]` truncation (`crexi/extract.py:83`) with token-aware chunk-and-merge so long pages don't drop rows.
3. **Delete the inert Firecrawl-primary branch** (`extract_client.py:80-117`) — zero production callers (per its own docstring), contradicts the crawl4ai-only decree.
4. Leave `LLMExtractionStrategy` documented as opt-in for genuinely nested/knowledge-graph schemas only.

**Live battle-test target: the Crexi lease scrape (Estero + Fort Myers Beach)** — the one live consumer. Effort M, risk low.

**Separate note (don't let it derail #4):** for *stable-layout* government/MLS portals, `JsonCssExtractionStrategy.generate_schema`
(one-time LLM → free deterministic CSS thereafter) beats per-row Haiku. That's a future per-source pattern, NOT a change to `extract()`.

---

## 5. Consolidate the test trees + actually CI-gate them (check `ingest_test_tree_consolidation`)

**Confirmed: NOT a collision, NOT CI-gated → pure cleanup.** Both trees collect cleanly (each dir has
`__init__.py`, distinct module paths) and nothing in CI runs pytest against them. They test *different*
surfaces:
- `ingest/lib/test_crawl4ai_client.py` — `download_step()` guards (mocked, 3 cases)
- `ingest/lib/test_extract_client.py` — `extract()` firecrawl→spider fallback (7 cases)
- `ingest/tests/lib/test_crawl4ai_client.py` — `session.step` raw:// **+ lee_permits.scraper JS builders**
- `ingest/tests/lib/test_extract_client.py` — `scrape_with_fallback()` (8 cases)

**Do:** canonical home = `ingest/tests/lib/`. Merge the `ingest/lib/test_*` cases into the matching
`ingest/tests/lib/` files; delete the emptied `ingest/lib/test_*.py`. **Decouple:** move the
`lee_permits.scraper` JS-builder assertions out of `test_crawl4ai_client.py` into
`ingest/tests/pipelines/test_lee_permits_scraper.py` (a generic-client test shouldn't import a pipeline).
Then add `[tool.pytest.ini_options] testpaths = ["ingest/tests"]` + a real CI pytest step (today nothing runs
these — they gate zero). Effort S–M, risk low. Independent of #2/#4 — ship as its own commit.

---

## 6. Fix GHA browser installs (do NOT "standardize on crawl4ai-setup")

`crawl4ai-setup` (used in `news-swfl-ingest.yml`) provisions Playwright but **NOT patchright** — and stealth
jobs need patchright. Correct standardization:
- **Stealth/UndetectedAdapter jobs** (lee-permits, collier, dbpr, crexi): `playwright install --with-deps chromium` **AND** `patchright install chromium`.
- **Non-stealth jobs** (news): `crawl4ai-setup` is fine.
- Add `crawl4ai-doctor` as a fast preflight everywhere to fail loud on a broken runner env.

Effort S, risk med. Touches: all crawl4ai cron YMLs.

---

## 7-11. Enhancements (catalogued; brainstorm the bigger ones — RULE 3.5)

7. **Crexi single-scroll under-capture (UX).** `crexi/extract.py:42` does ONE scroll then captures. If the grid is virtualized you're getting one viewport. **Probe first** (does an early card's DOM node vanish after scroll?), then `VirtualScrollConfig(container_selector=…, scroll_count=20, scroll_by="container_height")` or `scan_full_page=True`. Effort M.
8. **Residential `proxy_config` for datacenter-blocked targets (GHA IP).** See §"GHA IP" below. Optional `CRAWL4AI_PROXY` env passed via `CrawlerRunConfig(proxy_config=…)` — **structured config, NOT raw `--proxy-server` in `extra_args`** (0.8.9+ ignores raw proxy flags). Effort M, risk med.
9. **`result.tables` for clean HTML tabular SWFL sources.** Deterministic `pd.DataFrame(table['rows'], columns=table['headers'])`, zero LLM, zero hallucination — Brain Factory rule 2. Per-source pattern. Effort M.
10. **Document the in-process-vs-remote-server split** where `CRAWL4AI_API_URL` is consumed — incl. the landmine in the next section. Effort S.
11. **`AdaptiveCrawler`/`BestFirst` for the news-crawl path** (SDK-side; sidesteps #1's server problem). Brainstorm first. Effort L.

Full ranked table with effort/risk/confidence: `research.md` → "Prioritized action list".

---

## ⚠️ Landmines (read before any "consolidation")

- **Stealth scraping can NEVER move to the 0.9.0 remote server.** It rejects `js_code` / `js_code_before_wait` / `proxy` / `cookies` / `extra_args` / `simulate_user` / `magic` over the network with HTTP 400 (research.md appendix). Our stealth path depends on exactly those (`crawl4ai_client.py:84` passes `js_code_before_wait`). Interactive/stealth stays **in-process SDK forever**. Don't let a future "consolidate onto the server" idea silently kill stealth.
- **GHA datacenter-IP gap is real and per-target.** `UndetectedAdapter` defeats browser *fingerprinting*, NOT datacenter-*ASN* reputation. Accela clears GHA IPs (`crawl4ai_accela_gha_ip` CLOSED, run 27602909470) — **this does NOT generalize.** Crexi runs active anti-bot; collier-permits is HELD pending a green GHA dry-run probe. **Probe each new target from a GHA runner before trusting it; home-IP success does not transfer.** Escapes, in order: validated residential `proxy_config` (#8) → self-hosted/home runner.
- **0.9.0 server is auth-mandatory** ("no longer serves an unauthenticated API on 0.0.0.0"; JWT changed, old tokens invalid). If you ever stand up the server for #1, wire `CRAWL4AI_API_TOKEN`.

---

## Suggested sequence

1 (prod bug, diff-review) → 2 (bump, smallest named check) → 3 (dispatcher, cheap hardening) → 5 (test cleanup, independent) → 4 (extract rewire, needs Crexi battle-test) → 6 (GHA installs) → enhancements as capacity allows.

Each piece: commit + SESSION_LOG entry + reconcile its check (`node scripts/check.mjs close <key> "<note>"` only on **prod evidence**, not "code looks right") + `node scripts/safe-push.mjs`. Stage explicit paths only — the tree has concurrent-session WIP.
