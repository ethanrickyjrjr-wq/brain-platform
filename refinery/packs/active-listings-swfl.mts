import type { PackDefinition, PackOutput } from "../types/pack.mts";
import type { RawFragment } from "../types/fragment.mts";
import type {
  BrainOutputProducerResult,
  BrainOutputMetric,
  BrainOutputMetricSource,
  BrainOutputDetailTable,
} from "../types/brain-output.mts";
import {
  activeListingsResidentialSource,
  type ActiveListingsResidentialSummary,
  type ResidentialStatRow,
} from "../sources/active-listings-residential-source.mts";

const SOURCE_ID = "active_listings_residential";

/**
 * active-listings-swfl — region-wide SWFL residential active-listing inventory.
 *
 * Source: the listing-lifecycle state machine (data_lake.listing_state, active subset; scraped
 * listing data "for now", a licensed feed lands in the same table later — no rebuild on swap).
 * Reads the aggregate-at-source view data_lake.listing_active_stats (region / county / ZIP grains).
 *
 * Tier-1 Reporter — pure deterministic aggregation, no LLM (skipSynthesisAgent/skipTriageAgent),
 * no upstream brains. Headline key_metrics at region grain (count / median list price); days-on-
 * market is an OPEN column (the view returns NULL) and the metric stays SUPPRESSED until a real
 * list-date source lands — never faked. Per-county and per-ZIP breakouts ride in detail_tables
 * (scrub-exempt lookup rows — a downstream Claude answers a specific ZIP without the headline
 * needing a slug per ZIP).
 *
 * Direction is neutral by construction: a single scrape is a snapshot, not a trend. A second
 * scrape (inventory MoM) is what would let this brain read rising/falling — see caveats.
 */

let lastSummary: ActiveListingsResidentialSummary | null = null;
let lastFetchedAt: string | null = null;

const fmtUsd = (n: number): string => `$${Math.round(n).toLocaleString("en-US")}`;
const fmtK = (n: number): string => n.toLocaleString("en-US");

function makeSource(citation: string, fetchedAt: string, url: string): BrainOutputMetricSource {
  return { url, fetched_at: fetchedAt, tier: 2, citation };
}

function activeListingsOutputProducer(_out: PackOutput): BrainOutputProducerResult {
  const summary = lastSummary;
  const fetchedAt = lastFetchedAt ?? new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

  if (!summary || !summary.region || summary.region.listing_count === 0) {
    return {
      conclusion:
        "active-listings-swfl: no active residential listings in data_lake.listing_active_stats. " +
        "Run the listing-lifecycle pipeline (python -m ingest.pipelines.listing_lifecycle.pipeline).",
      key_metrics: [],
      caveats: [
        "data_lake.listing_active_stats returned 0 active rows for source_name='lifecycle_seed'.",
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
  const asOf = summary.latest_scraped_at ?? fetchedAt;
  const key_metrics: BrainOutputMetric[] = [];

  key_metrics.push({
    metric: "active_listings_count_swfl",
    label: "SWFL active residential listings (count)",
    value: region.listing_count,
    direction: "stable",
    variable_type: "extensive",
    units: "listings",
    display_format: "count",
    source: makeSource(
      `${fmtK(region.listing_count)} active SWFL residential listings as of ${asOf.slice(0, 10)}`,
      fetchedAt,
      url,
    ),
  });

  if (region.median_list_price != null) {
    key_metrics.push({
      metric: "median_list_price_swfl",
      label: "SWFL median asking price (active residential)",
      value: region.median_list_price,
      direction: "stable",
      variable_type: "intensive",
      units: "USD",
      display_format: "currency",
      source: makeSource(
        `median asking price across ${fmtK(region.listing_count)} active SWFL listings: ${fmtUsd(region.median_list_price)}`,
        fetchedAt,
        url,
      ),
    });
  }

  if (region.avg_days_on_market != null) {
    key_metrics.push({
      metric: "avg_days_on_market_swfl",
      label: "SWFL average days on market (active residential)",
      value: region.avg_days_on_market,
      direction: "stable",
      variable_type: "intensive",
      units: "days",
      display_format: "count",
      source: makeSource(
        `average days on market across active SWFL listings: ${region.avg_days_on_market} days`,
        fetchedAt,
        url,
      ),
    });
  }

  // Per-county + per-ZIP breakouts as detail_tables (lookup rows — no per-place slug needed).
  const tableSource = makeSource(
    `Active SWFL residential listings, aggregated per grain in SQL (listing_active_stats) as of ${asOf.slice(0, 10)}`,
    fetchedAt,
    url,
  );
  const detailColumns = [
    {
      id: "listing_count",
      label: "Active listings",
      display_format: "count" as const,
      units: "listings",
    },
    {
      id: "median_list_price",
      label: "Median asking price",
      display_format: "currency" as const,
      units: "USD",
    },
    {
      id: "avg_days_on_market",
      label: "Avg days on market",
      display_format: "count" as const,
      units: "days",
    },
  ];
  const rowOf = (r: ResidentialStatRow, key: string, label: string) => ({
    key,
    label,
    cells: {
      listing_count: r.listing_count,
      median_list_price: r.median_list_price,
      avg_days_on_market: r.avg_days_on_market,
    },
  });

  const detail_tables: BrainOutputDetailTable[] = [];
  if (summary.by_county.length > 0) {
    detail_tables.push({
      id: "active_listings_by_county",
      title: "SWFL active residential listings by county",
      grain: "county",
      columns: detailColumns,
      rows: summary.by_county.map((r) => rowOf(r, r.county ?? "unknown", r.county ?? "Unknown")),
      source: tableSource,
    });
  }
  if (summary.by_zip.length > 0) {
    detail_tables.push({
      id: "active_listings_by_zip",
      title: "SWFL active residential listings by ZIP",
      grain: "zip",
      columns: detailColumns,
      rows: summary.by_zip.map((r) =>
        rowOf(r, r.zip_code ?? "unknown", `${r.zip_code}${r.county ? ` (${r.county})` : ""}`),
      ),
      source: tableSource,
    });
  }

  const countyParts = summary.by_county
    .map(
      (c) =>
        `${c.county} ${fmtK(c.listing_count)}${c.median_list_price != null ? ` (median ${fmtUsd(c.median_list_price)})` : ""}`,
    )
    .join(", ");

  const conclusion =
    `${fmtK(region.listing_count)} active SWFL residential listings` +
    `${region.median_list_price != null ? `, median asking ${fmtUsd(region.median_list_price)}` : ""}` +
    `${region.avg_days_on_market != null ? `, avg ${region.avg_days_on_market} days on market` : ""}` +
    ` (active residential listings, as of ${asOf.slice(0, 10)}). By county: ${countyParts}.`;

  return {
    conclusion,
    key_metrics,
    detail_tables,
    caveats: [
      "List-side only: asking prices and days-on-market for ACTIVE listings — not sold/closed prices (that is the closed-sale records lane).",
      "Median asking price spans ALL active listings INCLUDING vacant land/lots — in lot-heavy areas this pulls the median well below typical home prices. Use the property_type field or the per-county/ZIP detail to separate homes from land.",
      "Single-source snapshot  — broad SWFL coverage but not comprehensive coverage. Direction is neutral: one scrape is a snapshot; a second scrape gives the inventory trend.",
      "Source is the 'for now' scrape; a licensed feed replaces it in the same table when credentialed.",
    ],
    direction: "neutral",
    magnitude: 0,
    drivers: [],
    overrides: [],
    contradicts: [],
    exogenous_signals: [],
    grain_boundary: {
      not_available: [
        "Sold / closed sale prices — active asking prices only, not closed transactions",
        "Per-listing history or price-cut events — current snapshot only",
        "Rental listings — sale listings only",
      ],
      finest_grain: "zip-snapshot",
    },
  };
}

export const activeListingsSwfl: PackDefinition = {
  id: "active-listings-swfl",
  brain_id: "active-listings-swfl",
  public_label: "Active Listings",
  domain: "real-estate",
  scope:
    "Southwest Florida active residential listing inventory — count, median asking price, and average days on market at region, county, and ZIP grain. Source: scraped listing data; a licensed feed swaps in later. List-side only (no closed sales).",
  ttl_seconds: 2 * 24 * 60 * 60, // 2 days — listings change daily; cron parked until runner-IP WAF proof

  sources: [activeListingsResidentialSource],
  input_brains: [],

  fitScore: () => 0.8,

  skipSynthesisAgent: true,
  skipTriageAgent: true,

  corpusSummary: (allFragments: RawFragment[]) => {
    const fragment = allFragments.find(
      (f) =>
        f.source_id === SOURCE_ID &&
        (f.normalized as { kind?: string }).kind === "active-listings-residential-summary",
    );
    lastSummary = fragment ? (fragment.normalized as ActiveListingsResidentialSummary) : null;
    lastFetchedAt = fragment?.fetched_at ?? null;

    if (!lastSummary || !lastSummary.region) return [];
    const r = lastSummary.region;
    return [
      {
        topic: "active_listings_swfl_snapshot",
        fact: "SWFL active residential listing inventory ",
        value:
          `${fmtK(r.listing_count)} active listings` +
          `${r.median_list_price != null ? `, median asking ${fmtUsd(r.median_list_price)}` : ""}` +
          `${r.avg_days_on_market != null ? `, avg ${r.avg_days_on_market} days on market` : ""}. ` +
          `${lastSummary.by_county.length} counties, ${lastSummary.by_zip.length} ZIPs covered.`,
        source_fragment_ids: [],
      },
    ];
  },

  outputProducer: activeListingsOutputProducer,

  preferences: [
    "Active LISTING inventory and asking prices — not sold/closed prices. Median asking price and days-on-market are list-side signals of supply and pricing stance, not transaction values.",
    "Coverage is broad across SWFL but not comprehensive coverage. Treat counts as a strong sample, not a census.",
  ],
  activeProject:
    "active-listings-swfl: region-wide SWFL active residential inventory (count / median ask / avg DOM) from scraped listing data, licensed-feed-swap-ready.",
  prompts: {
    triageContext:
      "Fragment is an active-listings-residential-summary with region/county/ZIP inventory counts, median asking price, and avg days-on-market. Decision-relevant by construction; pack is pure deterministic aggregation.",
    synthesisContext:
      "This pack runs no synthesis agent (skipSynthesisAgent). BrainOutput built by activeListingsOutputProducer from the aggregate-at-source ZIP-stats view.",
  },
};
