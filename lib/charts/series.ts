import type { ChartSeriesDef } from "@/types/viz";

// Locked series presets for the chart components. Colors are the gulf design
// tokens (app/_design/05-color-and-type.md): --gulf-teal / --mangrove /
// --neutral-gold. Those three are near-iso-luminant, so color alone fails for
// colorblind readers (WCAG 1.4.1) — `dash` (SVG strokeDasharray) is the required
// second channel. See app/_design/07-charts-and-dataviz.md §2.

/** The three SWFL metros shared by every data_lake.*_pivoted view (ZHVI, ZORI). */
export const SWFL_METRO_SERIES: ChartSeriesDef[] = [
  { key: "cape_coral", label: "Cape Coral", color: "#3dc9c0", dash: "" }, // gulf-teal, solid
  { key: "fort_myers", label: "Fort Myers", color: "#5bc97a", dash: "8 5" }, // mangrove, dashed
  { key: "naples", label: "Naples", color: "#d4b370", dash: "2 5" }, // neutral-gold, dotted
];

/** Single-series feed for the regional airport passenger panel. */
export const REGION_PASSENGER_SERIES: ChartSeriesDef[] = [
  { key: "passengers", label: "Passengers", color: "#3dc9c0", dash: "" }, // gulf-teal, solid
];
