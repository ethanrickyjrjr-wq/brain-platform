import type { ChartSeriesDef } from "@/types/viz";

// Locked series presets for the chart components. Colors are the gulf design
// tokens (app/_design/05-color-and-type.md): --gulf-teal / --mangrove /
// --neutral-gold. Those three are near-iso-luminant, so color alone fails for
// colorblind readers (WCAG 1.4.1) — `dash` (SVG strokeDasharray) is the required
// second channel. See app/_design/07-charts-and-dataviz.md §2.

/** The three SWFL metros shared by every data_lake.*_pivoted view (ZHVI, ZORI). */
export const SWFL_METRO_SERIES: ChartSeriesDef[] = [
  { key: "cape_coral", label: "Cape Coral", color: "#0a8078", dash: "" }, // gulf-teal, solid
  { key: "fort_myers", label: "Fort Myers", color: "#5bc97a", dash: "8 5" }, // mangrove, dashed
  { key: "naples", label: "Naples", color: "#d4b370", dash: "2 5" }, // neutral-gold, dotted
];

/** Single-series feed for the regional airport passenger panel. */
export const REGION_PASSENGER_SERIES: ChartSeriesDef[] = [
  { key: "passengers", label: "Passengers", color: "#0a8078", dash: "" }, // gulf-teal, solid
];

/** Two-series feed for the total-passengers + 12-month trend panel. */
export const REGION_AIR_TRAVEL_SERIES: ChartSeriesDef[] = [
  { key: "passengers", label: "Monthly passengers", color: "#0a8078", dash: "" }, // gulf-teal, solid
  { key: "trend", label: "12-month trend", color: "#d4b370", dash: "8 5" }, // neutral-gold, dashed
];

/**
 * Luxury vs. starter home-price tracks, each indexed to 100 at a base month
 * (data_lake.tier_divergence_pivoted → mapTierIndexed). Color + dash both encode
 * the line (the gulf palette is near-iso-luminant — dash is the WCAG 1.4.1 fallback).
 */
export const TIER_INDEXED_SERIES: ChartSeriesDef[] = [
  { key: "luxury_index", label: "Luxury homes", color: "#0a8078", dash: "" }, // gulf-teal, solid
  { key: "starter_index", label: "Starter homes", color: "#5bc97a", dash: "8 5" }, // mangrove, dashed
];
