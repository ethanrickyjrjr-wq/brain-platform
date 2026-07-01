import type { PackDefinition, PackOutput } from "../types/pack.mts";
import type { RawFragment } from "../types/fragment.mts";
import type {
  BrainOutputProducerResult,
  BrainOutputMetric,
  BrainOutputMetricSource,
  BrainOutputDetailTable,
} from "../types/brain-output.mts";
import {
  priceDistributionSource,
  type PriceDistributionSummary,
  type PriceDistributionCounty,
} from "../sources/price-distribution-source.mts";

const SOURCE_ID = "price_distribution_swfl";

/**
 * price-distribution-swfl — SWFL active for-sale listing count per $50k price band, per county
 * (the affordability shape of what is on the market). Source: realtor.com price-histogram aggregate,
 * one call per county — the API bins the whole county, so this is source-faithful ("read rates as
 * written"), never a median-of-hauled-rows.
 *
 * Genuinely net-new: no existing brain holds a price-band distribution. Tier-1 Reporter — pure
 * deterministic bucketing, no LLM. Headline = the four affordability-tier shares (entry / mid / upper /
 * luxury); the full per-band distribution rides in a detail_table. Direction neutral by construction
 * (a single snapshot; the shape's drift over time is what would read a trend).
 */

let lastSummary: PriceDistributionSummary | null = null;
let lastFetchedAt: string | null = null;

const ENTRY_MAX = 300_000;
const MID_MAX = 600_000;
const UPPER_MAX = 1_000_000;

interface CountyBuckets {
  county: string;
  total: number;
  entry: number;
  mid: number;
  upper: number;
  luxury: number;
}

/** Sum listing counts whose band_min falls in [lo, hi) (hi=null → open-ended top). */
function sumBand(county: PriceDistributionCounty, lo: number, hi: number | null): number {
  return county.bands
    .filter((b) => b.band_min >= lo && (hi === null || b.band_min < hi))
    .reduce((s, b) => s + (b.listing_count ?? 0), 0);
}

export function countyBuckets(county: PriceDistributionCounty): CountyBuckets {
  const summed = county.bands.reduce((s, b) => s + (b.listing_count ?? 0), 0);
  return {
    county: county.county,
    total: county.total_listings || summed,
    entry: sumBand(county, 0, ENTRY_MAX),
    mid: sumBand(county, ENTRY_MAX, MID_MAX),
    upper: sumBand(county, MID_MAX, UPPER_MAX),
    luxury: sumBand(county, UPPER_MAX, null),
  };
}

function pct(n: number, total: number): number {
  return total > 0 ? Math.round((1000 * n) / total) / 10 : 0;
}

function makeSource(citation: string, fetchedAt: string, url: string): BrainOutputMetricSource {
  return { url, fetched_at: fetchedAt, tier: 2, citation };
}

function priceDistributionOutputProducer(_out: PackOutput): BrainOutputProducerResult {
  const summary = lastSummary;
  const fetchedAt = lastFetchedAt ?? new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

  if (!summary || summary.counties.length === 0) {
    return {
      conclusion:
        "price-distribution-swfl: no price-band rows in data_lake.listing_price_histogram_swfl_latest. " +
        "Run the market_aggregates histogram pipeline (python -m ingest.pipelines.market_aggregates.pipeline --resource histogram).",
      key_metrics: [],
      caveats: [
        "data_lake.listing_price_histogram_swfl_latest returned 0 rows — pipeline not yet run live (cron parked).",
      ],
      direction: "neutral",
      magnitude: 0,
      drivers: [],
      overrides: [],
      contradicts: [],
      exogenous_signals: [],
    };
  }

  const asOf = summary.captured_date ?? fetchedAt.slice(0, 10);
  const url = summary.source_url;
  const buckets = summary.counties.map(countyBuckets);
  const region = buckets.reduce(
    (a, b) => ({
      total: a.total + b.total,
      entry: a.entry + b.entry,
      mid: a.mid + b.mid,
      upper: a.upper + b.upper,
      luxury: a.luxury + b.luxury,
    }),
    { total: 0, entry: 0, mid: 0, upper: 0, luxury: 0 },
  );

  const src = (label: string) =>
    makeSource(
      `${label} across ${region.total.toLocaleString("en-US")} active SWFL for-sale listings, as of ${asOf}`,
      fetchedAt,
      url,
    );

  const key_metrics: BrainOutputMetric[] = [
    {
      metric: "entry_level_listing_share_swfl",
      label: "SWFL for-sale listings priced under $300k (share of active inventory)",
      value: pct(region.entry, region.total),
      direction: "stable",
      variable_type: "intensive",
      units: "%",
      display_format: "percent",
      source: src("Entry-tier (<$300k) share of listings"),
    },
    {
      metric: "midmarket_listing_share_swfl",
      label: "SWFL for-sale listings priced $300k–$600k (share of active inventory)",
      value: pct(region.mid, region.total),
      direction: "stable",
      variable_type: "intensive",
      units: "%",
      display_format: "percent",
      source: src("Mid-tier ($300k–$600k) share of listings"),
    },
    {
      metric: "upper_tier_listing_share_swfl",
      label: "SWFL for-sale listings priced $600k–$1M (share of active inventory)",
      value: pct(region.upper, region.total),
      direction: "stable",
      variable_type: "intensive",
      units: "%",
      display_format: "percent",
      source: src("Upper-tier ($600k–$1M) share of listings"),
    },
    {
      metric: "luxury_listing_share_swfl",
      label: "SWFL for-sale listings priced $1M and above (share of active inventory)",
      value: pct(region.luxury, region.total),
      direction: "stable",
      variable_type: "intensive",
      units: "%",
      display_format: "percent",
      source: src("Luxury ($1M+) share of listings"),
    },
  ];

  // Per-county affordability-tier detail table (lookup rows — no per-place slug needed).
  const tableSource = makeSource(
    `SWFL for-sale listing distribution by price tier, per county, as of ${asOf}`,
    fetchedAt,
    url,
  );
  const detail_tables: BrainOutputDetailTable[] = [
    {
      id: "price_distribution_by_county",
      title: "SWFL active for-sale listings by price tier and county",
      grain: "county",
      columns: [
        {
          id: "total_listings",
          label: "Total listings",
          display_format: "count",
          units: "listings",
        },
        {
          id: "entry_under_300k",
          label: "Under $300k",
          display_format: "count",
          units: "listings",
        },
        { id: "mid_300k_600k", label: "$300k–$600k", display_format: "count", units: "listings" },
        { id: "upper_600k_1m", label: "$600k–$1M", display_format: "count", units: "listings" },
        { id: "luxury_1m_plus", label: "$1M+", display_format: "count", units: "listings" },
        { id: "entry_share", label: "Under $300k share", display_format: "percent", units: "%" },
      ],
      rows: buckets.map((b) => ({
        key: b.county,
        label: b.county,
        cells: {
          total_listings: b.total,
          entry_under_300k: b.entry,
          mid_300k_600k: b.mid,
          upper_600k_1m: b.upper,
          luxury_1m_plus: b.luxury,
          entry_share: pct(b.entry, b.total),
        },
      })),
      source: tableSource,
    },
  ];

  const conclusion =
    `Of ${region.total.toLocaleString("en-US")} active SWFL for-sale listings (as of ${asOf}), ` +
    `${pct(region.entry, region.total)}% are priced under $300k, ` +
    `${pct(region.mid, region.total)}% $300k–$600k, ` +
    `${pct(region.upper, region.total)}% $600k–$1M, and ` +
    `${pct(region.luxury, region.total)}% at $1M or above. ` +
    `By county: ${buckets
      .map((b) => `${b.county} ${b.total.toLocaleString("en-US")}`)
      .join(", ")}.`;

  return {
    conclusion,
    key_metrics,
    detail_tables,
    caveats: [
      "List-side only: this is the price distribution of ACTIVE for-sale listings (asking prices), not closed sales.",
      "Includes ALL for-sale property types — the under-$300k band is dominated by vacant land/lots in lot-heavy areas, so the entry-tier share overstates entry-level HOMES. Use the per-county detail to read the shape.",
      "Weekly snapshot — the distribution's drift over time reads the affordability trend; a single week is neutral.",
      "Source is realtor.com for-sale listings, binned per county at source.",
    ],
    direction: "neutral",
    magnitude: 0,
    drivers: [],
    overrides: [],
    contradicts: [],
    exogenous_signals: [],
    grain_boundary: {
      not_available: [
        "Sold / closed-sale price distribution — active asking prices only",
        "Per-listing detail — count-per-band aggregate only",
        "Rental price distribution — for-sale listings only",
      ],
      finest_grain: "county-week",
    },
  };
}

export const priceDistributionSwfl: PackDefinition = {
  id: "price-distribution-swfl",
  brain_id: "price-distribution-swfl",
  public_label: "Price Distribution",
  domain: "real-estate",
  scope:
    "Southwest Florida active for-sale listing distribution by $50k price band, per county (Lee + Collier) — " +
    "the affordability shape of the market: share of inventory under $300k, $300k–$600k, $600k–$1M, and $1M+. " +
    "Source: realtor.com price-histogram aggregate (one call per county, binned at source). List-side only " +
    "(no closed sales); all math deterministic, no LLM synthesis.",
  ttl_seconds: 8 * 24 * 60 * 60, // 8 days — weekly refresh (list-side inventory shape)

  sources: [priceDistributionSource],
  input_brains: [],

  fitScore: () => 0.8,

  skipSynthesisAgent: true,
  skipTriageAgent: true,

  corpusSummary: (allFragments: RawFragment[]) => {
    const fragment = allFragments.find(
      (f) =>
        f.source_id === SOURCE_ID &&
        (f.normalized as { kind?: string }).kind === "price-distribution-summary",
    );
    lastSummary = fragment ? (fragment.normalized as PriceDistributionSummary) : null;
    lastFetchedAt = fragment?.fetched_at ?? null;

    if (!lastSummary || lastSummary.counties.length === 0) return [];
    const buckets = lastSummary.counties.map(countyBuckets);
    const total = buckets.reduce((s, b) => s + b.total, 0);
    const entry = buckets.reduce((s, b) => s + b.entry, 0);
    return [
      {
        topic: "price_distribution_swfl_snapshot",
        fact: "SWFL for-sale listing price distribution ",
        value:
          `${total.toLocaleString("en-US")} active for-sale listings across ${buckets.length} counties; ` +
          `${pct(entry, total)}% priced under $300k. As of ${lastSummary.captured_date ?? "latest"}.`,
        source_fragment_ids: [],
      },
    ];
  },

  outputProducer: priceDistributionOutputProducer,

  preferences: [
    "This is the price DISTRIBUTION of active for-sale listings (the affordability shape) — not sold prices, not a median. Lead with the tier shares.",
    "The under-$300k band includes vacant land/lots — never imply it is all entry-level homes.",
  ],
  activeProject:
    "price-distribution-swfl: SWFL for-sale listing count per $50k price band per county from the realtor.com price-histogram aggregate (one call per county).",
  prompts: {
    triageContext:
      "Fragment is a price-distribution-summary: per-county arrays of $50k price bands (listing count) + county totals. Deterministic bucketing; decision-relevant for affordability questions.",
    synthesisContext:
      "This pack runs no synthesis agent (skipSynthesisAgent). BrainOutput built by priceDistributionOutputProducer from the aggregate-at-source price-histogram view.",
  },
};
