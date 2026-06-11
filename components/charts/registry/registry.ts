// CHART_REGISTRY — frameId → component map. One entry per frame; pick-frames.ts selects from this at runtime.
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
  },
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
