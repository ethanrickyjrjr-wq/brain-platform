// pick-frames.ts — ranked data-shape → frame mapper (Phase 2g v2).
// Returns the single highest-priority registered frame for a brain's data, or null.
import type { BrainOutputDetailTable, BrainOutputMetric } from "@/refinery/types/brain-output.mts";
import { isDateColumn, numericQualifyingColumns } from "@/refinery/lib/chart-from-metrics.mts";

export interface FrameCandidate {
  frameId: string;
  reason: string;
}

// Priority 1 — change-over-time: date column + numeric column in any detail_table.
function tryTimeSeries(tables: readonly BrainOutputDetailTable[]): FrameCandidate | null {
  for (const t of tables) {
    const hasDateCol = t.columns.some((c) => isDateColumn(c.id));
    if (!hasDateCol) continue;
    if (numericQualifyingColumns(t).length >= 1) {
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

// Priority 5 — ranked-categories: any detail_table with 1+ non-date numeric column (lowest-specificity fallback).
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
