# Gradeable-Coverage Tracker + Polarity Backfill — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **Recommended model:** ⚡ Sonnet — 8 tasks, 10 files, keywords: architecture

**Goal:** Give the prediction-grading config a fresh, drift-proof coverage artifact, a read-only `/glass` pane that shows the ungradeable backlog shrinking, and drain the 167-slug moat-fuel backlog one category at a time — each polarity a real directional call.

**Architecture:** `brain-platform` owns producing the artifact (`grade-config-sweep.mts` → `_AUDIT_AND_ROADMAP/grade-coverage.json`, guarded by a vocab-scoped pre-push check). `swfldatagulf-ops` only reads it via the GitHub contents API (`lib/github.rawText`), the same cross-repo read `fetchFlowSignal` already uses for `cadence_registry.yaml`. No DB, no cron, no shared runtime — the committed JSON is the single seam. Phase 0 unblocks Phase 1 and Phase 2; ships in order.

**Tech Stack:** TypeScript, Bun (`bun:test`), Next.js App Router (ops, React Server Components), Node `.mjs` pre-push hook. Spec: `docs/superpowers/specs/2026-06-29-grade-coverage-backfill-design.md`.

## Global Constraints

- **Two repos.** Phase 0 + Phase 2 live in `brain-platform` (`C:\Users\ethan\dev\brain-platform`). Phase 1 lives in `swfldatagulf-ops` (`C:\Users\ethan\dev\swfldatagulf-ops`). Never cross-commit.
- **Polarity convention — bullish = a stronger SWFL market / regional economy**, never one stakeholder's gain. `direction_polarity` is one scalar per metric; it is **slug-only, never inherited**. Reference points already in the corpus: `sales_velocity_zscore` = `higher_is_bullish`, `lee_months_of_supply` = `lower_is_bullish`, `sba_overall_survival_rate` = `higher_is_bullish`.
- **No grading-math changes.** Do not touch the grader, capture (`deriveGradeFields`), `VALUE_TYPE_BUCKET`, or `CATEGORY_WINDOW_DAYS` (the deferred regulatory-window micro-track is out of scope). This is config + tracking only.
- **§3 drift pin must stay green.** `gateVector` all-green ⇔ `resolveGradeConfig(slug).gradeable` for every concept. A `reviewed_non_directional` concept stays `gradeable:false`.
- **Edit JSON with the Edit tool, never `sed`/Bash string ops** — `brain-vocabulary.json` contains em-dashes/UTF-8; a Bash rewrite risks U+FFFD corruption.
- **Verify ops with `bunx next build`, NOT bare `tsc`** — local tsc ≠ Vercel.
- **No push without explicit operator confirmation.** Stage explicit paths only (never `git add -A`). Append a `SESSION_LOG.md` entry before any push; push via `node scripts/safe-push.mjs`.
- **Vocab-touch gate.** Any push touching `refinery/vocab/**` runs `corridor-aliases.test.mts` + `check-vocab-coverage.mts --all` (and, after Phase 0b, `grade-config-sweep.mts --check`). All must pass.

---

### Task 1: Phase 0 — Relocate the sweep artifact + add a committed-drift guard (brain-platform)

The sweep's `OUTPUT_PATH` points at `docs/superpowers/plans/2026-06-03-row-tier/sweep-output.json`, but that dir was archived to `_FINISHED/` — so the write path is **currently broken** (ENOENT) and the only committed copy is the stale `144/25` snapshot from 2026-06-05. Move the output beside the build queue and teach `--check` to fail when the committed artifact drifts from a fresh run.

**Files:**
- 🔴 Modify: `refinery/tools/grade-config-sweep.mts` (`OUTPUT_PATH` at lines 37–44; `main()` `--check` branch at lines 219–222; add `readFileSync` to the `node:fs` import at line 28)
- 🔴 Create: `_AUDIT_AND_ROADMAP/grade-coverage.json` (regenerated artifact, committed)

**Interfaces:**
- Consumes: `runSweep()` (existing) → `{ output: SweepOutput, pinFailures: string[] }`; `SweepOutput.summary` is `Record<Bucket, number> & { backtest_clean: number }`.
- Produces: `_AUDIT_AND_ROADMAP/grade-coverage.json` — a `SweepOutput` JSON with `generated_at`, `summary`, `records[]`. This is the file Phase 1 reads and Phase 0b guards.

- [ ] **Step 1: Repoint `OUTPUT_PATH`**

In `refinery/tools/grade-config-sweep.mts`, replace lines 37–44:

```ts
const OUTPUT_PATH = path.join(
  process.cwd(),
  "_AUDIT_AND_ROADMAP",
  "grade-coverage.json",
);
```

- [ ] **Step 2: Import `readFileSync`**

Change the `node:fs` import (line 28) from:

```ts
import { writeFileSync } from "node:fs";
```

to:

```ts
import { readFileSync, writeFileSync } from "node:fs";
```

- [ ] **Step 3: Add the committed-drift guard to the `--check` branch**

Replace the existing `--check` short-circuit in `main()` (lines 219–222):

```ts
  if (checkOnly) {
    console.log("\n--check: §3 pin green; no write.");
    return;
  }
```

with a version that also asserts the committed artifact matches a fresh sweep. **Summary-only comparison** — the artifact's `generated_at` changes daily, so a full-file compare would false-fail; the tradeoff is blindness to a count-neutral same-push swap, acceptable for a tracking artifact (spec Phase 0):

```ts
  if (checkOnly) {
    // Drift guard: the committed artifact's `summary` must equal a fresh sweep.
    // Compares summary ONLY — `generated_at` changes daily, so a full-file
    // compare false-fails. Blind to a count-neutral same-push swap (acceptable
    // for a tracking artifact; see the plan's Phase 0 notes).
    let committedSummary: string | null = null;
    try {
      const committed = JSON.parse(
        readFileSync(OUTPUT_PATH, "utf-8"),
      ) as SweepOutput;
      committedSummary = JSON.stringify(committed.summary);
    } catch {
      committedSummary = null; // missing/unparseable → treat as drift
    }
    const freshSummary = JSON.stringify(output.summary);
    if (committedSummary !== freshSummary) {
      console.error(
        `✗ committed ${path.relative(process.cwd(), OUTPUT_PATH)} is stale or missing ` +
          `— its bucket summary differs from a fresh sweep.\n` +
          `  committed: ${committedSummary ?? "(file missing/unparseable)"}\n` +
          `  fresh:     ${freshSummary}\n` +
          `Fix: bun refinery/tools/grade-config-sweep.mts && ` +
          `git add _AUDIT_AND_ROADMAP/grade-coverage.json`,
      );
      process.exit(1);
    }
    console.log(
      "\n--check: §3 pin green; committed artifact matches fresh sweep; no write.",
    );
    return;
  }
```

- [ ] **Step 4: Regenerate the artifact at the new path**

Run: `bun refinery/tools/grade-config-sweep.mts`
Expected: `✓ wrote _AUDIT_AND_ROADMAP/grade-coverage.json (NNN slugs)` and the tallies print `gradeable 66 / moat-fuel 167 / invalid-polarity 2 / needs-window 23 / row-candidate 32`.

- [ ] **Step 5: Verify `--check` now passes against the fresh artifact**

Run: `bun refinery/tools/grade-config-sweep.mts --check`
Expected: prints the tallies, the 2 invalid-polarity warning, then `--check: §3 pin green; committed artifact matches fresh sweep; no write.` and exits 0.

- [ ] **Step 6: Verify `--check` FAILS on a deliberately-stale artifact**

Temporarily hand-edit `_AUDIT_AND_ROADMAP/grade-coverage.json` — change `summary.gradeable` from `66` to `65` — then run: `bun refinery/tools/grade-config-sweep.mts --check`
Expected: exits non-zero with `✗ committed _AUDIT_AND_ROADMAP/grade-coverage.json is stale or missing`. Then **regenerate** (`bun refinery/tools/grade-config-sweep.mts`) to restore the honest artifact and re-run `--check` → exits 0.

- [ ] **Step 7: Commit (do not push)**

```bash
git add refinery/tools/grade-config-sweep.mts _AUDIT_AND_ROADMAP/grade-coverage.json
git commit -m "feat(grading): relocate grade-coverage artifact to _AUDIT_AND_ROADMAP + drift guard"
```

---

### Task 2: Phase 0 — Wire `grade-config-sweep.mts --check` into the pre-push gate (brain-platform)

So the artifact can't silently drift from the vocab again. Scope it to the existing `vocabTouched` branch (Gate 2) so it only runs on `refinery/vocab/**` pushes. The artifact already exists (Task 1 committed it), so the check has something to compare against from its first run.

**Files:**
- Modify: `.claude/hooks/check-prepush-gate.mjs` (inside the `if (vocabTouched) { … }` block, after the conditional-orphan guard ends at line 168, before the block's closing brace at line 169)

**Interfaces:**
- Consumes: `run(cmd)` → `{ ran: boolean, code: number, out: string }`; `block(title, body)` → exits 2; `truncate(s)`. All defined in the same file (lines 292, 321, 316).

- [ ] **Step 1: Add the sweep drift block**

In `.claude/hooks/check-prepush-gate.mjs`, immediately after the `unregisteredLiteralSlugs` block closes (line 168 `}`) and before the `vocabTouched` block's own closing `}` (line 169), insert:

```js
    // grade-coverage artifact drift: the committed _AUDIT_AND_ROADMAP/grade-coverage.json
    // must match a fresh sweep, and the §3 gradeability pin must hold. Exit-code
    // driven — `block()` fires on any non-zero regardless of captured output.
    const sweep = run("bun refinery/tools/grade-config-sweep.mts --check");
    if (sweep.ran && sweep.code !== 0) {
      block(
        "VOCAB — grade-coverage artifact drift (grade-config-sweep --check failed)",
        `Either the §3 gradeability pin regressed (gateVector all-green ≠\n` +
          `resolveGradeConfig.gradeable), or _AUDIT_AND_ROADMAP/grade-coverage.json is\n` +
          `stale vs the current vocabulary.\n\n` +
          `Fix: bun refinery/tools/grade-config-sweep.mts && \\\n` +
          `     git add _AUDIT_AND_ROADMAP/grade-coverage.json\n` +
          `(commit the regenerated artifact in THIS push), then retry.\n\n` +
          truncate(sweep.out),
      );
    }
```

- [ ] **Step 2: Verify the gate passes with a clean artifact**

Make a no-op vocab touch and dry-run the hook with a synthetic push payload:

Run:
```bash
printf '{"tool_input":{"command":"git push origin HEAD:main"}}' | node .claude/hooks/check-prepush-gate.mjs; echo "exit=$?"
```
Expected: no `PUSH BLOCKED — VOCAB — grade-coverage artifact drift` banner; `exit=0` (assuming the committed artifact is fresh from Task 1).

- [ ] **Step 3: Verify the gate BLOCKS on a stale artifact**

Hand-edit `_AUDIT_AND_ROADMAP/grade-coverage.json` (`summary.gradeable` `66`→`65`), stage a vocab file (`git add refinery/vocab/brain-vocabulary.json`), then re-run the Step 2 command.
Expected: prints `PUSH BLOCKED — VOCAB — grade-coverage artifact drift` and `exit=2`. Restore the artifact: `bun refinery/tools/grade-config-sweep.mts && git checkout _AUDIT_AND_ROADMAP/grade-coverage.json` (regenerate, confirm clean), and unstage if needed.

- [ ] **Step 4: Commit (do not push)**

```bash
git add .claude/hooks/check-prepush-gate.mjs
git commit -m "ci(prepush): block grade-coverage artifact drift on refinery/vocab/** pushes"
```

---

### Task 3: Phase 1 — `fetchGradeableCoverage()` reader + types (swfldatagulf-ops)

Mirror `fetchFlowSignal` (cross-repo `rawText` read, graceful `available:false`). Derive `moatFuelByCategory` and `invalidPolarity` from the artifact's `records[]` so the pane never recomputes from raw vocab. **Repo: `swfldatagulf-ops`.**

> **Testing note:** ops has no unit-test runner wired for these panes (the existing `shopping.tsx`/`flow.tsx` ship none). Following the repo's established verification pattern, Phase 1 is gated by a fixture-parse scratch check (Step 2/4 below) + `bunx next build` + live-verify — not a new test harness.

**Files:**
- Modify: `lib/glass.ts` (add types after the `FlowSignal` interface ~line 52; add reader at end of file ~line 284)

**Interfaces:**
- Consumes: `rawText(path: string): Promise<string | null>` from `@/lib/github` (already imported at `lib/glass.ts:3`), pointed at the `brain-platform` repo.
- Produces: `fetchGradeableCoverage(): Promise<GradeableCoverage>` and the `GradeableCoverage` interface (consumed by Task 4's pane and Task 5's page).

- [ ] **Step 1: Add the types + reader to `lib/glass.ts`**

Append at the end of `lib/glass.ts`:

```ts
// ── Gradeable-coverage reader (grade-config-sweep artifact, brain-platform) ──
//
// Reads _AUDIT_AND_ROADMAP/grade-coverage.json from brain-platform via the
// GitHub contents API (lib/github.rawText) — the SAME cross-repo read
// fetchFlowSignal uses for cadence_registry.yaml. Any error → available:false,
// matching fetchDataTargets / fetchFlowSignal. Read-only, zero DB.

interface SweepRecordLite {
  slug: string;
  bucket: string;
  gateVector: { category: string | null; raw_polarity: string | null };
}

interface SweepArtifact {
  generated_at: string;
  summary: Record<string, number>;
  records: SweepRecordLite[];
}

export interface GradeableCoverage {
  available: boolean;
  generated_at: string | null;
  summary: Record<string, number>; // bucket → count (incl. backtest_clean)
  moatFuelByCategory: { category: string; count: number }[];
  invalidPolarity: { slug: string; raw_polarity: string | null }[];
}

export async function fetchGradeableCoverage(): Promise<GradeableCoverage> {
  const EMPTY: GradeableCoverage = {
    available: false,
    generated_at: null,
    summary: {},
    moatFuelByCategory: [],
    invalidPolarity: [],
  };

  const raw = await rawText("_AUDIT_AND_ROADMAP/grade-coverage.json").catch(
    () => null,
  );
  if (!raw) return EMPTY;

  try {
    const art = JSON.parse(raw) as SweepArtifact;
    if (
      !art ||
      typeof art.summary !== "object" ||
      !Array.isArray(art.records)
    ) {
      return EMPTY;
    }

    const byCat = new Map<string, number>();
    const invalid: { slug: string; raw_polarity: string | null }[] = [];
    for (const r of art.records) {
      if (r.bucket === "moat-fuel") {
        const cat = r.gateVector?.category ?? "uncategorized";
        byCat.set(cat, (byCat.get(cat) ?? 0) + 1);
      } else if (r.bucket === "invalid-polarity") {
        invalid.push({
          slug: r.slug,
          raw_polarity: r.gateVector?.raw_polarity ?? null,
        });
      }
    }

    const moatFuelByCategory = [...byCat.entries()]
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count);

    return {
      available: true,
      generated_at: art.generated_at ?? null,
      summary: art.summary,
      moatFuelByCategory,
      invalidPolarity: invalid,
    };
  } catch {
    return EMPTY;
  }
}
```

- [ ] **Step 2: Write the fixture-parse scratch check (test-first)**

Create a throwaway fixture and a one-off parse assertion (delete after). Save the current live artifact as the fixture so the shape is real:

```bash
# in swfldatagulf-ops/
cp ../brain-platform/_AUDIT_AND_ROADMAP/grade-coverage.json /tmp/coverage-fixture.json
```

Write `/tmp/check-coverage.ts`:

```ts
import { readFileSync } from "node:fs";

interface SweepRecordLite {
  slug: string;
  bucket: string;
  gateVector: { category: string | null; raw_polarity: string | null };
}
interface SweepArtifact {
  generated_at: string;
  summary: Record<string, number>;
  records: SweepRecordLite[];
}

const art = JSON.parse(
  readFileSync("/tmp/coverage-fixture.json", "utf-8"),
) as SweepArtifact;

const byCat = new Map<string, number>();
const invalid: { slug: string; raw_polarity: string | null }[] = [];
for (const r of art.records) {
  if (r.bucket === "moat-fuel")
    byCat.set(
      r.gateVector?.category ?? "uncategorized",
      (byCat.get(r.gateVector?.category ?? "uncategorized") ?? 0) + 1,
    );
  else if (r.bucket === "invalid-polarity")
    invalid.push({ slug: r.slug, raw_polarity: r.gateVector?.raw_polarity });
}
const moatTotal = [...byCat.values()].reduce((a, b) => a + b, 0);

console.assert(art.summary["moat-fuel"] === moatTotal, "moat sum mismatch");
console.assert(invalid.length === art.summary["invalid-polarity"], "invalid count mismatch");
console.log("moatFuelByCategory total:", moatTotal, "invalid:", invalid.length, "OK");
```

- [ ] **Step 3: Run the parse check**

Run: `bun /tmp/check-coverage.ts`
Expected: `moatFuelByCategory total: 167 invalid: 2 OK` (no assertion failures). Delete `/tmp/check-coverage.ts` and `/tmp/coverage-fixture.json` after.

- [ ] **Step 4: Typecheck the reader compiles**

Run: `bunx next build` (or `bunx tsc --noEmit` for a faster inner-loop check; the build is the authority).
Expected: no type errors in `lib/glass.ts`.

- [ ] **Step 5: Commit (do not push)**

```bash
git add lib/glass.ts
git commit -m "feat(glass): fetchGradeableCoverage reader over grade-coverage artifact"
```

---

### Task 4: Phase 1 — `<CoveragePane>` server component (swfldatagulf-ops)

Mirror `shopping.tsx` exactly: a `glass-section` with a label, a graceful placeholder when unavailable, a headline tally row, moat-fuel grouped by category (the numbers to watch drop), and the invalid-polarity slugs named with their raw token. **Repo: `swfldatagulf-ops`.**

**Files:**
- Create: `app/glass/coverage.tsx`

**Interfaces:**
- Consumes: `GradeableCoverage` from `@/lib/glass` (Task 3).
- Produces: `CoveragePane` React component — `export function CoveragePane({ coverage }: { coverage: GradeableCoverage })`. Consumed by Task 5's page.

- [ ] **Step 1: Create the pane**

```tsx
// app/glass/coverage.tsx — Gradeable-coverage pane
// Server Component. Renders _AUDIT_AND_ROADMAP/grade-coverage.json (grade-config-sweep,
// brain-platform). Graceful fallback if the artifact can't be read. Read-only, zero DB.
import type { GradeableCoverage } from "@/lib/glass";

function tally(summary: Record<string, number>, bucket: string): number {
  return summary[bucket] ?? 0;
}

export function CoveragePane({ coverage }: { coverage: GradeableCoverage }) {
  const { available, summary, moatFuelByCategory, invalidPolarity } = coverage;

  return (
    <section className="glass-section">
      <div className="glass-section-label">GRADEABLE COVERAGE</div>

      {!available ? (
        <div className="glass-placeholder glass-shop-pending">
          grade-coverage artifact not yet readable — ships with Phase 0
          (brain-platform sweep relocate)
        </div>
      ) : (
        <>
          <div className="glass-coverage-tallies">
            <span className="glass-coverage-tally glass-coverage-tally--ok">
              {tally(summary, "gradeable")} gradeable ✓
            </span>
            <span className="glass-coverage-tally glass-coverage-tally--backlog">
              {tally(summary, "moat-fuel")} moat-fuel backlog
            </span>
            <span className="glass-coverage-tally">
              {tally(summary, "needs-window")} needs-window
            </span>
            <span className="glass-coverage-tally glass-coverage-tally--warn">
              {tally(summary, "invalid-polarity")} invalid ⚠
            </span>
            {tally(summary, "reviewed-display") > 0 && (
              <span className="glass-coverage-tally">
                {tally(summary, "reviewed-display")} reviewed (non-directional)
              </span>
            )}
          </div>

          {moatFuelByCategory.length > 0 && (
            <div className="glass-coverage-cats">
              <div className="glass-coverage-cats-label">
                moat-fuel by category — the number to watch drop
              </div>
              <div className="glass-coverage-cat-grid">
                {moatFuelByCategory.map((c) => (
                  <div key={c.category} className="glass-coverage-cat">
                    <span className="chip">{c.category}</span>
                    <span className="glass-coverage-cat-count">{c.count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {invalidPolarity.length > 0 && (
            <div className="glass-coverage-invalid">
              <div className="glass-coverage-invalid-label">
                invalid polarity — FIX OR REMOVE
              </div>
              {invalidPolarity.map((p) => (
                <div key={p.slug} className="glass-coverage-invalid-row">
                  <span className="chip">{p.slug}</span>
                  <span className="glass-coverage-invalid-token">
                    raw=&quot;{p.raw_polarity ?? "—"}&quot;
                  </span>
                </div>
              ))}
            </div>
          )}

          {coverage.generated_at && (
            <div className="glass-call-count">
              swept {coverage.generated_at}
            </div>
          )}
        </>
      )}
    </section>
  );
}
```

- [ ] **Step 2: Add the pane's CSS classes**

Find the stylesheet that defines the `glass-*` classes (grep for `glass-shop-grid`):

Run: `grep -rl "glass-shop-grid" app/ styles/ --include="*.css"`

Append the coverage-specific classes to that file (reuse `glass-section`, `glass-placeholder`, `glass-shop-pending`, `chip`, `glass-call-count` as-is; add only the new ones):

```css
.glass-coverage-tallies { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-bottom: 0.75rem; }
.glass-coverage-tally { font-size: 0.8rem; padding: 0.15rem 0.5rem; border-radius: 4px; background: rgba(255,255,255,0.06); }
.glass-coverage-tally--ok { color: #6ee7b7; }
.glass-coverage-tally--backlog { color: #fbbf24; }
.glass-coverage-tally--warn { color: #fca5a5; }
.glass-coverage-cats-label,
.glass-coverage-invalid-label { font-size: 0.7rem; opacity: 0.6; text-transform: uppercase; letter-spacing: 0.04em; margin: 0.5rem 0 0.35rem; }
.glass-coverage-cat-grid { display: flex; flex-wrap: wrap; gap: 0.4rem; }
.glass-coverage-cat { display: inline-flex; align-items: center; gap: 0.35rem; }
.glass-coverage-cat-count { font-variant-numeric: tabular-nums; opacity: 0.85; }
.glass-coverage-invalid-row { display: flex; align-items: center; gap: 0.5rem; margin-top: 0.25rem; }
.glass-coverage-invalid-token { font-size: 0.75rem; color: #fca5a5; font-family: monospace; }
```

- [ ] **Step 3: Verify it builds**

Run: `bunx next build`
Expected: build completes; no type/JSX errors in `app/glass/coverage.tsx`.

- [ ] **Step 4: Commit (do not push)**

```bash
git add app/glass/coverage.tsx
# plus the CSS file grep found in Step 2
git commit -m "feat(glass): CoveragePane — gradeable coverage backlog by category"
```

---

### Task 5: Phase 1 — Wire `<CoveragePane>` into `/glass` (swfldatagulf-ops)

**Files:**
- Modify: `app/glass/page.tsx` (imports lines 2–14; `Promise.all` lines 19–37; render after `<ShoppingPane>` line 105)

**Interfaces:**
- Consumes: `fetchGradeableCoverage` (Task 3), `CoveragePane` (Task 4).

- [ ] **Step 1: Import the reader and the pane**

In `app/glass/page.tsx`, add `fetchGradeableCoverage` to the `@/lib/glass` import block (lines 2–10):

```tsx
import {
  fetchOpenCalls,
  fetchGradedCalls,
  fetchPendingHuskCount,
  fetchSkillOverTime,
  fetchCalibration,
  fetchDataTargets,
  fetchFlowSignal,
  fetchGradeableCoverage,
} from "@/lib/glass";
```

Add the pane import after the `ShoppingPane` import (line 14):

```tsx
import { ShoppingPane } from "./shopping";
import { CoveragePane } from "./coverage";
```

- [ ] **Step 2: Add the fetch to `Promise.all`**

Extend the destructure and the `Promise.all` array (lines 19–37) — add `coverageResult` / `fetchGradeableCoverage()` as the final entry:

```tsx
  const [
    masterHealth,
    callsResult,
    gradedResult,
    pendingCount,
    skillResult,
    calibResult,
    targetsResult,
    flowSignal,
    coverageResult,
  ] = await Promise.all([
    getMasterHealth(),
    fetchOpenCalls(),
    fetchGradedCalls(),
    fetchPendingHuskCount(),
    fetchSkillOverTime(),
    fetchCalibration(),
    fetchDataTargets(),
    fetchFlowSignal(),
    fetchGradeableCoverage(),
  ]);
```

- [ ] **Step 3: Render the pane next to `<ShoppingPane>`**

After the `<ShoppingPane … />` block (lines 101–105), add:

```tsx
      {/* ── Pane 5: Gradeable Coverage ── */}
      <CoveragePane coverage={coverageResult} />
```

- [ ] **Step 4: Verify the full page builds**

Run: `bunx next build`
Expected: build completes clean; `/glass` route compiles with the new pane.

- [ ] **Step 5: Commit (do not push)**

```bash
git add app/glass/page.tsx
git commit -m "feat(glass): render CoveragePane on /glass"
```

- [ ] **Step 6: Live-verify after deploy**

Once `swfldatagulf-ops` is deployed (operator confirms the push), open the deployed `/glass` and confirm the GRADEABLE COVERAGE pane shows `66 gradeable / 167 moat-fuel`, the category grid, and the 2 invalid-polarity slugs. This is the prod-evidence close for the ops side (never close on "code looks right").

---

### Task 6: Phase 2 — Batch 0: clear the 2 invalid-polarity slugs (brain-platform)

Both `active_listings_count_swfl` and `avg_days_on_market_swfl` carry the out-of-enum token `higher_is_bearish`, **AND both lack `value_type` and `category` in the vocab** — verified in-session via `gateVector` (`numeric_ok:false, window_ok:false`). A polarity flip alone would only move them to `row-candidate` (non-prediction-target). They are obviously numeric SWFL market metrics, so Batch 0 makes them genuinely **gradeable**: flip polarity to `lower_is_bullish` (market-strength convention — more supply / a slower market is bearish; their scope_notes confirm it: "rising inventory signals a softening, buyer-favorable market"; "Higher = slower market") **and** add the missing `value_type` + `category`. Source-faithful: a listings count IS a `count`, DOM IS `days`, both are SWFL `real-estate` (both value_types are confirmed already in use on real-estate concepts).

**Files:**
- Modify: `refinery/vocab/brain-vocabulary.json` (both concepts — use the **Edit tool**, not Bash, to preserve UTF-8; match the file's existing indentation)
- 🔴 Modify: `_AUDIT_AND_ROADMAP/grade-coverage.json` (regenerated)

- [ ] **Step 1: Make `active_listings_count_swfl` gradeable**

Read the `active_listings_count_swfl` concept block, then add two top-level fields and flip the polarity. The block goes from:

```json
  "active_listings_count_swfl": {
    "id": "active_listings_count_swfl",
    "grade": {
      "direction_polarity": "higher_is_bearish"
    },
    "prefLabel": "SWFL Active Residential Listings (Count)",
```

to:

```json
  "active_listings_count_swfl": {
    "id": "active_listings_count_swfl",
    "category": "real-estate",
    "value_type": "count",
    "grade": {
      "direction_polarity": "lower_is_bullish"
    },
    "prefLabel": "SWFL Active Residential Listings (Count)",
```

- [ ] **Step 2: Make `avg_days_on_market_swfl` gradeable**

Same shape — add `"category": "real-estate"` + `"value_type": "days"` as top-level fields and flip the polarity:

```json
  "avg_days_on_market_swfl": {
    "id": "avg_days_on_market_swfl",
    "category": "real-estate",
    "value_type": "days",
    "grade": {
      "direction_polarity": "lower_is_bullish"
    },
    "prefLabel": "SWFL Average Days on Market (Active Residential)",
```

- [ ] **Step 3: Run the sweep — warning gone, both now gradeable**

Run: `bun refinery/tools/grade-config-sweep.mts --check`
Expected: `invalid-polarity 0`; `gradeable` rises by 2 to **68**; `row-candidate` unchanged at `32` (the flip + value_type/category promotes them past row-candidate); `moat-fuel` unchanged at `167`; NO invalid-polarity warning block. (`--check` will FAIL the drift guard now because the committed artifact is stale — expected; regenerate in Step 4.) Sanity-confirm both are gradeable, not row-candidate: `bun -e "import {gateVector} from './refinery/vocab/loader.mts'; for (const s of ['active_listings_count_swfl','avg_days_on_market_swfl']) {const g=gateVector(s); console.log(s, g.numeric_ok, g.window_ok, g.polarity_state);}"` → both `true true valid_directional`.

- [ ] **Step 4: Regenerate the committed artifact**

Run: `bun refinery/tools/grade-config-sweep.mts`
Then re-run `--check` → exits 0 (pin green + artifact fresh).

- [ ] **Step 5: Confirm the polarity-lock + grade-config tests stay green**

Run: `bun test refinery/vocab/properties-polarity-lock.test.mts refinery/vocab/grade-config-polarity.test.mts`
Expected: all pass (these two slugs aren't in those locks, but the suites assert no inherited/invalid polarity crept in corpus-wide).

- [ ] **Step 6: Commit (do not push)**

```bash
git add refinery/vocab/brain-vocabulary.json _AUDIT_AND_ROADMAP/grade-coverage.json
git commit -m "feat(grading): Batch 0 — active-listings & DOM gradeable (lower_is_bullish + count/days value_type, real-estate); clears invalid-polarity"
```

---

### Task 7: Phase 2 — `reviewed_non_directional` marker + `reviewed-display` bucket (brain-platform)

Give the backlog a true floor: a moat-fuel concept judged intentionally non-directional gets a `grade.reviewed_non_directional: true` marker and lands in a new terminal `reviewed-display` bucket instead of moat-fuel forever. Threads through four files. `resolveGradeConfig` is **untouched** — a marked concept stays `gradeable:false` (its polarity is `none`), so the §3 pin holds.

**Files:**
- Modify: `refinery/stages/2.5-normalize.mts` (the `grade?:` block type, lines 73–84)
- Modify: `refinery/vocab/loader.mts` (`GateVector` interface ~lines 350–371; `gateVector()` return ~lines 415–426)
- 🔴 Modify: `refinery/tools/grade-config-sweep.mts` (`Bucket` union lines 68–74; `assignBucket()` lines 86–98; `summary` initializer lines 123–131; print-loop array lines 195–202)
- Create: `refinery/vocab/reviewed-non-directional.test.mts`

**Interfaces:**
- Consumes: `GateVector` (extended here), `assignBucket(gv: GateVector): Bucket`.
- Produces: `Bucket` now includes `"reviewed-display"`; `GateVector` gains `reviewed_non_directional: boolean`.

- [ ] **Step 1: Write the failing test**

Create `refinery/vocab/reviewed-non-directional.test.mts`:

```ts
/**
 * reviewed-display bucket — a moat-fuel concept with grade.reviewed_non_directional
 * is deliberately non-directional. It must (a) bucket as "reviewed-display", not
 * "moat-fuel", and (b) still resolve gradeable:false (polarity none) so the §3 pin
 * stays green. Tested against assignBucket(gateVector(...)) with a synthetic vector
 * so it does not depend on a live marked concept existing in the corpus yet.
 */
import { test } from "bun:test";
import assert from "node:assert/strict";
import {
  assignBucket,
  type Bucket,
} from "../tools/grade-config-sweep.mts";
import { type GateVector } from "./loader.mts";

function vec(over: Partial<GateVector>): GateVector {
  return {
    slug: "x",
    concept_id: "x",
    registered: true,
    polarity_state: "none",
    window_ok: true,
    numeric_ok: true,
    raw_polarity: null,
    category: "macro",
    value_type: "count",
    window_days: 90,
    reviewed_non_directional: false,
    ...over,
  };
}

test("marked, numeric, polarity-none concept buckets reviewed-display (not moat-fuel)", () => {
  const bucket: Bucket = assignBucket(vec({ reviewed_non_directional: true }));
  assert.equal(bucket, "reviewed-display");
});

test("unmarked numeric polarity-none concept still buckets moat-fuel", () => {
  assert.equal(assignBucket(vec({ reviewed_non_directional: false })), "moat-fuel");
});

test("marker does not promote a directional concept", () => {
  // valid_directional + window_ok is gradeable regardless of the marker
  assert.equal(
    assignBucket(vec({ polarity_state: "valid_directional", reviewed_non_directional: true })),
    "gradeable",
  );
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `bun test refinery/vocab/reviewed-non-directional.test.mts`
Expected: FAIL at the first assertion — `assignBucket` returns `"moat-fuel"`, not `"reviewed-display"`. (Bun runs types-stripped, so this fails at assertion time, not as a TS compile error — that's the correct red.)

- [ ] **Step 3: Add the marker field to the `grade?:` type**

In `refinery/stages/2.5-normalize.mts`, inside the `grade?:` block (lines 73–84), add after the `grade_basis` field:

```ts
    /** Override the value_type grade basis. */
    grade_basis?: "delta" | "sign";
    /**
     * Marks a numeric, polarity-`none` concept as deliberately non-directional
     * (a level/identifier that shouldn't be directionally graded). Buckets it
     * `reviewed-display` instead of `moat-fuel` so the backlog has a true floor.
     * Does NOT make the concept gradeable.
     */
    reviewed_non_directional?: boolean;
```

- [ ] **Step 4: Surface the marker on `GateVector` and populate it**

In `refinery/vocab/loader.mts`, add to the `GateVector` interface (after `window_days` ~line 370):

```ts
  window_days: number | null;
  /** grade.reviewed_non_directional === true — deliberately non-directional. */
  reviewed_non_directional: boolean;
```

In the `gateVector()` unregistered early-return (the `if (!concept)` block ~lines 381–393), add `reviewed_non_directional: false,` to the returned object. In the main return (~lines 415–426), add:

```ts
    window_days,
    reviewed_non_directional: g?.reviewed_non_directional === true,
  };
```

- [ ] **Step 5: Extend the sweep — bucket, union, summary, print loop**

In `refinery/tools/grade-config-sweep.mts`:

(a) Add to the `Bucket` union (lines 68–74):

```ts
export type Bucket =
  | "unregistered"
  | "invalid-polarity"
  | "row-candidate"
  | "gradeable"
  | "reviewed-display"
  | "moat-fuel"
  | "needs-window";
```

(b) In `assignBucket()` (lines 86–98), insert the `reviewed-display` branch **before** the `moat-fuel` return:

```ts
  if (gv.polarity_state === "none" && gv.window_ok) {
    if (gv.reviewed_non_directional) return "reviewed-display"; // looked at, deliberately not graded
    return "moat-fuel"; // polarity is the SOLE blocker — cheapest unlock
  }
```

(c) Add `"reviewed-display": 0,` to the `summary` initializer (lines 123–131).

(d) Add `"reviewed-display"` to the print-loop bucket array (lines 195–202), positioned after `"gradeable"`.

(e) **Make the module import-safe.** The test imports `assignBucket` from this file, but the file calls `main()` at the top level (line 230) — importing it would run the full sweep and overwrite the artifact mid-test. Guard the bottom-of-file call so it only runs when the file is the entry point:

```ts
// was: main();
if (import.meta.main) main();
```

(Bun sets `import.meta.main` true only for the directly-executed entry file, false on import — so `bun refinery/tools/grade-config-sweep.mts [--check]` still runs `main()`, while the test import does not.)

- [ ] **Step 6: Run the test — verify it passes**

Run: `bun test refinery/vocab/reviewed-non-directional.test.mts`
Expected: all 3 tests PASS.

- [ ] **Step 7: Verify the §3 pin + full sweep still green, regenerate artifact**

Run: `bun refinery/tools/grade-config-sweep.mts`
Expected: tallies now include a `reviewed-display 0` line; `gradeable 68 / moat-fuel 167` unchanged (no concept is marked yet); `✓ wrote`. Then `bun refinery/tools/grade-config-sweep.mts --check` exits 0.

- [ ] **Step 8: Commit (do not push)**

```bash
git add refinery/stages/2.5-normalize.mts refinery/vocab/loader.mts refinery/tools/grade-config-sweep.mts refinery/vocab/reviewed-non-directional.test.mts _AUDIT_AND_ROADMAP/grade-coverage.json
git commit -m "feat(grading): reviewed_non_directional marker + reviewed-display bucket"
```

---

### Task 8: Phase 2 — Drain moat-fuel by category, Batches 1–5 (brain-platform, iterative)

A repeatable per-category procedure, not pre-canned code: each of the 167 moat-fuel slugs needs a **real directional judgment against its `scope_note`**, applying the convention. Pre-inventing 167 polarity tokens would violate the no-fabrication rule — the polarity is derived per concept at execution time. Order (spec): **Batch 1** real-estate · **Batch 2** macro · **Batch 3** environmental · **Batch 4** logistics + credit-risk · **Batch 5** tail (demand-signal, economic-activity, labor, hospitality).

**Files (per batch):**
- Modify: `refinery/vocab/brain-vocabulary.json` (add `direction_polarity` or `reviewed_non_directional` to each concept's `grade` block — **Edit tool only**, preserve UTF-8)
- Modify: `_AUDIT_AND_ROADMAP/grade-coverage.json` (regenerated)

- [ ] **Step 1: Derive the TRUE per-category split**

The spec's per-category numbers (real-estate ~40, macro ~30, …) come from the stale 144 artifact and are indicative only. Get the real list per category from the fresh artifact:

```bash
bun -e "const a=JSON.parse(require('fs').readFileSync('_AUDIT_AND_ROADMAP/grade-coverage.json','utf-8')); const m={}; for(const r of a.records){ if(r.bucket==='moat-fuel'){ (m[r.gateVector.category]??=[]).push(r.slug); } } for(const k of Object.keys(m).sort()) console.log(k, m[k].length, '\n  '+m[k].join('\n  ')); "
```

Set each batch's true size from THIS output, not the spec's estimates.

- [ ] **Step 2: For each concept in the batch's category — judge and mark**

For every slug listed for the category, read its concept in `brain-vocabulary.json` (its `scope_note` + `prefLabel`), then apply the convention (**bullish = stronger SWFL market / regional economy**):

- Higher value = stronger market/economy → add `"direction_polarity": "higher_is_bullish"` to the `grade` block.
- Higher value = weaker market/economy → add `"direction_polarity": "lower_is_bullish"`.
- A level/identifier/structural figure that has no honest market direction → add `"reviewed_non_directional": true` (it will bucket `reviewed-display`).

Example shape of an edit (a concept currently `"grade": { ... }` or with no grade block — add the field):

```json
  "grade": {
    "direction_polarity": "higher_is_bullish"
  },
```

When a metric helps one side and hurts another (e.g. new-construction permits: bearish for prices, bullish for regional growth), grade by **market/economic strength**, never by buyer-vs-seller. If a call is genuinely ambiguous, mark it `reviewed_non_directional` rather than guess — an honest floor beats a wrong polarity.

- [ ] **Step 3: Run the sweep — confirm the count moves by the batch size**

Run: `bun refinery/tools/grade-config-sweep.mts`
Expected: `moat-fuel` drops by the number of slugs given a `direction_polarity` this batch; `gradeable` rises by the same; `reviewed-display` rises by the number marked non-directional. Sum is conserved.

- [ ] **Step 4: Keep the locks green**

Run: `bun test refinery/vocab/properties-polarity-lock.test.mts refinery/vocab/grade-config-polarity.test.mts refinery/vocab/reviewed-non-directional.test.mts`
Expected: all pass. Then `bun refinery/tools/grade-config-sweep.mts --check` → exits 0 (pin green + artifact fresh after Step 3's regenerate).

- [ ] **Step 5: Commit the batch (do not push)**

```bash
git add refinery/vocab/brain-vocabulary.json _AUDIT_AND_ROADMAP/grade-coverage.json
git commit -m "feat(grading): Batch N <category> — directional polarity backfill"
```

- [ ] **Step 6: Repeat Steps 2–5 for each remaining category**

After all batches, `moat-fuel` = genuine remaining owed work (ideally 0 or only deferred categories); `reviewed-display` = "looked at, deliberately not graded." Update the `grade_coverage_backfill_live_verify` check with prod evidence once the ops pane reflects the drained counts.

---

## Deferred (not in this plan)

**needs-window micro-track.** The 13 `regulatory` needs-window concepts need either a `regulatory` entry in `CATEGORY_WINDOW_DAYS` (grounded in a confirmed source publish cadence) or per-slug windows; the 3 `qualitative` are correctly non-gradeable — leave them. Decide regulatory's window in its own commit once a regulatory source's cadence is confirmed. Out of scope here because it changes a grading default, not a polarity.

## Self-Review

- **Spec coverage:** Phase 0 relocate + drift guard → Tasks 1–2. Phase 1 reader + pane + wiring → Tasks 3–5. Phase 2 Batch 0 + marker + category drain → Tasks 6–8. `reviewed_non_directional` floor → Task 7. needs-window → Deferred section. All spec sections map to a task.
- **Type consistency:** `GradeableCoverage` (Task 3) is consumed verbatim by Tasks 4–5. `Bucket` gains `"reviewed-display"` and `GateVector` gains `reviewed_non_directional` in Task 7, used by the Task 7 test. `fetchGradeableCoverage` name matches across Tasks 3/5.
- **No invented numbers:** the only hard counts asserted (66/167/2/23/32, stale 144/25) are the live + committed sweep outputs verified in-session; Phase 2 polarities are derived per concept, never pre-stamped.

---

## Parallel Safety

> Tasks sharing a color badge touch overlapping files and **cannot run in parallel**.

| Group | Tasks | Shared Files |
|-------|-------|--------------|
| 🔴 | Task 1, Task 6, Task 7 | `refinery/tools/grade-config-sweep.mts`, `_AUDIT_AND_ROADMAP/grade-coverage.json` |

Tasks with no color badge have no file conflicts — safe to parallelize freely.
