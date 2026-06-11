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
import type React from "react";
import type { ChartSpec, DataShape } from "./chart-spec";
import { ChartBlockFrame } from "./frames/ChartBlockFrame";
import { ZHVIAreaChartFrame } from "./frames/ZHVIAreaChartFrame";
import { CorridorMarketScatterFrame } from "./frames/CorridorMarketScatterFrame";
import { TimelineFrame } from "./frames/TimelineFrame";
import { SeasonalRadialFrame } from "./frames/SeasonalRadialFrame";

export interface FrameDef {
  /** Renders a `ChartSpec`. Every registry component takes exactly `{ spec }`. */
  component: React.ComponentType<{ spec: ChartSpec }>;
  /** Which data shapes this frame can render (drives Phase 2g frame-picking). */
  accepts: DataShape[];
  /** Human label for pickers / template UIs. */
  label: string;
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
  "storm-timeline": {
    component: TimelineFrame,
    accepts: ["timeline"],
    label: "Storm Claims Timeline",
  },
  "seasonal-radial": {
    component: SeasonalRadialFrame,
    accepts: ["time-series"],
    label: "Seasonal Radial (corridor index)",
  },
};

/** Resolve a frame by id. Returns `undefined` for an unregistered `frameId`. */
export function getFrame(frameId: string): FrameDef | undefined {
  return CHART_REGISTRY[frameId];
}
