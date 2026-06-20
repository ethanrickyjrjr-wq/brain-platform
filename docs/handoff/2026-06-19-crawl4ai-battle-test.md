# Handoff — crawl4ai battle-test (firecrawl fallback consolidation)

**Date:** 2026-06-19
**Branch:** `claude/crawl4ai-fallback-integration-0wfnml`
**Status:** investigation complete; battle-test NOT yet run (env-blocked, see below)

## The ask (operator-confirmed)

Make sure **crawl4ai works correctly** so we can rely on it as much as Firecrawl.
Specifically: **battle-test crawl4ai's `LLMExtractionStrategy`.** If it reliably
gives what we want → make it **primary where needed**, with the **crexi/Haiku
pattern as fallback**, and **Firecrawl kept as the last-resort option** (operator
will pay for Firecrawl later only if crawl4ai has issues).

> Note: there are currently **no Firecrawl or Spider credits** — so today those
> fallback branches cannot actually fire. crawl4ai is effectively the only live
> scraper right now.

## What the code actually does today (verified, not remembered)

- **`ingest/lib/extract_client.py`**
  - `scrape_with_fallback()` — plain page→markdown: **crawl4ai primary** → spider →
    firecrawl last-resort. Sole production caller: `ingest/pipelines/live_search/engine.py:108`.
  - `extract()` — AI structured extract: firecrawl `/v2/agent` primary → spider
    `/ai/scrape` fallback. **Zero production callers** — only `test_extract_client.py`
    exercises it. (Confirmed via repo-wide grep.)
- **`ingest/lib/crawl4ai_client.py`** — generic primitives already in place:
  `Crawl4aiSession` (UndetectedAdapter stealth, sequential, downloads), `fetch_many`
  (parallel arun_many), `fetch_page_markdown/html` (static). **No use of
  `LLMExtractionStrategy` anywhere in the repo** (grep: zero hits).
- **`ingest/pipelines/crexi_listings/extract.py`** — the working reference for
  "/v2/agent without firecrawl": `Crawl4aiSession` stealth scrape → BeautifulSoup
  strip → **Anthropic Haiku** (`claude-haiku-4-5-20251001`) JSON extraction →
  `{"rows":[...]}`. Runs nightly. This is the **crexi/Haiku fallback pattern** the
  operator referenced.

**Conclusion from the audit:** the `/v2/agent`-has-no-crawl4ai-analogue claim in
the `extract_client.py` docstring is literally true (no single autonomous endpoint)
but the *capability* is already reproduced two ways: (1) crexi hand-rolled
Haiku extraction (proven), (2) crawl4ai-native `LLMExtractionStrategy` (untested
here — this is what to battle-test).

## Target end-state

`extract()` rebuilt so the order is:
1. **crawl4ai `LLMExtractionStrategy`** (primary, once proven)
2. **crexi/Haiku pattern** (crawl4ai fetch → strip → Haiku) (fallback)
3. **Firecrawl `/v2/agent`** (last resort, kept; fires only if credits exist)

## Environment constraints discovered (these block the battle-test here)

This remote container is behind an **allowlist egress proxy**
(`x-deny-reason: host_not_allowed`, `connection: close`).

- **Reachable:** `pypi.org` (200), `api.anthropic.com` (404 to root = real Anthropic
  response, i.e. allowed through).
- **Blocked (403 host_not_allowed):** `example.com`, `www.fgcu.edu`, `www.crexi.com`,
  `httpbin.org`, `quotes.toscrape.com` — i.e. every real scrape target.
- **`ANTHROPIC_API_KEY` is NOT set** in this container's env.

### Implications for the next session
- **crawl4ai installed fine** from pypi: `crawl4ai 0.9.0` → `/root/.local` (ephemeral;
  re-`pip install --user crawl4ai` on a fresh container). `beautifulsoup4`, `anthropic`,
  `playwright` are NOT yet installed in the base image — install from `ingest/requirements.txt`.
- **Playwright chromium download not yet verified** — `playwright install chromium`
  pulls from a Playwright CDN that may be blocked by the allowlist. **Test this first.**
  If blocked, ask operator to allowlist the Playwright CDN host(s).
- **Live-site battle-test needs an allowlist change**: add target hosts (e.g.
  `www.crexi.com`, `www.fgcu.edu`) to the environment's network egress settings.
- **LLMExtractionStrategy test needs `ANTHROPIC_API_KEY`** in env (api.anthropic.com
  is already reachable). crawl4ai's `LLMConfig` uses LiteLLM under the hood —
  `provider="anthropic/claude-haiku-4-5-20251001"`, `api_token=$ANTHROPIC_API_KEY`.

### Recommended battle-test approach (no allowlist change required)
Spin up a **localhost** HTTP server serving a realistic listings HTML fixture (the
proxy doesn't intercept localhost), point crawl4ai at `http://localhost:PORT/`, run
`LLMExtractionStrategy` with a schema, and assert structured rows come back. This
exercises the full path (browser fetch → extraction → Anthropic) using only the
already-allowlisted `api.anthropic.com`. Still requires: playwright chromium installed
+ `ANTHROPIC_API_KEY` set.

## Next steps (in order)
1. `pip install --user -r ingest/requirements.txt` (or at least crawl4ai, anthropic,
   beautifulsoup4, playwright) on the fresh container.
2. `playwright install chromium` (or `crawl4ai-setup`) — **verify CDN reachable**;
   if 403, request allowlist add.
3. Get `ANTHROPIC_API_KEY` into env.
4. Battle-test `LLMExtractionStrategy` against a localhost fixture page; measure
   reliability/accuracy of structured-row extraction.
5. If reliable → add a `crawl4ai_extract()` to `crawl4ai_client.py` and rewire
   `extract_client.extract()` to the 3-tier order above; update tests
   (`test_extract_client.py` currently mocks `firecrawl_agent`/`spider_ai_scrape`).
6. Brainstorm (RULE 3.5) before the rewire commit; keep firecrawl_client.py.
