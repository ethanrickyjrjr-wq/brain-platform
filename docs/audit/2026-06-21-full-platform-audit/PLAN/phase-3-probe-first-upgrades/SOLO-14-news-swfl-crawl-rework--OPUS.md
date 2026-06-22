# 14 — news_swfl crawl rework (BestFirst frontier vs simple shared-client migrate) — **SOLO**

**Model: Opus.** **SOLO — AFTER build 01 (news schema must be fixed first).** **Priority: P3.**
Full plan: `BRIEF.md` #11 + cap #9/#21. This supersedes the old standalone "migrate news_swfl onto the
shared client" TODO — Option B below *is* that migration.

## The defect (verified)
`ingest/pipelines/news_swfl/fetcher.py` rolls its own bare `AsyncWebCrawler()` (line 55) — **bypasses the
shared client** (no `Crawl4aiSession`/`fetch_many`, no dispatcher, no rate-limiter, no stealth) — with a
**per-source** cap `MAX_ARTICLES_PER_SOURCE = 10` across **4 sources ≈ 40 total** (the audit's "fixed
10-article cap" was imprecise; it's ~40). Relevance is a regex `LINK_RE` sieve.

## ⚠️ Premise correction (BRIEF #11)
The "this sidesteps the #1 server problem" justification is **dead** (#1 was fixed by Anthropic
`web_search`). #14 must stand on its own merit: a scored, depth-limited frontier beats a fixed 4-source/~40
cap + regex. `BestFirstCrawlingStrategy` + `KeywordRelevanceScorer` are **pure keyword math, zero API cost**.

## Options (pick after a brainstorm + battle-test)
- **Option A (recommended):** new `adaptive_fetcher.py` behind a `NEWS_ADAPTIVE` env flag (default off):
  `BestFirstCrawlingStrategy(max_depth=1, url_scorer=KeywordRelevanceScorer(...), filter_chain=[DomainFilter,
  URLPatternFilter])`, returns the **same** `ArticleRow` via the existing `normalize()`, preserving the dlt
  `primary_key=article_url` contract. Optionally adopt `markdown_with_citations` (#21) for the provenance list.
- **Option B (simpler):** just migrate `fetcher.py` onto the shared `Crawl4aiSession`/`fetch_many` (gets
  dispatcher + rate-limiter + the build-07 free-wins) and keep the per-source cap. Lower ceiling, lower risk.
- **Option C (reject):** embedding adaptive strategy (per-run API cost a keyword scorer already approximates).

## Best-practice fold-in
REPORT BRAINS bias: workflows (LLMs in predefined code paths) beat agents for predictable tasks — start
simple, deterministic-first. So **default to Option B** (shared-client migrate) unless the battle-test below
shows Option A's scored frontier clearly wins on yield/precision. Same logic as the existing gate; this just
sets the prior.

## Gate
**Mandatory local battle-test** measuring yield / freshness / precision vs the ~40-cap baseline BEFORE any
check closes. If Option A doesn't beat baseline, ship Option B.

## Steps
1. **Probe first.** Read `news_swfl/fetcher.py` + `normalizer.py` (+ confirm build 01's schema fix landed so
   loads succeed). Confirm `BestFirstCrawlingStrategy`/`KeywordRelevanceScorer` import on the installed 0.9.0.
2. **RULE 3.5 brainstorm** (this is a behavior change — the gate). Then implement the chosen option behind
   the flag, fixture test, then the battle-test.

## Done when
- Battle-test numbers recorded; chosen option behind a default-off flag (Option A) or a clean migration
   (Option B); `primary_key=article_url` contract preserved; loads exit 0.

## Risk
Code low / outcome medium (empirical) → battle-test required, hence SOLO + Opus.

## References (added 2026-06-22 — crawl4ai-live + best-practices fold-in)
**crawl4ai-live (tool-usage reference, docs/audit/2026-06-21-crawl4ai-live/):**
- `docs/audit/2026-06-21-crawl4ai-live/round3/25-deep-crawling.md` — BestFirst deep-crawl strategy = Option A
- `docs/audit/2026-06-21-crawl4ai-live/round3/26-adaptive-crawling.md` — adaptive stop conditions
- `docs/audit/2026-06-21-crawl4ai-live/round2/10-multi-url-crawling.md` — the shared dispatcher Option B migrates onto
- `docs/audit/2026-06-21-crawl4ai-live/round3/28-crawl-dispatcher.md` — dispatcher + rate-limiter the bare crawler currently bypasses
**best-practices-research (how to build/operate what we build, docs/audit/2026-06-21-best-practices-research/):**
- `docs/audit/2026-06-21-best-practices-research/round1/brains-anthropic-effective-agents.md` (REPORT BRAINS row) — deterministic-first; prefer the simpler workflow unless the agentic path measurably wins
**Verified:** V-4 — the cap is ~40 total = MAX_ARTICLES_PER_SOURCE=10 x 4 sources (listing caps 20/source), NOT a single fixed 10-article cap — folded into Steps above where applicable.
