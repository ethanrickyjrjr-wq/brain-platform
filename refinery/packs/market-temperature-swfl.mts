import type { PackDefinition, PackOutput } from "../types/pack.mts";
import type { RawFragment } from "../types/fragment.mts";
import type {
  BrainOutputProducerResult,
  BrainOutputMetric,
  BrainOutputMetricSource,
  BrainOutputDetailTable,
} from "../types/brain-output.mts";
import {
  marketTemperatureSource,
  type MarketTemperatureSummary,
} from "../sources/market-temperature-source.mts";

const SOURCE_ID = "market_temperature_swfl";

/**
 * market-temperature-swfl — per-ZIP market snapshot from realtor.com's monthly ZIP aggregates.
 *
 * HEADLINE = sold_to_rent_ratio (sold price ÷ annual rent), the one genuinely net-new field no free source
 * publishes — a gross-yield read for the investor audience. Everything else in the snapshot (median
 * sold/list/rent/DOM/ppsqft/hotness/list-to-sold, market_strength) DUPLICATES data we already hold free
 * (housing-swfl Redfin sold + sale-to-list, market-heat realtor DOM/hotness), so it rides as CITED CONTEXT
 * in the per-ZIP detail table — never as a headline vote (that would double-count in master).
 *
 * Tier-1 Reporter — deterministic, no LLM. Monthly cadence (realtor.com's ZIP aggregates refresh monthly).
 */

let lastSummary: MarketTemperatureSummary | null = null;
let lastFetchedAt: string | null = null;

function makeSource(citation: string, fetchedAt: string, url: string): BrainOutputMetricSource {
  return { url, fetched_at: fetchedAt, tier: 2, citation };
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

function marketTemperatureOutputProducer(_out: PackOutput): BrainOutputProducerResult {
  const summary = lastSummary;
  const fetchedAt = lastFetchedAt ?? new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

  if (!summary || summary.rows.length === 0) {
    return {
      conclusion:
        "market-temperature-swfl: no rows in data_lake.market_details_swfl_latest. " +
        "Run the market_aggregates details pipeline (python -m ingest.pipelines.market_aggregates.pipeline --resource details).",
      key_metrics: [],
      caveats: [
        "data_lake.market_details_swfl_latest returned 0 rows — pipeline not yet run live (cron parked).",
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
  const key_metrics: BrainOutputMetric[] = [];

  // ── The ONLY headline: sold-to-rent (gross-yield read) — the net-new field. ──
  const ratio = summary.region_sold_to_rent;
  if (ratio != null && ratio > 0) {
    const impliedYieldPct = round2(100 / ratio);
    key_metrics.push({
      metric: "sold_to_rent_ratio_swfl",
      label: `SWFL median price-to-annual-rent multiple (sold ÷ annual rent) — an implied gross rental yield of ~${impliedYieldPct}% across ${summary.rows.length} ZIPs`,
      value: round2(ratio),
      direction: "stable",
      variable_type: "intensive",
      units: "price ÷ annual rent",
      display_format: "ratio",
      source: makeSource(
        `median price-to-annual-rent multiple across ${summary.rows.length} SWFL ZIPs: ${round2(ratio)} (~${impliedYieldPct}% gross yield), as of ${asOf}`,
        fetchedAt,
        url,
      ),
    });
  }

  // ── Full per-ZIP snapshot as CITED CONTEXT (not headline metrics — avoids double-counting the
  //    sold/DOM/hotness we already hold free). ──
  const tableSource = makeSource(
    `SWFL per-ZIP market snapshot (realtor.com monthly ZIP aggregates), as of ${asOf}`,
    fetchedAt,
    url,
  );
  const detail_tables: BrainOutputDetailTable[] = [
    {
      id: "market_temperature_by_zip",
      title: `SWFL per-ZIP market snapshot — ${asOf}`,
      grain: "zip",
      columns: [
        {
          id: "sold_to_rent_ratio",
          label: "Price ÷ annual rent",
          display_format: "ratio",
          units: "×",
        },
        { id: "median_sold_price", label: "Median sold", display_format: "currency", units: "USD" },
        {
          id: "median_listing_price",
          label: "Median list",
          display_format: "currency",
          units: "USD",
        },
        {
          id: "median_rent_price",
          label: "Median rent",
          display_format: "currency",
          units: "USD/mo",
        },
        {
          id: "median_days_on_market",
          label: "Median DOM",
          display_format: "count",
          units: "days",
        },
        {
          id: "median_price_per_sqft",
          label: "Price/sqft",
          display_format: "currency",
          units: "USD",
        },
        {
          id: "list_to_sold_ratio_pct",
          label: "List-to-sold",
          display_format: "percent",
          units: "%",
        },
        {
          id: "local_hotness_score",
          label: "Hotness (relative)",
          display_format: "raw",
          units: "score",
        },
        { id: "market_strength", label: "Strength" },
      ],
      rows: [...summary.rows]
        .sort((a, b) => (a.sold_to_rent_ratio ?? Infinity) - (b.sold_to_rent_ratio ?? Infinity))
        .map((r) => ({
          key: r.zip_code,
          label: `${r.zip_code}${r.county ? ` (${r.county})` : ""}`,
          cells: {
            sold_to_rent_ratio: r.sold_to_rent_ratio,
            median_sold_price: r.median_sold_price,
            median_listing_price: r.median_listing_price,
            median_rent_price: r.median_rent_price,
            median_days_on_market: r.median_days_on_market,
            median_price_per_sqft: r.median_price_per_sqft,
            list_to_sold_ratio_pct: r.list_to_sold_ratio_pct,
            local_hotness_score: r.local_hotness_score,
            market_strength: r.market_strength,
          },
        })),
      source: tableSource,
    },
  ];

  // Best-yield ZIPs (lowest price-to-rent multiple = highest gross yield).
  const ranked = [...summary.rows]
    .filter((r) => r.sold_to_rent_ratio != null && r.sold_to_rent_ratio > 0)
    .sort((a, b) => a.sold_to_rent_ratio! - b.sold_to_rent_ratio!);
  const topYield = ranked
    .slice(0, 3)
    .map((r) => `${r.zip_code} (${round2(100 / r.sold_to_rent_ratio!)}%)`)
    .join(", ");

  const conclusion =
    ratio != null && ratio > 0
      ? `Across ${summary.rows.length} SWFL ZIPs (as of ${asOf}), the median home sells for ${round2(ratio)}× its annual rent — an implied gross rental yield near ${round2(100 / ratio)}%. ` +
        `Highest-yield ZIPs: ${topYield}. The full per-ZIP sold/list/rent/DOM snapshot is in the table below.`
      : `Per-ZIP market snapshot for ${summary.rows.length} SWFL ZIPs as of ${asOf} — see the table below.`;

  return {
    conclusion,
    key_metrics,
    detail_tables,
    caveats: [
      "The headline is a gross yield (sold price ÷ annual rent) — before taxes, insurance, HOA, vacancy, and maintenance; a net yield is materially lower, especially given SWFL insurance costs.",
      "The median sold/DOM/hotness/list-to-sold figures in the table are CONTEXT — the same signals are tracked at monthly cadence elsewhere; this brain's own read is the sold-to-rent yield.",
      "Monthly cadence: realtor.com's ZIP-grain aggregates refresh monthly, so these numbers move month to month, not week to week.",
      "Source is realtor.com per-ZIP market aggregates.",
    ],
    direction: "neutral",
    magnitude: 0,
    drivers: [],
    overrides: [],
    contradicts: [],
    exogenous_signals: [],
    grain_boundary: {
      not_available: [
        "Net rental yield — this is a GROSS yield (before carrying costs)",
        "Sub-ZIP / per-property yield — ZIP-median aggregate only",
        "Week-over-week change — monthly snapshot only",
      ],
      finest_grain: "zip-month",
    },
  };
}

export const marketTemperatureSwfl: PackDefinition = {
  id: "market-temperature-swfl",
  brain_id: "market-temperature-swfl",
  public_label: "Market Temperature",
  domain: "real-estate",
  scope:
    "Southwest Florida per-ZIP market snapshot (Lee + Collier) from realtor.com's monthly ZIP aggregates. " +
    "Headline is the sold-to-rent gross-yield read (median home price ÷ annual rent) — the one field no free " +
    "source publishes. The full per-ZIP snapshot (median sold, list, rent, days-on-market, price/sqft, hotness, " +
    "list-to-sold, market strength) rides as cited context. Monthly cadence; deterministic, no LLM synthesis.",
  ttl_seconds: 35 * 24 * 60 * 60, // 35 days — realtor.com restates ZIP aggregates monthly

  sources: [marketTemperatureSource],
  input_brains: [],

  fitScore: () => 0.75,

  skipSynthesisAgent: true,
  skipTriageAgent: true,

  corpusSummary: (allFragments: RawFragment[]) => {
    const fragment = allFragments.find(
      (f) =>
        f.source_id === SOURCE_ID &&
        (f.normalized as { kind?: string }).kind === "market-temperature-summary",
    );
    lastSummary = fragment ? (fragment.normalized as MarketTemperatureSummary) : null;
    lastFetchedAt = fragment?.fetched_at ?? null;

    if (!lastSummary || lastSummary.rows.length === 0) return [];
    const ratio = lastSummary.region_sold_to_rent;
    return [
      {
        topic: "market_temperature_swfl_snapshot",
        fact: "SWFL sold-to-rent yield snapshot ",
        value:
          ratio != null && ratio > 0
            ? `median price-to-annual-rent ${round2(ratio)}× (~${round2(100 / ratio)}% gross yield) across ${lastSummary.rows.length} ZIPs, as of ${lastSummary.captured_date ?? "latest"}.`
            : `per-ZIP snapshot for ${lastSummary.rows.length} ZIPs, as of ${lastSummary.captured_date ?? "latest"}.`,
        source_fragment_ids: [],
      },
    ];
  },

  outputProducer: marketTemperatureOutputProducer,

  preferences: [
    "Lead with the sold-to-rent gross yield (the net-new read). It is GROSS (before carrying costs) — say so.",
    "The other medians (sold, DOM, hotness) are context tracked monthly elsewhere — do not present them as this brain's unique signal.",
  ],
  activeProject:
    "market-temperature-swfl: SWFL per-ZIP sold-to-rent yield + full market snapshot from realtor.com monthly ZIP aggregates (one call per ZIP).",
  prompts: {
    triageContext:
      "Fragment is a market-temperature-summary: per-ZIP realtor.com market aggregates. Headline sold-to-rent yield; full snapshot in detail_table. Deterministic.",
    synthesisContext:
      "This pack runs no synthesis agent (skipSynthesisAgent). BrainOutput built by marketTemperatureOutputProducer from the aggregate-at-source per-ZIP view.",
  },
};
