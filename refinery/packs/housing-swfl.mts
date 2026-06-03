import type { PackDefinition, PackOutput } from "../types/pack.mts";
import type { RawFragment } from "../types/fragment.mts";
import type { SynthesisFact } from "../types/event.mts";
import type {
  BrainOutputDirection,
  BrainOutputMetric,
  BrainOutputMetricSource,
  BrainOutputProducerResult,
  BrainOutputDetailRow,
  BrainOutputDetailTable,
} from "../types/brain-output.mts";
import {
  housingSource,
  type HousingZipRow,
} from "../sources/housing-source.mts";

const BRAIN_ID = "housing-swfl";
const TOP_N = 3;

// A ZIP whose latest 90-day window has fewer than this many sales is a thin
// sample: its "median" rests on 1–4 transactions and is indicative, not stable.
// We keep the row (answering ANY ZIP is the design goal) but flag it and suppress
// its derived months-of-supply, which a tiny denominator distorts wildly.
const LOW_SAMPLE_FLOOR = 5;

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

// A thin-sample ZIP — fewer than LOW_SAMPLE_FLOOR sales in the latest window.
export function isLowSample(r: HousingZipRow): boolean {
  return (r.homes_sold ?? 0) < LOW_SAMPLE_FLOOR;
}

// Per-ZIP months of supply, for the detail-table cell. Redfin leaves
// MONTHS_OF_SUPPLY null at ZIP grain, so derive it: inventory ÷ the trailing
// 90-day sales pace (HOMES_SOLD is a 90-day count, so monthly pace = /3). Prefer
// the published value if Redfin ever fills it in. SUPPRESS the derivation on
// thin-sample rows — a 1–4 sale denominator produces nonsense (2 sales → 30+
// "months"), so a null is more honest than a fabricated figure.
export function monthsOfSupply(r: HousingZipRow): number | null {
  if (r.months_of_supply != null && Number.isFinite(r.months_of_supply)) {
    return r.months_of_supply;
  }
  if (
    r.inventory == null ||
    r.homes_sold == null ||
    r.homes_sold < LOW_SAMPLE_FLOOR
  ) {
    return null;
  }
  return (r.inventory * 3) / r.homes_sold;
}

// Regional / metro months of supply as a TRUE absorption rate: aggregate
// inventory ÷ aggregate 90-day sales pace — NOT a median of per-ZIP ratios,
// which thin-sample ZIPs distort badly (a 2-sale ZIP reads 30+ months and drags
// the median). The aggregate is dominated by high-volume ZIPs and is robust to
// the long tail. All rows with a real sales count contribute to the denominator.
export function aggregateMonthsOfSupply(
  rows: readonly HousingZipRow[],
): number | null {
  let inv = 0;
  let sold = 0;
  for (const r of rows) {
    if (r.inventory != null && r.homes_sold != null && r.homes_sold > 0) {
      inv += r.inventory;
      sold += r.homes_sold;
    }
  }
  if (sold === 0) return null;
  return (inv * 3) / sold;
}

// MEDIAN_DOM_YOY is an ABSOLUTE day difference (see housing-source.mts), so it
// renders as a signed day change — NEVER ×100 as a percent (that bug shipped a
// "650.0% YoY" to users). e.g. -11 → "-11 days", +6.5 → "+6.5 days".
export function formatDayDelta(days: number): string {
  const r = Math.round(days * 10) / 10;
  const sign = r > 0 ? "+" : "";
  return `${sign}${r} day${Math.abs(r) === 1 ? "" : "s"}`;
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
      months_of_supply: aggregateMonthsOfSupply(metroRows),
    };
  }

  return {
    period_begin: latestPeriod,
    zip_count: rows.length,
    median_sale_price: medianSalePrice,
    median_dom: median(rows.map((r) => r.median_dom)),
    months_of_supply: aggregateMonthsOfSupply(rows),
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

  // DOM YoY (absolute days): falling = faster sales = bullish
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
// All ZIP rows from this build, handed to the outputProducer so it can emit the
// per-ZIP detail table (every SWFL ZIP, not just the priciest/fastest extremes).
let lastRows: HousingZipRow[] = [];

// ── corpusSummary ─────────────────────────────────────────────────────────────

function housingCorpusSummary(allFragments: RawFragment[]): SynthesisFact[] {
  lastSnapshot = null;
  lastFetchedAt = null;
  lastRows = [];

  const rows = rowsFromFragments(allFragments);
  if (rows.length === 0) return [];

  const snap = buildSnapshot(rows);
  if (!snap) return [];

  lastSnapshot = snap;
  lastRows = rows;
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
      label: `SWFL regional median days on market — falling = faster sales${snap.median_dom_yoy !== null ? ` (YoY: ${formatDayDelta(snap.median_dom_yoy)})` : ""}`,
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
        "SWFL regional median months of supply — derived from inventory over the 90-day sales pace (< 3 = seller's market, > 6 = buyer's market)",
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
  caveats.push(
    "Months of supply is derived (inventory over the trailing 90-day sales pace); Redfin does not publish it at ZIP grain.",
  );

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

  // ── Per-ZIP detail table ──
  // The headline above is regional + the 6 EXTREME ZIPs (priciest/fastest). The
  // failure this fixes: a consumer asked about an ORDINARY ZIP (Gateway/33913)
  // and was told it "wasn't broken out" — because every non-extreme ZIP was
  // dropped before the payload left the brain. This table carries EVERY SWFL ZIP
  // so a downstream Claude answers any ZIP/named-place by lookup. Uncapped by
  // design (full coverage is the point); rides in the dossier, not tier-1/2 prose.
  const zipRows: BrainOutputDetailRow[] = lastRows
    .filter((r) => r.zip_code && r.median_sale_price !== null)
    .sort((a, b) => a.zip_code.localeCompare(b.zip_code))
    .map((r) => {
      const mos = monthsOfSupply(r);
      return {
        key: r.zip_code,
        label: r.zip_code,
        cells: {
          metro: r.parent_metro_region || null,
          median_sale_price: r.median_sale_price,
          median_sale_price_yoy_pct:
            r.median_sale_price_yoy === null
              ? null
              : Number((r.median_sale_price_yoy * 100).toFixed(1)),
          median_dom: r.median_dom,
          median_dom_yoy_days:
            r.median_dom_yoy === null
              ? null
              : Number(r.median_dom_yoy.toFixed(1)),
          avg_sale_to_list_pct:
            r.avg_sale_to_list === null
              ? null
              : Number((r.avg_sale_to_list * 100).toFixed(1)),
          months_of_supply: mos === null ? null : Number(mos.toFixed(1)),
          homes_sold: r.homes_sold,
          inventory: r.inventory,
          low_sample: isLowSample(r),
        },
      };
    });

  const detail_tables: BrainOutputDetailTable[] = zipRows.length
    ? [
        {
          id: "housing_by_zip",
          title: `SWFL housing by ZIP — latest 90-day window (${snap.period_begin})`,
          grain: "zip",
          columns: [
            { id: "metro", label: "Metro area" },
            {
              id: "median_sale_price",
              label: "Median sale price",
              display_format: "currency",
              units: "USD",
            },
            {
              id: "median_sale_price_yoy_pct",
              label: "Median sale price YoY",
              display_format: "percent",
              units: "percent",
            },
            {
              id: "median_dom",
              label: "Median days on market",
              display_format: "count",
              units: "days",
            },
            {
              id: "median_dom_yoy_days",
              label: "Median days-on-market YoY change",
              display_format: "raw",
              units: "days",
            },
            {
              id: "avg_sale_to_list_pct",
              label: "Sale-to-list ratio",
              display_format: "percent",
              units: "percent",
            },
            {
              id: "months_of_supply",
              label: "Months of supply",
              display_format: "raw",
              units: "months",
            },
            {
              id: "homes_sold",
              label: "Homes sold (90-day)",
              display_format: "count",
              units: "count",
            },
            {
              id: "inventory",
              label: "Active inventory",
              display_format: "count",
              units: "count",
            },
            {
              id: "low_sample",
              label: "Thin sample (under 5 sales this window)",
            },
          ],
          rows: zipRows,
          source,
          note: "One row per SWFL ZIP, each its latest Redfin 90-day window. Months of supply is derived (inventory over the 90-day sales pace); Redfin does not publish it at ZIP grain. When low_sample is true the row rests on fewer than 5 sales — quote its median as a thin, indicative read rather than a stable one, and its months of supply is omitted.",
        },
      ]
    : [];

  return {
    conclusion,
    key_metrics,
    detail_tables,
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
