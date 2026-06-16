"use client";

import { Component, type ReactNode } from "react";
import type { ChartBlock } from "@/refinery/validate/chart-block-lint.mts";
import { ChartBlockView } from "@/components/charts/ChartBlockView";
import { ChartError } from "@/components/charts/ChartError";

/**
 * ReportChart — a client renderer for a brain's `ChartBlock`.
 *
 * A `"use client"` wrapper around `ChartBlockView` (HBarChart runs a gsap
 * entrance in `useLayoutEffect`, so it is client-only) with a local error
 * boundary so a render fault degrades to nothing instead of taking the
 * surrounding page down.
 *
 * Mounts ONE chart on `/r/` — the report's most-relevant chart, computed from
 * the data the report holds (`computeMetricChart` → `DisplayBrain.chart`). The
 * same component is the render surface the Highlighter's on-demand "Chart this"
 * (Tier B) reuses to swap in a question-specific chart. The block carries only
 * human labels + already-public numbers (`computeMetricChart` + the
 * display-leak guard), so it is customer-safe.
 */
class ChartBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? <ChartError /> : this.props.children;
  }
}

export function ReportChart({ block }: { block: ChartBlock }) {
  return (
    <section className="mt-10" aria-label="At-a-glance chart">
      <ChartBoundary>
        <ChartBlockView block={block} />
      </ChartBoundary>
    </section>
  );
}

export default ReportChart;
