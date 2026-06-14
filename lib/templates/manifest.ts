// AI SELECTION FLOW
// 1. User: "give me a flood exposure PDF for Fort Myers Beach"
// 2. AI reads TEMPLATE_MANIFEST, selects slug: "viz/flood-exposure"
// 3. AI fetches live data from Supabase for ZIP 33931
// 4. AI maps live data → FloodExposureTokens shape (includes brand_primary, brand_secondary)
// 5. AI POSTs to /api/templates/render with slug + tokens
// 6. Response is rendered HTML → user gets preview or download
// The AI never writes HTML. It only fills the token contract.

/** Default SWFL brand pair — used as previewData fallback for every card. */
export const SWFL_BRAND_PRIMARY = "#3DC9C0";
export const SWFL_BRAND_SECONDARY = "#E08158";

export type TemplateEntry = {
  slug: string;
  family: "viz" | "email" | "doc";
  id: string;
  name: string;
  subtitle: string;
  description: string;
  /** Name of the token contract interface in `token-contracts.ts`. */
  tokenType: string;
  previewData: Record<string, string | number>;
};

export const TEMPLATE_MANIFEST: TemplateEntry[] = [
  {
    slug: "viz/corridor-positioning",
    family: "viz",
    id: "001",
    name: "Corridor positioning",
    subtitle: "Cap rate × vacancy scatter",
    description:
      "Quadrant scatter of SWFL CRE corridors on cap rate × vacancy, sized by absorption and colored by evolution, with a pack-median crosshair. Click any bubble for the full profile.",
    tokenType: "CorridorPositioningTokens",
    previewData: {
      corridor_count: 8,
      pack_median_cap: 6.5,
      pack_median_vac: 6.0,
      freshness_token: "SWFL-7421-v34-20260522",
      brand_primary: SWFL_BRAND_PRIMARY,
      brand_secondary: SWFL_BRAND_SECONDARY,
    },
  },
  {
    slug: "viz/flood-exposure",
    family: "viz",
    id: "003",
    name: "Flood exposure",
    subtitle: "Lee SFHA + V/VE composition",
    description:
      "Lee County land split into safe / SFHA / coastal V-VE bands, the storm-year vs non-storm claim multiple, and a 100th-percentile ZIP focus with the CRE cap-rate translation.",
    tokenType: "FloodExposureTokens",
    previewData: {
      safe_pct: 62.05,
      sfha_pct: 32.8,
      vve_pct: 5.15,
      ve_polygons: 271,
      storm_multiplier: 357,
      storm_years_target: 100,
      storm_years_claims: "$21.38M",
      baseline_target: 0.28,
      baseline_claims: "$59.9K",
      storm_count: 6,
      storm_names: "Charley · Wilma · Irma · Ian · Helene · Milton",
      zip_code: 33931,
      zip_label: "Fort Myers Beach",
      zip_place: "Fort Myers Beach · Estero Island",
      zip_aal: "$850",
      zip_noi_share: "5.3%",
      zip_cap_adj: "+50–70 bps",
      zip_cap_adj_plain: "50–70 bps",
      freshness_token: "SWFL-7421-v17-20260520",
      brand_primary: SWFL_BRAND_PRIMARY,
      brand_secondary: SWFL_BRAND_SECONDARY,
    },
  },
  {
    slug: "viz/freight-nowcast",
    family: "viz",
    id: "004",
    name: "Freight nowcast",
    subtitle: "FDOT z-score deviation gauge",
    description:
      "Deviation gauge for current annualized FDOT freight activity against its own 90-day rolling history, with the current-vs-baseline comparison and a full supporting stat rail.",
    tokenType: "FreightNowcastTokens",
    previewData: {
      segment_count: 9,
      z_value: -0.02,
      state_name: "normal",
      deviation_pct: "0.0%",
      baseline_flag: "valid",
      history_days: 90,
      breach_days: 0,
      current_target: 100,
      current_activity: "242,430,080",
      mean_target: 100.02,
      baseline_mean: "242,477,266",
      stddev_target: 0.9,
      baseline_stddev: "±2,179,960",
      avg_payload: 16,
      faf5_context: 0,
      counties_covered: 2,
      freshness_token: "SWFL-7421-v8-20260520",
      brand_primary: SWFL_BRAND_PRIMARY,
      brand_secondary: SWFL_BRAND_SECONDARY,
    },
  },
  {
    slug: "viz/seasonal-exposure",
    family: "viz",
    id: "005",
    name: "Seasonal exposure",
    subtitle: "Corridor seasonal-index bars",
    description:
      "Horizontal bars ranking SWFL CRE corridors by winter-season dependence on a 0→1 index, banded year-round / seasonal / winter-dependent. Click any corridor for its read.",
    tokenType: "SeasonalExposureTokens",
    previewData: {
      corridor_count: 7,
      year_round_count: 3,
      year_round_list: "Alico · Cape Coral · Immokalee",
      seasonal_count: 3,
      seasonal_list: "Pine Ridge · Bonita · Gulf Coast",
      winter_count: 1,
      winter_list: "Estero Blvd",
      pack_range: "0.10 – 0.88",
      freshness_token: "SWFL-7421-v34-20260522",
      brand_primary: SWFL_BRAND_PRIMARY,
      brand_secondary: SWFL_BRAND_SECONDARY,
    },
  },
  {
    slug: "viz/storm-year-timeline",
    family: "viz",
    id: "006",
    name: "Storm-year timeline",
    subtitle: "Named-storm NFIP paid claims",
    description:
      "Vertical timeline of NFIP paid claims per named storm (2004–2024), with Ian as the peak and the non-storm baseline shown for scale.",
    tokenType: "StormYearTimelineTokens",
    previewData: {
      storm_count: 6,
      year_range: "2004 – 2024",
      cumulative_claims: "$21.4M",
      baseline_claims: "$59.9K",
      counties_covered: 6,
      freshness_token: "SWFL-7421-v17-20260520",
      brand_primary: SWFL_BRAND_PRIMARY,
      brand_secondary: SWFL_BRAND_SECONDARY,
    },
  },
];

/** Look up a manifest entry by slug. */
export function getTemplateEntry(slug: string): TemplateEntry | undefined {
  return TEMPLATE_MANIFEST.find((t) => t.slug === slug);
}
