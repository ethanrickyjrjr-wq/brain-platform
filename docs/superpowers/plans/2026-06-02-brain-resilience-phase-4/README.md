# Brain Resilience — Phase 4: Circuit Breaker

> **Status:** Ready to implement. Audited 2026-06-02 — three bugs found and corrected (see Audit Corrections below).
>
> Phases 1 (type-lifts), 2 (resilient walk + buildOne), 3 (harvestUpstreams degradation wiring), and 5 (speaker token rendering) are all shipped — 920 tests green, 9 commits on main as of 2026-06-02.

---

## Context

What remains: Phase 4 (circuit breaker), Phase 6 (ops dashboard health), Phase 7 (GHA default flip).

Phase 4 goal: Add a pure `evaluateMasterGate()` function (`refinery/lib/master-gate.mts`) called inside `outputStage` before `writeFile` when `brain_id === "master"`. The gate refuses to overwrite a good `master.md` when critical upstreams have gone dark (expired eligibility, not merely never-built). Two knobs default to OFF so the gate is hole-or-hollow only until explicitly tuned.

The gate is **defense-in-depth** relative to `computeMasterDecision` (already shipped in Phase 3). `computeMasterDecision` decides whether to run the master pipeline at all from the cli; `evaluateMasterGate` is a last-line-of-defense inside `outputStage` that catches the same condition if `outputStage` is ever called outside the cli's resilient path. When `computeMasterDecision` returns `"published"`, `criticalHoleIds` will be empty in normal operation — Rule 1 of the gate will not fire. This is intentional; the gate is not dead code.

**Critical distinction the gate must enforce:**

| Upstream state                                                                   | Counts as          | Gate effect                           |
| -------------------------------------------------------------------------------- | ------------------ | ------------------------------------- |
| Failed rebuild, eligible last-good exists                                        | `degradedFraction` | PUBLISH proceeds                      |
| Never built (`lastGoodRefinedAt` absent)                                         | not-yet-online     | non-blocking, PUBLISH proceeds        |
| Failed rebuild, last-good expired (`lastGoodRefinedAt` set on `missing` outcome) | `criticalHole`     | HOLD; prior `master.md` keeps serving |

---

## Files

| Action | Path                                | Responsibility                                                                               |
| ------ | ----------------------------------- | -------------------------------------------------------------------------------------------- |
| Create | `refinery/lib/master-gate.mts`      | Pure `evaluateMasterGate()`, two default-off knobs                                           |
| Create | `refinery/lib/master-gate.test.mts` | 7 unit tests (all 4 HOLD conditions + 3 PUBLISH cases)                                       |
| Modify | `refinery/cli.mts`                  | Build `criticalHoleIds` from outcomes; close over it into master's `buildOne` lambda         |
| Modify | `refinery/stages/4-output.mts`      | Extend inline opts type; wire gate call before `writeFile`; return `{written:false}` on HOLD |

> **Note:** `refinery/lib/resilient-build.mts` does NOT need to change. `criticalHoleIds` is threaded via closure in the lambda, not through `buildOne`'s opts type. See Task 3.

---

## Audit Corrections (2026-06-02)

Three bugs were found in the original spec and corrected here:

**Correction 1 — HOLD return was missing `brainOutput`.**
`OutputResult` requires five fields: `brainPath`, `written`, `markdown`, `version`, and `brainOutput`. The original HOLD return omitted `brainOutput`, which would have caused a TypeScript compile error. Fixed in Task 4.

**Correction 2 — `criticalHoleIds` must use closure, not `buildOne` opts.**
The original spec threaded `criticalHoleIds` through `buildOne`'s opts, which would have required editing `resilient-build.mts` (unlisted in the file table) and the `RunPipelineFn` type. The correct approach closes over `criticalHoleIds` from the surrounding scope in the lambda — no changes to `resilient-build.mts`. Fixed in Task 3.

**Correction 3 — Rule 4 (degraded fraction ceiling) had no test.**
The spec claimed "all 4 HOLD conditions" but the test table listed only 3. Added a 7th test covering Rule 4. Expected passing count is 927 (920 + 7), not 926.

---

## Task 1 — Create `refinery/lib/master-gate.mts`

```typescript
import type { BrainOutput } from "../types/brain-output.mts";

export const MASTER_MIN_PUBLISH_CONFIDENCE = 0.0; // off day one — breaker is hole-or-hollow only
export const MASTER_MAX_DEGRADED_FRACTION = 1.0; // off day one

export interface MasterGateKnobs {
  minPublishConfidence: number;
  maxDegradedFraction: number;
}

export interface MasterGateInput {
  rendered: Pick<BrainOutput, "confidence" | "upstream_count">;
  priorMasterExists: boolean;
  criticalHoleIds: ReadonlySet<string>; // missing + expired eligibility, filtered to critical upstreams
  criticalUpstreamIds: ReadonlySet<string>;
  degradedCriticalIds: ReadonlySet<string>; // degraded (eligible last-good) AND critical
  knobs?: Partial<MasterGateKnobs>;
}

export type GateDecision = "PUBLISH" | "HOLD";

export function evaluateMasterGate(input: MasterGateInput): GateDecision {
  const knobs: MasterGateKnobs = {
    minPublishConfidence: MASTER_MIN_PUBLISH_CONFIDENCE,
    maxDegradedFraction: MASTER_MAX_DEGRADED_FRACTION,
    ...input.knobs,
  };

  // Rule 1: any re-darkened critical hole → HOLD
  if (input.criticalHoleIds.size > 0) return "HOLD";

  // Rule 2: hollow overwrite guard (upstream_count === 0 AND prior master exists)
  if (input.rendered.upstream_count === 0 && input.priorMasterExists)
    return "HOLD";

  // Rule 3: confidence floor (default 0.0 = off)
  if (input.rendered.confidence < knobs.minPublishConfidence) return "HOLD";

  // Rule 4: degraded fraction ceiling (default 1.0 = off)
  if (input.criticalUpstreamIds.size > 0) {
    const fraction =
      input.degradedCriticalIds.size / input.criticalUpstreamIds.size;
    if (fraction > knobs.maxDegradedFraction) return "HOLD";
  }

  return "PUBLISH";
}
```

---

## Task 2 — Create `refinery/lib/master-gate.test.mts`

Seven tests covering every decision branch including all four HOLD rules.

| #   | Test                                     | Setup                                                                                            | Expected |
| --- | ---------------------------------------- | ------------------------------------------------------------------------------------------------ | -------- |
| 1   | re-darkened critical hole                | `criticalHoleIds: new Set(["env-swfl"])`                                                         | HOLD     |
| 2   | never-built critical (not-yet-online)    | `criticalHoleIds: new Set()`, `degradedCriticalIds: new Set()`                                   | PUBLISH  |
| 3   | hollow overwrite with prior master       | `upstream_count: 0`, `priorMasterExists: true`                                                   | HOLD     |
| 4   | hollow but cold start (no prior)         | `upstream_count: 0`, `priorMasterExists: false`                                                  | PUBLISH  |
| 5   | confidence knob triggered                | `knobs: { minPublishConfidence: 0.9 }`, `rendered.confidence: 0.5`                               | HOLD     |
| 6   | degraded fraction ceiling knob triggered | `knobs: { maxDegradedFraction: 0.4 }`, 1 critical upstream, 1 degraded-critical (fraction = 1.0) | HOLD     |
| 7   | non-critical hole                        | `criticalHoleIds: new Set()`, non-critical id in `degradedCriticalIds`                           | PUBLISH  |

Run: `bun test refinery/lib/master-gate.test.mts` — expect all 7 pass.

---

## Task 3 — Track `criticalHoleIds` in `cli.mts`

In the resilient walk outcome loop (already collects `degradedIds`), additionally build `criticalHoleIds`. Note: no criticality filter here — the gate filters to critical in Task 4. All expired-lastGood holes flow in; the gate's `criticalUpstreamIds.has(id)` filter does the triage.

```typescript
const criticalHoleIds = new Set<string>();

// In the outcome-collection loop, after outcomes.push(outcome):
if (outcome.status === "missing" && outcome.lastGoodRefinedAt !== undefined) {
  criticalHoleIds.add(id); // re-darkened: had a last-good, eligibility expired
}
```

Thread it into master's `buildOne` call via **closure in the lambda** — do NOT add it to `buildOne`'s opts (that would require modifying `resilient-build.mts`):

```typescript
// In the resilient master block, when decision === "published":
const masterOutcome = await buildOne(
  masterPack,
  { dryRun, degradedUpstreamIds: degradedIds }, // buildOne opts unchanged
  (p, o) =>
    runPipeline(p, {
      dryRun: o.dryRun,
      strict,
      degradedUpstreamIds: o.degradedUpstreamIds,
      criticalHoleIds, // ← closed over from the outer scope; no type change in resilient-build.mts
    }),
);
```

Extend `runPipeline`'s **inline opts type** (in its function signature) to include `criticalHoleIds?: ReadonlySet<string>` and pass it through to `outputStage`.

---

## Task 4 — Wire gate into `4-output.mts`

`readBrainOutput` is already imported at line 38. `brainOutput` is in scope from line 479. `brainPath` is defined at line 585, just before the `dryRun` early return at line 586. The gate goes **after** the `dryRun` return and **before** `writeFile` at line 590.

Extend the **inline opts type** in `outputStage`'s function signature (currently lines 333–337):

```typescript
opts: {
  dryRun: boolean;
  degradedUpstreamIds?: ReadonlySet<string>;
  criticalHoleIds?: ReadonlySet<string>;   // ← new
}
```

Insert the gate block after the `dryRun` early return (~line 588) and before `await mkdir`:

```typescript
if (pack.brain_id === "master") {
  const priorRead = await readBrainOutput("master");
  const criticalUpstreamIds = new Set(
    (pack.input_brains ?? []).filter((e) => e.critical).map((e) => e.id),
  );
  const allDegraded = opts.degradedUpstreamIds ?? new Set<string>();
  const holes = opts.criticalHoleIds ?? new Set<string>();
  const degradedCriticalIds = new Set(
    [...allDegraded].filter(
      (id) => criticalUpstreamIds.has(id) && !holes.has(id),
    ),
  );
  const gateInput: MasterGateInput = {
    rendered: brainOutput,
    priorMasterExists: priorRead.kind === "ok",
    criticalHoleIds: new Set(
      [...holes].filter((id) => criticalUpstreamIds.has(id)),
    ),
    criticalUpstreamIds,
    degradedCriticalIds,
  };
  const decision = evaluateMasterGate(gateInput);
  if (decision === "HOLD") {
    console.warn(
      `[output] HOLD: master gate blocked write — ${JSON.stringify([...gateInput.criticalHoleIds])}`,
    );
    return {
      brainPath,
      written: false,
      markdown: "",
      version: brainOutput.version,
      brainOutput, // ← required by OutputResult; was missing in original spec
    };
  }
}
```

Add the import at the top of the file:

```typescript
import {
  evaluateMasterGate,
  type MasterGateInput,
} from "../lib/master-gate.mts";
```

> `!opts.dryRun` guard from the original spec is **removed** — the `if (opts.dryRun) return` at line 586 already exits before this block is reached, so the guard was redundant. The gate only fires in live write paths.

---

## Task 5 — Full test suite

```
bun test refinery/
```

Expected: **927+ pass** (920 baseline + 7 new master-gate tests), 0 changed existing assertions.

Regression guards to verify manually:

- Guard 4 (re-darkened critical → HOLD): master-gate test #1
- Guard 5 (never-built → no HOLD): master-gate test #2
- Guard 6 (hollow overwrite refusal): master-gate test #3
- Guard 7 (registry invariant — load-time critical+public_label check): already shipped in Phase 1, confirm still passing
- Rule 4 knob (degraded fraction ceiling): master-gate test #6 ← new

---

## Verification

Smoke test (dry-run, fixture mode):

```
cd refinery && REFINERY_SOURCE=fixture bun run cli.mts master --resilient --dry-run 2>&1
```

Expected: no HOLD messages, completes cleanly (fixture brains all succeed → no criticalHoles).

Forced HOLD test (manual): In a test run, pass an outcome with `status: "missing"` + `lastGoodRefinedAt` set for a critical upstream. Confirm `evaluateMasterGate` returns `HOLD` and `outputStage` returns `{written: false}` without touching `master.md`.

---

## What's Next (after Phase 4)

- **Phase 6:** Ops dashboard reads `brains/_build-report.json` (already emitted by Phase 2 cli.mts) → GREEN/YELLOW/RED tiles in `swfldatagulf-ops`. Scope: one PR in the ops repo, no refinery changes.
- **Phase 7:** ✅ DONE (2026-06-03). Flipped `--resilient` to default in `.github/workflows/daily-rebuild.yml` — `continue-on-error` + `set +e` exit-code capture, summarize step, commit-on-any-exit-code, and a `Fail job on hard HOLD` step before notify (exit 2 stays green, exit 1 fails). As-shipped YAML + the three non-obvious corrections are documented in `docs/superpowers/plans/2026-06-01-brain-resilience-system/README.md` §Phase 7.
