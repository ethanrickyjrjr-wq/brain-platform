import type { PackDefinition, PackOutput } from "../types/pack.mts";
import type { RawFragment } from "../types/fragment.mts";
import type { SynthesisFact } from "../types/event.mts";
import type {
  BrainOutputDirection,
  BrainOutputMetric,
  BrainOutputMetricSource,
  BrainOutputProducerResult,
} from "../types/brain-output.mts";
import {
  housingSource,
  type HousingZipRow,
} from "../sources/housing-source.mts";

const BRAIN_ID = "housing-swfl";
const TOP_N = 3;

// ── Domain types ──────────────────────────────────────────────────────────────

interface HousingSnapshot {
  period_begin: string;
  zip_count: number;
  median_sale_price: number;
  median_dom: number | null;
  months_of_supply: number | null;
  avg_sale_to_list: number | null;
  sold_above_list: number | null;
  off_market_in_two_weeks: number | null;
  median_sale_price_yoy: number | null;
  median_dom_yoy: number | null;
  inventory_yoy: number | null;
  avg_sale_to_list_yoy: number | null;
  hottest_zips: Array<{ zip: string; metro: string; dom: number }>;
  priciest_zips: Array<{ zip: string; metro: string; price: number }>;
  by_metro: Record<string, MetroSummary>;
}

interface MetroSummary {
  metro: string;
  zip_count: number;
  median_sale_price: number | null;
  median_dom: number | null;
  months_of_supply: number | null;
}

interface DirectionVerdict {
  direction: BrainOutputDirection;
  magnitude: number;
  caveats: string[];
}

// ── Pure helpers ──────────────────────────────────────────────────────────────

function median(values: readonly (number | null)[]): number | null {
  const nums = values.filter(
    (v): v is number => v !== null && Number.isFinite(v),
  );
  if (nums.length === 0) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

// Directional label for a change in the same sign as the metric (rising = good).
function metricDirection(
  delta: number | null,
): "rising" | "falling" | "stable" {
  if (delta === null) return "stable";
  if (delta > 0.005) return "rising";
  if (delta < -0.005) return "falling";
  return "stable";
}

// DOM moves inversely to market heat: falling DOM = homes selling faster.
function domTrendDirection(
  domYoy: number | null,
): "rising" | "falling" | "stable" {
  return metricDirection(domYoy);
}

function rowsFromFragments(fragments: RawFragment[]): HousingZipRow[] {
  return fragments
    .map((f) => f.normalized as unknown as HousingZipRow)
    .filter((r): r is HousingZipRow => !!r && typeof r === "object");
}

function buildSnapshot(rows: HousingZipRow[]): HousingSnapshot | null {
  if (rows.length === 0) return null;

  let latestPeriod = "";
  const byMetro = new Map<string, HousingZipRow[]>();

  for (const row of rows) {
    if (row.period_begin > latestPeriod) latestPeriod = row.period_begin;
    const metro = row.parent_metro_region || "Unknown";
    if (!byMetro.has(metro)) byMetro.set(metro, []);
    byMetro.get(metro)!.push(row);
  }

  const medianSalePrice = median(rows.map((r) => r.median_sale_price));
  if (medianSalePrice === null) return null;

  const hottestZips = [...rows]
    .filter((r) => r.median_dom !== null)
    .sort((a, b) => (a.median_dom ?? Infinity) - (b.median_dom ?? Infinity))
    .slice(0, TOP_N)
    .map((r) => ({
      zip: r.zip_code,
      metro: r.parent_metro_region ?? "",
      dom: r.median_dom!,
    }));

  const priciestZips = [...rows]
    .filter((r) => r.median_sale_price !== null)
    .sort((a, b) => (b.median_sale_price ?? 0) - (a.median_sale_price ?? 0))
    .slice(0, TOP_N)
    .map((r) => ({
      zip: r.zip_code,
      metro: r.parent_metro_region ?? "",
      price: r.median_sale_price!,
    }));

  const metroSummary: Record<string, MetroSummary> = {};
  for (const [metro, metroRows] of byMetro.entries()) {
    metroSummary[metro] = {
      metro,
      zip_count: metroRows.length,
      median_sale_price: median(metroRows.map((r) => r.median_sale_price)),
      median_dom: median(metroRows.map((r) => r.median_dom)),
      months_of_supply: median(metroRows.map((r) => r.months_of_supply)),
    };
  }

  return {
    period_begin: latestPeriod,
    zip_count: rows.length,
    median_sale_price: medianSalePrice,
    median_dom: median(rows.map((r) => r.median_dom)),
    months_of_supply: median(rows.map((r) => r.months_of_supply)),
    avg_sale_to_list: median(rows.map((r) => r.avg_sale_to_list)),
    sold_above_list: median(rows.map((r) => r.sold_above_list)),
    off_market_in_two_weeks: median(rows.map((r) => r.off_market_in_two_weeks)),
    median_sale_price_yoy: median(rows.map((r) => r.median_sale_price_yoy)),
    median_dom_yoy: median(rows.map((r) => r.median_dom_yoy)),
    inventory_yoy: median(rows.map((r) => r.inventory_yoy)),
    avg_sale_to_list_yoy: median(rows.map((r) => r.avg_sale_to_list_yoy)),
    hottest_zips: hottestZips,
    priciest_zips: priciestZips,
    by_metro: metroSummary,
  };
}

// Vote-based direction: DOM, inventory, sale-to-list, and months of supply each
// cast a directional vote. "bullish" = seller's market / heating. "bearish" = buyer's market.
function classifyDirection(snap: HousingSnapshot): DirectionVerdict {
  let score = 0;
  const caveats: string[] = [];

  // DOM YoY (fraction): falling = faster sales = bullish
  if (snap.median_dom_yoy !== null) {
    if (snap.median_dom_yoy < 0) score += 1;
    else if (snap.median_dom_yoy > 0) score -= 1;
  }

  // Inventory YoY (fraction): falling = tighter supply = bullish
  if (snap.inventory_yoy !== null) {
    if (snap.inventory_yoy < -0.05) score += 1;
    else if (snap.inventory_yoy > 0.05) score -= 1;
  }

  // Sale-to-list ratio: > 1.0 = buyers bid over ask = bullish
  if (snap.avg_sale_to_list !== null) {
    if (snap.avg_sale_to_list >= 1.0) score += 1;
    else if (snap.avg_sale_to_list < 0.97) score -= 1;
  }

  // Months of supply: < 3 = seller's market (bullish), > 6 = buyer's market (bearish)
  if (snap.months_of_supply !== null) {
    if (snap.months_of_supply < 3) score += 1;
    else if (snap.months_of_supply > 6) score -= 1;
  }

  let direction: BrainOutputDirection;
  let magnitude: number;
  if (score >= 2) {
    direction = "bullish";
    magnitude = Math.min(score / 4, 1);
  } else if (score <= -2) {
    direction = "bearish";
    magnitude = Math.min(Math.abs(score) / 4, 1);
  } else if (score > 0) {
    direction = "mixed";
    magnitude = 0.25;
  } else if (score < 0) {
    direction = "mixed";
    magnitude = 0.25;
  } else {
    direction = "neutral";
    magnitude = 0;
  }

  if (snap.zip_count < 10) {
    caveats.push(
      `Only ${snap.zip_count} SWFL ZIPs in corpus — regional read is thin.`,
    );
  }
  if (snap.median_sale_price_yoy === null) {
    caveats.push("Price YoY unavailable for this build period.");
  }

  return { direction, magnitude, caveats };
}

// ── Module-level state (handoff corpusSummary → outputProducer) ──────────────

let lastSnapshot: HousingSnapshot | null = null;
let lastFetchedAt: string | null = null;

// ── corpusSummary ─────────────────────────────────────────────────────────────

function housingCorpusSummary(allFragments: RawFragment[]): SynthesisFact[] {
  lastSnapshot = null;
  lastFetchedAt = null;

  const rows = rowsFromFragments(allFragments);
  if (rows.length === 0) return [];

  const snap = buildSnapshot(rows);
  if (!snap) return [];

  lastSnapshot = snap;
  lastFetchedAt = allFragments[0]?.fetched_at ?? new Date().toISOString();

  const priceStr = `$${snap.median_sale_price.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  const yoyStr =
    snap.median_sale_price_yoy === null
      ? "n/a"
      : `${(snap.median_sale_price_yoy * 100).toFixed(1)}%`;

  return [
    {
      topic: "corpus_overview",
      fact: "Redfin SWFL housing market corpus",
      value: `${rows.length.toLocaleString()} ZIP snapshots at ${snap.period_begin}. Regional median sale price = ${priceStr}, YoY = ${yoyStr}. Median DOM = ${snap.median_dom?.toFixed(0) ?? "n/a"} days. Months of supply = ${snap.months_of_supply?.toFixed(1) ?? "n/a"}.`,
      source_fragment_ids: [],
    },
  ];
}

// ── outputProducer ────────────────────────────────────────────────────────────

function housingOutputProducer(_out: PackOutput): BrainOutputProducerResult {
  const snap = lastSnapshot;
  const fetched_at = lastFetchedAt ?? new Date().toISOString();

  if (!snap) {
    return {
      conclusion: "housing-swfl could not load any Redfin rows this build.",
      key_metrics: [],
      caveats: [
        "Zero rows from Redfin Parquet. Verify ingest:redfin-swfl ran successfully and s3://lake-tier1/market/redfin_swfl.parquet is populated.",
      ],
      direction: "neutral",
      magnitude: 0,
      drivers: [],
      overrides: [],
      contradicts: [],
      exogenous_signals: [],
    };
  }

  const source: BrainOutputMetricSource = {
    url: "https://www.redfin.com/news/data-center/",
    fetched_at,
    tier: 3,
    citation:
      "Redfin Data Center — ZIP-level monthly housing metrics (All Residential), SWFL MSAs. Updated ~3rd Friday each month.",
  };

  const verdict = classifyDirection(snap);
  const key_metrics: BrainOutputMetric[] = [];

  // 1. Median sale price + YoY
  const priceYoyLabel =
    snap.median_sale_price_yoy !== null
      ? ` (${(snap.median_sale_price_yoy * 100).toFixed(1)}% YoY)`
      : "";
  key_metrics.push({
    metric: "housing_median_sale_price_swfl",
    value: Number(snap.median_sale_price.toFixed(0)),
    direction: metricDirection(snap.median_sale_price_yoy),
    label: `SWFL regional median sale price (All Residential) at ${snap.period_begin}${priceYoyLabel}`,
    variable_type: "extensive",
    units: "USD",
    display_format: "currency",
    source,
  });

  // 2. Median days on market
  if (snap.median_dom !== null) {
    key_metrics.push({
      metric: "housing_median_dom_swfl",
      value: Number(snap.median_dom.toFixed(0)),
      direction: domTrendDirection(snap.median_dom_yoy),
      label: `SWFL regional median days on market — falling = faster sales${snap.median_dom_yoy !== null ? ` (YoY: ${(snap.median_dom_yoy * 100).toFixed(1)}%)` : ""}`,
      variable_type: "extensive",
      units: "days",
      display_format: "count",
      source,
    });
  }

  // 3. Months of supply
  if (snap.months_of_supply !== null) {
    const supplyDir: "rising" | "falling" | "stable" =
      snap.months_of_supply < 3
        ? "falling"
        : snap.months_of_supply > 6
          ? "rising"
          : "stable";
    key_metrics.push({
      metric: "housing_months_of_supply_swfl",
      value: Number(snap.months_of_supply.toFixed(1)),
      direction: supplyDir,
      label:
        "SWFL regional median months of supply (< 3 = seller's market, > 6 = buyer's market)",
      variable_type: "intensive",
      units: "months",
      display_format: "raw",
      source,
    });
  }

  // 4. Sale-to-list ratio
  if (snap.avg_sale_to_list !== null) {
    key_metrics.push({
      metric: "housing_avg_sale_to_list_swfl",
      value: Number((snap.avg_sale_to_list * 100).toFixed(1)),
      direction: snap.avg_sale_to_list >= 1.0 ? "rising" : "falling",
      label:
        "SWFL regional median sale-to-list ratio (> 100% = homes selling above ask)",
      variable_type: "intensive",
      units: "percent",
      display_format: "percent",
      source,
    });
  }

  // 5. Sold above list
  if (snap.sold_above_list !== null) {
    key_metrics.push({
      metric: "housing_sold_above_list_pct_swfl",
      value: Number((snap.sold_above_list * 100).toFixed(1)),
      direction: "stable",
      label: "SWFL regional median % of homes sold above list price",
      variable_type: "intensive",
      units: "percent",
      display_format: "percent",
      source,
    });
  }

  // 6. Off-market in 2 weeks
  if (snap.off_market_in_two_weeks !== null) {
    key_metrics.push({
      metric: "housing_off_market_in_two_weeks_pct_swfl",
      value: Number((snap.off_market_in_two_weeks * 100).toFixed(1)),
      direction: "stable",
      label: "SWFL regional median % of homes going off-market within 2 weeks",
      variable_type: "intensive",
      units: "percent",
      display_format: "percent",
      source,
    });
  }

  // ── Caveats ──
  const caveats = [...verdict.caveats];

  // ── Conclusion ──
  const priceDisplay = `$${snap.median_sale_price.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  const yoyDisplay =
    snap.median_sale_price_yoy !== null
      ? ` (${(snap.median_sale_price_yoy * 100).toFixed(1)}% YoY)`
      : "";
  const domDisplay =
    snap.median_dom !== null ? `${snap.median_dom.toFixed(0)} days` : "n/a";
  const mosDisplay =
    snap.months_of_supply !== null
      ? `${snap.months_of_supply.toFixed(1)} months`
      : "n/a";
  const stlDisplay =
    snap.avg_sale_to_list !== null
      ? `${(snap.avg_sale_to_list * 100).toFixed(1)}%`
      : "n/a";

  const hottestList =
    snap.hottest_zips
      .map((z) => `${z.zip} (${z.dom.toFixed(0)} days)`)
      .join(", ") || "none";
  const priciestList =
    snap.priciest_zips
      .map(
        (z) =>
          `${z.zip} ($${z.price.toLocaleString("en-US", { maximumFractionDigits: 0 })})`,
      )
      .join(", ") || "none";

  const conclusion = [
    `SWFL housing reads ${verdict.direction} at ${snap.period_begin} across ${snap.zip_count} ZIPs — regional median sale price ${priceDisplay}${yoyDisplay}, DOM ${domDisplay}, ${mosDisplay} of supply, ${stlDisplay} sale-to-list.`,
    `Fastest-moving ZIPs: ${hottestList}. Priciest ZIPs: ${priciestList}.`,
  ].join(" ");

  return {
    conclusion,
    key_metrics,
    caveats,
    direction: verdict.direction,
    magnitude: verdict.magnitude,
    drivers: [],
    overrides: [],
    contradicts: [],
    exogenous_signals: [],
  };
}

// ── PackDefinition ────────────────────────────────────────────────────────────

export const housingSwfl: PackDefinition = {
  id: BRAIN_ID,
  brain_id: BRAIN_ID,
  public_label: "Housing Market",
  domain: "real-estate",
  scope:
    "SWFL ZIP-level residential buy-side housing market (Redfin), monthly — median sale price, days on market, inventory, sale-to-list ratio, and market heat direction.",
  ttl_seconds: 86400 * 35,
  sources: [housingSource],
  input_brains: [],
  fitScore: () => 10,
  skipTriageAgent: true,
  skipSynthesisAgent: true,
  corpusSummary: housingCorpusSummary,
  outputProducer: housingOutputProducer,
  preferences: [
    "Read residential buy-side conditions from the investor/operator frame — buyer leverage, market heat, entry timing.",
    "DOM trend and months of supply are the primary market-heat indicators; sale price is secondary confirmation.",
    "Fastest-moving ZIPs and priciest ZIPs are the operational cuts for location-level decisions.",
  ],
  activeProject:
    "housing-swfl: track SWFL ZIP-level residential buy-side market direction via Redfin monthly data.",
  prompts: {
    triageContext:
      "A Redfin row is decision-relevant when it falls in a tracked SWFL MSA (Cape Coral-Fort Myers, Naples-Marco Island, Punta Gorda, North Port-Sarasota-Bradenton). The pack runs deterministically — no LLM triage is invoked.",
    synthesisContext:
      "Produce a buy-side market-direction read using DOM, inventory, and sale-to-list signals. Quote median sale price YoY, DOM trend, and months of supply. Fastest-moving and priciest ZIP cuts are the operational outputs. Never infer rental or cap-rate implications from sale price alone.",
  },
};
