# 04 — classifier: add DatatypeMismatch + deterministic-HOLD; widen the log tail

**Model: Sonnet.** Two `.github/scripts` files. **Priority: P1.** Restores root-cause truth.

## The defect (verified)
- `.github/scripts/lib/cron-run.mjs:22` `fetchLogTail(id, lines = 30)` — only the last **30 lines** of
  `gh run view --log-failed` reach the classifier. A traceback's root line is often above the 30-line window.
- `.github/scripts/classify-cron-failure.mjs` recognizes 7 classes (LOCKFILE, ACTION_VERSION, MISSING_DEP,
  MISSING_SECRET, SCHEMA_DRIFT, DATA_EMPTY, TRANSIENT) then falls to `UNKNOWN`. **No rule for Postgres
  `DatatypeMismatch` or a brain `deterministic HOLD`** — so the news_swfl + daily-rebuild roots both bucket
  `UNKNOWN` → `_auto-captured; pending triage_` → auto-RESOLVED. (The `RESOLVED (auto…)` flip lives in
  `.github/scripts/lib/ledger-flap.mjs` `flipMostRecentOpenRow`; don't change that here.)

## Steps
1. **Probe first.** Read `classify-cron-failure.mjs` (the 7 class regexes + the `UNKNOWN` fallback ~139-144,
   and `shouldRetry` ~181-183) and `cron-run.mjs:22-29`.
2. **Widen the tail:** raise `fetchLogTail` default from 30 to ~200 (or accept a per-call override and pass
   a larger value from `log-cron-incident.mjs`). Keep it a tail (don't fetch whole multi-MB logs).
3. **Add two rules** (deterministic classes — must NOT be retried, so they stay out of `TRANSIENT`):
   - **`SCHEMA_DRIFT` += `DatatypeMismatch`** — `column ".*" is of type .* but expression is of type .*`
     (Contract B). Same class as the existing `relation/column does not exist`.
   - **`DETERMINISTIC_HOLD`** (new class) — matches build 02's `CRON-DIAG failureClass=deterministic`
     line AND/OR raw `reason=.*\.md not found` / `failureClass: deterministic` (Contract A). `suggestedAction`:
     "master held — a brain in `sources[]` is missing from `input_brains[]`/unbuilt; reconcile (build 05)."
4. Confirm neither new class is in `shouldRetry`'s TRANSIENT-only allow (they're deterministic — heal must
   not auto-retry them).

## Done when
- A unit/fixture pass: feed the classifier a saved DatatypeMismatch tail and a `CRON-DIAG …deterministic`
  tail; both classify to the new/extended class, not `UNKNOWN`. (Add the fixtures alongside any existing
  classifier tests.)

## Best-practice fold-in
Build 28 (postmortem record) depends on these classifier rules being correct first: once `DatatypeMismatch` and `DETERMINISTIC_HOLD` are recognized classes rather than `UNKNOWN`, the ledger gains two trending-ready root-cause buckets — the foundation for build 28's "No Postmortem Left Unreviewed" pass (SRE postmortem culture: repository for trend analysis).

## Risk
Low. Additive classification; the retry-gate stays transient-only.

## References (added 2026-06-22 — crawl4ai-live + best-practices fold-in)
**crawl4ai-live (tool-usage reference, docs/audit/2026-06-21-crawl4ai-live/):**
- (n/a — not a crawl4ai build)
**best-practices-research (how to build/operate what we build, docs/audit/2026-06-21-best-practices-research/):**
- `docs/audit/2026-06-21-best-practices-research/round2/rootcause-sre-monitoring-workbook.md` (REPORT HEADLINE point 3) — alert only on significant events
- `docs/audit/2026-06-21-best-practices-research/round1/rootcause-sre-postmortem-culture.md` — "No Postmortem Left Unreviewed"; repository for trend analysis
- `docs/audit/2026-06-21-best-practices-research/round2/rootcause-sre-managing-incidents.md` — incident classification discipline
**Verified:** V-7 — the "_auto-captured; pending triage_" Root-Cause string is written ONLY for classify()==UNKNOWN (log-cron-incident.mjs:79); recognized classes write "KLASS — signal"; the RESOLVED(auto) flip lives in lib/ledger-flap.mjs. Narrative holds (the 3 roots all bucket UNKNOWN today). Add DatatypeMismatch to the existing SCHEMA_DRIFT class + a DETERMINISTIC_HOLD rule (Phase-1 _CONTRACT A/B). — folded into Steps above where applicable.
