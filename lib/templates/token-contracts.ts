/**
 * Token contracts for the 6 viz cards in `templates/html/viz/`.
 *
 * Each type lists every `{{token}}` the card's shell expects. The caller (an AI
 * or an API route) fills these from live SWFL data; the renderer
 * (`renderHtmlTemplate`) does the string substitution.
 *
 * Conventions:
 *  - `brand_primary` / `brand_secondary` are on EVERY card. They drive the
 *    `<style id="brand-override">` block (and the JS-driven SVG fills where a
 *    card paints via `<script>`). Pass SWFL's own colors (`#0a8078` / `#E08158`)
 *    or any client brand pair.
 *  - Numeric tokens that flow into JS constants or `data-target` ratios are typed
 *    `number` (e.g. `z_value` becomes `const Z_VALUE = <number>` in card 004).
 *  - Per-record arrays (corridors, brands, storms) are NOT tokenized in v1 — they
 *    stay inline in each shell. Only scalar headline/KPI values are tokens.
 *  - `*_target` tokens are pre-computed bar-fill ratios (0–100+); the caller
 *    computes the ratio, the shell only animates to it.
 */

/** Brand color pair present on every viz card. */
export interface BrandTokens {
  brand_primary: string;
  brand_secondary: string;
}

/** 001 — corridor-positioning.html (cap rate × vacancy scatter). */
export interface CorridorPositioningTokens extends BrandTokens {
  corridor_count: number;
  pack_median_cap: number;
  pack_median_vac: number;
  freshness_token: string;
}

/** 003 — flood-exposure.html (Lee SFHA + V/VE composition). */
export interface FloodExposureTokens extends BrandTokens {
  safe_pct: number;
  sfha_pct: number;
  vve_pct: number;
  ve_polygons: number;
  storm_multiplier: number;
  /** Bar-fill ratio for the storm-years row (caller computes; typically 100). */
  storm_years_target: number;
  storm_years_claims: string;
  /** Bar-fill ratio for the baseline row (caller computes). */
  baseline_target: number;
  baseline_claims: string;
  storm_count: number;
  storm_names: string;
  zip_code: number | string;
  /** Place name used in the section title, e.g. "Fort Myers Beach". */
  zip_label: string;
  zip_place: string;
  zip_aal: string;
  zip_noi_share: string;
  /** Cap-rate adjustment as shown in the stat cell, e.g. "+50–70 bps". */
  zip_cap_adj: string;
  /** Same adjustment without the leading "+", for the prose sentence. */
  zip_cap_adj_plain: string;
  freshness_token: string;
}

/** 004 — freight-nowcast.html (FDOT z-score gauge vs rolling baseline). */
export interface FreightNowcastTokens extends BrandTokens {
  segment_count: number;
  /** Drives `const Z_VALUE`, the gauge needle angle, and the readout. */
  z_value: number;
  state_name: string;
  deviation_pct: string;
  baseline_flag: string;
  history_days: number;
  breach_days: number;
  current_target: number;
  current_activity: string;
  mean_target: number;
  baseline_mean: string;
  stddev_target: number;
  baseline_stddev: string;
  avg_payload: number;
  faf5_context: number;
  counties_covered: number;
  freshness_token: string;
}

/** 005 — seasonal-exposure.html (radial/horizontal seasonal-index bars). */
export interface SeasonalExposureTokens extends BrandTokens {
  corridor_count: number;
  year_round_count: number;
  year_round_list: string;
  seasonal_count: number;
  seasonal_list: string;
  winter_count: number;
  winter_list: string;
  /** Pack index range shown in the footer, e.g. "0.10 – 0.88". */
  pack_range: string;
  freshness_token: string;
}

/** 006 — storm-year-timeline.html (named-storm NFIP paid claims). */
export interface StormYearTimelineTokens extends BrandTokens {
  storm_count: number;
  year_range: string;
  cumulative_claims: string;
  baseline_claims: string;
  counties_covered: number;
  freshness_token: string;
}

/** Union of every viz token contract. */
export type AnyVizTokens =
  | CorridorPositioningTokens
  | FloodExposureTokens
  | FreightNowcastTokens
  | SeasonalExposureTokens
  | StormYearTimelineTokens;
