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
    component: SeasonalRadialFrame,
    accepts: ["time-series"],
    label: "Seasonal Radial (corridor index)",
    fixtureOnly: true,
  },
  "storm-timeline": {
    // NOT fixtureOnly: a per-storm (date, paid-$) timeline is a normal live shape
    // a flood brain can emit as a detail_table — it's merely unimplemented in the
    // binder today (env-swfl emits the combined storm total, not per-storm rows),
    // same category as zhvi-area. Flagging it fixtureOnly would silently suppress
    // a real frame once a brain emits per-storm rows.
    // TWO-SIDED DEFERRED: when wired, BOTH sides land in the SAME PR (brain-first
    // ingest gate) — the brain emitting a per-storm detail_table AND a matching
    // `buildFrame` storm-timeline case. Never the emit side without the bind side.
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
