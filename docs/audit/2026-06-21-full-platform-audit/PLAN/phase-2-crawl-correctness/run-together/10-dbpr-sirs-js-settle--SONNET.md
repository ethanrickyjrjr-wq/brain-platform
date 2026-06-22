# 10 — dbpr_sirs: replace the blind 16s sleep with a `js:` row-count settle

**Model: Sonnet.** Single file, one mechanism swap. **Priority: P2.** (BRIEF cap #20.)

## The defect (verified)
`ingest/pipelines/dbpr_sirs/pipeline.py:48` `_WAIT_SECONDS = 16.0  # Qlik needs ~15s to render rows`, used
at `:57` `delay_after=_WAIT_SECONDS`. `delay_before_return_html` (what `delay_after` maps to) is the doc's
**"extra safety margin"**, NOT the settle mechanism. The real settle is `wait_for="js:() => {…}"`, which
**polls until true or timeout** — `lee_permits` already uses this pattern correctly. A blind 16s both
under-waits on a slow render and wastes time on a fast one.

## Steps
1. **Probe first.** Read `dbpr_sirs/pipeline.py` (the Qlik fetch around `:48-60`), and `lee_permits`'s `js:`
   `wait_for` predicate as the reference pattern. Identify the DOM signal that means "rows finished
   rendering" (a row container whose child count stabilizes).
2. Replace `delay_after=16.0` with `wait_for="js:() => { /* row count stopped growing */ }"` — a predicate
   that captures the grid's row count, waits a tick, and returns true once it stops increasing (with a
   bounded timeout). Keep a *small* `delay_before_return_html` (≤2s) as the residual safety margin.
3. Leave the extraction/parse path alone — **this build is ONLY the wait swap.** (The `result.tables`
   rewrite of the parser is the separate, probe-gated build 13; do not touch parsing here.)

## Done when
- A local/dispatch run of dbpr_sirs returns the same (or more complete) row set as the 16s version, faster
  on a quick render and not under-waiting on a slow one. `condo-sirs-swfl` output unchanged.

## Risk
Low. Same extraction, smarter wait. Sequences BEFORE build 13 (which rewrites the same file's parser).

## Best-practice fold-in
`wait_for="js:() => {…}"` **polls until true or timeout** (confirmed in crawl4ai-live round1/05-parameters.md) — `delay_after` is only a safety margin, never a settle. Keep the residual `delay_before_return_html` ≤2s. Build 13 rewrites the parser in this same file; do not touch parsing here.

## References (added 2026-06-22 — crawl4ai-live + best-practices fold-in)
**crawl4ai-live (tool-usage reference, docs/audit/2026-06-21-crawl4ai-live/):**
- `docs/audit/2026-06-21-crawl4ai-live/round1/05-parameters.md` — wait_for="js:() => {...}" POLLS until true or timeout = the correct settle; delay_after is only a safety margin
- `docs/audit/2026-06-21-crawl4ai-live/round1/08-page-interaction.md` — JS-driven wait conditions
- `docs/audit/2026-06-21-crawl4ai-live/round2/14-session-management.md` — settling a stateful grid before capture
**best-practices-research (how to build/operate what we build, docs/audit/2026-06-21-best-practices-research/):**
- (n/a — crawl4ai tool-usage build)
**Verified:** confirmed blind-delay-as-settle anti-pattern; 13 also touches this file (sequence 10 -> 13) — folded into Steps above where applicable.
