/**
 * cre-metrics.ts — server-safe shared types + parsers for the /r/cre-swfl
 * Key-metrics redesign (County → City → Corridor drill-down + the Market Beat
 * sector chart).
 *
 * No "use client" — imported by both the server page (which serializes the
 * brain's key_metrics) and the client explorer/chart components. Plain strings
 * and numbers only; no brain_id / slug / tier ever crosses into these shapes
 * (the page hands in already-display-scrubbed labels + audited public numbers).
 */

export type CRESector = "retail" | "office" | "industrial";
export type CREMetricType = "vacancy" | "rent" | "absorption";

/** One per-city MarketBeat datapoint, flattened across sector × metric. */
export interface MBCityMetric {
  city: string;
  sector: CRESector;
  metricType: CREMetricType;
  /** Already-formatted display string, e.g. "2.2%" / "$30.88/sqft". */
  value: string;
  /** Audited numeric value for charting; null when not a clean number. */
  valueNum: number | null;
  direction: string | null;
}

/** A single labelled stat box (combined-SWFL summary, city box, corridor box). */
export interface MetricBox {
  label: string;
  value: string;
  direction: string | null;
}

/** A corridor leaf — name (big), type sub-line (small), its own metric boxes. */
export interface CorridorNode {
  slug: string;
  name: string;
  /** Corridor type rendered in the smaller font where ZIPs would go. */
  subtitle: string | null;
  metrics: MetricBox[];
}

/** A city within a county — its MarketBeat boxes + the corridors under it. */
export interface CityNode {
  city: string;
  county: string;
  corridors: CorridorNode[];
}

export interface CountyNode {
  county: string;
  cities: CityNode[];
}

/**
 * The six cities the Market Beat chart compares, in the operator's requested
 * order. Matched EXACTLY against the parsed submarket name so "Fort Myers" /
 * "Naples" never pick up "North Fort Myers" / "East Naples" / their "area"
 * medians.
 */
export const MARKET_BEAT_CITIES = [
  "Naples",
  "Bonita Springs",
  "Estero",
  "Fort Myers",
  "Cape Coral",
  "Lehigh Acres",
] as const;

export const SECTORS: { key: CRESector; label: string }[] = [
  { key: "retail", label: "Retail" },
  { key: "office", label: "Office" },
  { key: "industrial", label: "Industrial" },
];

export const METRIC_TYPES: {
  key: CREMetricType;
  label: string;
  short: string;
}[] = [
  { key: "vacancy", label: "Vacancy Rate", short: "Vacancy" },
  { key: "rent", label: "Asking Rent NNN", short: "NNN" },
  { key: "absorption", label: "Net Absorption", short: "Absorption" },
];

/**
 * Parse a MarketBeat per-city key_metric label into { city, sector, metricType }.
 *
 * Handles the three label shapes the cre-swfl pack emits per submarket:
 *   "MarketBeat Fort Myers vacancy rate (2026-Q1)"            → retail
 *   "MarketBeat Fort Myers office vacancy rate (2026-Q1)"     → office
 *   "MarketBeat Fort Myers industrial net absorption (..)"    → industrial
 *
 * Returns null for SWFL-wide / county / "area" rollup aggregates and for any
 * label that is not a per-submarket vacancy/rent/absorption metric.
 */
export function parseMBCityLabel(
  label: string,
): { city: string; sector: CRESector; metricType: CREMetricType } | null {
  if (!label.startsWith("MarketBeat ")) return null;

  let s = label.slice("MarketBeat ".length);
  // Drop a trailing "(2026-Q1)" date and any "— median across N sub-areas" note.
  s = s.replace(/\s*\([^)]*\)\s*$/, "");
  s = s.replace(/\s*—\s*median across.*$/i, "");
  s = s.trim();
  const lower = s.toLowerCase();

  // Exclude the wide / rollup aggregates — they are not single submarkets.
  if (lower.startsWith("swfl ")) return null;
  if (/\barea\b/.test(lower)) return null;
  if (/\bcounty\b/.test(lower)) return null;

  let metricType: CREMetricType;
  let keyword: string;
  if (lower.includes("net absorption")) {
    metricType = "absorption";
    keyword = "net absorption";
  } else if (lower.includes("asking rent")) {
    metricType = "rent";
    keyword = "asking rent";
  } else if (lower.includes("vacancy rate")) {
    metricType = "vacancy";
    keyword = "vacancy rate";
  } else {
    return null;
  }

  const idx = lower.indexOf(keyword);
  if (idx <= 0) return null;
  let prefix = s.slice(0, idx).trim(); // "{City}" or "{City} office/industrial"
  const plower = prefix.toLowerCase();

  let sector: CRESector = "retail";
  if (plower.endsWith(" office")) {
    sector = "office";
    prefix = prefix.slice(0, prefix.length - " office".length).trim();
  } else if (plower.endsWith(" industrial")) {
    sector = "industrial";
    prefix = prefix.slice(0, prefix.length - " industrial".length).trim();
  }

  if (!prefix) return null;
  return { city: prefix, sector, metricType };
}

/**
 * Shorten a long combined-SWFL summary label into a tight box caption, e.g.
 * "Median SWFL CRE asking rent PSF NNN (27 of 27 corridors)" → "Asking Rent NNN".
 * Falls back to a trimmed version of the original for anything unrecognised.
 */
export function shortenSummaryLabel(label: string): string {
  const l = label.toLowerCase();
  if (l.startsWith("marketbeat")) {
    if (l.includes("vacancy")) return "MarketBeat Vacancy";
    if (l.includes("asking rent")) return "MarketBeat NNN";
    if (l.includes("net absorption")) return "MarketBeat Absorption";
  }
  const suffix = l.startsWith("median") ? " (median)" : "";
  if (l.includes("cap rate")) return `Cap Rate${suffix}`;
  if (l.includes("net absorption")) return `Net Absorption${suffix}`;
  if (l.includes("asking rent")) return `Asking Rent NNN${suffix}`;
  if (l.includes("vacancy")) return `Vacancy${suffix}`;
  if (l.includes("corridor factor")) return "Corridor Factor";
  if (l.includes("permit")) return "Permit Capital Flow (z)";
  return label.length > 28 ? label.slice(0, 28) + "…" : label;
}

/**
 * Pull a clean number out of an already-formatted display value
 * ("2.2%" → 2.2, "$30.88/sqft" → 30.88, "+6,397 sqft" → 6397). Used only as a
 * fallback when the audited numeric isn't threaded through; returns null when
 * the string carries no parseable magnitude.
 */
export function parseDisplayNumeric(value: string): number | null {
  const m = value.replace(/,/g, "").match(/-?\d+(\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}
