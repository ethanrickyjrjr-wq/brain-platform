import type { PackDefinition } from "../types/pack.mts";
import type { PackOutput } from "../types/pack.mts";
import type {
  BrainOutputProducerResult,
  BrainOutputMetric,
  BrainOutputDirection,
} from "../types/brain-output.mts";
import {
  rswAirportSource,
  type RswAirportNormalized,
} from "../sources/rsw-airport-source.mts";
import type { RawFragment } from "../types/fragment.mts";
import type { SynthesisFact } from "../types/event.mts";

const SOURCE_ID = "rsw_airport_monthly";

/**
 * rsw-airport — Monthly aviation demand for Southwest Florida's two LCPA
 * airports: RSW (Southwest Florida International, Fort Myers/Cape Coral) and
 * PGD (Punta Gorda Airport).
 *
 * Source: public.rsw_airport_monthly (ingest/pipelines/rsw_airport_monthly,
 * cron 8th of month via rsw-airport-monthly.yml). Scraped from
 * https://www.flylcpa.com/about/statistics via Firecrawl.
 *
 * Primary metric: monthly enplanements (passengers boarding).
 * YoY direction is the bullish/bearish signal; trailing 12-mo total shows
 * absolute demand scale. PGD metrics surfaced where available.
 *
 * Leaf brain (no upstream brains). Deterministic pack.
 */

// ── Closure state ─────────────────────────────────────────────────────────────

let lastRows: RswAirportNormalized[] = [];
let lastFetchedAt: string | null = null;

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number, decimals = 1): string {
  return n.toFixed(decimals);
}

function sign(n: number): string {
  return n >= 0 ? "+" : "";
}

function fmtCount(n: number): string {
  return n.toLocaleString("en-US");
}

function metricDirection(pct: number | null): "rising" | "falling" | "stable" {
  if (pct == null) return "stable";
  return pct > 0 ? "rising" : pct < 0 ? "falling" : "stable";
}

function makeSource(
  fetchedAt: string,
  sourceUrl: string,
  citationLabel: string,
): BrainOutputMetric["source"] {
  return {
    url: sourceUrl || "https://www.flylcpa.com/about/statistics",
    fetched_at: fetchedAt,
    tier: 1,
    citation: `Lee County Port Authority Aviation Statistics — ${citationLabel}`,
  };
}

// ── outputProducer ────────────────────────────────────────────────────────────

function rswAirportOutputProducer(_out: PackOutput): BrainOutputProducerResult {
  const rows = lastRows;
  const fetchedAt =
    lastFetchedAt ?? new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

  if (rows.length === 0) {
    return {
      conclusion:
        "rsw-airport: no aviation data available — table may be empty or pipeline has not yet run.",
      key_metrics: [],
      caveats: [
        "rsw_airport_monthly table returned 0 rows. Run the rsw-airport-monthly pipeline.",
      ],
      direction: "neutral",
      magnitude: 0,
      drivers: [],
      overrides: [],
      contradicts: [],
      exogenous_signals: [],
    };
  }

  // ── Filter to enplanements only for the primary analysis ─────────────────
  const enplRows = rows.filter((r) => r.metric === "enplanements");

  // Latest RSW month
  const rswRows = enplRows.filter((r) => r.airport_code === "RSW");
  const latestRswMonth =
    rswRows.length > 0
      ? rswRows.reduce(
          (best, r) => (r.report_month > best ? r.report_month : best),
          rswRows[0].report_month,
        )
      : null;

  const latestRsw = latestRswMonth
    ? (rswRows.find((r) => r.report_month === latestRswMonth) ?? null)
    : null;

  // Trailing 12-month RSW enplanements (sum)
  const trailing12 = (() => {
    if (!latestRswMonth) return null;
    const sorted = rswRows
      .filter((r) => r.value != null)
      .sort((a, b) => (a.report_month > b.report_month ? -1 : 1))
      .slice(0, 12);
    if (sorted.length < 6) return null; // not enough data
    return sorted.reduce((sum, r) => sum + (r.value ?? 0), 0);
  })();

  // Latest PGD month
  const pgdRows = enplRows.filter((r) => r.airport_code === "PGD");
  const latestPgdMonth =
    pgdRows.length > 0
      ? pgdRows.reduce(
          (best, r) => (r.report_month > best ? r.report_month : best),
          pgdRows[0].report_month,
        )
      : null;
  const latestPgd = latestPgdMonth
    ? (pgdRows.find((r) => r.report_month === latestPgdMonth) ?? null)
    : null;

  // ── key_metrics ───────────────────────────────────────────────────────────
  const key_metrics: BrainOutputMetric[] = [];

  if (latestRsw?.value != null) {
    key_metrics.push({
      metric: "rsw_monthly_enplanements",
      label: "RSW Monthly Enplanements",
      value: latestRsw.value,
      direction: metricDirection(latestRsw.yoy_pct_change),
      variable_type: "extensive",
      units: "passengers",
      display_format: "count",
      source: makeSource(
        fetchedAt,
        latestRsw.source_url,
        `RSW ${latestRswMonth} — ${fmtCount(latestRsw.value)} enplanements`,
      ),
    });
  }

  if (latestRsw?.yoy_pct_change != null) {
    key_metrics.push({
      metric: "rsw_yoy_pct_change",
      label: "RSW Enplanements YoY",
      value: latestRsw.yoy_pct_change,
      direction: metricDirection(latestRsw.yoy_pct_change),
      variable_type: "intensive",
      units: "%",
      display_format: "raw",
      source: makeSource(
        fetchedAt,
        latestRsw.source_url,
        `RSW ${latestRswMonth} YoY ${sign(latestRsw.yoy_pct_change)}${fmt(latestRsw.yoy_pct_change)}%`,
      ),
    });
  }

  if (trailing12 != null) {
    key_metrics.push({
      metric: "rsw_trailing_12mo_enplanements",
      label: "RSW Trailing 12-Mo Enplanements",
      value: trailing12,
      direction: metricDirection(latestRsw?.yoy_pct_change ?? null),
      variable_type: "extensive",
      units: "passengers",
      display_format: "count",
      source: makeSource(
        fetchedAt,
        latestRsw?.source_url ?? "https://www.flylcpa.com/about/statistics",
        `RSW trailing 12-month sum ending ${latestRswMonth}`,
      ),
    });
  }

  if (latestPgd?.value != null) {
    key_metrics.push({
      metric: "pgd_monthly_enplanements",
      label: "PGD Monthly Enplanements",
      value: latestPgd.value,
      direction: metricDirection(latestPgd.yoy_pct_change),
      variable_type: "extensive",
      units: "passengers",
      display_format: "count",
      source: makeSource(
        fetchedAt,
        latestPgd.source_url,
        `PGD ${latestPgdMonth} — ${fmtCount(latestPgd.value)} enplanements`,
      ),
    });
  }

  if (latestPgd?.yoy_pct_change != null) {
    key_metrics.push({
      metric: "pgd_yoy_pct_change",
      label: "PGD Enplanements YoY",
      value: latestPgd.yoy_pct_change,
      direction: metricDirection(latestPgd.yoy_pct_change),
      variable_type: "intensive",
      units: "%",
      display_format: "raw",
      source: makeSource(
        fetchedAt,
        latestPgd.source_url,
        `PGD ${latestPgdMonth} YoY ${sign(latestPgd.yoy_pct_change)}${fmt(latestPgd.yoy_pct_change)}%`,
      ),
    });
  }

  // ── Direction ─────────────────────────────────────────────────────────────
  const yoy = latestRsw?.yoy_pct_change ?? null;
  const direction: BrainOutputDirection =
    yoy == null
      ? "neutral"
      : yoy > 0
        ? "bullish"
        : yoy < 0
          ? "bearish"
          : "neutral";

  // Magnitude: 10% YoY swing → 0.5; 20% → 1.0
  const magnitude = yoy != null ? Math.min(Math.abs(yoy) / 20, 1.0) : 0;

  // ── Conclusion ────────────────────────────────────────────────────────────
  const parts: string[] = [];
  if (latestRsw?.value != null)
    parts.push(`RSW ${fmtCount(latestRsw.value)} enplanements`);
  if (yoy != null) parts.push(`${sign(yoy)}${fmt(yoy)}% YoY`);
  if (trailing12 != null) parts.push(`trailing 12-mo ${fmtCount(trailing12)}`);
  if (latestPgd?.value != null)
    parts.push(`PGD ${fmtCount(latestPgd.value)} enplanements`);

  const caveats: string[] = [];
  if (!latestRsw) {
    caveats.push("No RSW enplanement data in the last 15 months.");
  }
  if (yoy == null && latestRsw) {
    caveats.push(
      "YoY change not available — prior-year row absent (pipeline may not have backfilled).",
    );
  }
  if (trailing12 == null) {
    caveats.push(
      "Trailing 12-month total not computed — fewer than 6 RSW monthly rows available.",
    );
  }

  const reportLabel = latestRswMonth ?? latestPgdMonth ?? "unknown month";
  const conclusion =
    `LCPA Aviation ${reportLabel} — ${parts.join(", ")}. ` +
    `Source: Lee County Port Authority (flylcpa.com/about/statistics).`;

  return {
    conclusion,
    key_metrics,
    caveats,
    direction,
    magnitude,
    drivers: [],
    overrides: [],
    contradicts: [],
    exogenous_signals: [],
    grain_boundary: {
      not_available: [
        "PGD (Punta Gorda) enplanements — LCPA does not operate that airport; Charlotte County Airport data not yet sourced.",
        "Sub-county or airline-level passenger breakdowns.",
        "Cargo, freight, or aircraft operations metrics (separate LCPA PDFs, not yet ingested).",
      ],
      finest_grain: "airport-month",
    },
  };
}

// ── Pack definition ───────────────────────────────────────────────────────────

export const rswAirport: PackDefinition = {
  id: "rsw-airport",
  brain_id: "rsw-airport",
  public_label: "RSW Airport",
  domain: "hospitality",
  scope:
    "Southwest Florida airport passenger demand — RSW (Southwest Florida International, Fort Myers/Cape Coral) and PGD (Punta Gorda) monthly enplanements from Lee County Port Authority",
  ttl_seconds: 30 * 24 * 60 * 60, // 30 days

  sources: [rswAirportSource],
  input_brains: [],

  // 8: primary SWFL aviation demand source; directly sourced from airport operator.
  fitScore: () => 8,

  skipSynthesisAgent: true,
  skipTriageAgent: true,

  corpusSummary: (allFragments: RawFragment[]): SynthesisFact[] => {
    const rows = allFragments
      .filter((f) => f.source_id === SOURCE_ID)
      .map((f) => f.normalized as RswAirportNormalized)
      .filter(Boolean);
    lastRows = rows;
    lastFetchedAt = rows[0]
      ? (allFragments.find((f) => f.source_id === SOURCE_ID)?.fetched_at ??
        null)
      : null;
    if (rows.length === 0) return [];
    // rows are DESC from the source; sort to find min/max
    const enplRows = rows
      .filter((r) => r.metric === "enplanements" && r.airport_code === "RSW")
      .sort((a, b) => (a.report_month > b.report_month ? -1 : 1));
    const latest = enplRows[0] ?? null;
    const earliest = enplRows[enplRows.length - 1] ?? null;
    return [
      {
        topic: "rsw_airport_enplanements",
        fact: `RSW monthly enplanements — ${rows.length} rows loaded (${earliest?.report_month ?? "?"} to ${latest?.report_month ?? "?"})`,
        value: latest
          ? `Latest: ${latest.period_label} — ${(latest.value ?? 0).toLocaleString("en-US")} enplaned passengers` +
            (latest.yoy_pct_change != null
              ? ` (${latest.yoy_pct_change >= 0 ? "+" : ""}${latest.yoy_pct_change.toFixed(1)}% YoY)`
              : "")
          : "No enplanement data",
        source_fragment_ids: [],
      },
    ];
  },

  outputProducer: rswAirportOutputProducer,

  preferences: [
    "The user tracks SWFL aviation demand as a leading indicator for hospitality, retail, and real estate decisions in Lee and Collier counties.",
    "RSW monthly enplanements and YoY trends are the primary signal; trailing 12-month totals smooth seasonal noise.",
    "The user expects citations directly to the Lee County Port Authority source, not to intermediate databases.",
  ],

  activeProject:
    "rsw-airport: SWFL aviation demand pulse — monthly RSW enplanements from LCPA PDF, YoY change, and trailing 12-month total.",

  prompts: {
    triageContext:
      "These fragments are RSW monthly enplanement rows from the rsw_airport_monthly table (Lee County Port Authority). All are decision-relevant by construction; the pack is pure deterministic aggregation.",
    synthesisContext:
      "This pack runs no synthesis agent (skipSynthesisAgent). Every fact is produced deterministically by the corpusSummary and outputProducer functions.",
  },
};
