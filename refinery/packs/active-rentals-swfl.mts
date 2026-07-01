import type { PackDefinition, PackOutput } from "../types/pack.mts";
import type { RawFragment } from "../types/fragment.mts";
import type {
  BrainOutputProducerResult,
  BrainOutputMetric,
  BrainOutputMetricSource,
  BrainOutputDetailTable,
} from "../types/brain-output.mts";
import {
  activeRentalsSource,
  type ActiveRentalsSummary,
  type RentalStatRow,
} from "../sources/active-rentals-source.mts";

const SOURCE_ID = "active_rentals_swfl";

/**
 * active-rentals-swfl — SWFL active RENTAL listing inventory (count + observed asking-price range) from
 * SteadyAPI's weekly /rentals-search sweep (Lee + Collier, county-form).
 *
 * Distinct from TWO existing brains, deliberately:
 *   - rentals-swfl: the Zillow ZORI rent INDEX (monthly trend, YoY/MoM direction) — an aggregate index,
 *     not live inventory.
 *   - market-temperature-swfl: carries the source-faithful median_rent_price per ZIP (realtor.com
 *     /housing-market-details). This brain does NOT recompute a median rent from the per-listing
 *     price.min/price.max ranges SteadyAPI returns — that would blend two different numbers into a
 *     synthetic point value with no source (the locked "derivable is not source-faithful" rule). Its
 *     net-new contribution is the INVENTORY shape (mirrors active-listings-swfl on the sale side):
 *     count, and the observed price MIN/MAX (a safe aggregate over the vendor's own fields, never a
 *     blended median).
 *
 * Tier-1 Reporter — deterministic, no LLM. Weekly cadence.
 */

let lastSummary: ActiveRentalsSummary | null = null;
let lastFetchedAt: string | null = null;

const fmtUsd = (n: number): string => `$${Math.round(n).toLocaleString("en-US")}`;
const fmtK = (n: number): string => n.toLocaleString("en-US");

function makeSource(citation: string, fetchedAt: string, url: string): BrainOutputMetricSource {
  return { url, fetched_at: fetchedAt, tier: 2, citation };
}

function activeRentalsOutputProducer(_out: PackOutput): BrainOutputProducerResult {
  const summary = lastSummary;
  const fetchedAt = lastFetchedAt ?? new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

  if (!summary || !summary.region || summary.region.rental_listing_count === 0) {
    return {
      conclusion:
        "active-rentals-swfl: no active rental listings in data_lake.rental_listing_stats. " +
        "Run the rentals pipeline (python -m ingest.pipelines.rentals.pipeline).",
      key_metrics: [],
      caveats: [
        "data_lake.rental_listing_stats returned 0 rows — the SteadyAPI rentals sweep has not run live yet (cron parked).",
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
  const asOf = (summary.captured_date ?? fetchedAt).slice(0, 10);
  const key_metrics: BrainOutputMetric[] = [];

  key_metrics.push({
    metric: "active_rental_listings_count_swfl",
    label: "SWFL active rental listings (count)",
    value: region.rental_listing_count,
    direction: "stable",
    variable_type: "extensive",
    units: "listings",
    display_format: "count",
    source: makeSource(
      `${fmtK(region.rental_listing_count)} active SWFL rental listings as of ${asOf}`,
      fetchedAt,
      url,
    ),
  });

  const tableSource = makeSource(
    `Active SWFL rental listings, aggregated per grain in SQL (rental_listing_stats) as of ${asOf}`,
    fetchedAt,
    url,
  );
  const detailColumns = [
    {
      id: "rental_listing_count",
      label: "Active rentals",
      display_format: "count" as const,
      units: "listings",
    },
    {
      id: "observed_price_min",
      label: "Observed asking min",
      display_format: "currency" as const,
      units: "USD/mo",
    },
    {
      id: "observed_price_max",
      label: "Observed asking max",
      display_format: "currency" as const,
      units: "USD/mo",
    },
  ];
  const rowOf = (r: RentalStatRow, key: string, label: string) => ({
    key,
    label,
    cells: {
      rental_listing_count: r.rental_listing_count,
      observed_price_min: r.observed_price_min,
      observed_price_max: r.observed_price_max,
    },
  });

  const detail_tables: BrainOutputDetailTable[] = [];
  if (summary.by_county.length > 0) {
    detail_tables.push({
      id: "active_rentals_by_county",
      title: "SWFL active rental listings by county",
      grain: "county",
      columns: detailColumns,
      rows: summary.by_county.map((r) => rowOf(r, r.county ?? "unknown", r.county ?? "Unknown")),
      source: tableSource,
    });
  }
  if (summary.by_zip.length > 0) {
    detail_tables.push({
      id: "active_rentals_by_zip",
      title: "SWFL active rental listings by ZIP",
      grain: "zip",
      columns: detailColumns,
      rows: summary.by_zip.map((r) =>
        rowOf(r, r.zip_code ?? "unknown", `${r.zip_code}${r.county ? ` (${r.county})` : ""}`),
      ),
      source: tableSource,
    });
  }

  const countyParts = summary.by_county
    .map((c) => `${c.county} ${fmtK(c.rental_listing_count)}`)
    .join(", ");
  const rangeStr =
    region.observed_price_min != null && region.observed_price_max != null
      ? `, asking prices observed from ${fmtUsd(region.observed_price_min)} to ${fmtUsd(region.observed_price_max)}/mo`
      : "";

  const conclusion =
    `${fmtK(region.rental_listing_count)} active SWFL rental listings${rangeStr} ` +
    `(as of ${asOf}). By county: ${countyParts}.`;

  return {
    conclusion,
    key_metrics,
    detail_tables,
    caveats: [
      "Inventory COUNT and observed asking-price RANGE only — not a median rent. The observed min/max is the plain MIN/MAX of each listing's own posted price range, not a computed average; for the source-faithful median rent per ZIP, see market-temperature-swfl (realtor.com monthly ZIP aggregates).",
      "Each row can be a multi-unit community (one property_id spans a range of unit types/prices), not one apartment — counts are LISTINGS, not units.",
      "This is live FOR-RENT inventory, distinct from rentals-swfl (the Zillow ZORI rent INDEX — a monthly trend/direction read, not a listing count).",
      "Weekly snapshot — direction is neutral on any one week; a second sweep is what would read inventory rising/falling.",
      "Source is realtor.com rental listings.",
    ],
    direction: "neutral",
    magnitude: 0,
    drivers: [],
    overrides: [],
    contradicts: [],
    exogenous_signals: [],
    grain_boundary: {
      not_available: [
        "Median or average rent — see market-temperature-swfl for the source-faithful per-ZIP median",
        "Rent index / YoY trend — see rentals-swfl (Zillow ZORI)",
        "Sale listings — see active-listings-swfl (for-sale inventory only)",
        "Per-unit price (vs. per-listing range) — a community listing spans a price range, not one unit",
      ],
      finest_grain: "zip-snapshot",
    },
  };
}

export const activeRentalsSwfl: PackDefinition = {
  id: "active-rentals-swfl",
  brain_id: "active-rentals-swfl",
  public_label: "Active Rentals",
  domain: "real-estate",
  scope:
    "Southwest Florida active rental listing inventory (Lee + Collier) — count and observed asking-price " +
    "range at region, county, and ZIP grain, from SteadyAPI's weekly rentals-search sweep. List-side rental " +
    "inventory only (not the ZORI rent index/trend, and not a computed median rent — see market-temperature-swfl " +
    "for the source-faithful median). Deterministic, no LLM synthesis.",
  ttl_seconds: 8 * 24 * 60 * 60, // 8 days — weekly refresh + one cycle of slack

  sources: [activeRentalsSource],
  input_brains: [],

  fitScore: () => 0.75,

  skipSynthesisAgent: true,
  skipTriageAgent: true,

  corpusSummary: (allFragments: RawFragment[]) => {
    const fragment = allFragments.find(
      (f) =>
        f.source_id === SOURCE_ID &&
        (f.normalized as { kind?: string }).kind === "active-rentals-summary",
    );
    lastSummary = fragment ? (fragment.normalized as ActiveRentalsSummary) : null;
    lastFetchedAt = fragment?.fetched_at ?? null;

    if (!lastSummary || !lastSummary.region) return [];
    const r = lastSummary.region;
    return [
      {
        topic: "active_rentals_swfl_snapshot",
        fact: "SWFL active rental listing inventory ",
        value:
          `${fmtK(r.rental_listing_count)} active rental listings` +
          `${r.observed_price_min != null && r.observed_price_max != null ? `, asking ${fmtUsd(r.observed_price_min)}–${fmtUsd(r.observed_price_max)}/mo` : ""}. ` +
          `${lastSummary.by_county.length} counties, ${lastSummary.by_zip.length} ZIPs covered.`,
        source_fragment_ids: [],
      },
    ];
  },

  outputProducer: activeRentalsOutputProducer,

  preferences: [
    "This is a LISTING COUNT + observed price RANGE, not a median rent — never word it as an average or typical rent.",
    "Distinct from rentals-swfl (ZORI index/trend) and from market-temperature-swfl (source-faithful median rent per ZIP) — point there for a single typical-rent figure.",
  ],
  activeProject:
    "active-rentals-swfl: SWFL weekly active rental listing inventory (count + observed price range) from the SteadyAPI rentals-search sweep, no metered-call double-count with market-temperature-swfl.",
  prompts: {
    triageContext:
      "Fragment is an active-rentals-summary: region/county/ZIP rental inventory counts + observed price range off the weekly rentals-search sweep. Deterministic; decision-relevant for rental-market questions.",
    synthesisContext:
      "This pack runs no synthesis agent (skipSynthesisAgent). BrainOutput built by activeRentalsOutputProducer from the aggregate-at-source rental-stats view.",
  },
};
