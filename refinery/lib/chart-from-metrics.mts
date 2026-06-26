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
export const MIN_POINTS = 3;

/** Column id matches a date/period time dimension. */
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

/** Column id/label signals a period-over-period CHANGE (a delta), not a level —
 *  YoY / Y/Y / MoM / M/M / change / delta / growth / chg. The signal that a column
 *  can pair with a value column as the ranked-delta chip. */
const DELTA_COLUMN_RE = /(yoy|y[_/ ]?y|mom|m[_/ ]?m|change|delta|growth|\bchg\b|_yy\b|_mm\b)/i;

export function isDeltaColumn(col: { id: string; label?: string }): boolean {
  return DELTA_COLUMN_RE.test(col.id) || (col.label ? DELTA_COLUMN_RE.test(col.label) : false);
}

/** Stem tokens (>= 4 chars) of a column id/label — the join key that pairs a value
 *  column to its OWN delta (home_value_zhvi ↔ value_yoy_pct share "value"), so a
 *  delta never mispairs to an unrelated metric on a multi-metric table. */
function stemTokens(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 4);
}

/**
 * True when `table` is a genuine TIME SERIES: a date column with >1 distinct value
 * across rows (one row per period). A single repeated period stamp (e.g. a
 * `latest_period` constant on a cross-section) is NOT a time series — it is a level
 * snapshot, eligible for ranked / dot geometries.
 */
export function isTimeSeriesTable(table: BrainOutputDetailTable): boolean {
  for (const col of table.columns) {
    if (!isDateColumn(col.id)) continue;
    const distinct = new Set<string>();
    for (const r of table.rows) {
      const v = r.cells[col.id];
      if (v !== null && v !== undefined) distinct.add(String(v));
    }
    if (distinct.size > 1) return true;
  }
  return false;
}

export interface RankedDeltaPair {
  valueColId: string;
  deltaColId: string;
  /** The delta column reads as a percent (a % change) — the binder converts it to
   *  the value's own unit so the chip and the bar share a scale. */
  deltaIsPercent: boolean;
}

/**
 * Find a value column paired with its period-over-period delta column in a
 * CROSS-SECTIONAL table — ranked-delta's data shape. Returns null when the table is
 * a time series, when there is no delta column, or when no value column shares a
 * token stem with a delta column (the guard against pairing a delta to an unrelated
 * metric on a multi-metric table, e.g. market-heat's heat-score vs. inventory-YoY).
 * ONE root: the auto-picker, the deliverable binder, and the conversation producer
 * all pair identically.
 */
export function findRankedDeltaPair(table: BrainOutputDetailTable): RankedDeltaPair | null {
  if (isTimeSeriesTable(table)) return null;
  const qualifying = new Set(numericQualifyingColumns(table).map((c) => c.id));
  const cols = table.columns.filter((c) => qualifying.has(c.id));
  const valueCols = cols.filter((c) => !isDeltaColumn(c));
  const deltaCols = cols.filter((c) => isDeltaColumn(c));
  if (!valueCols.length || !deltaCols.length) return null;
  for (const v of valueCols) {
    const vStems = new Set(stemTokens(v.id).concat(stemTokens(v.label)));
    for (const d of deltaCols) {
      const dStems = stemTokens(d.id).concat(stemTokens(d.label));
      if (dStems.some((t) => vStems.has(t))) {
        return {
          valueColId: v.id,
          deltaColId: d.id,
          deltaIsPercent: d.display_format === "percent",
        };
      }
    }
  }
  return null;
}

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

/** Fallback: largest comparable key_metrics group.
 *
 * Comparability keys on `units`, NOT `display_format`. A "count" of storms (9)
 * and a "count" of inbound freight tons (1,226,969) share a display_format but
 * are NOT comparable on one axis — putting them together makes every small bar
 * sub-pixel and the median/range dimensionless (the master "Key metrics" bug,
 * where 7 distinct-unit metrics shared `display_format: "count"`). Grouping by
 * units splits that grab-bag into singletons → no group clears MIN_POINTS → no
 * chart → the report correctly falls through to its labeled key-metrics TABLE.
 * `display_format` is only a fallback key for the rare metric carrying no units
 * (test fixtures; real numeric metrics always carry units, spec-validator-
 * enforced) and still drives the value formatter for the chosen group. */
function chartFromKeyMetrics(
  metrics: readonly BrainOutputMetric[],
  asOf: string,
): ChartBlock | null {
  const groups = new Map<string, BrainOutputMetric[]>();
  const fmtOf = new Map<string, BrainOutputMetricDisplayFormat>();
  for (const m of metrics) {
    if (m.variable_type === "categorical") continue; // value is a string
    if (typeof m.value !== "number") continue;
    const key = (m.units ?? "").trim().toLowerCase() || (m.display_format ?? "raw");
    const g = groups.get(key);
    if (g) g.push(m);
    else {
      groups.set(key, [m]);
      fmtOf.set(key, m.display_format ?? "raw");
    }
  }

  let best: { key: string; metrics: BrainOutputMetric[] } | null = null;
  for (const [key, ms] of groups) {
    if (ms.length >= MIN_POINTS && (best === null || ms.length > best.metrics.length)) {
      best = { key, metrics: ms };
    }
  }
  if (best === null) return null;
  const fmt = fmtOf.get(best.key) ?? "raw";

  const truncated = best.metrics.length > MAX_BARS;
  const picked = truncated ? best.metrics.slice(0, MAX_BARS) : best.metrics;
  return finalize({
    title: `Key metrics${truncated ? ` (top ${MAX_BARS})` : ""}`,
    columns: ["Metric", FORMAT_AXIS_LABEL[fmt]],
    rows: picked.map((m) => [m.label, m.value as number]),
    chart_type: "bar",
    value_format: valueFormatFor(fmt),
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
  // Every pre-computed chart is a bar — stamp its registry frame so the adapter
  // (`blockToSpec`) can lift it to a ChartSpec without re-inferring shape.
  if (fromTable) return { ...fromTable, frame_id: "bar-table" };
  const fromMetrics = chartFromKeyMetrics(output.key_metrics, asOf);
  return fromMetrics ? { ...fromMetrics, frame_id: "bar-table" } : null;
}
