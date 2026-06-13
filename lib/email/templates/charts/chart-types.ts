// Section 2 (S2) — email-safe chart spec union.
//
// Every chart `renderChart()` produces is a self-contained HTML/SVG string that
// drops into renderEmailTemplate()'s `data.chart` slot (fills the [ CHART ]
// placeholder in a shell). No JS, no <canvas>, no <style> blocks, ≤600px wide.

interface BaseChartSpec {
  /** Pixel width. Defaults to SWFL_CHART_DEFAULTS.maxWidth (560); clamped to ≤600. */
  width?: number;
  title?: string;
  subtitle?: string;
}

export interface BarChartSpec extends BaseChartSpec {
  type: "bar";
  data: Array<{ label: string; value: number; color?: string }>;
  /** Appended after each value, e.g. "%", " days". */
  unit?: string;
}

export interface SparklineSpec extends BaseChartSpec {
  type: "sparkline";
  data: Array<{ x: string | number; y: number }>;
  color?: string;
}

export interface GaugeSpec extends BaseChartSpec {
  type: "gauge";
  /** 0–100. Clamped into range. */
  value: number;
  label?: string;
  color?: string;
}

export interface HeatRowSpec extends BaseChartSpec {
  type: "heat-row";
  rows: Array<{ label: string; cells: Array<{ value: number; color?: string }> }>;
  columnLabels: string[];
}

export interface StackedBarSpec extends BaseChartSpec {
  type: "stacked-bar";
  segments: Array<{ label: string; value: number; color: string }>;
  /** When omitted, the segment values are summed. */
  total?: number;
}

export type EmailChartSpec =
  | BarChartSpec
  | SparklineSpec
  | GaugeSpec
  | HeatRowSpec
  | StackedBarSpec;
