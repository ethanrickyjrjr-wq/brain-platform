# Gradeable-coverage tracker + polarity backfill

**Date:** 2026-06-29
**Check:** `grade_coverage_backfill_live_verify`
**Repos:** `brain-platform` (Phase 0 + 2) · `swfldatagulf-ops` (Phase 1)

## Problem

Master and leaf brains pin predictions at capture, but most never get graded. The
reason is a config gap, not a code bug. The deterministic grader
(`refinery/grade/grade-predictions.mts`) and capture (`refinery/lib/predictions-log.mts`
`deriveGradeFields`) both gate on `resolveGradeConfig(slug).gradeable`
(`refinery/vocab/loader.mts`), which requires three things on the concept:

1. a window default (slug `grade.window_days` or `CATEGORY_WINDOW_DAYS[category]`),
2. a numeric `epsilon` + `grade_basis` (slug override or `VALUE_TYPE_BUCKET[value_type]`),
3. a valid `direction_polarity` ∈ {`higher_is_bullish`, `lower_is_bullish`} — **slug-only,
   never inherited**, because within one category some metrics are higher-is-bullish and
   others higher-is-bearish; a category default would silently grade one backwards.

A slug missing #3 is `ungradeable` from capture, or `[SKIP unconfigured]` at grade time
if its polarity was removed after capture. The fix for the large majority is a one-line
polarity block per concept — but each is a real directional judgment, not a blind stamp.

### Live sweep (run 2026-06-29, `bun refinery/tools/grade-config-sweep.mts --check`)

The `grade-config-sweep` tool already partitions every concept into exactly one bucket:

- **gradeable: 66** — passes all gates today.
- **moat-fuel: 167** — numeric + has a window, missing **only** `direction_polarity`.
  The backlog. Indicative split by category (from the **stale** artifact, so it sums to
  144, not 167 — Phase 0's regenerate produces the true 167 breakdown and Phase 2's batch
  sizes are set from THAT, never from these numbers): real-estate ~40, macro ~30,
  environmental ~27, logistics ~17, credit-risk ~14, demand-signal ~6, economic-activity ~6,
  labor ~2, hospitality ~2.
- **invalid-polarity: 2** — `active_listings_count_swfl`, `avg_days_on_market_swfl`,
  both carry the out-of-enum token `higher_is_bearish`.
- **needs-window: 23** — `regulatory` (13, category absent from `CATEGORY_WINDOW_DAYS`)
  + `qualitative` (3, non-gradeable by construction) + others.
- **row-candidate: 32** — non-numeric, correctly never a prediction target. No action.

### Source-of-truth defect (must fix first)

The committed sweep artifact is **stale and misfiled**. The tool's `OUTPUT_PATH` points at
`docs/superpowers/plans/2026-06-03-row-tier/sweep-output.json`, but that plan dir was
archived to `_FINISHED/`. The only committed copy lives at
`docs/superpowers/plans/_FINISHED/2026-06-03-row-tier/sweep-output.json`, dated
`2026-06-05`, showing `moat-fuel:144 / gradeable:25` — 24 days stale, undercounting the
live `167 / 66`. Any dashboard reading the committed file would lie. The artifact needs a
live, stable home before anything reads it.

## Goal

1. A fresh, honestly-located coverage artifact that can't silently drift.
2. A read-only `/glass` pane that shows the backlog and lets us watch it shrink.
3. The 167-slug moat-fuel backlog drained by category, each polarity a real call, with a
   marker for concepts intentionally left non-directional so the backlog has a true floor.

Non-goal: changing the grader, the capture path, or any grading math. This is config +
tracking only.

## What we're building

Three phases, shippable in order. Phase 0 unblocks both 1 and 2.

### Phase 0 — relocate + freshen the coverage artifact (brain-platform, small)

- Change `grade-config-sweep.mts` `OUTPUT_PATH` to `_AUDIT_AND_ROADMAP/grade-coverage.json`
  (outside `_FINISHED`, beside the build queue — a permanent home both repos can rely on).
- Regenerate (`bun refinery/tools/grade-config-sweep.mts`), commit the fresh artifact
  (now `167 / 66`).
- Wire `grade-config-sweep.mts --check` into the pre-push gate
  (`.claude/hooks/check-prepush-gate.mjs`) so the artifact can't drift from the vocab again.
  The `--check` mode already exists and exits non-zero on the §3 drift pin; we additionally
  fail if the committed JSON differs from a fresh run (regenerate-and-commit reminder). Scope
  this to pushes that touch `refinery/vocab/**`. Note the committed-JSON compare is **net-new**
  logic — `--check` reads no committed file today — so add it AFTER the artifact's first commit
  (Phase 0 step 2), never before, or the wiring push fails on a missing file.
  - **Comparison choice:** default to comparing the `summary` block only — it's date-stable
    (the artifact's top-level `generated_at` changes daily, so a full-JSON compare false-fails
    unless you strip it). The blind spot: a same-push swap (slug A moat-fuel→gradeable while
    slug B goes the other way, counts unchanged) passes the check. For a tracking artifact
    that's acceptable; if airtight is wanted instead, compare full JSON minus `generated_at`.
- Leave the stale `_FINISHED` copy in place (archived history); the tool no longer writes there.

### Phase 1 — `/glass` coverage pane (swfldatagulf-ops, ships before any backfill)

Mirrors the existing Shopping-List pane exactly; no new infrastructure.

- `lib/glass.ts`: add `GradeableCoverage` types + `fetchGradeableCoverage()`. Reads
  `rawText("_AUDIT_AND_ROADMAP/grade-coverage.json")` (the same `rawText` contents-API
  read already used for `cadence_registry.yaml` and `brains/`), `JSON.parse`, returns
  `{ available, summary, moatFuelByCategory, invalidPolarity }`. Any error → `available:false`,
  matching `fetchDataTargets`/`fetchFlowSignal`.
- `app/glass/coverage.tsx`: new server-component pane mirroring `shopping.tsx`. Renders:
  headline tallies (gradeable ✓ / moat-fuel backlog / needs-window / invalid ⚠), then
  moat-fuel grouped by category with per-category counts (the number to watch drop), and
  the 2 invalid-polarity slugs named with their raw token (FIX-OR-REMOVE flag).
- `app/glass/page.tsx`: add `fetchGradeableCoverage()` to the `Promise.all`, render
  `<CoveragePane>` next to `<ShoppingPane>`. `revalidate: 300`, read-only, zero DB.
- Styling reuses the existing `glass-*` classes; add only what's needed for the tally row.

### Phase 2 — drain the backlog by category (brain-platform, batched)

Each batch: per-concept directional judgment, one commit, re-run the sweep, watch the ops
number drop. These are polarity additions to **already-registered** concepts (no new slugs),
so the guards are the polarity-lock tests (`properties-polarity-lock.test.mts`,
`grade-config-polarity.test.mts`) + the §3 drift pin — NOT the orphan gate (which fires only
on a new emitted slug missing from the vocab).

**Polarity convention — the one rule every batch applies.** `direction_polarity` is a single
scalar per metric; it cannot be per-audience. The convention, confirmed against the slugs
already graded, is **bullish = a stronger SWFL market / regional economy**, never one
stakeholder's gain. Today: `sales_velocity_zscore` is `higher_is_bullish`, `lee_months_of_supply`
is `lower_is_bullish`, `sba_overall_survival_rate` is `higher_is_bullish`. Where a metric helps
one side and hurts the other (new-construction permits: bearish for prices, bullish for regional
growth), grade by market/economic strength, not by buyer-vs-seller.

- **Batch 0** — the 2 invalid-polarity → `lower_is_bullish`. Under the market-strength
  convention above: more active listings / longer days-on-market = more supply, a softer
  market = bearish, consistent with `lee_months_of_supply`'s `lower_is_bullish`
  (`higher_is_bearish` ≡ `lower_is_bullish`). This is a per-slug audit, not a string-normalize —
  the judgment is recorded in the commit. Clears the sweep warning.
- **Batch 1** real-estate · **Batch 2** macro · **Batch 3** environmental ·
  **Batch 4** logistics + credit-risk · **Batch 5** the tail (demand-signal,
  economic-activity, labor, hospitality).
- Per concept the judgment is: does higher mean bullish or bearish for SWFL, or is this a
  level/identifier that shouldn't be directionally graded at all? The first two get a
  `direction_polarity` block; the third gets the marker below.

#### `reviewed_non_directional` marker (honest backlog floor)

A moat-fuel concept judged intentionally non-directional currently stays in moat-fuel
forever, so the backlog never reaches a true floor. Add a `grade.reviewed_non_directional: true`
field. A registered, numeric, polarity-`none` concept with the marker set lands in a new
terminal bucket `reviewed-display` (checked before `moat-fuel`), not `moat-fuel`. This extends
the existing `GateVector` seam — no new gate, no new pre-materialization stage (honors CLAUDE.md
C2). After Phase 2, moat-fuel = genuine remaining owed work; reviewed-display = "looked at,
deliberately not graded."

Concrete touch-list (all bounded — the marker threads through four files):

- `refinery/stages/2.5-normalize.mts` — add `reviewed_non_directional?: boolean` to the
  `grade?:` block type (lines 73–84). **Without this the field won't type-check** — it's the
  file Phase 2's first draft omits.
- `refinery/vocab/loader.mts` — add an optional marker field to `GateVector`; `gateVector`
  populates it from `concept.grade`, and `assignBucket` reads it to branch to `reviewed-display`
  before the `moat-fuel` return. `resolveGradeConfig` is **untouched** — a marked concept still
  resolves `gradeable:false` (polarity is `none`), so the §3 pin stays green.
- `refinery/tools/grade-config-sweep.mts` — add `"reviewed-display"` to the `Bucket` union
  (lines 68–74), the `summary` initializer (lines 123–131), and the print-loop array
  (lines 195–202).
- The unit test (see Testing): a marked concept buckets `reviewed-display`, and
  `resolveGradeConfig` still returns `gradeable:false` for it.

#### needs-window micro-track (defer, separate from polarity)

Out of scope for the polarity batches but logged here: the 13 `regulatory` needs-window
concepts need either a `regulatory` entry in `CATEGORY_WINDOW_DAYS` (grounded in source
cadence) or a per-slug window. The 3 `qualitative` are correctly non-gradeable — leave
them. Decide regulatory's window default in its own commit once a regulatory source's
publish cadence is confirmed.

## Architecture / data flow

```
brain-vocabulary.json  ──(grade-config-sweep.mts)──►  _AUDIT_AND_ROADMAP/grade-coverage.json
        ▲                                                          │ (committed, regenerable)
        │ Phase 2 adds polarity / marker                           │
        │                                                          ▼
   resolveGradeConfig ──► capture + grader gate            GitHub contents API (rawText)
                                                                   │
                                                                   ▼
                                          swfldatagulf-ops  lib/glass.fetchGradeableCoverage
                                                                   │
                                                                   ▼
                                                  app/glass/coverage.tsx  (read-only pane)
```

The artifact is the single seam between repos. brain-platform owns producing it (sweep +
pre-push check); ops only reads it. No DB, no cron, no shared runtime.

## Testing

- **Phase 0:** `grade-config-sweep.mts --check` exits 0 (§3 pin green) after relocate;
  the new pre-push drift check fails on a deliberately-stale committed artifact and passes
  after regenerate.
- **Phase 1:** `bunx next build` clean in ops; pane renders tallies from a fixture JSON;
  `available:false` path renders the graceful placeholder when `rawText` returns null.
  Live-verify the pane on the deployed `/glass`.
- **Phase 2:** each batch — `bun refinery/tools/grade-config-sweep.mts` shows moat-fuel
  count dropping by the batch size and gradeable rising by the same; existing vocab
  coverage + corridor-alias gates stay green; `grade-config-polarity.test.mts` and
  `properties-polarity-lock.test.mts` stay green. The `reviewed_non_directional` change
  ships with a unit test asserting a marked concept buckets `reviewed-display`, not
  `moat-fuel`, and that `resolveGradeConfig` still returns `gradeable:false` for it.

## What we're explicitly not doing

- No new DB table, no nightly cron — the committed artifact is the source (vs the
  `data_targets` shopping-list pattern, which is for data-volume needs, a different
  lifecycle).
- No Workflow / subagents — bounded file work across two repos (RULE 0.6).
- No web-research pass — the only external surface is the GitHub contents-API raw read,
  already proven live in `swfldatagulf-ops/lib/github.ts`; nothing about a vendor contract
  is being invented (RULE 0.4 satisfied by reuse, not memory).
- No change to grading math, capture, the grader, or `VALUE_TYPE_BUCKET` /
  `CATEGORY_WINDOW_DAYS` defaults (except the deferred regulatory-window micro-track).
