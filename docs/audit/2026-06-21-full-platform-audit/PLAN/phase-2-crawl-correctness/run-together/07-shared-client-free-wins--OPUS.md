# 07 — shared client: the additive "free-wins" bundle (jitter / monitor / stream / after_goto / fit_markdown)

**Model: Opus.** One file (`ingest/lib/crawl4ai_client.py`) but it's the **shared client every crawl
pipeline uses** — blast radius = all of ingest. Additive, but the byte-identical-defaults discipline is
load-bearing, so Opus. **Priority: P2.** Source detail: `BRIEF.md` caps #14/#15/#16/#18/#19/#23 + #7-cap.

## What's missing (verified)
The client is correct on the hard parts (UndetectedAdapter assembly, `MemoryAdaptiveDispatcher` +
`RateLimiter(base_delay=(1.0,3.0), max_delay=60.0, max_retries=3, rate_limit_codes=[429,503])`,
`CacheMode.BYPASS`). Missing, all available, none wired: pre-emptive jitter, streaming, telemetry, an
anti-bot gate, and a denoiser.

## Add (each DEFAULT-OFF / default-unchanged — see Phase-2 `_CONTRACT.md`)
1. **`mean_delay`/`max_range`** on `fetch_many`'s dispatcher (#14) — pre-emptive jitter; `RateLimiter` only
   backs off *after* a 429/503. One line.
2. **`CrawlerMonitor` + `result.dispatch_result`** (#15) — per-URL memory/timing; the missing diagnostic
   when a GHA batch hangs/OOMs. Surface it to logs.
3. **`MemoryAdaptiveDispatcher` full params** (#16) — `memory_threshold_percent`, `check_interval`,
   `memory_wait_timeout` so a constrained runner throttles instead of getting killed.
4. **`stream=True` option** on `fetch_many` (#18) — async-for so one stuck detail page doesn't block the
   batch. Default off (collect-all stays the default) to honor byte-identical.
5. **`after_goto` anti-bot gate** (#23) — `Crawl4aiSession.__aenter__` sets a hook checking `response.status`
   right after navigation; fail fast/loud on a 403/challenge instead of returning thin HTML as "success."
   This is the gate the audit flagged missing (client only checks `r.success` after capture, ~101-102).
6. **`PruningContentFilter` → `fit_markdown`** on `_scrape_page` (#7-cap) — denoises every static fetch
   (drops nav/footer/ads): cleaner parse + fewer LLM tokens. Default behavior unchanged unless opted in.

## Steps
1. **Probe first.** Read the whole `crawl4ai_client.py` (it's ~221 lines): `__init__`/`__aenter__` (54-75),
   `step` (88-102), `_scrape_page` (~150), `fetch_many` (185-220).
2. **RULE 3.5 brainstorm (short):** which knobs default-off vs default-on. Default: everything OFF except
   the `after_goto` gate (decide — a loud anti-bot gate is arguably the safe default, but it changes
   behavior on a challenged page; if so it may belong in its own build). Keep the 6 existing callers
   byte-identical.
3. Implement additively; keep the `RateLimiter`/dispatcher exact signatures intact.

## Done when
- Full ingest smoke (a representative `fetch_many` + a `Crawl4aiSession` step + a `_scrape_page`) behaves
  **identically by default**; the supercrawl bench/test still pass; the new knobs are reachable + unit-tested.

## Best-practice fold-in
No new recommendation beyond the references below — this is the canonical free-wins bundle. Confirmed live
(`ingest/lib/crawl4ai_client.py`, 2026-06-22): the `RateLimiter(base_delay=(1.0,3.0), max_delay=60.0,
max_retries=3, rate_limit_codes=[429,503])` signature (lines 208-213) and the `UndetectedAdapter` assembly
(`__aenter__` 65-76) are exact and correct — keep both byte-identical; all six additions are purely additive.

## Risk
Medium (shared client). Contained by default-off + the byte-identical verification. Serializes BEFORE 12/13.

## References (added 2026-06-22 — crawl4ai-live + best-practices fold-in)
**crawl4ai-live (tool-usage reference, docs/audit/2026-06-21-crawl4ai-live/):**
- `docs/audit/2026-06-21-crawl4ai-live/round1/06-undetected-browser.md` — UndetectedAdapter assembly (the hard part the repo already got right — do not disturb)
- `docs/audit/2026-06-21-crawl4ai-live/round2/10-multi-url-crawling.md` — dispatcher + stream=True bounds memory
- `docs/audit/2026-06-21-crawl4ai-live/round2/11-hooks-auth.md` — after_goto(page,context,url,response) anti-bot gate
- `docs/audit/2026-06-21-crawl4ai-live/round2/16-fit-markdown.md` — PruningContentFilter -> fit_markdown denoiser
- `docs/audit/2026-06-21-crawl4ai-live/round3/28-crawl-dispatcher.md` — MemoryAdaptiveDispatcher + RateLimiter + CrawlerMonitor signatures
- `docs/audit/2026-06-21-crawl4ai-live/round3/20-arun-result-contract.md` — result.dispatch_result telemetry
- `docs/audit/2026-06-21-crawl4ai-live/round3/24-network-console-capture.md` — capture_network_requests
**best-practices-research (how to build/operate what we build, docs/audit/2026-06-21-best-practices-research/):**
- (n/a — crawl4ai tool-usage build)
**Verified:** confirmed: RateLimiter(base_delay=(1.0,3.0), max_delay=60.0, max_retries=3, rate_limit_codes=[429,503]) — keep EXACT; UndetectedAdapter assembly is correct, keep intact — folded into Steps above where applicable.
