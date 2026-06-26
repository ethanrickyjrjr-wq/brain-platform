// lib/deliverable/ranked-delta-bind.ts
//
// THE RANKED-DELTA BINDER — one root, REGISTRY-FREE on purpose.
//
// ranked-delta is the only one of the 2026-06-26 SVG frames with a data-shape
// signal we actually emit: a cross-sectional table that carries a value column
// AND its period-over-period delta (home_value_zhvi + value_yoy_pct, …). This
// turns that shape into a ranked-delta ChartSpec — the SAME bars a bar-table would
// show, plus a ▲/▼ chip per row.
//
// Why its own module (not inside bind-frame.ts): the conversation chart producer
// (`lib/assistant/chart-for-question.ts`) auto-upgrades a bar to ranked-delta on
// the hot `/api/assistant` path, which deliberately imports NO chart registry (no
// React frame components in the server bundle). bind-frame.ts imports the registry;
// this module imports only `chart-from-metrics` + types, so the producer can share
// the EXACT binding logic without dragging 12 frame components into the chat route.
// bind-frame.ts's `ranked-delta` case calls this too — one binder, both surfaces.
//
// PURE: no I/O, no Date.now, no randomness. `asOf` is the brain's own refined_at.

import {
  findRankedDeltaPair,
  type RankedDeltaPair,
} from "../../refinery/lib/chart-from-metrics.mts";
import type {
  BrainOutput,
  BrainOutputMetricDisplayFormat,
  BrainOutputMetricSource,
} from "../../refinery/types/brain-output.mts";
import type { ChartSpec } from "../../components/charts/registry/chart-spec"; // type-only → erased, no registry runtime

/** One ranked-delta row. `delta` is in the value's OWN unit (chip + bar share a scale). */
export interface RankedDeltaItem {
  label: string;
  value: number;
  delta?: number;
}

/** ChartBlock value_format + the frame-vocab ValueFormat its SVG builder reads,
 *  kept in lock-step with the email bridge's `mapValueFormat` so the web frame and
 *  the rasterized PNG never diverge (currency→usd, percent→pct, count→count, else
 *  index). */
function vfOf(fmt: BrainOutputMetricDisplayFormat | undefined): {
  block: "usd" | "percent" | "count" | "number";
  frame: "usd" | "pct" | "count" | "index";
} {
  switch (fmt) {
    case "currency":
      return { block: "usd", frame: "usd" };
    case "percent":
      return { block: "percent", frame: "pct" };
    case "count":
      return { block: "count", frame: "count" };
    default:
      return { block: "number", frame: "index" };
  }
}

/** Numeric coercion for a detail_table cell — null/boolean stay null (never 0). */
function cellNum(v: number | string | boolean | null | undefined): number | null {
  if (v === null || v === undefined || typeof v === "boolean") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Human header for a detail_table grain, e.g. "zip" → "ZIP", "county" → "County". */
function titleizeGrain(grain: string): string {
  const g = (grain ?? "").trim();
  if (/^zips?$/i.test(g)) return "ZIP";
  if (g.length === 0) return "Item";
  return g.charAt(0).toUpperCase() + g.slice(1);
}

/** Provenance receipt → ChartBlock `source` (NEVER sanitized). */
function sourceOf(src: BrainOutputMetricSource | undefined): ChartSpec["source"] {
  if (!src) return undefined;
  return src.url ? { citation: src.citation, url: src.url } : { citation: src.citation };
}

const MIN_ROWS = 3; // a ranked chart needs >= 3 bars to be worth drawing
const MAX_ROWS = 8; // the ranked-delta SVG builder caps at 8

/** Convert a per-row delta to the value's OWN unit. A percent delta on a
 *  non-percent value → the implied absolute change (deterministic algebra on two
 *  audited numbers — `value - value/(1+pct/100)` — NOT an inference). Same-unit and
 *  percent-on-percent deltas pass through verbatim. */
function deltaInValueUnit(
  value: number,
  dRaw: number,
  pair: RankedDeltaPair,
  blockIsPercent: boolean,
): number {
  if (pair.deltaIsPercent && !blockIsPercent) {
    const prior = value / (1 + dRaw / 100);
    return Number.isFinite(prior) ? round2(value - prior) : dRaw;
  }
  return dRaw;
}

/**
 * Bind a BrainOutput to a ranked-delta ChartSpec, or null when no detail_table
 * carries a clean value+delta pair. The first qualifying table wins. Pure.
 */
export function bindRankedDeltaSpec(
  output: BrainOutput,
  opts: { title?: string } = {},
): ChartSpec | null {
  const asOf = (output.refined_at ?? "").slice(0, 10);
  if (!asOf) return null;

  for (const t of output.detail_tables ?? []) {
    const pair = findRankedDeltaPair(t);
    if (!pair) continue;
    const valCol = t.columns.find((c) => c.id === pair.valueColId);
    if (!valCol) continue;
    const vf = vfOf(valCol.display_format);

    const items: RankedDeltaItem[] = [];
    for (const r of t.rows) {
      const value = cellNum(r.cells[pair.valueColId]);
      if (value === null) continue;
      const dRaw = cellNum(r.cells[pair.deltaColId]);
      const delta =
        dRaw === null ? undefined : deltaInValueUnit(value, dRaw, pair, vf.block === "percent");
      items.push({ label: r.label || r.key, value, delta });
    }
    if (items.length < MIN_ROWS) continue;

    items.sort((a, b) => b.value - a.value);
    const top = items.slice(0, MAX_ROWS);

    return {
      // Synthesize a clean title — never inherit `t.title`, which can embed an ISO
      // date / internal period stamp (the MM/DD/YYYY display rule); the as-of rides
      // the caption, formatted by the date root.
      title: opts.title ?? `${valCol.label} by ${titleizeGrain(t.grain)}`,
      columns: [titleizeGrain(t.grain), valCol.label],
      rows: top.map((i) => [i.label, i.value] as [string, number]),
      chart_type: "bar",
      value_format: vf.block,
      asOf,
      source: sourceOf(t.source),
      frameId: "ranked-delta",
      // ranked-delta frame reads options.value_format (snake); the email bridge
      // derives its format from spec.value_format → both land on the same scale.
      options: { items: top, value_format: vf.frame },
    };
  }
  return null;
}
