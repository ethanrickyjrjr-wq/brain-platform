# Phase 2g — `pickFramesForData` deterministic mapper · v2 REVISED SPEC

> **Why v2:** The v1 build (commit `7323a8b`) was run by the wrong builder (Sonnet, not Opus),
> duplicated `MIN_POINTS` and column-detection logic already in `chart-from-metrics.mts` (spec
> said "don't duplicate it"), returned a noisy array of candidates rather than a ranked
> single best-match, and registered `franchise-survival` as a generic `ranked-categories`
> consumer causing it to fire on any brain with a numeric column.

---

## Contract (inherited)

- Own `ChartSpec` registry extending `ChartBlock`; per-visual as-of; NO `git push`.
- Depends only on **Phase 2a** (`ChartSpec` + `CHART_REGISTRY`).
- `chart-from-metrics.mts` (`@/refinery/lib/chart-from-metrics.mts`) is a **HARD IMPORT REQUIREMENT**
  — `pick-frames.ts` MUST import `MIN_POINTS` and the qualifying-table/metric detection functions
  from there. Do not re-implement or inline those constants or algorithms. If they are not yet
  exported, export them in the same commit.

---

## Return type — single ranked best-match (not a candidate set)

`pickFramesForData` returns **`FrameCandidate | null`**, not an array.

The function evaluates shapes in strict priority order and returns the **first match**.
Callers get one answer and act on it; they never need to pick from a list.

```ts
export interface FrameCandidate {
  frameId: string;
  reason: string;  // human-readable shape explanation, no internal IDs
}

export function pickFramesForData(
  detail_tables: BrainOutputDetailTable[] | undefined,
  key_metrics: BrainOutputMetric[],
): FrameCandidate | null
```

---

## Priority ladder (evaluated top-to-bottom, first match wins)

| Priority | Shape trigger | frameId returned | Rationale |
|----------|--------------|-----------------|-----------|
| 1 | `detail_tables`: any table has a date/period column AND a numeric column with ≥ MIN_POINTS rows | `"zhvi-area"` | Change-over-time beats all others; most informative view |
| 2 | `detail_tables`: any table has ≥ 2 non-date numeric columns each with ≥ MIN_POINTS rows | `"corridor-scatter"` | Two numeric axes → scatter beats generic bar |
| 3 | `key_metrics`: ≥ 2 metrics with `display_format === "percent"` (or `"ratio"` with value in [0,1]) whose values sum to 0.9–1.1 | `"composition"` | Percent segments → composition bar |
| 4 | `key_metrics`: exactly 1 numeric (non-categorical) metric | `"z-gauge"` | Single metric vs implied target/baseline |
| 5 | `detail_tables`: any table has ≥ 1 non-date numeric column with ≥ MIN_POINTS rows | `"bar-table"` | Generic ranked bar is the lowest-specificity fallback |
| — | None of the above | `null` | Caller falls back to prose |

**Never return** `"franchise-survival"`, `"seasonal-radial"`, or `"storm-timeline"`.
Those frames are fixture-bound/brain-specific and are wired directly by Phase 3 via brain ID.
They live in the registry for `FrameRenderer` but `pickFramesForData` must not select them.

### Date-column detection rule

A column is a date/period dimension if its `id` matches
`/date|year|month|period|quarter|week/i`. This is the same heuristic used internally
in `chart-from-metrics.mts` — export and import it, do not re-declare it.

---

## What to export from `chart-from-metrics.mts`

Add these exports (no logic changes — just expose what already exists):

```ts
// MIN_POINTS — already defined, add `export`
export const MIN_POINTS = 3;

// Date-column predicate — extract from internal usage, add export
export const DATE_COLUMN_RE = /date|year|month|period|quarter|week/i;
export function isDateColumn(columnId: string): boolean {
  return DATE_COLUMN_RE.test(columnId);
}

// Qualifying numeric columns in a detail_table — generalized from chartFromDetailTable
// Returns the subset of columns that are non-date AND have >= MIN_POINTS numeric rows
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

Do NOT change `chartFromDetailTable`, `chartFromKeyMetrics`, or `computeMetricChart` — they are
refinery build-time code with their own consumers. Only add the three exports above.

---

## Acceptance

- `pick-frames.ts` imports `MIN_POINTS`, `isDateColumn`, `numericQualifyingColumns` from
  `@/refinery/lib/chart-from-metrics.mts` — grep must confirm, no inline re-declarations.
- Return type is `FrameCandidate | null`, not an array.
- `"franchise-survival"`, `"seasonal-radial"`, `"storm-timeline"` never appear in any return value.
- Unit tests: each priority level + null case + priority-ordering (a two-numeric table returns
  `corridor-scatter`, not `bar-table`, even though the ranked-categories trigger also fires).
- `tsc --noEmit` clean across both files.
- No multi-paragraph comment blocks in `pick-frames.ts` or `registry.ts` (CLAUDE.md rule).

---

## Wrap

Commit locally. SESSION_LOG + build-queue. Update README status row 2g. **No push.**
