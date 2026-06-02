# macro-florida top3 + vocab fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correct the macro-florida CBP "top sectors" narrative (it currently lists the "00" total-all-sectors row and a duplicated Professional subsector) and fix two swapped `fred_series` vocab values.

**Architecture:** Pure deterministic pack (`skipSynthesisAgent: true`). The bug is in one narrative `SynthesisFact` produced by `macroFloridaCorpusSummary`; the fix filters CBP rows to the brain's tracked NAICS sectors and sorts by establishment count before taking the top 3. The vocab fix is a two-value swap in `brain-vocabulary.json`. Both are confined to macro-florida — nothing downstream is touched.

**Tech Stack:** TypeScript / Bun, refinery pipeline, `bun:test` + `node:assert/strict`.

---

## Audit context — what changed vs. the original plan

This plan supersedes an earlier draft ("Fix macro-florida Brain"). Findings from verifying every claim against live code + the current brain file (`brains/macro-florida.md` v17, refined 2026-06-02T04:44:08Z):

- **Original Issue #1 (brain stale, shows 2,026 / sectors missing) is ALREADY FIXED.** The `selectAllPaged` pagination fix shipped and the brain was rebuilt to **v17** with all five sectors at full, correct counts (Professional 92,082; Retail 75,729; Healthcare 71,553; Construction 65,227; Accommodation 47,652 — exactly the "DB total" column). **No data rebuild is needed for this.** (If the _deployed_ `/api/b/macro-florida` still serves v16, that is deployment lag, not a rebuild problem — it resolves on the next deploy, not via this plan.)
- **Original Issue #2 (top3) is REAL and confirmed in v17** — line 41: `… Total for all sectors (631,745 estab.), Professional… (92,082 estab.), Professional… (92,082 estab.)`. This is the only narrative defect and it still ships today. **This is the core of the fix below.**
- **Original Issue #3 (vocab `fred_series` swap) is REAL but pure hygiene.** `fred_series` is only a declared optional field in the vocab concept type (`refinery/stages/2.5-normalize.mts:55`); no code reads its value. Zero impact on any brain output, MCP payload, or provenance surface today. Fixed here for correctness, not because anything is broken at runtime.
- **The rebuild is macro-florida-only.** The broken top3 line is a `SynthesisFact` rendered into the `SAVED FACTS` section, **not** the `--- OUTPUT ---` block. Per the thin-pipe rule (CLAUDE.md Brain Factory rule 1), macro-swfl and master read only the OUTPUT block, so the bug does **not** propagate. macro-swfl/master need **no** action.
- **No hang risk.** macro-florida, macro-swfl, and master all set `skipSynthesisAgent: true` — the macro chain never calls Anthropic and cannot hang in Stage 3. The `SUPABASE_S3_*` secrets are already wired into `daily-rebuild.yml` (lines 42-44, commit `a434e02`).
- **The bug is invisible in fixture mode** (the fixture contains no "00"/"541" rows and `loadFixture` does not sort), so the existing source test does not cover it. Task 1 adds a deterministic unit test that reproduces it.

---

## File Structure

- **Modify:** `refinery/packs/macro-florida.mts` — the `top3` computation inside `macroFloridaCorpusSummary` (currently lines 198-204).
- **Create:** `refinery/packs/macro-florida.test.mts` — first pack-level test for macro-florida; exercises `macroFlorida.corpusSummary` directly.
- **Modify:** `refinery/vocab/brain-vocabulary.json` — swap two `fred_series` values (lines ~471 and ~503).
- **Regenerate (build artifact):** `brains/macro-florida.md` — via a live `--target-only` rebuild in Task 5.

> Stage ONLY these files. The working tree has unrelated in-progress operator changes (`refinery/cli.mts`, `refinery/stages/4-output.mts`, `tools/lake-mcp-server*.mts`, `refinery/lib/master-gate*.mts`, untracked firecrawl JSON, the brain-resilience-phase-4 plan dir). Do not stage them.

---

### Task 1: Fix the CBP "top sectors" narrative (TDD)

**Files:**

- Test: `refinery/packs/macro-florida.test.mts` (create)
- Modify: `refinery/packs/macro-florida.mts:198-204`

- [ ] **Step 1: Write the failing test**

`macroFloridaCorpusSummary` returns `[]` unless at least one `macro-indicator` fragment is present (guard at macro-florida.mts:157), so the test must include one dummy FRED indicator alongside the CBP rows. The CBP rows are fed in deliberately scrambled order (not count-sorted) and include the two offenders — `"00"` (total-all-sectors) and `"541"` (a Professional subsector with the same label/count as `"54"`) — so the test pins BOTH defects: untracked-row leakage and wrong ordering.

Create `refinery/packs/macro-florida.test.mts`:

```typescript
import { test } from "bun:test";
import assert from "node:assert/strict";
import type { RawFragment } from "../types/fragment.mts";
import { macroFlorida } from "./macro-florida.mts";

function cbpFrag(
  naics_code: string,
  naics_label: string,
  fl_establishments: number,
): RawFragment {
  return {
    fragment_id: `census_cbp_fl:${naics_code}-2022`,
    source_id: "census_cbp_fl",
    source_trust_tier: 1,
    fetched_at: "2026-06-02T00:00:00Z",
    raw: {},
    normalized: {
      kind: "fl-cbp-aggregate",
      naics_code,
      naics_label,
      fl_establishments,
      fl_employment: 0,
      fl_annual_payroll: 0,
      year: 2022,
    },
  } as unknown as RawFragment;
}

function indicatorFrag(): RawFragment {
  return {
    fragment_id: "fred_macro_florida:FLUR",
    source_id: "fred_macro_florida",
    source_trust_tier: 1,
    fetched_at: "2026-06-02T00:00:00Z",
    raw: {},
    normalized: {
      kind: "macro-indicator",
      series_id: "FLUR",
      label: "Florida Unemployment Rate",
      value: 4.8,
      unit: "percent",
      period: "2026-04-01",
      direction: "rising",
      context: "",
      source_url: "https://example.test/flur",
    },
  } as unknown as RawFragment;
}

test("CBP top-sectors fact excludes the total-all-sectors row and subsectors, and ranks tracked sectors by establishment count", () => {
  // Scrambled order on purpose: a correct fix must sort by count, not trust input order.
  const fragments: RawFragment[] = [
    indicatorFrag(),
    cbpFrag("44-45", "Retail Trade", 75_729),
    cbpFrag("00", "Total for all sectors", 631_745),
    cbpFrag("23", "Construction", 65_227),
    cbpFrag("54", "Professional, scientific, and technical services", 92_082),
    cbpFrag("72", "Accommodation and Food Services", 47_652),
    cbpFrag("541", "Professional, scientific, and technical services", 92_082),
    cbpFrag("62", "Health Care and Social Assistance", 71_553),
  ];

  const facts = macroFlorida.corpusSummary!(fragments);
  const snapshot = facts.find((f) => f.topic === "fl_cbp_sector_snapshot");
  assert.ok(snapshot, "expected an fl_cbp_sector_snapshot fact");
  const value = snapshot!.value;

  // Bug #1: the "00" total-all-sectors row must not appear.
  assert.ok(
    !value.includes("631,745") && !value.includes("Total for all sectors"),
    `top3 leaked the total-all-sectors row: ${value}`,
  );

  // Bug #2: "541" duplicates "54"; Professional (92,082) must appear exactly once.
  assert.equal(
    value.split("92,082").length - 1,
    1,
    `Professional (92,082) should appear exactly once: ${value}`,
  );

  // Correct top 3 BY COUNT among tracked sectors: Professional > Retail > Healthcare.
  assert.ok(value.includes("75,729"), `Retail missing from top3: ${value}`);
  assert.ok(value.includes("71,553"), `Healthcare missing from top3: ${value}`);
  // Construction (65,227) and Accommodation (47,652) are 4th/5th — excluded.
  assert.ok(
    !value.includes("65,227"),
    `Construction should not be in top3: ${value}`,
  );
  assert.ok(
    !value.includes("47,652"),
    `Accommodation should not be in top3: ${value}`,
  );

  // Ordering is by descending count.
  assert.ok(
    value.indexOf("92,082") < value.indexOf("75,729") &&
      value.indexOf("75,729") < value.indexOf("71,553"),
    `top3 not ordered by establishment count: ${value}`,
  );
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test refinery/packs/macro-florida.test.mts`
Expected: FAIL — current code slices `cbpSectors.slice(0,3)` unfiltered, so `value` contains "Total for all sectors", "631,745", and "92,082" twice.

- [ ] **Step 3: Apply the minimal fix**

In `refinery/packs/macro-florida.mts`, replace the `top3` computation (currently lines 198-204):

```typescript
const top3 = cbpSectors
  .slice(0, 3)
  .map(
    (s) => `${s.naics_label} (${s.fl_establishments.toLocaleString()} estab.)`,
  )
  .join(", ");
```

with:

```typescript
// The live CBP source aggregates EVERY naics_code present, including the
// "00" total-all-sectors line and multi-digit subsectors (e.g. "541" under
// "54"). Restrict the headline to the sectors this brain tracks, and sort by
// establishment count so "top sectors by establishment count" is true even in
// fixture mode (loadFixture does not pre-sort). .filter()/.sort() build a new
// array — cbpSectors and lastCbpSectors stay untouched for the loop below.
const top3 = cbpSectors
  .filter((s) => CBP_NAICS_METRICS.some((m) => m.naics === s.naics_code))
  .sort((a, b) => b.fl_establishments - a.fl_establishments)
  .slice(0, 3)
  .map(
    (s) => `${s.naics_label} (${s.fl_establishments.toLocaleString()} estab.)`,
  )
  .join(", ");
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test refinery/packs/macro-florida.test.mts`
Expected: PASS.

- [ ] **Step 5: Commit**

Stage only the two files for this task:

```bash
git add refinery/packs/macro-florida.mts refinery/packs/macro-florida.test.mts
git commit -m "fix(macro-florida): filter CBP top-sectors to tracked NAICS, sort by count"
```

---

### Task 2: Swap the two `fred_series` vocab values

**Files:**

- Modify: `refinery/vocab/brain-vocabulary.json` (concepts `macro_fl_unemployment` ~line 471 and `macro_fl_labor_participation` ~line 503)

Source of truth: `refinery/sources/macro-florida-source.mts` `FRED_SERIES` — `FLUR` is the Florida unemployment rate; `LBSSA12` is the Florida labor-force participation rate. The vocab currently has them swapped.

- [ ] **Step 1: Fix `macro_fl_unemployment.fred_series`**

In the `macro_fl_unemployment` concept, change:

```json
      "fred_series": "LBSSA12",
```

to:

```json
      "fred_series": "FLUR",
```

- [ ] **Step 2: Fix `macro_fl_labor_participation.fred_series`**

In the `macro_fl_labor_participation` concept, change:

```json
      "fred_series": "FLUR",
```

to:

```json
      "fred_series": "LBSSA12",
```

- [ ] **Step 3: Verify the JSON still parses**

Run: `bun -e "JSON.parse(require('node:fs').readFileSync('refinery/vocab/brain-vocabulary.json','utf8')); console.log('ok')"`
Expected: `ok`

- [ ] **Step 4: Commit**

```bash
git add refinery/vocab/brain-vocabulary.json
git commit -m "fix(vocab): unswap macro_fl unemployment/participation fred_series metadata"
```

---

### Task 3: Full typecheck + test sweep

**Files:** none (verification only)

- [ ] **Step 1: Run the existing CBP source test (regression guard)**

Run: `bun test refinery/sources/macro-florida-cbp-source.test.mts`
Expected: PASS (5 tests).

- [ ] **Step 2: Run the full refinery test suite**

Run: `bun test refinery/`
Expected: all green (the new macro-florida pack test included; no changed assertions elsewhere).

- [ ] **Step 3: Typecheck**

Run `refinery:typecheck` ALONE — its non-zero exit is accepted baseline debt (~18 pre-existing strictness errors), and its non-zero exit will cancel a parallel tool batch. Confirm no NEW errors reference `macro-florida.mts` or `macro-florida.test.mts`:

Run: `bun run refinery:typecheck`
Expected: same baseline error set as before this change; nothing new in the two touched files.

---

### Task 4: Regenerate `brains/macro-florida.md` (live, macro-florida only)

**Files:**

- Regenerate: `brains/macro-florida.md`

This produces v18 with both the correct counts (already correct in v17) AND the corrected top3 line. `--target-only` rebuilds ONLY macro-florida and never touches macro-us/macro-swfl/master artifacts (cli.mts:38). macro-florida skips synthesis, so no Anthropic egress and no Stage-3 hang. Requires live creds: `FRED_API_KEY` and `SUPABASE_URL` / `SUPABASE_SERVICE_KEY` (for `data_lake.census_cbp_fl`).

- [ ] **Step 1: Dry-run validate (no write)**

Run: `bun refinery/cli.mts macro-florida --target-only --dry-run`
Expected: pipeline runs, all validators (`spec-validator`, `facts-only-lint`, `inference-bait-lint`, `smoothing-lint`) pass, no file written.

- [ ] **Step 2: Live rebuild (writes the brain file)**

Run: `bun refinery/cli.mts macro-florida --target-only`
Expected: `brains/macro-florida.md` rewritten, version bumps to 18, freshness token updates.

- [ ] **Step 3: Verify the regenerated brain**

Confirm in `brains/macro-florida.md`:

- The `fl_cbp_sector_snapshot` fact (the "top sectors by establishment count" sentence) names three DISTINCT sectors — Professional (92,082), Retail (75,729), Healthcare (71,553) — with NO "Total for all sectors" and NO duplicated Professional.
- `key_metrics` still contains all five CBP sectors with unchanged counts (92,082 / 75,729 / 71,553 / 65,227 / 47,652).

Run (spot check): `bun -e "const t=require('node:fs').readFileSync('brains/macro-florida.md','utf8'); console.log(/Total for all sectors/.test(t)?'FAIL: total leaked':'ok: no total'); console.log((t.match(/92,082/g)||[]).length,'occurrences of 92,082')"`
Expected: `ok: no total` and a small, sane count of `92,082` occurrences (snapshot once + key_metric once + citation once — not a duplicated-in-snapshot count).

- [ ] **Step 4: Commit the regenerated brain**

```bash
git add brains/macro-florida.md
git commit -m "chore(brains): rebuild macro-florida — corrected CBP top-sectors line"
```

> Fallback if live creds are unavailable in this session: skip Task 4 and let the 06:00 UTC `daily-rebuild.yml` cron regenerate macro-florida as part of the (synthesis-free) master cascade. The code fix is already on `main` from Tasks 1-2, so the next cron run produces the corrected v18 automatically.

---

### Task 5: Session log + push

**Files:**

- Modify: `SESSION_LOG.md`

- [ ] **Step 1: Append a newest-first SESSION_LOG entry**

Add to the top of `SESSION_LOG.md`:

```markdown
## 2026-06-02 (<model> · main) — fix(macro-florida): CBP top-sectors filter + vocab fred_series unswap

`macroFloridaCorpusSummary` top3 listed the "00" total-all-sectors row and a duplicated Professional subsector ("54"+"541"). Filtered to tracked NAICS + sorted by establishment count; added first pack-level test (`refinery/packs/macro-florida.test.mts`). Unswapped `macro_fl_unemployment`/`macro_fl_labor_participation` `fred_series` (metadata-only; nothing reads it). Counts were already correct in v17 — only the narrative line was wrong; rebuilt to v18. Downstream untouched (top3 is a SAVED FACT, not in OUTPUT).
```

- [ ] **Step 2: Commit the log and push**

```bash
git add SESSION_LOG.md
git commit -m "log: macro-florida top-sectors + vocab fix"
node scripts/safe-push.mjs
```

Expected: hook confirms a commit ahead of upstream touched `SESSION_LOG.md`; push succeeds.

---

## Self-Review

- **Spec coverage:** Original Issue #1 → intentionally dropped (already fixed in v17; documented in audit context). Issue #2 → Task 1. Issue #3 → Task 2. Rebuild → Task 4 (macro-florida only, justified by thin-pipe analysis). Verification → Tasks 3-4.
- **Placeholder scan:** No TBDs; all code and commands are concrete. `<model>` in the SESSION_LOG entry is the one intentional fill-in (the executing session's model name).
- **Type consistency:** Test constructs `fl-cbp-aggregate` normalized fragments matching `MacroFloridaCbpNormalized` (`refinery/sources/macro-florida-cbp-source.mts:22-30`) and one `macro-indicator` matching `MacroFloridaNormalized` (`macro-florida-source.mts:33-44`). The fix references `CBP_NAICS_METRICS` (defined macro-florida.mts:80) and `s.naics_code` / `s.fl_establishments` (confirmed field names). `macroFlorida.corpusSummary` is the exported pack's bound `macroFloridaCorpusSummary`.
