# pick-frames v2 + comment-block cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite `pickFramesForData` to import from `chart-from-metrics.mts` (not duplicate it), return a single ranked best-match instead of a candidate array, and strip illegal multi-paragraph comment blocks from `pick-frames.ts` and `registry.ts`.

**Architecture:** Export three helpers from the existing `chart-from-metrics.mts` (MIN_POINTS, isDateColumn, numericQualifyingColumns). Rewrite `pick-frames.ts` to import those and evaluate a strict 5-level priority ladder returning `FrameCandidate | null`. Tests cover all five priority levels plus the priority-ordering guarantee that scatter wins over bar when 2 numeric cols are present.

**Tech Stack:** TypeScript, Bun test runner (`bun test`).

**Spec:** `docs/superpowers/plans/2026-06-10-presentation-deliverable-engine/phase-2g-pick-frames-mapper__OPUS-v2.md`

---

### Task 1: Export three helpers from `chart-from-metrics.mts`

**Files:**
- Modify: `refinery/lib/chart-from-metrics.mts` (add 3 exports; no logic changes)

The file currently has private `MIN_POINTS = 3` and column-detection logic inline inside `chartFromDetailTable`. We need to surface them for `pick-frames.ts` without touching the existing exported function.

- [ ] **Step 1: Write a failing test that imports the new exports**

Create `refinery/lib/chart-from-metrics-exports.test.mts`:

```ts
import { describe, it, expect } from "bun:test";
import { MIN_POINTS, isDateColumn, numericQualifyingColumns } from "./chart-from-metrics.mts";
import type { BrainOutputDetailTable } from "../types/brain-output.mts";

describe("chart-from-metrics exports", () => {
  it("MIN_POINTS is 3", () => {
    expect(MIN_POINTS).toBe(3);
  });

  it("isDateColumn matches date/year/month/period/quarter/week (case-insensitive)", () => {
    expect(isDateColumn("date")).toBe(true);
    expect(isDateColumn("year")).toBe(true);
    expect(isDateColumn("Month")).toBe(true);
    expect(isDateColumn("period")).toBe(true);
    expect(isDateColumn("quarter")).toBe(true);
    expect(isDateColumn("week")).toBe(true);
    expect(isDateColumn("zip")).toBe(false);
    expect(isDateColumn("value")).toBe(false);
    expect(isDateColumn("corridor")).toBe(false);
  });

  it("numericQualifyingColumns returns non-date columns with >= MIN_POINTS numeric rows", () => {
    const table: BrainOutputDetailTable = {
      grain: "zip",
      columns: [
        { id: "zip", label: "ZIP" },
        { id: "aal_usd", label: "AAL ($)", display_format: "currency" },
      ],
      rows: [
        { label: "33901", cells: { zip: "33901", aal_usd: 12000 } },
        { label: "33908", cells: { zip: "33908", aal_usd: 30074 } },
        { label: "33931", cells: { zip: "33931", aal_usd: 18500 } },
      ],
    };
    const cols = numericQualifyingColumns(table);
    expect(cols).toHaveLength(1);
    expect(cols[0].id).toBe("aal_usd");
    expect(cols[0].numericRowCount).toBe(3);
  });

  it("numericQualifyingColumns excludes date columns", () => {
    const table: BrainOutputDetailTable = {
      grain: "month",
      columns: [
        { id: "date", label: "Month" },
        { id: "value", label: "Index", display_format: "raw" },
      ],
      rows: [
        { label: "2025-01", cells: { date: "2025-01", value: 102.1 } },
        { label: "2025-02", cells: { date: "2025-02", value: 104.5 } },
        { label: "2025-03", cells: { date: "2025-03", value: 108.0 } },
      ],
    };
    const cols = numericQualifyingColumns(table);
    // "date" is excluded; "value" has 3 numeric rows
    expect(cols.map((c) => c.id)).not.toContain("date");
    expect(cols.map((c) => c.id)).toContain("value");
  });

  it("numericQualifyingColumns returns empty when no column has >= MIN_POINTS numeric rows", () => {
    const table: BrainOutputDetailTable = {
      grain: "corridor",
      columns: [{ id: "name", label: "Name" }],
      rows: [
        { label: "A", cells: { name: "Alpha" } },
        { label: "B", cells: { name: "Beta" } },
      ],
    };
    expect(numericQualifyingColumns(table)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails (imports missing)**

```
bun test refinery/lib/chart-from-metrics-exports.test.mts
```

Expected: error — `MIN_POINTS`, `isDateColumn`, `numericQualifyingColumns` not exported.

- [ ] **Step 3: Add the three exports to `chart-from-metrics.mts`**

At line 39 (before the existing private `const MIN_POINTS = 3`), replace the private declarations with exported ones and add the two new helpers. Existing functions (`chartFromDetailTable`, `chartFromKeyMetrics`, `computeMetricChart`) are untouched.

Change the `MIN_POINTS` line from:
```ts
const MIN_POINTS = 3;
```
to:
```ts
export const MIN_POINTS = 3;
```

After the `MIN_POINTS` block (before `MAX_BARS`), add:

```ts
/** Column id matches a date/period dimension. */
export const DATE_COLUMN_RE = /date|year|month|period|quarter|week/i;

export function isDateColumn(columnId: string): boolean {
  return DATE_COLUMN_RE.test(columnId);
}

/** Non-date columns in `table` that have >= MIN_POINTS numeric rows. */
export function numericQualifyingColumns(
  table: BrainOutputDetailTable,
): Array<{ id: string; numericRowCount: number }> {
  return table.columns
    .filter((col) => !isDateColumn(col.id))
    .map((col) => ({
      id: col.id,
      numericRowCount: table.rows.filter((r) => typeof r.cells[col.id] === "number").length,
    }))
    .filter(({ numericRowCount }) => numericRowCount >= MIN_POINTS);
}
```

- [ ] **Step 4: Run the new tests to confirm they pass**

```
bun test refinery/lib/chart-from-metrics-exports.test.mts
```

Expected: 5 tests pass.

- [ ] **Step 5: Run existing refinery tests to confirm no regressions**

```
bun test refinery/lib/chart-from-metrics.test.mts 2>/dev/null || bun test refinery/ --bail
```

Expected: all existing tests still pass (we only added exports, changed no logic).

- [ ] **Step 6: Typecheck**

```
bun run tsc --noEmit 2>&1 | head -30
```

Expected: 0 new errors (the ~18 baseline strictness errors are pre-existing accepted debt).

---

### Task 2: Rewrite `pick-frames.ts` — ranked single best-match

**Files:**
- Modify: `components/charts/registry/pick-frames.ts` (full replacement)
- Modify: `components/charts/registry/pick-frames.test.ts` (update for new signature)

The current file returns `FrameCandidate[]` and duplicates `MIN_POINTS` and column-detection logic. The rewrite returns `FrameCandidate | null` and imports from `chart-from-metrics.mts`.

- [ ] **Step 1: Write the new test file**

Replace `components/charts/registry/pick-frames.test.ts` entirely:

```ts
import { describe, it, expect } from "bun:test";
import { pickFramesForData } from "./pick-frames";
import type { BrainOutputDetailTable, BrainOutputMetric } from "@/refinery/types/brain-output.mts";

// --- fixtures ---

const TIME_SERIES_TABLE: BrainOutputDetailTable = {
  grain: "month",
  columns: [
    { id: "date", label: "Month" },
    { id: "value", label: "Index", display_format: "raw" },
  ],
  rows: [
    { label: "2025-01", cells: { date: "2025-01", value: 102.1 } },
    { label: "2025-02", cells: { date: "2025-02", value: 104.5 } },
    { label: "2025-03", cells: { date: "2025-03", value: 108.0 } },
  ],
};

const RANKED_TABLE: BrainOutputDetailTable = {
  grain: "zip",
  columns: [
    { id: "zip", label: "ZIP" },
    { id: "aal_usd", label: "AAL ($)", display_format: "currency" },
  ],
  rows: [
    { label: "33901", cells: { zip: "33901", aal_usd: 12000 } },
    { label: "33908", cells: { zip: "33908", aal_usd: 30074 } },
    { label: "33931", cells: { zip: "33931", aal_usd: 18500 } },
  ],
};

const TWO_NUMERIC_TABLE: BrainOutputDetailTable = {
  grain: "corridor",
  columns: [
    { id: "corridor", label: "Corridor" },
    { id: "vacancy_rate", label: "Vacancy %", display_format: "percent" },
    { id: "asking_rent", label: "Asking Rent ($)", display_format: "currency" },
  ],
  rows: [
    { label: "Bonita", cells: { corridor: "Bonita", vacancy_rate: 0.04, asking_rent: 18.5 } },
    { label: "Airport", cells: { corridor: "Airport", vacancy_rate: 0.06, asking_rent: 22.0 } },
    { label: "Estero", cells: { corridor: "Estero", vacancy_rate: 0.03, asking_rent: 20.5 } },
  ],
};

const PERCENT_METRICS: BrainOutputMetric[] = [
  {
    metric: "sfha_pct",
    label: "SFHA zone",
    value: 0.19,
    display_format: "percent",
    variable_type: "intensive",
    units: "ratio",
    source: { citation: "FEMA" },
  },
  {
    metric: "ve_zone_pct",
    label: "V/VE zone",
    value: 0.031,
    display_format: "percent",
    variable_type: "intensive",
    units: "ratio",
    source: { citation: "FEMA" },
  },
  {
    metric: "non_sfha_pct",
    label: "Non-SFHA",
    value: 0.779,
    display_format: "percent",
    variable_type: "intensive",
    units: "ratio",
    source: { citation: "FEMA" },
  },
];

const SINGLE_METRIC: BrainOutputMetric[] = [
  {
    metric: "post_ian_recovery",
    label: "Post-Ian Recovery",
    value: 108.1,
    display_format: "raw",
    variable_type: "intensive",
    units: "index (2022=100)",
    source: { citation: "FDOT" },
  },
];

// --- tests ---

describe("pickFramesForData — returns single best-match or null", () => {
  it("P1: time-series table → zhvi-area", () => {
    const result = pickFramesForData([TIME_SERIES_TABLE], []);
    expect(result).not.toBeNull();
    expect(result!.frameId).toBe("zhvi-area");
  });

  it("P2: two-numeric table → corridor-scatter (not bar-table)", () => {
    const result = pickFramesForData([TWO_NUMERIC_TABLE], []);
    expect(result).not.toBeNull();
    expect(result!.frameId).toBe("corridor-scatter");
    // bar-table must NOT be returned — scatter wins the priority race
  });

  it("P3: percent metrics summing ~1.0 → composition", () => {
    const result = pickFramesForData(undefined, PERCENT_METRICS);
    expect(result).not.toBeNull();
    expect(result!.frameId).toBe("composition");
  });

  it("P4: single numeric metric → z-gauge", () => {
    const result = pickFramesForData(undefined, SINGLE_METRIC);
    expect(result).not.toBeNull();
    expect(result!.frameId).toBe("z-gauge");
  });

  it("P5: ranked table (single numeric col) → bar-table", () => {
    const result = pickFramesForData([RANKED_TABLE], []);
    expect(result).not.toBeNull();
    expect(result!.frameId).toBe("bar-table");
  });

  it("null: empty input → null (no crash)", () => {
    expect(pickFramesForData(undefined, [])).toBeNull();
    expect(pickFramesForData([], [])).toBeNull();
  });

  it("result carries a non-empty reason string", () => {
    const result = pickFramesForData([RANKED_TABLE], []);
    expect(result!.reason.length).toBeGreaterThan(0);
  });

  it("P1 beats P5: time-series table is not downgraded to bar-table", () => {
    // TIME_SERIES_TABLE also has a non-date numeric column (value), so P5 would fire too.
    // P1 must win.
    const result = pickFramesForData([TIME_SERIES_TABLE], []);
    expect(result!.frameId).toBe("zhvi-area");
    expect(result!.frameId).not.toBe("bar-table");
  });

  it("never returns fixture-bound frames", () => {
    const FIXTURE_BOUND = ["franchise-survival", "seasonal-radial", "storm-timeline"];
    const inputs: Array<[BrainOutputDetailTable[] | undefined, BrainOutputMetric[]]> = [
      [[TIME_SERIES_TABLE], []],
      [[RANKED_TABLE], []],
      [[TWO_NUMERIC_TABLE], []],
      [undefined, PERCENT_METRICS],
      [undefined, SINGLE_METRIC],
    ];
    for (const [tables, metrics] of inputs) {
      const result = pickFramesForData(tables, metrics);
      if (result) {
        expect(FIXTURE_BOUND).not.toContain(result.frameId);
      }
    }
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail (old implementation)**

```
bun test components/charts/registry/pick-frames.test.ts
```

Expected: multiple failures — old function returns array, tests expect `null | object`.

- [ ] **Step 3: Replace `pick-frames.ts` with the correct implementation**

Write `components/charts/registry/pick-frames.ts`:

```ts
// pick-frames.ts — ranked data-shape → frame mapper (Phase 2g v2).
// Returns the single highest-priority registered frame for a brain's data, or null.
import type { BrainOutputDetailTable, BrainOutputMetric } from "@/refinery/types/brain-output.mts";
import { MIN_POINTS, isDateColumn, numericQualifyingColumns } from "@/refinery/lib/chart-from-metrics.mts";

export interface FrameCandidate {
  frameId: string;
  reason: string;
}

// Priority 1 — change-over-time: date column + numeric column in any detail_table.
function tryTimeSeries(tables: readonly BrainOutputDetailTable[]): FrameCandidate | null {
  for (const t of tables) {
    const hasDateCol = t.columns.some((c) => isDateColumn(c.id));
    if (!hasDateCol) continue;
    const qualifyingNonDate = numericQualifyingColumns(t);
    if (qualifyingNonDate.length >= 1) {
      return { frameId: "zhvi-area", reason: "time-series: date column + numeric values detected" };
    }
  }
  return null;
}

// Priority 2 — relationship: 2+ non-date numeric columns in any detail_table.
function tryRelationship(tables: readonly BrainOutputDetailTable[]): FrameCandidate | null {
  for (const t of tables) {
    if (numericQualifyingColumns(t).length >= 2) {
      return { frameId: "corridor-scatter", reason: "relationship: 2+ numeric columns detected" };
    }
  }
  return null;
}

// Priority 3 — composition: percent key_metrics whose values sum to ~1.0.
function tryComposition(metrics: readonly BrainOutputMetric[]): FrameCandidate | null {
  const pct = metrics.filter(
    (m) =>
      m.variable_type !== "categorical" &&
      typeof m.value === "number" &&
      (m.display_format === "percent" ||
        (m.display_format === "ratio" && (m.value as number) >= 0 && (m.value as number) <= 1)),
  );
  if (pct.length < 2) return null;
  const total = pct.reduce((s, m) => s + (m.value as number), 0);
  if (total < 0.9 || total > 1.1) return null;
  return { frameId: "composition", reason: "composition: percent metrics summing to ~1.0" };
}

// Priority 4 — single-vs-target: exactly 1 numeric key_metric.
function trySingleVsTarget(metrics: readonly BrainOutputMetric[]): FrameCandidate | null {
  const numeric = metrics.filter(
    (m) => m.variable_type !== "categorical" && typeof m.value === "number",
  );
  if (numeric.length !== 1) return null;
  return { frameId: "z-gauge", reason: "single-vs-target: one numeric metric" };
}

// Priority 5 — ranked-categories: any detail_table with 1 non-date numeric column.
function tryRankedCategories(tables: readonly BrainOutputDetailTable[]): FrameCandidate | null {
  for (const t of tables) {
    if (numericQualifyingColumns(t).length >= 1) {
      return { frameId: "bar-table", reason: "ranked-categories: single numeric column" };
    }
  }
  return null;
}

/**
 * Returns the single highest-priority frame for a brain's data shape, or null.
 * Fixture-bound frames (franchise-survival, seasonal-radial, storm-timeline) are
 * never returned — Phase 3 wires those directly by brain ID.
 */
export function pickFramesForData(
  detail_tables: BrainOutputDetailTable[] | undefined,
  key_metrics: BrainOutputMetric[],
): FrameCandidate | null {
  const tables = detail_tables ?? [];
  return (
    tryTimeSeries(tables) ??
    tryRelationship(tables) ??
    tryComposition(key_metrics) ??
    trySingleVsTarget(key_metrics) ??
    tryRankedCategories(tables) ??
    null
  );
}
```

- [ ] **Step 4: Run the new tests to confirm they pass**

```
bun test components/charts/registry/pick-frames.test.ts
```

Expected: 9 tests pass.

- [ ] **Step 5: Verify the hard import is present (grep check)**

```
grep -n "chart-from-metrics" components/charts/registry/pick-frames.ts
```

Expected: one line showing the import from `@/refinery/lib/chart-from-metrics.mts`.

```
grep -n "MIN_POINTS\s*=" components/charts/registry/pick-frames.ts
```

Expected: no local `MIN_POINTS` declaration — it must only appear as an import.

---

### Task 3: Strip multi-paragraph comment blocks from `registry.ts`

**Files:**
- Modify: `components/charts/registry/registry.ts` (remove block comment, keep file otherwise identical)

- [ ] **Step 1: Replace the opening comment block**

Current lines 1–10 in `registry.ts`:
```ts
/**
 * CHART_REGISTRY — the `frameId → component` map (Phase 2a).
 *
 * The single place new charts plug in. Phase 2b–2f each ADD one entry + one
 * frame file; nothing here is edited by surgery. `FrameRenderer` and the Phase 3
 * assembly engine resolve a `ChartSpec` through `getFrame(spec.frameId)`.
 *
 * Registered here: the three ALREADY-BUILT frames (generic bar/table, ZHVI area,
 * corridor scatter). The five UI-Kit frames land via 2b–2f.
 */
```

Replace with:
```ts
// CHART_REGISTRY — frameId → component map. One entry per frame; pick-frames.ts selects from this at runtime.
```

- [ ] **Step 2: Run typecheck to confirm no regressions**

```
bun run tsc --noEmit 2>&1 | head -30
```

Expected: same baseline error count as before.

---

### Task 4: Full test suite + commit

**Files:** none new — verification pass.

- [ ] **Step 1: Run all chart registry tests**

```
bun test components/charts/registry/
```

Expected: all tests in `registry.test.ts`, `pick-frames.test.ts`, and any frame tests pass.

- [ ] **Step 2: Run refinery tests to confirm no regressions from Task 1 exports**

```
bun test refinery/lib/
```

Expected: all pass (including new `chart-from-metrics-exports.test.mts`).

- [ ] **Step 3: Final typecheck**

```
bun run tsc --noEmit 2>&1 | grep "error TS" | wc -l
```

Expected: same count as baseline (no new errors).

- [ ] **Step 4: Commit**

```bash
git add \
  refinery/lib/chart-from-metrics.mts \
  refinery/lib/chart-from-metrics-exports.test.mts \
  components/charts/registry/pick-frames.ts \
  components/charts/registry/pick-frames.test.ts \
  components/charts/registry/registry.ts \
  docs/superpowers/plans/2026-06-10-presentation-deliverable-engine/phase-2g-pick-frames-mapper__OPUS-v2.md \
  docs/superpowers/plans/2026-06-11-pick-frames-v2.md
git commit -m "fix(charts): pick-frames v2 — ranked single-match, import chart-from-metrics.mts, strip comment blocks"
```

- [ ] **Step 5: Update SESSION_LOG and build-queue before Ricky pushes**

Append to top of `SESSION_LOG.md`:
```
## 2026-06-11 (main) — pick-frames v2 (local, not pushed)
- Rewrote `pick-frames.ts`: imports MIN_POINTS/isDateColumn/numericQualifyingColumns from `chart-from-metrics.mts` (no duplication), returns `FrameCandidate | null` (ranked single best-match, not candidate array), never recommends fixture-bound frames.
- Exported 3 helpers from `chart-from-metrics.mts`; 5 new export tests.
- Stripped multi-paragraph comment blocks from `registry.ts`.
- 9 pick-frames tests pass; tsc 0 new errors.
- Next: Phase 3 assembly + /p/[id].
```

Update `_AUDIT_AND_ROADMAP/build-queue.md`: mark 2g `[x]` (was `[~]`).
