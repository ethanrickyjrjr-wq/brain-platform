import type { PackDefinition } from "../types/pack.mts";
import type { PackOutput } from "../types/pack.mts";
import type {
  BrainOutputProducerResult,
  BrainOutputMetric,
  BrainOutputDirection,
} from "../types/brain-output.mts";
import {
  fgcuReriSource,
  type ReriNormalized,
} from "../sources/fgcu-reri-source.mts";
import type { RawFragment } from "../types/fragment.mts";

const SOURCE_ID = "fgcu_reri_indicators";

/**
 * fgcu-reri — SWFL monthly economic snapshot from FGCU's Regional Economic
 * Research Institute (Lutgert College of Business).
 *
 * Source: public.fgcu_reri_indicators (ingest/pipelines/fgcu_reri_indicators)
 * Cadence: monthly ~4th of month, ~2-month data lag.
 * Coverage: Lee + Collier + Charlotte counties.
 *
 * 8 indicators per report month:
 *   airport_activity, tourist_tax_revenues, taxable_sales, unemployment_rate,
 *   permits_single_family, home_sales_single_family, home_prices_single_family
 *   (per county: Lee / Collier / Charlotte), active_listings_residential.
 *
 * Polarity: unemployment_rate is INVERSE — rising unemployment is bearish.
 *   All other 7 indicators are DIRECT (positive = bullish).
 */

// ── Polarity ──────────────────────────────────────────────────────────────────

/**
 * Indicators where a positive pct_change is bearish, not bullish.
 * Rising unemployment = bad. All other RERI indicators are direct (positive = good).
 */
const INVERSE_INDICATORS = new Set(["unemployment_rate"]);

function polarityAdjusted(indicator: string, pct: number): number {
  return INVERSE_INDICATORS.has(indicator) ? -pct : pct;
}

// ── Closure state (populated by corpusSummary, consumed by outputProducer) ───

let lastRows: ReriNormalized[] = [];
let lastFetchedAt: string | null = null;

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number, decimals = 1): string {
  return n.toFixed(decimals);
}

function sign(n: number): string {
  return n >= 0 ? "+" : "";
}

function metricDirection(
  adjusted: number | null,
): "bullish" | "bearish" | "neutral" {
  if (adjusted == null) return "neutral";
  return adjusted > 0 ? "bullish" : adjusted < 0 ? "bearish" : "neutral";
}

function makeSource(
  fetchedAt: string,
  sourceUrl: string,
  refLabel: string,
): BrainOutputMetric["source"] {
  return {
    url: sourceUrl || "https://www.fgcu.edu/cob/reri/",
    fetched_at: fetchedAt,
    tier: 1,
    citation: `FGCU RERI Monthly Economic Outlook — Lutgert College of Business (${refLabel})`,
  };
}

// ── outputProducer ────────────────────────────────────────────────────────────

function fgcuReriOutputProducer(_out: PackOutput): BrainOutputProducerResult {
  const rows = lastRows;
  const fetchedAt =
    lastFetchedAt ?? new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

  if (rows.length === 0) {
    return {
      conclusion:
        "fgcu-reri: no RERI indicator data available — table may be empty or pipeline has not yet run.",
      key_metrics: [],
      caveats: [
        "fgcu_reri_indicators table returned 0 rows. Run the fgcu-reri-monthly pipeline.",
      ],
      direction: "neutral",
      magnitude: 0,
      drivers: [],
      overrides: [],
      contradicts: [],
      exogenous_signals: [],
    };
  }

  // Latest report month
  const latestMonth = rows.reduce(
    (best, r) => (r.report_month > best ? r.report_month : best),
    rows[0].report_month,
  );
  const latest = rows.filter((r) => r.report_month === latestMonth);

  // Build key_metrics
  const key_metrics: BrainOutputMetric[] = [];

  // Helper: find row by indicator + county in latest month
  const find = (indicator: string, county = "swfl") =>
    latest.find((r) => r.indicator === indicator && r.county === county) ??
    null;

  const addMetric = (
    slug: string,
    label: string,
    row: ReriNormalized | null,
  ) => {
    if (!row || row.pct_change == null) return;
    const adj = polarityAdjusted(row.indicator, row.pct_change);
    const unit = row.pct_change_unit === "percentage points" ? "pp" : "%";
    key_metrics.push({
      metric: slug,
      label,
      value: row.pct_change,
      direction: metricDirection(adj),
      variable_type: "intensive",
      units: unit,
      display_format: "raw",
      source: makeSource(
        fetchedAt,
        row.source_url,
        `${row.indicator} ${latestMonth} ${sign(row.pct_change)}${fmt(row.pct_change)}${unit} YoY`,
      ),
    });
  };

  addMetric(
    "fgcu_reri_airport_activity_pct_change",
    "RERI Airport Activity YoY",
    find("airport_activity"),
  );
  addMetric(
    "fgcu_reri_tourist_tax_pct_change",
    "RERI Tourist Tax Revenues YoY",
    find("tourist_tax_revenues"),
  );
  addMetric(
    "fgcu_reri_taxable_sales_pct_change",
    "RERI Taxable Sales YoY",
    find("taxable_sales"),
  );
  addMetric(
    "fgcu_reri_unemployment_rate_pct_change",
    "RERI Unemployment Rate YoY Δ",
    find("unemployment_rate"),
  );
  addMetric(
    "fgcu_reri_permits_sf_pct_change",
    "RERI SF Permits YoY",
    find("permits_single_family"),
  );
  addMetric(
    "fgcu_reri_home_sales_sf_pct_change",
    "RERI SF Home Sales YoY",
    find("home_sales_single_family"),
  );
  addMetric(
    "fgcu_reri_home_prices_lee_pct_change",
    "RERI SF Home Prices Lee YoY",
    find("home_prices_single_family", "lee"),
  );
  addMetric(
    "fgcu_reri_home_prices_collier_pct_change",
    "RERI SF Home Prices Collier YoY",
    find("home_prices_single_family", "collier"),
  );
  addMetric(
    "fgcu_reri_home_prices_charlotte_pct_change",
    "RERI SF Home Prices Charlotte YoY",
    find("home_prices_single_family", "charlotte"),
  );
  addMetric(
    "fgcu_reri_active_listings_pct_change",
    "RERI Active Listings YoY",
    find("active_listings_residential"),
  );

  // ── Direction (polarity-aware tally) ──────────────────────────────────────
  // Each row in the latest month is polarity-adjusted before counting.
  // unemployment_rate is INVERSE: rising unemployment = bearish (sign flipped).
  // A single bearish signal among otherwise-bullish indicators = "mixed".
  let bullish = 0;
  let bearish = 0;
  for (const row of latest) {
    if (row.pct_change == null) continue;
    const adj = polarityAdjusted(row.indicator, row.pct_change);
    if (adj > 0) bullish++;
    else if (adj < 0) bearish++;
  }
  const direction: BrainOutputDirection =
    bullish === 0 && bearish === 0
      ? "neutral"
      : bearish === 0
        ? "bullish"
        : bullish === 0
          ? "bearish"
          : "mixed";

  // ── Conclusion ────────────────────────────────────────────────────────────
  const airRow = find("airport_activity");
  const taxRow = find("tourist_tax_revenues");
  const unempRow = find("unemployment_rate");
  const permitsRow = find("permits_single_family");

  const parts: string[] = [];
  if (airRow?.pct_change != null)
    parts.push(
      `airport activity ${sign(airRow.pct_change)}${fmt(airRow.pct_change)}%`,
    );
  if (taxRow?.pct_change != null)
    parts.push(
      `tourist tax ${sign(taxRow.pct_change)}${fmt(taxRow.pct_change)}%`,
    );
  if (unempRow?.pct_change != null)
    parts.push(
      `unemployment ${sign(unempRow.pct_change)}${fmt(unempRow.pct_change)}pp`,
    );
  if (permitsRow?.pct_change != null)
    parts.push(
      `SF permits ${sign(permitsRow.pct_change)}${fmt(permitsRow.pct_change)}%`,
    );

  const conclusion =
    `FGCU RERI ${latestMonth} — ${parts.join(", ")}. ` +
    `${bullish} of ${bullish + bearish} polarity-adjusted indicators positive. ` +
    `Source: FGCU Lutgert College of Business (~2-month data lag).`;

  return {
    conclusion,
    key_metrics,
    caveats: [
      `Data lag: FGCU RERI publishes indicators ~4th of each month; data reflects ~2 months prior (report_month ${latestMonth} → reference period ends ~${latestMonth}).`,
    ],
    direction,
    magnitude: Math.min(
      Math.max(bullish, bearish) / Math.max(bullish + bearish, 1),
      1,
    ),
    drivers: [],
    overrides: [],
    contradicts: [],
    exogenous_signals: [],
    grain_boundary:
      "Monthly SWFL regional economic snapshot; 8 indicators for Lee + Collier + Charlotte counties; ~2-month data lag.",
  };
}

// ── Pack definition ───────────────────────────────────────────────────────────

export const fgcuReri: PackDefinition = {
  id: "fgcu-reri",
  brain_id: "fgcu-reri",
  domain: "macro",
  scope: "Southwest Florida — FGCU RERI monthly regional economic indicators",
  ttl_seconds: 30 * 24 * 60 * 60, // 30 days

  sources: [fgcuReriSource],
  input_brains: [],

  // 0.7: macro-domain leaf; dedicated SWFL regional source; see SOURCED.md#fgcu-reri
  fitScore: () => 0.7,

  skipSynthesisAgent: true,
  skipTriageAgent: true,

  corpusSummary: (allFragments: RawFragment[]) => {
    const rows = allFragments
      .filter((f) => f.source_id === SOURCE_ID)
      .map((f) => f.normalized as ReriNormalized)
      .filter(Boolean);
    lastRows = rows;
    lastFetchedAt = rows[0]
      ? (allFragments.find((f) => f.source_id === SOURCE_ID)?.fetched_at ??
        null)
      : null;
    return rows.map((r) => ({ kind: "reri-row" as const, ...r }));
  },

  outputProducer: fgcuReriOutputProducer,
};
