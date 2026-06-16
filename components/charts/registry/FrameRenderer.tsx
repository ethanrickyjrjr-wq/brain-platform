"use client";

import { Component, type CSSProperties, type ReactNode } from "react";
import type { ChartSpec } from "./chart-spec";
import { getFrame } from "./registry";
import { ChartError } from "@/components/charts/ChartError";

/**
 * FrameRenderer — the single render entry for a `ChartSpec`. Looks up
 * `CHART_REGISTRY[spec.frameId]` and renders its component behind a local error
 * boundary (mirroring `ReportChart.tsx`) so one bad frame degrades to nothing
 * instead of taking the surrounding page (a `/p/[id]` deck or `/r/` report)
 * down. This is the surface the Phase 3 assembly engine and `/p/[id]` use.
 *
 * An unknown `frameId` renders nothing — a missing frame must never throw in a
 * client-facing deliverable.
 */
class FrameBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? <ChartError /> : this.props.children;
  }
}

export function FrameRenderer({ spec }: { spec: ChartSpec }) {
  const frame = getFrame(spec.frameId);
  if (!frame) return null;
  const Frame = frame.component;

  // Inject brand theme as CSS custom properties so frame components can read
  // `var(--chart-primary)` / `var(--chart-accent)` without per-frame wiring.
  const themeStyle = spec.theme
    ? ({
        "--chart-primary": spec.theme.primary,
        "--chart-accent": spec.theme.accent,
      } as CSSProperties)
    : undefined;

  return (
    <FrameBoundary>
      <div className="contents" style={themeStyle}>
        <Frame spec={spec} />
      </div>
    </FrameBoundary>
  );
}

export default FrameRenderer;
