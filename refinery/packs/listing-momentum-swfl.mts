import type { PackDefinition, PackOutput } from "../types/pack.mts";
import type { RawFragment } from "../types/fragment.mts";
import type {
  BrainOutputProducerResult,
  BrainOutputMetric,
  BrainOutputMetricSource,
  BrainOutputDetailTable,
} from "../types/brain-output.mts";
import {
  listingMomentumSource,
  type ListingMomentumSummary,
  type MomentumRow,
} from "../sources/listing-momentum-source.mts";

const SOURCE_ID = "listing_momentum_swfl";

/**
 * listing-momentum-swfl — the weekly LEADING list-side signal, from our OWN active inventory (no metered
 * calls). Point-in-time shares off the SteadyAPI /search sweep flags: price_reduced_share (softening
 * pressure — the fastest sentiment read) and new_listing_share (fresh supply). These lead the monthly
 * closed-sale stats by weeks (the Altos edge), computed from data we already sweep.
 *
 * Tier-1 Reporter — pure deterministic aggregation, no LLM. Direction neutral by construction (a single
 * weekly snapshot; the shares' week-over-week drift is what reads rising/falling). Distinct from
 * active-listings-swfl (which owns inventory COUNT/price) and market-heat-swfl (monthly YoY vote).
 */

let lastSummary: ListingMomentumSummary | null = null;
let lastFetchedAt: string | null = null;

const fmtK = (n: number): string => n.toLocaleString("en-US");

function makeSource(citation: string, fetchedAt: string, url: string): BrainOutputMetricSource {
  return { url, fetched_at: fetchedAt, tier: 2, citation };
}

function listingMomentumOutputProducer(_out: PackOutput): BrainOutputProducerResult {
  const summary = lastSummary;
  const fetchedAt = lastFetchedAt ?? new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

  if (!summary || !summary.region || summary.region.active_listing_count === 0) {
    return {
      conclusion:
        "listing-momentum-swfl: no active listings in data_lake.listing_momentum_stats. " +
        "Run the listing-lifecycle sweep (source_name='api_feed') to populate the flag shares.",
      key_metrics: [],
      caveats: [
        "data_lake.listing_momentum_stats returned 0 active rows — the realtor.com listing sweep has not run live yet (cron parked).",
      ],
      direction: "neutral",
      magnitude: 0,
      drivers: [],
      overrides: [],
      contradicts: [],
      exogenous_signals: [],
    };
  }

  const region = summary.region;
  const url = summary.source_url;
  const asOf = (summary.latest_scraped_at ?? fetchedAt).slice(0, 10);
  const key_metrics: BrainOutputMetric[] = [];

  if (region.price_reduced_share != null) {
    key_metrics.push({
      metric: "price_reduced_share_swfl",
      label: "SWFL active for-sale listings with a price cut (share of active inventory)",
      value: region.price_reduced_share,
      direction: "stable",
      variable_type: "intensive",
      units: "%",
      display_format: "percent",
      source: makeSource(
        `${region.price_reduced_share}% of ${fmtK(region.active_listing_count)} active SWFL for-sale listings carry a price reduction, as of ${asOf}`,
        fetchedAt,
        url,
      ),
    });
  }

  if (region.new_listing_share != null) {
    key_metrics.push({
      metric: "new_listing_share_swfl",
      label: "SWFL active for-sale listings flagged new (share of active inventory)",
      value: region.new_listing_share,
      direction: "stable",
      variable_type: "intensive",
      units: "%",
      display_format: "percent",
      source: makeSource(
        `${region.new_listing_share}% of ${fmtK(region.active_listing_count)} active SWFL for-sale listings are newly listed, as of ${asOf}`,
        fetchedAt,
        url,
      ),
    });
  }

  const tableSource = makeSource(
    `SWFL for-sale listing momentum shares, per grain, as of ${asOf}`,
    fetchedAt,
    url,
  );
  const columns = [
    {
      id: "active_listing_count",
      label: "Active listings",
      display_format: "count" as const,
      units: "listings",
    },
    {
      id: "price_reduced_share",
      label: "Price-cut share",
      display_format: "percent" as const,
      units: "%",
    },
    {
      id: "new_listing_share",
      label: "New-listing share",
      display_format: "percent" as const,
      units: "%",
    },
  ];
  const rowOf = (r: MomentumRow, key: string, label: string) => ({
    key,
    label,
    cells: {
      active_listing_count: r.active_listing_count,
      price_reduced_share: r.price_reduced_share,
      new_listing_share: r.new_listing_share,
    },
  });

  const detail_tables: BrainOutputDetailTable[] = [];
  if (summary.by_county.length > 0) {
    detail_tables.push({
      id: "listing_momentum_by_county",
      title: "SWFL for-sale listing momentum by county",
      grain: "county",
      columns,
      rows: summary.by_county.map((r) => rowOf(r, r.county ?? "unknown", r.county ?? "Unknown")),
      source: tableSource,
    });
  }
  if (summary.by_zip.length > 0) {
    detail_tables.push({
      id: "listing_momentum_by_zip",
      title: "SWFL for-sale listing momentum by ZIP",
      grain: "zip",
      columns,
      rows: summary.by_zip.map((r) =>
        rowOf(r, r.zip_code ?? "unknown", `${r.zip_code}${r.county ? ` (${r.county})` : ""}`),
      ),
      source: tableSource,
    });
  }

  const conclusion =
    `Across ${fmtK(region.active_listing_count)} active SWFL for-sale listings (as of ${asOf}), ` +
    `${region.price_reduced_share ?? "—"}% currently carry a price cut and ` +
    `${region.new_listing_share ?? "—"}% are newly listed. ` +
    `By county: ${summary.by_county
      .map(
        (c) =>
          `${c.county} ${c.price_reduced_share ?? "—"}% cut / ${c.new_listing_share ?? "—"}% new`,
      )
      .join(", ")}.`;

  return {
    conclusion,
    key_metrics,
    detail_tables,
    caveats: [
      "Point-in-time shares of ACTIVE for-sale listings (list-side leading signals), not closed sales.",
      "A single week is neutral by construction — the week-over-week drift is the read: a rising price-cut share signals softening, a rising new-listing share signals supply building.",
      "Shares come from the listing's own new / price-reduced flags on the realtor.com for-sale feed.",
    ],
    direction: "neutral",
    magnitude: 0,
    drivers: [],
    overrides: [],
    contradicts: [],
    exogenous_signals: [],
    grain_boundary: {
      not_available: [
        "Sold / closed-sale momentum — active list-side flags only",
        "Week-over-week change — current snapshot only (a second sweep reads the trend)",
        "Rental momentum — for-sale listings only",
      ],
      finest_grain: "zip-snapshot",
    },
  };
}

export const listingMomentumSwfl: PackDefinition = {
  id: "listing-momentum-swfl",
  brain_id: "listing-momentum-swfl",
  public_label: "Listing Momentum",
  domain: "real-estate",
  scope:
    "Southwest Florida weekly for-sale listing momentum (Lee + Collier) — the leading list-side signals from " +
    "our own active-inventory sweep: share of active listings carrying a price cut, and share newly listed, at " +
    "region, county, and ZIP grain. Point-in-time shares off the realtor.com for-sale feed's own flags; no " +
    "closed sales. Direction neutral on any one week; the week-over-week drift reads the trend. Deterministic, no LLM.",
  ttl_seconds: 8 * 24 * 60 * 60, // 8 days — weekly refresh (leading list-side signal)

  sources: [listingMomentumSource],
  input_brains: [],

  fitScore: () => 0.75,

  skipSynthesisAgent: true,
  skipTriageAgent: true,

  corpusSummary: (allFragments: RawFragment[]) => {
    const fragment = allFragments.find(
      (f) =>
        f.source_id === SOURCE_ID &&
        (f.normalized as { kind?: string }).kind === "listing-momentum-summary",
    );
    lastSummary = fragment ? (fragment.normalized as ListingMomentumSummary) : null;
    lastFetchedAt = fragment?.fetched_at ?? null;

    if (!lastSummary || !lastSummary.region) return [];
    const r = lastSummary.region;
    return [
      {
        topic: "listing_momentum_swfl_snapshot",
        fact: "SWFL for-sale listing momentum ",
        value:
          `${r.price_reduced_share ?? "—"}% of ${fmtK(r.active_listing_count)} active listings carry a price cut, ` +
          `${r.new_listing_share ?? "—"}% newly listed. ${lastSummary.by_county.length} counties, ${lastSummary.by_zip.length} ZIPs.`,
        source_fragment_ids: [],
      },
    ];
  },

  outputProducer: listingMomentumOutputProducer,

  preferences: [
    "These are LEADING list-side shares (price cuts, new listings) — a fast read on softening/supply, not closed prices.",
    "One week is neutral; lead with the direction of the week-over-week drift when a prior week exists.",
  ],
  activeProject:
    "listing-momentum-swfl: SWFL weekly price-cut + new-listing shares from the active-inventory sweep (data_lake.listing_momentum_stats), no metered calls.",
  prompts: {
    triageContext:
      "Fragment is a listing-momentum-summary: region/county/ZIP price-reduced + new-listing shares off active for-sale inventory. Deterministic; decision-relevant for market-momentum questions.",
    synthesisContext:
      "This pack runs no synthesis agent (skipSynthesisAgent). BrainOutput built by listingMomentumOutputProducer from the aggregate-at-source momentum view.",
  },
};
