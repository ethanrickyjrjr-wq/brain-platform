/**
 * chart-from-metrics.mts — Tier A of the chart-generation design
 * (`docs/superpowers/specs/2026-06-07-chart-generation-three-tier-design.md`).
 *
 * `computeMetricChart(output)` turns a BrainOutput into ONE deterministic bar
 * `ChartBlock`, computed in code at refinery build time, or `null` when the
 * brain has no chartable shape (most brains do; some don't — that's correct,
 * not a failure). The block is persisted into the brain `.md` (Stage 4) and
 * read back onto BOTH the `/r/` display projection and the `/api/b` dossier.
 *
 * Source preference (most-legible first):
 *   1. a cross-sectional `detail_table` whose rows carry a single comparable
 *      numeric column (env-swfl AAL-by-ZIP, housing median-price-by-ZIP) — a
 *      real multi-bar comparison across places;
 *   2. else `key_metrics` grouped by `display_format` so bars are comparable
 *      (never mix `$` and `%` in one chart), taking the largest group with
 *      >= MIN_POINTS comparable numeric metrics.
 * Neither yields >= MIN_POINTS comparable numeric points => `null`.
 *
 * Leak discipline (Brain Factory rule 3): every label comes from a human
 * `label` / column `label` / row `label`, NEVER a metric slug or column `id`,
 * and the numeric cells are the already-audited public values. So the block is
 * customer-safe and may ride `DisplayBrain.chart` (the display-leak guard moves
 * with the type-lift). No interpolation, no smoothing — the audited numbers
 * verbatim (CLAUDE.md data-protocol rule 8).
 */
import {
  lintChartBlock,
  type ChartBlock,
  type ChartValueFormat,
} from "../validate/chart-block-lint.mts";
import type {
  BrainOutput,
  BrainOutputMetric,
  BrainOutputDetailTable,
  BrainOutputMetricDisplayFormat,
} from "../types/brain-output.mts";

/** A chart needs at least this many comparable bars to be worth drawing. */
const MIN_POINTS = 3;

/**
 * ...and at most this many to stay "at a glance" — a 125-ZIP housing table or a
 * 100+ metric pack would otherwise draw an unreadable wall of bars. Detail
 * tables keep the top-N by value (the most significant places); a key_metrics
 * group keeps the brain's first N (its own priority order).
 */
const MAX_BARS = 12;

const FORMAT_AXIS_LABEL: Record<BrainOutputMetricDisplayFormat, string> = {
  currency: "Currency",
  percent: "Percent",
  count: "Count",
  ratio: "Ratio",
  raw: "Value",
};

/**
 * Map a source `display_format` to the chart renderer's numeric formatter.
 * `currency` becomes `usd` (brain currency metrics are headline dollar amounts
 * — median price, AAL — not per-unit rents); ratios/raw/absent become `number`.
 */
function valueFormatFor(fmt: BrainOutputMetricDisplayFormat | undefined): ChartValueFormat {
  switch (fmt) {
    case "currency":
      return "usd";
    case "percent":
      return "percent";
    case "count":
      return "count";
    case "ratio":
    case "raw":
    default:
      return "number";
  }
}

/** Human header for a detail_table grain, e.g. "zip" -> "ZIP". */
function titleizeGrain(grain: string): string {
  const g = grain.trim();
  if (/^zips?$/i.test(g)) return "ZIP";
  if (g.length === 0) return "Item";
  return g.charAt(0).toUpperCase() + g.slice(1);
}

/**
 * Belt-and-suspenders: every block we emit must pass the chart lint
 * structurally, and provenance-trivially against its own cells. A structural
 * failure (should be unreachable given construction) => `null`, never a
 * malformed block.
 */
function finalize(block: ChartBlock): ChartBlock | null {
  const nums = new Set<number>();
  for (const row of block.rows) {
    for (const cell of row) {
      if (typeof cell === "number") nums.add(cell);
    }
  }
  return lintChartBlock(block, nums).ok ? block : null;
}

/** Try the preferred detail_table path; `null` if no table qualifies. */
function chartFromDetailTable(
  tables: readonly BrainOutputDetailTable[],
  asOf: string,
): ChartBlock | null {
  for (const t of tables) {
    for (const col of t.columns) {
      const numericRows = t.rows.filter((r) => typeof r.cells[col.id] === "number");
      if (numericRows.length >= MIN_POINTS) {
        const grainLabel = titleizeGrain(t.grain);
        const truncated = numericRows.length > MAX_BARS;
        // Over the cap: show the most significant places (top-N by value).
        const picked = truncated
          ? [...numericRows]
              .sort((a, b) => (b.cells[col.id] as number) - (a.cells[col.id] as number))
              .slice(0, MAX_BARS)
          : numericRows;
        return finalize({
          title: `${col.label} by ${grainLabel}${truncated ? ` (top ${MAX_BARS})` : ""}`,
          columns: [grainLabel, col.label],
          rows: picked.map((r) => [r.label, r.cells[col.id] as number]),
          chart_type: "bar",
          value_format: valueFormatFor(col.display_format),
          asOf,
        });
      }
    }
  }
  return null;
}

/** Fallback: largest comparable (same display_format) key_metrics group. */
function chartFromKeyMetrics(
  metrics: readonly BrainOutputMetric[],
  asOf: string,
): ChartBlock | null {
  const groups = new Map<BrainOutputMetricDisplayFormat, BrainOutputMetric[]>();
  for (const m of metrics) {
    if (m.variable_type === "categorical") continue; // value is a string
    if (typeof m.value !== "number") continue;
    const fmt = m.display_format ?? "raw";
    const g = groups.get(fmt);
    if (g) g.push(m);
    else groups.set(fmt, [m]);
  }

  let best: {
    fmt: BrainOutputMetricDisplayFormat;
    metrics: BrainOutputMetric[];
  } | null = null;
  for (const [fmt, ms] of groups) {
    if (ms.length >= MIN_POINTS && (best === null || ms.length > best.metrics.length)) {
      best = { fmt, metrics: ms };
    }
  }
  if (best === null) return null;

  const truncated = best.metrics.length > MAX_BARS;
  const picked = truncated ? best.metrics.slice(0, MAX_BARS) : best.metrics;
  return finalize({
    title: `Key metrics${truncated ? ` (top ${MAX_BARS})` : ""}`,
    columns: ["Metric", FORMAT_AXIS_LABEL[best.fmt]],
    rows: picked.map((m) => [m.label, m.value as number]),
    chart_type: "bar",
    value_format: valueFormatFor(best.fmt),
    asOf,
  });
}

/**
 * Compute the one build-time bar chart for a brain output, or `null`.
 */
export function computeMetricChart(output: BrainOutput): ChartBlock | null {
  // KEYSTONE as-of: a single-vintage block is anchored to the brain's
  // `refined_at` (the moment all its audited numbers were computed). ISO
  // 8601 → date portion. The contributing sources' `fetched_at` precede this
  // by construction, so `refined_at` is the honest "data through" date.
  const asOf = output.refined_at.slice(0, 10);
  const fromTable = output.detail_tables ? chartFromDetailTable(output.detail_tables, asOf) : null;
  if (fromTable) return fromTable;
  return chartFromKeyMetrics(output.key_metrics, asOf);
}
