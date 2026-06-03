# Brain Resilience System — "one brain failing never loses everything master says"

> **Status:** Pre-condition met — master v65, tree clean at `cfe830b`. Ready for Phase 1.
>
> **Audited 2026-06-01** — joint Sonnet + LittleBird audit + LittleBird verification agents (4 agents, ~562k tokens against live source). Accepted/rejected findings folded in below. See [Audit decisions](#audit-decisions) section.

---

## Context — why this exists

The §7 gate fixed Fort Myers Beach. But fixing one place exposed the real fear: the rebuild is all-or-nothing. Verified in code:

- The live answer already survives a failed rebuild. `/api/b/[slug]` serves the last-good `brains/{id}.md` off disk (`lib/fetch-brain.ts:18`). A broken build freezes the answer; it doesn't erase it. That's passive tolerance, and it's good.
- But the rebuild itself aborts on the first throw. `refinery/cli.mts` (~163-216) walks the DAG calling `runPipeline` per brain; any throw propagates to `main().catch()` → `process.exit(1)`. One broken upstream stops master from rebuilding at all — freshness freezes, and the ops banner shows false-green (it checks "did it answer," not "is it fresh + correct"). This is exactly "one thing fails and we lose everything master says."
- Master hard-requires every upstream. `harvestUpstreams()` (`refinery/stages/4-output.mts` ~142-177) throws if any upstream `.md` is missing. There is no "build with the upstreams that survived."
- A wrong new build already can't poison prod. Stage-4 validators throw before `writeFile` (`4-output.mts:474-521`), so a bad render leaves the prior good `.md` intact. The protection exists — the problem is the throw also kills the whole cascade instead of isolating the one brain.
- The one soft-degradation path that exists — stale upstream → caveat + `applyStalenessCap(min(self, upstream))` (`4-output.mts:190-197`). That machinery is the seam we extend to build-failure degradation.

**Intended outcome:** a build system where a single brain's failure is isolated, not fatal — master rebuilds from each failed upstream's last-good read (with an honest caveat + capped confidence), the run completes "degraded-but-complete" instead of dying, a truly missing load-bearer holds the prior good master rather than shipping a hollow one, and the ops dashboard can tell the difference. The guiding invariant: a good `brains/{id}.md` is sacred — nothing here ever overwrites a good file with a worse one.

---

## Pre-condition — MET (2026-06-01, cfe830b)

> **Pre-condition met. Master is v65, tree clean at `cfe830b`. Start Phase 1.**

- [x] Daily Brain Rebuild completed successfully
- [x] `master` is live at v65 with per-ZIP flood routes
- [x] Working tree is clean at `cfe830b`

---

## Operator-locked decisions (forks resolved 2026-06-01)

1. **Scope = resilience + failure-protection items only.** IN: resilient executor, GHA-vs-local egress runbook, ops false-green fix. OUT (named follow-on phases): §9 place-router, §4 ranker, §5 TDT, §6 presentation polish.
2. **Degrade policy = publish + caveat + cap.** A critical upstream that fails THIS run but has an eligible last-good → master publishes from it, with a degradation caveat + capped confidence; health → YELLOW. HOLD (serve prior good master) ONLY when a critical upstream has no eligible last-good, OR the render is fully hollow. Last-good eligibility window: `age ≤ min(LAST_GOOD_ABSOLUTE_MAX_DAYS, max(LAST_GOOD_MIN_WINDOW_DAYS, LAST_GOOD_ELIGIBILITY_MULT × ttl_days))` — the absolute ceiling is mandatory; with `MULT=1`, env-swfl's 30-day TTL would otherwise yield a 30-day window — a month-old flood read under a cap, indefensible — and the ceiling caps it at 14 days. See real TTL table in Phase 3.
3. **User visibility = compact inline token, not prose.** When a critical upstream is on last-good, append one `(Label-Date)` token near the answer (e.g. `(Flood Input-June 1)`), never above the lead. One token per degraded critical input. The human label comes from a `public_label` field on the brain, never render-time prose.

---

## Audit decisions

### Accepted findings (incorporated)

**Phase 0 — DONE. Do not re-implement.**
`fema-nfip-source.mts` already has `.range()` pagination (`FEMA_PAGE_SIZE = 1000`, ordered by `id`, stops on short page). Committed `f772f72`. Struck from phases below.

**`degradedIds` threading must be explicit.**
The executor builds a `degradedIds: Set<string>` after leaf brains run. This must be threaded through `runPipelineOpts.degradedUpstreamIds?: ReadonlySet<string>` all the way to `outputStage`. Every existing `runPipeline` caller passes `new Set()` (or omits, defaults to empty) so no existing behavior changes. This is not hand-waving — it is a real interface addition.

**Retry on transient failure before classifying degraded.**
One retry with a 5-second backoff before marking a brain "degraded." The §7 socket-reset failures were transient. This is the highest-value self-healing addition. Implement in `buildOne` in `resilient-build.mts`.

**GHA exit-2 mechanics require explicit implementation.**
Non-zero exit fails a GHA step identically regardless of value. Achieving "exit 2 = warning, not red" requires:

```yaml
- name: Run refinery
  id: rebuild
  continue-on-error: true
  run: |
    bun refinery/cli.mts master --resilient
    echo "exit_code=$?" >> $GITHUB_OUTPUT
- name: Notify on hard failure only
  if: steps.rebuild.outputs.exit_code != '0' && steps.rebuild.outputs.exit_code != '2'
  # ... existing notify step unchanged
```

Without this, every degraded run fires the failure notify.

**`degradedFraction` denominator = critical upstreams only.**
Not total upstream count. Non-critical leaf hiccups don't move this number.

**SOURCED.md citations required for the three constants before Phase 3 ships.**

Original plan used `LAST_GOOD_ELIGIBILITY_MULT = 2` and cited "env-swfl TTL ~7d → 14d window." This was wrong — env-swfl's actual TTL is 30 days (`env-swfl.mts:1079`), not 7. The author conflated env-swfl with cre-swfl. Applying MULT=2 to the real TTLs: flood → 60-day window (worse than the unguarded case the policy was written to stop). Corrected constants and derivation live in Phase 3.

**`public_label` bootstrapping gap — safe guard covers it; say so.**
Speaker reads `degraded_inputs[].label` from master's own BrainOutput (see Phase 5 redesign). The safe guard (emit `"a regional input"` if label absent) covers the 1–2 day window after Phase 1 lands before every critical upstream has rebuilt live and stage 4 has lifted their labels into master's output.

**Degraded modifier semantics — one sentence closes it.**
`env-swfl` is `edge_type: "modifier"`, not veto (Group C flipped it; `master.mts:261–270` is explicit). A degraded modifier on last-good contributes capped stale magnitude/confidence only — it cannot flip direction. Add to Phase 3: _"degraded modifier contributes capped stale magnitude; no direction risk by construction."_

**HOLD alerting — step summary must be explicit.**
On HOLD (exit 1), `$GITHUB_STEP_SUMMARY` should include the reason: `"MASTER HELD: {id} ineligible (last-good: {date}, now {N} days old, threshold: {W}d)"`. The GHA failure notify already fires on exit 1.

**Smoke test target = `labor-demand-swfl`, not `cre-swfl`.**
`cre-swfl` hangs at stage 3 without LLM egress.

**Verbatim caveat = snapshot test, not `includes()`.**
Assert exact string: `"Upstream brain 'env-swfl' failed to rebuild on 2026-06-01; using last good read from 2026-05-28 (v22)."` String format drift is how caveats silently become unreadable.

### Rejected findings

**Rejected: derive `critical` from `edge_type`.**
Proposed rule: `critical = edge_type === "veto" || edge_type === "constraint"`. Wrong. Master's DAG has zero veto or constraint edges — every edge is `"input"` or `"modifier"`. This rule produces an empty critical set. The breaker never trips. Keep `critical?: boolean` as an explicit field.

**Rejected: veto degradation semantics concern.**
Collapses on the same fact. env-swfl is a modifier. No stale-veto scenario exists.

### Follow-on (not in this plan)

Issue [#61](https://github.com/ethanrickyjrjr-wq/brain-platform/issues/61): `minLiveRows` / row-floor guard per source connector. The macro-florida CBP 2.3% sample is the live instance of silent truncation (wrong aggregates, clean build, GREEN ops). Design into the source audit work, not here.

---

## The system, in one diagram

```
         ┌──────────────────────── resilient DAG walk (cli.mts) ────────────────────────┐
each brain → buildOne() ──try──▶ runPipeline ──ok──▶ status: built / skipped-fresh
                  │              [1 retry, 5s backoff, before classifying degraded]
                  └──catch──▶ last-good on disk & eligible? ──yes──▶ status: degraded
                                                             └──no──▶ status: missing
         walk NEVER short-circuits → collects BrainBuildOutcome[] → BuildReport(exit 0/2/1)
                  │
master build ─────┴─▶ harvestUpstreams(degradedIds): degraded→caveat+cap · non-crit hole→soft-skip · crit hole→flag
                  │   [degradedIds threaded via runPipelineOpts.degradedUpstreamIds]
                  └─▶ evaluateMasterGate(): PUBLISH (degrade-and-ship) | HOLD (keep prior master)
                  │
speaker ──────────┴─▶ compact (Label-Date) token for each entry in master's degraded_inputs[]
                  │   [master carries {label,date}[] on its own BrainOutput — speaker reads master only]
                  │
ops dashboard ────┴─▶ reads brains/_build-report.json → GREEN = built + PUBLISH (not hollow/HOLD)
```

---

## Phases

### Phase 0 — FEMA `.range()` pagination — DONE (f772f72)

Already implemented in `refinery/sources/fema-nfip-source.mts`. `FEMA_PAGE_SIZE = 1000`, ordered by `id`, stops on short page. No action needed.

---

### Phase 1 — Behavior-neutral type-lifts (atomic, zero behavior change)

Ships as one atomic commit. All new fields default to no-op so all existing tests pass untouched. Brain Factory rule 3: type-lift + backfill together.

**`BrainEdge.critical?: boolean`** (`refinery/types/pack.mts` ~58-75) + `edge()` gains an optional 3rd param. Backfill: audit all ~26 packs for load-bearers. Tag master's direction-bearers `critical: true` (`refinery/packs/master.mts` ~275-297): `env-swfl`, `cre-swfl`, and the macro chain `macro-us` → `macro-florida` → `macro-swfl`. Everything else stays best-effort (`critical` absent/false).

Note: `critical` does NOT derive from `edge_type`. Master's DAG has zero veto or constraint edges. Every edge is `"input"` or `"modifier"`. The explicit boolean is required.

**`PackDefinition.public_label?: string`** — curated user-facing label (e.g. `env-swfl` → `"Flood Input"`). Lifted to `BrainOutput.public_label` by Stage 4 so it rides the thin pipe. Backfill every pack.

**`BrainOutput.degraded_inputs?: Array<{label: string; date: string}>`** — structured token payload populated by stage 4's `harvestUpstreams` from `public_label` + `refined_at` of each degraded critical upstream. Speaker reads from master's own output only — it never touches upstream BrainOutputs (Brain Factory rule 1: thin pipe). **Must round-trip the thin pipe:** the speaker renders from the _re-parsed_ `master.md`, not the in-memory build object, so `degraded_inputs` has to be serialized into the `--- OUTPUT ---` block by the stage-4 writer AND reconstructed by `parseBrainMarkdown` (same as `caveats`/`key_metrics` already do). A field on the type that nobody serializes is silently dropped at serve time — the token never appears. Assert the round-trip in a test (see Verification guard 9).

**Registry invariant (not spec-validator):** `spec-validator` is `function(markdown)` — it never sees a `PackDefinition` or its edges. Label-completeness is a registry property. Put the check where it belongs: a load-time assertion over `PACKS` that runs at startup and in CI. Fails fast at boot, not mid-rebuild.

**Snapshot test for the critical set:** a unit test that asserts exactly which pack IDs have `critical: true`. Any change to the critical set is a conscious, reviewed diff — not a silent omission when someone wires a new load-bearing upstream and forgets the flag.

**`applyStalenessCap` rename — SKIP.** Touching 4 files + 7 tests for a naming preference when a comment does the same job. Leave the existing name; add an inline comment explaining that degradation feeds the same floor.

**`harvestUpstreams` / `outputStage`** gain `degradedUpstreamIds?: ReadonlySet<string>` param, default empty → identical behavior for every current caller and test.

---

### Phase 2 — Resilient executor + build report (behind `--resilient`, default OFF)

**New `refinery/lib/resilient-build.mts`:**

- `buildOne(pack, opts, runPipeline)` — wraps `runPipeline` in try/catch. **One retry with 5-second backoff, but only on transient/network errors** (classify by error message: `socket`, `ECONNRESET`, `ETIMEDOUT`, `fetch failed` → retry; validator throws, type errors, real bugs → no retry). Do not double-charge deterministic failures — on a globally-degraded-egress night all 26 brains would otherwise burn retry+backoff+timeout serially. Also verify `runPipeline` / the Anthropic SDK aren't already retrying internally to avoid stacking. On throw after retry (or on non-retriable throw), consult disk via existing `brainStatus` (`dag.mts:137`) + `readBrainOutput` (`brain-output-reader.mts:38`): parseable + eligible last-good → `degraded`; else → `missing`.
- Types `BrainBuildOutcome` (`packId`, `status: "built"|"skipped-fresh"|"degraded"|"missing"`, `reason?`, `version?`, `lastGoodRefinedAt?`, `written`, `brainOutput?`, `dataIntegrity?: {rowsRead: number; rowsExpected?: number; sampled?: boolean}`) and `BuildReport` (`target`, `timestamps`, `source`, `outcomes[]`, `exitCode`, `masterDecision?`). The `dataIntegrity` slot is intentionally empty for now — it's the hook for issue #61 so that work plugs into this health model without a second type-lift.
- Exit semantics: `0` clean · `2` degraded-but-complete (≥1 degraded or non-critical missing, master still published) · `1` hard (master HELD, or CLI crashed).

**`cli.mts` walk change** (~163-216): collect outcomes instead of throwing; the missing-upstream hard throw at ~185-191 becomes non-fatal (records `missing`, continues); collect `degradedIds: Set<string>` across the walk; thread into master's `runPipeline` call via `runPipelineOpts.degradedUpstreamIds`; emit `brains/_build-report.json`; set exit from the report. `main().catch()` stays as last-resort exit-1.

Smoke test on **`labor-demand-swfl --resilient`** (not `cre-swfl` — hangs without LLM egress) before going near master.

---

### Phase 3 — Last-good fallback + degradation caveat + eligibility window

**SOURCED.md entries required before this phase ships** for all three eligibility constants.

**Real TTL table for the five critical brains** (verified against source, LittleBird agents 2026-06-01):

| Critical brain              | `ttl_seconds` | = days | Window: `min(14, max(2, 1×ttl_days))`   |
| --------------------------- | ------------- | ------ | --------------------------------------- |
| env-swfl (flood)            | 2,592,000     | 30 d   | **14 days** (absolute ceiling kicks in) |
| cre-swfl                    | 604,800       | 7 d    | **7 days**                              |
| macro-us / -florida / -swfl | 86,400        | 1 d    | **2 days** (floor kicks in)             |

**Corrected constants** (re-derived against real TTLs):

- `LAST_GOOD_MIN_WINDOW_DAYS = 2` — floor: every brain gets at least 2 nights
- `LAST_GOOD_ELIGIBILITY_MULT = 1` — one full TTL cycle; past one cycle = stale by that brain's own contract
- `LAST_GOOD_ABSOLUTE_MAX_DAYS = 14` — hard ceiling; env-swfl's 30-day TTL would otherwise produce a 30-day window, and serving 30-day-stale flood data under a confidence cap is indefensible

Formula: `eligible iff age_days ≤ min(LAST_GOOD_ABSOLUTE_MAX_DAYS, max(LAST_GOOD_MIN_WINDOW_DAYS, LAST_GOOD_ELIGIBILITY_MULT × ttl_days))`

SOURCED.md entry must include the TTL table above and explain why the absolute ceiling exists (the FMB lesson: calibrate constants against the real reference values, not assumed ones).

**Wire the degraded set through harvest** (`4-output.mts:142-177`):

- `read.kind === "ok"` and `degradedIds.has(id)` → contribute confidence as normal, push a degradation caveat **distinct from staleness**:
  `"Upstream brain '{id}' failed to rebuild on {today}; using last good read from {refined_at:YYYY-MM-DD} (v{version})."`
  Fold into the same `minCappedUpstreamConfidence` floor staleness uses. Keep `degradationCaveats` and `stalenessCaveats` separate arrays in the return so the OUTPUT distinguishes them; both feed the one cap via `applyStalenessCap` (leave existing name; add inline comment: "staleness and degradation both feed this floor").
  Populate `master.output.degraded_inputs` with `{label: read.output.public_label ?? "a regional input", date: refined_at.slice(0,10)}` for each degraded critical upstream. Speaker reads this array; it never accesses upstream BrainOutputs directly.

- `read.kind === "missing"`, non-critical → soft-skip: hole caveat, do not contribute, do not throw.

- `read.kind === "missing"` OR last-good ineligible, critical → classify as `criticalHole`. Pass to gate (Phase 4).

- **Degraded modifier note:** `env-swfl` is `edge_type: "modifier"`. A degraded modifier on last-good contributes capped stale magnitude/confidence only — it cannot flip direction (direction is driven by the full upstream vote). The cap handles this correctly; no special-case needed.

---

### Phase 4 — Circuit breaker (`refinery/lib/master-gate.mts`)

Pure, table-driven `evaluateMasterGate(rendered, priorMaster, criticalHoles, degradedFraction, knobs)`. Called from `outputStage` before `writeFile` (`4-output.mts:520`), gated on `brain_id === "master"`, after validation.

**`criticalHoles` must distinguish never-built from re-darkened.** A brand-new critical brain has no last-good on its first nightly — HOLD would freeze master whenever anyone adds a new critical dimension. Adding a dimension must never take down the existing answer. The outcome enum already has `degraded` vs `missing`; the gate must not collapse them:

- `degraded` (had a good read, lost it) → eligible last-good exists → counts toward `degradedFraction`, not `criticalHoles`; gap covered by the eligibility window.
- `missing` AND has never had a good read (`lastGoodRefinedAt` is absent) → `not-yet-online`; non-blocking. Adds a caveat, does not trip HOLD.
- `missing` AND had a good read that is now ineligible → `criticalHole`; trips HOLD. This is the re-darkened load-bearer case the gate was written for.

The split is reliable because a failed rebuild **never deletes** a good `.md` (last-good is sacred; validators throw before `writeFile`). So a previously-online brain always leaves an on-disk last-good carrying a `refined_at` — an ineligible one keeps its date and lands correctly in the HOLD bucket; only a genuinely never-built brain (or an operator deletion) has no `refined_at` at all and is treated as `not-yet-online`.

**PUBLISH iff ALL hold, else HOLD:**

1. `criticalHoles.length === 0` — only re-darkened ineligible holes trip this; never-built brains do not.
2. NOT (rendered is hollow AND a good prior master exists) — hollow = `upstream_count === 0`. Never replace a real `master.md` with the `emptySynthesisResult` stub.
3. `confidence >= MASTER_MIN_PUBLISH_CONFIDENCE` (knob, default 0.0 = **off day one** — breaker is hole-or-hollow only until explicitly tuned)
4. `degradedFraction <= MASTER_MAX_DEGRADED_FRACTION` (knob, default 1.0 = **off day one** — same)

**`degradedFraction` denominator = critical upstreams only** (not total upstream count).

- PUBLISH → write proceeds; exit 0 or 2.
- HOLD → `outputStage` returns `{written:false, reason}` without writing; prior `master.md` keeps serving; exit 1 + loud health flag. Cold start with no prior master + HOLD → `missing` + exit 1 (honest "no answer yet").

---

### Phase 5 — User-facing degradation token (speaker)

**Architecture correction from LittleBird verification agents:** speaker.mts receives exactly one `ParsedBrain` — master's own. It has no handle on upstream brains' outputs or pack definitions. Reaching into upstreams would violate Brain Factory rule 1 (thin pipe). The original design ("label from the degraded upstream's `BrainOutput.public_label`") is architecturally impossible.

**Correct shape:** master's own `BrainOutput` carries a `degraded_inputs: Array<{label: string; date: string}>` field (added to the type in Phase 1, populated by `harvestUpstreams` in Phase 3). Speaker reads from master's output only.

In `refinery/render/speaker.mts`, for tier 1/2 master output: read `brainOutput.degraded_inputs`. For each entry, render a compact `(Label-Date)` token near (never above) the lead. Date formatted `"June 1"`. One token per entry; not clickable. The "why" stays in the existing caveats block.

**Safe guard:** if an entry's `label` is `"a regional input"` (set by stage 4 when `public_label` was absent at harvest time — covers the 1–2 day bootstrapping window after Phase 1 lands), render it as-is. Never fall back to a pack id — stage 4 never puts one there.

---

### Phase 6 — Build-status-aware health (kills the false-green)

Write `brains/_build-report.json` (via existing `writeJsonAtomic`, committed under `brains/` which the daily-rebuild `git add brains/` already globs).

In `swfldatagulf-ops`: **GREEN iff** frontmatter-fresh AND report status for that brain is `built`/`skipped-fresh` AND master's `masterDecision` is `PUBLISH`. YELLOW = frontmatter-fresh but degraded/HOLD. RED = missing or HOLD.

**Scope note:** this is build-status-aware health, not correctness-aware health. The system sees whether a brain built successfully — not whether its source data is correct. The macro-florida CBP truncation (issue #61) would still show GREEN here because the brain built clean. That's why `BrainBuildOutcome.dataIntegrity?` exists in Phase 2's schema — when #61 ships its row-floor checks, the populated field plugs into this same report without a second type-lift. Until then, Phase 6 is honest about what it guarantees.

---

### Phase 7 — Flip master + GHA mechanics ✅ DONE (2026-06-03)

`--resilient` is now the default in `.github/workflows/daily-rebuild.yml`. Below is the **as-shipped** YAML — it differs from the original draft in three ways that were load-bearing, documented inline so the next session doesn't re-derive them:

1. **`set +e` around the `bun` call.** The default shell is `bash -eo pipefail`; the original draft's `bun … && echo "exit_code=$?"` would, under `-e`, abort the step on any non-zero exit _before_ the echo ran — so `exit_code` was never written and every downstream step gated on it silently no-op'd. We wrap the call in `set +e` / `set -e`.
2. **Commit step runs on any captured exit code, not just `gate==true`.** Exit 2 (degraded — master published) must commit `master.md` + the new `_build-report.json` (YELLOW tile); exit 1 (HOLD) must still commit the new `_build-report.json` (RED tile) even though `master.md` is unchanged. Condition: `steps.gate.outputs.run == 'true' && steps.rebuild.outputs.exit_code != ''`.
3. **A dedicated `Fail job on hard HOLD` step sits BEFORE `Notify on failure`.** `if: failure()` evaluates at step position, so we flip the job to failed on exit 1/crash (not exit 2) right before the notify step — that's what makes notify fire on a real HOLD while exit 2 stays green and quiet.

```yaml
- name: Run refinery (resilient)
  id: rebuild
  if: steps.gate.outputs.run == 'true'
  continue-on-error: true
  env:
    # ... existing secret env block unchanged ...
  run: |
    PACK="${{ github.event.inputs.pack_id || 'master' }}"
    FORCE_FLAG="${{ github.event.inputs.force == 'true' && '--force' || '' }}"
    echo "Rebuilding pack: $PACK $FORCE_FLAG (resilient)"
    set +e
    bun refinery/cli.mts $PACK $FORCE_FLAG --resilient
    echo "exit_code=$?" >> "$GITHUB_OUTPUT"
    set -e

- name: Summarize build result
  if: steps.rebuild.outputs.exit_code != ''
  run: |
    EXIT="${{ steps.rebuild.outputs.exit_code }}"
    if [ "$EXIT" = "0" ]; then
      echo "### ✅ Brain rebuild: clean" >> "$GITHUB_STEP_SUMMARY"
    elif [ "$EXIT" = "2" ]; then
      echo "### ⚠️ Brain rebuild: degraded-but-complete" >> "$GITHUB_STEP_SUMMARY"
      echo "At least one upstream is serving last-good data. See brains/_build-report.json." >> "$GITHUB_STEP_SUMMARY"
    else
      echo "### ❌ Brain rebuild: MASTER HELD (exit $EXIT)" >> "$GITHUB_STEP_SUMMARY"
      echo "A critical upstream is missing or ineligible. Prior master.md is still serving." >> "$GITHUB_STEP_SUMMARY"
    fi

- name: Commit updated brains
  if: steps.gate.outputs.run == 'true' && steps.rebuild.outputs.exit_code != ''
  run: |
    # ... existing git add brains/ + diff-guard + rebase-retry push unchanged
    # (git add brains/ already globs brains/_build-report.json) ...

- name: Fail job on hard HOLD # BEFORE "Notify on failure"
  if: steps.rebuild.outputs.exit_code != '0' && steps.rebuild.outputs.exit_code != '2' && steps.rebuild.outputs.exit_code != ''
  run: |
    echo "Master HELD or crashed (exit ${{ steps.rebuild.outputs.exit_code }}). Prior master.md still serving."
    exit 1

- name: Notify on failure
  if: failure()
  # ... existing notify step unchanged
```

GHA-vs-local egress runbook (already banked): when GHA runner egress is degraded, a local build with `source=live agents=live` is the valid fallback after confirming local egress with a cheap probe (`api.anthropic.com → HTTP 200`). Never `--force` the daily-rebuild GHA.

**Deliberately still OFF:** `MASTER_MAX_DEGRADED_FRACTION` stays at 1.0 — the breaker runs hole-or-hollow only. Lowering it is a later decision (now safe because issue #6 is fixed), not part of Phase 7.

---

## Critical files

| Concern                   | File                                                              | Change                                                                                                                                                                                                   |
| ------------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Edge criticality + label  | `refinery/types/pack.mts`                                         | `BrainEdge.critical?`, `PackDefinition.public_label?`, `BrainOutput.degraded_inputs?`, `edge()` param                                                                                                    |
| Master tagging            | `refinery/packs/master.mts` (~275-297)                            | tag critical upstreams; set `public_label`; snapshot test for critical set                                                                                                                               |
| Cap + harvest + gate call | `refinery/stages/4-output.mts`                                    | `harvestUpstreams(degradedIds)`, degradation caveats, eligibility window (3 constants), populate `degraded_inputs` on master output, `evaluateMasterGate` before `writeFile`, write `_build-report.json` |
| Resilient walk            | `refinery/cli.mts` (~163-216)                                     | collect outcomes, continue-on-failure, thread `degradedIds`, emit report, exit 0/2/1, `--resilient` flag                                                                                                 |
| New: executor             | `refinery/lib/resilient-build.mts` (+ `.test.mts`)                | `buildOne` with transient-only retry, `BrainBuildOutcome` (with `dataIntegrity?` slot), `BuildReport`, exit derivation                                                                                   |
| New: breaker              | `refinery/lib/master-gate.mts` (+ `.test.mts`)                    | `evaluateMasterGate` — never-built vs re-darkened distinction, pure table-driven                                                                                                                         |
| Token render              | `refinery/render/speaker.mts`                                     | `(Label-Date)` token from master's own `degraded_inputs[]` — never touches upstream outputs                                                                                                              |
| Registry invariant        | `refinery/packs/index.mts` (or load-time assertion)               | load-time check: every pack referenced by `critical:true` edge has non-empty `public_label`                                                                                                              |
| Constants citation        | `refinery/SOURCED.md` (or project equivalent)                     | derivation for all three eligibility constants + real TTL table                                                                                                                                          |
| Health source             | `brains/_build-report.json` (new, committed) + `swfldatagulf-ops` | GREEN = built + PUBLISH (build-status-aware, not correctness-aware; `dataIntegrity?` reserved for #61)                                                                                                   |
| Cron                      | `.github/workflows/daily-rebuild.yml`                             | `--resilient` default, `continue-on-error`, exit-code capture, exit-2 warning vs exit-1 HOLD notify                                                                                                      |

**Reuse (do not reinvent):** `readBrainOutput` (`brain-output-reader.mts:38`), `brainStatus` (`dag.mts:137`), `applyStalenessCap` math (`4-output.mts:190`), `writeJsonAtomic` (`refinery/lib/write-json-atomic.mts`), `withFixtureBrains` harness + `makeMinimalPack` factory (`stale-upstream-cascade.test.mts:96-140, 527-572`).

---

## Verification

**Regression guards (must all hold):**

1. **Happy-path byte-identical** — run a full fixture-mode master build with and without `--resilient`; assert every `brains/*.md` is byte-for-byte equal.
2. **Forced single-brain failure → degraded-but-complete** — inject a fixture upstream whose `runPipeline` throws a transient error; assert: walk continues, master publishes, exact degradation caveat string matches snapshot (not `includes()`), exit 2, report marks brain `degraded`, `(Label-Date)` token appears in speaker output if brain is critical.
3. **Deterministic failure → no retry** — inject a throw that looks like a validator error (not a network error); assert `runPipeline` called exactly once (no retry).
4. **Missing/ineligible critical → HOLD** — age a critical upstream's last-good past the eligibility window; assert master does not write (compare bytes/mtime of prior `master.md`), exit 1, report `masterDecision: HOLD`.
5. **Never-built critical → not-yet-online (no HOLD)** — delete a critical upstream's `.md` with no prior `refined_at`; assert master still publishes (HOLD does not fire for a brain that has never built).
6. **Hollow-overwrite refusal** — force zero passing upstreams; assert master with a good prior does not overwrite it with the `emptySynthesisResult` stub.
7. **Registry invariant** — a `critical: true` edge whose pack lacks `public_label` fails the load-time assertion before any build runs.
8. **Critical-set snapshot** — assert the exact set of pack IDs with `critical: true` matches a recorded snapshot; any change is a deliberate diff, not a silent omission.
9. **`degraded_inputs` round-trips the markdown** — build a master output with one `degraded_inputs` entry, write `master.md`, re-parse via `parseBrainMarkdown`, assert the entry survives on `ParsedBrain.output` and the tier-2 speaker emits exactly one `(Label-Date)` token. Guards against a type field that never gets serialized into the `--- OUTPUT ---` block.

**Unit tests** (mirror `stale-upstream-cascade.test.mts` patterns): `buildOne` classifier (built/degraded/missing); transient-only retry (network errors → retry, validator errors → no retry); degradation caveat exact string + `applyStalenessCap` cap; eligibility-window math against real TTL table (env-swfl=30d→14d, cre-swfl=7d→7d, macro=1d→2d); `evaluateMasterGate` never-built vs re-darkened distinction; speaker renders from `degraded_inputs[]` on master's own output only.

**Integration:** extend existing `outputStage` test (`stale-upstream-cascade.test.mts:473-521`) with a `degradedUpstreamIds` set; assert degradation caveat is in `result.brainOutput.caveats` and confidence is capped.

**Live (after Phase 7 flip):** trigger daily rebuild with one critical upstream forced stale-but-eligible → master publishes v+1, `/api/b/master?format=json` carries degradation caveat + capped confidence, speaker tier-2 shows `(Label-Date)` token, `_build-report.json` shows that brain `degraded` and `masterDecision: PUBLISH`, ops tile → YELLOW. Then force it ineligible → rebuild HOLDs, prior master keeps serving, ops tile → RED.

**Always:** `bun test refinery/` green; `node scripts/safe-push.mjs`; top-of-file `SESSION_LOG.md` entry per push; stage only owned files; show diffs per Rule 1 before pushing (this touches build orchestration + a live `/api/b/*` response shape).
