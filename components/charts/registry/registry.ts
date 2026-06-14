// CHART_REGISTRY — frameId → component map. One entry per frame; FrameRenderer resolves frameId→component via getFrame(). NOTE: pick-frames.ts does NOT read the component map; it returns frameIds from a hardcoded priority ladder. It DOES read isFixtureOnly() below — FrameDef.fixtureOnly is the SINGLE gate for "cannot bind to live data", and both the picker and the deliverable binder read it (no separate hardcoded exclusion list).
import type React from "react";
import type { ChartSpec, DataShape } from "./chart-spec";
import { ChartBlockFrame } from "./frames/ChartBlockFrame";
import { ZHVIAreaChartFrame } from "./frames/ZHVIAreaChartFrame";
import { CorridorMarketScatterFrame } from "./frames/CorridorMarketScatterFrame";
import { CompositionFrame } from "./frames/CompositionFrame";
import { ZGaugeFrame } from "./frames/ZGaugeFrame";
import { SeasonalRadialFrame } from "./frames/SeasonalRadialFrame";
import { TimelineFrame } from "./frames/TimelineFrame";

export interface FrameDef {
  /** Renders a `ChartSpec`. Every registry component takes exactly `{ spec }`. */
  component: React.ComponentType<{ spec: ChartSpec }>;
  /** Which data shapes this frame can render. Descriptive metadata only — the
   *  picker does NOT match on it. For a `fixtureOnly` frame this is inert. */
  accepts: DataShape[];
  /** Human label for pickers / template UIs. */
  label: string;
  /**
   * SINGLE SOURCE OF TRUTH for "this frame cannot bind to LIVE brain data" — it
   * renders from a fixture (`options.data` the brains don't emit). Both the
   * picker (`pickFramesForData`) and the deliverable binder (`bindFrameSpec`)
   * read this via `isFixtureOnly()` to exclude the frame; there is NO separate
   * hardcoded exclusion list. Flip this flag and both paths follow.
   */
  fixtureOnly?: boolean;
}

export const CHART_REGISTRY: Record<string, FrameDef> = {
  "bar-table": {
    component: ChartBlockFrame,
    accepts: ["ranked-categories"],
    label: "Bar / Table",
  },
  "zhvi-area": {
    component: ZHVIAreaChartFrame,
    accepts: ["time-series"],
    label: "ZHVI Area (time series)",
  },
  "corridor-scatter": {
    component: CorridorMarketScatterFrame,
    accepts: ["relationship"],
    label: "Corridor Market Scatter",
  },
  composition: {
    component: CompositionFrame,
    accepts: ["composition"],
    label: "Composition Bar",
  },
  "z-gauge": {
    component: ZGaugeFrame,
    accepts: ["single-vs-target"],
    label: "Z-Gauge / Index",
  },
  "seasonal-radial": {
    // L0 (done): bind-frame's `seasonal-radial` case + `corridor_seasonality`
    // detail_table column contract exist; bindSeasonalRadial maps rows → spec.
    // L3 (done): cre-swfl now emits a `corridor_seasonality` detail_table
    // (one row per corridor, seasonal_index as 0–1 ratio). Flag flipped here
    // in the same PR as the emit (brain-first gate).
    component: SeasonalRadialFrame,
    accepts: ["time-series"],
    label: "Seasonal Radial (corridor index)",
  },
  // NOT fixtureOnly: a per-storm (date, paid-$) timeline is a normal live shape
  // a flood brain can emit as a detail_table.
  // L0 (done): bind-frame's `storm-timeline` case + `storm_timeline` column
  // contract now exist; the case binds the moment a brain emits the table and
  // returns null (caller drops) until then — no fixture, no suppression.
  // REMAINING (Task L1): env-swfl emits a `storm_timeline` detail_table (per
  // storm: year + paid_usd) in place of today's single combined storm total.
  // No flag flip needed (already false); just the emit side, same PR (brain-first).
  "storm-timeline": {
    component: TimelineFrame,
    accepts: ["timeline"],
    label: "Storm Claims Timeline",
  },
};

/** Resolve a frame by id. Returns `undefined` for an unregistered `frameId`. */
export function getFrame(frameId: string): FrameDef | undefined {
  return CHART_REGISTRY[frameId];
}

/**
 * True when a frame cannot bind to live brain data (it needs a fixture). The
 * SINGLE gate read by both `pickFramesForData` and the deliverable binder — no
 * other code should hardcode which frames are fixture-only.
 */
export function isFixtureOnly(frameId: string): boolean {
  return CHART_REGISTRY[frameId]?.fixtureOnly === true;
}
