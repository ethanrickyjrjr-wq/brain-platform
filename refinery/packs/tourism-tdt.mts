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
  tourismTdtSource,
  type TourismTdtNormalized,
} from "../sources/tourism-tdt-source.mts";
import { env } from "../config/env.mts";

/**
 * tourism-tdt — SWFL (Lee + Collier) hospitality pulse from Tourist
 * Development Tax collections (Florida DOR Form 3, monthly).
 *
 * Branches: fl_dor_tdt_collections, self-ingested via
 * ingest/pipelines/fl_dor_tdt (cron 20th of month).
 *
 * Leaf brain (no upstream brains). Pure deterministic pack — every fact is
 * computed in code from typed fragments. Direction vote uses SWFL combined
 * (Lee + Collier summed) YoY and post-Ian recovery ratio.
 *
 * Key metrics:
 *   5 SWFL-combined (backward-compat slugs preserved):
 *     latest_monthly_collections_usd, yoy_delta_pct,
 *     trailing_12mo_collections_usd, post_ian_recovery_ratio,
 *     seasonal_position_vs_history
 *   4 per-county (additive):
 *     lee_latest_monthly_collections_usd, lee_trailing_12mo_collections_usd,
 *     collier_latest_monthly_collections_usd, collier_trailing_12mo_collections_usd
 */

// ---------------------------------------------------------------------
// Closure state — populated by corpusSummary, read by outputProducer.
// ---------------------------------------------------------------------
let lastSnapshot: TdtSnapshot | null = null;
let lastFetchedAt: string | null = null;

/** One SWFL combined period: Lee + Collier collections summed for that month. */
export interface SwflPeriod {
  period_yyyymm: string;
  combined_usd: number;
  post_ian: boolean;
  fiscal_year: number | null;
  source_url: string;
  /** How many counties contributed to combined_usd for this period. */
  county_count: number;
}

export interface TdtSnapshot {
  /** All valid rows (both counties, non-null period + value). */
  rows: TourismTdtNormalized[];
  /** Lee + Collier summed per period, sorted ascending. */
  swflPeriods: SwflPeriod[];
  /** Most recent SWFL combined period. null = no usable data. */
  latest: SwflPeriod | null;
  /**
   * Same-calendar-month prior-year SWFL period with combined_usd > 0.
   * 0-value guard: a $0 prior year is excluded — it means Lee data was absent
   * (Lee self-administers; FL DOR may publish $0 for Lee) rather than a real
   * collapse. Excluding it avoids a nonsensical +∞% YoY read.
   */
  priorYear: SwflPeriod | null;
  /** Sum of the last 12 SWFL combined periods (including any $0 months). */
  trailing12moUsd: number | null;
  /** Best 12-month SWFL combined window over the pre-Ian era (combined_usd > 0). */
  preIanBaseline12moUsd: number | null;
  /** Mean SWFL combined for the same calendar month across all non-zero years. */
  sameMonthHistoricalMeanUsd: number | null;
  // Per-county snapshots
  leeLatestUsd: number | null;
  leeTrailing12moUsd: number | null;
  collierLatestUsd: number | null;
  collierTrailing12moUsd: number | null;
}

function tdtRowsFrom(fragments: RawFragment[]): TourismTdtNormalized[] {
  return fragments
    .map((f) => f.normalized as unknown as TourismTdtNormalized)
    .filter((n) => n?.kind === "tdt-collection")
    .filter(
      (n) => n.period_yyyymm.length === 7 && n.gross_collections_usd !== null,
    );
}

function byPeriodAsc(a: TourismTdtNormalized, b: TourismTdtNormalized): number {
  return a.period_yyyymm.localeCompare(b.period_yyyymm);
}

function monthOf(yyyymm: string): number {
  return parseInt(yyyymm.slice(5, 7), 10);
}

function yearOf(yyyymm: string): number {
  return parseInt(yyyymm.slice(0, 4), 10);
}

function shiftYears(yyyymm: string, deltaYears: number): string {
  const y = yearOf(yyyymm) + deltaYears;
  const m = yyyymm.slice(5, 7);
  return `${y}-${m}`;
}

export function buildSnapshot(rows: TourismTdtNormalized[]): TdtSnapshot {
  const empty: TdtSnapshot = {
    rows,
    swflPeriods: [],
    latest: null,
    priorYear: null,
    trailing12moUsd: null,
    preIanBaseline12moUsd: null,
    sameMonthHistoricalMeanUsd: null,
    leeLatestUsd: null,
    leeTrailing12moUsd: null,
    collierLatestUsd: null,
    collierTrailing12moUsd: null,
  };
  if (rows.length === 0) return empty;

  // --- Build SWFL combined series ---
  const periodMap = new Map<string, SwflPeriod>();
  for (const row of rows) {
    const key = row.period_yyyymm;
    const usd = row.gross_collections_usd ?? 0;
    const existing = periodMap.get(key);
    if (existing) {
      existing.combined_usd += usd;
      existing.county_count += 1;
    } else {
      periodMap.set(key, {
        period_yyyymm: key,
        combined_usd: usd,
        post_ian: row.post_ian,
        fiscal_year: row.fiscal_year,
        source_url: row.source_url,
        county_count: 1,
      });
    }
  }

  const swflPeriods = Array.from(periodMap.values()).sort((a, b) =>
    a.period_yyyymm.localeCompare(b.period_yyyymm),
  );

  if (swflPeriods.length === 0) return { ...empty, rows };

  const latest = swflPeriods[swflPeriods.length - 1];

  // priorYear: same calendar month, same county_count as latest, non-zero.
  // County count guard: if latest is Lee-only (1 county) because Collier is
  // lagged, comparing against a Lee+Collier prior-year combined would produce
  // a nonsensical -40%+ YoY. Only compare like-for-like county sets.
  const priorYearKey = shiftYears(latest.period_yyyymm, -1);
  const priorYear =
    swflPeriods.find(
      (p) =>
        p.period_yyyymm === priorYearKey &&
        p.combined_usd > 0 &&
        p.county_count === latest.county_count,
    ) ?? null;

  // trailing 12mo: sum of last ≤12 combined periods (includes $0 months)
  const trailingSlice = swflPeriods.slice(-12);
  const trailing12moUsd = trailingSlice.reduce((s, p) => s + p.combined_usd, 0);

  // pre-Ian baseline: best 12-month window from non-zero pre-Ian combined periods
  const preIanNonZero = swflPeriods.filter(
    (p) => !p.post_ian && p.combined_usd > 0,
  );
  let preIanBaseline12moUsd: number | null = null;
  if (preIanNonZero.length >= 12) {
    let maxWindow = 0;
    for (let i = 0; i + 12 <= preIanNonZero.length; i++) {
      const sum = preIanNonZero
        .slice(i, i + 12)
        .reduce((s, p) => s + p.combined_usd, 0);
      if (sum > maxWindow) maxWindow = sum;
    }
    preIanBaseline12moUsd = maxWindow;
  }

  // same-month mean across non-zero combined periods
  const latestMonth = monthOf(latest.period_yyyymm);
  const sameMonthNonZero = swflPeriods.filter(
    (p) => monthOf(p.period_yyyymm) === latestMonth && p.combined_usd > 0,
  );
  const sameMonthHistoricalMeanUsd =
    sameMonthNonZero.length === 0
      ? null
      : sameMonthNonZero.reduce((s, p) => s + p.combined_usd, 0) /
        sameMonthNonZero.length;

  // --- Per-county ---
  const leeRows = rows
    .filter((r) => r.county.toLowerCase() === "lee")
    .sort(byPeriodAsc);
  const collierRows = rows
    .filter((r) => r.county.toLowerCase() === "collier")
    .sort(byPeriodAsc);

  const leeLatest = leeRows.length > 0 ? leeRows[leeRows.length - 1] : null;
  const collierLatest =
    collierRows.length > 0 ? collierRows[collierRows.length - 1] : null;

  const leeTrailing = leeRows.slice(-12);
  const collierTrailing = collierRows.slice(-12);

  const leeTrailing12moUsd =
    leeTrailing.length > 0
      ? leeTrailing.reduce((s, r) => s + (r.gross_collections_usd ?? 0), 0)
      : null;
  const collierTrailing12moUsd =
    collierTrailing.length > 0
      ? collierTrailing.reduce((s, r) => s + (r.gross_collections_usd ?? 0), 0)
      : null;

  return {
    rows,
    swflPeriods,
    latest,
    priorYear,
    trailing12moUsd,
    preIanBaseline12moUsd,
    sameMonthHistoricalMeanUsd,
    leeLatestUsd: leeLatest?.gross_collections_usd ?? null,
    leeTrailing12moUsd,
    collierLatestUsd: collierLatest?.gross_collections_usd ?? null,
    collierTrailing12moUsd,
  };
}

// ---------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------

function fmtUsdMillions(n: number): string {
  return `$${(n / 1_000_000).toFixed(2)}M`;
}

function fmtPct(n: number): string {
  const rounded = Math.round(n * 10) / 10;
  return `${rounded > 0 ? "+" : ""}${rounded}%`;
}

function seasonLabel(monthIndex: number): "peak" | "shoulder" | "trough" {
  // SWFL hospitality pattern: Jan-Mar peak, Jun-Sep trough, rest shoulder.
  if (monthIndex >= 1 && monthIndex <= 3) return "peak";
  if (monthIndex >= 6 && monthIndex <= 9) return "trough";
  return "shoulder";
}

/**
 * Direction vote on SWFL combined. YoY uses combined_usd (not per-county).
 * 0-value guard: if priorYear.combined_usd is 0 the vote already excluded
 * it (priorYear is null), so yoyPct falls through as null → neutral signal.
 */
export function voteTdtDirection(snapshot: TdtSnapshot): {
  direction: BrainOutputDirection;
  magnitude: number;
  yoyPct: number | null;
  recoveryRatio: number | null;
} {
  const latest = snapshot.latest;
  if (!latest) {
    return {
      direction: "neutral",
      magnitude: 0,
      yoyPct: null,
      recoveryRatio: null,
    };
  }

  const priorUsd = snapshot.priorYear?.combined_usd ?? null;
  // 0-value guard already enforced by priorYear selection (> 0 required).
  const yoyPct =
    priorUsd !== null && priorUsd > 0
      ? ((latest.combined_usd - priorUsd) / priorUsd) * 100
      : null;

  const recoveryRatio =
    snapshot.trailing12moUsd !== null &&
    snapshot.preIanBaseline12moUsd !== null &&
    snapshot.preIanBaseline12moUsd > 0
      ? snapshot.trailing12moUsd / snapshot.preIanBaseline12moUsd
      : null;

  const yoyBullish = yoyPct !== null && yoyPct > 5;
  const yoyBearish = yoyPct !== null && yoyPct < -5;
  const recoveryBullish = recoveryRatio !== null && recoveryRatio >= 0.9;
  const recoveryBearish = recoveryRatio !== null && recoveryRatio < 0.7;

  if ((yoyBullish && recoveryBearish) || (yoyBearish && recoveryBullish)) {
    return { direction: "mixed", magnitude: 0.5, yoyPct, recoveryRatio };
  }
  if (yoyBullish && recoveryBullish) {
    return { direction: "bullish", magnitude: 0.8, yoyPct, recoveryRatio };
  }
  if (yoyBearish || recoveryBearish) {
    return { direction: "bearish", magnitude: 0.7, yoyPct, recoveryRatio };
  }
  if (yoyBullish || recoveryBullish) {
    return { direction: "bullish", magnitude: 0.55, yoyPct, recoveryRatio };
  }
  return { direction: "neutral", magnitude: 0.4, yoyPct, recoveryRatio };
}

// ---------------------------------------------------------------------
// Metric key constants
// ---------------------------------------------------------------------

// SWFL combined — backward-compat slugs unchanged
const METRIC_LATEST = "latest_monthly_collections_usd";
const METRIC_YOY = "yoy_delta_pct";
const METRIC_TRAILING_12MO = "trailing_12mo_collections_usd";
const METRIC_RECOVERY = "post_ian_recovery_ratio";
const METRIC_SEASONAL = "seasonal_position_vs_history";
// Per-county additive metrics
const METRIC_LEE_LATEST = "lee_latest_monthly_collections_usd";
const METRIC_LEE_TRAILING_12MO = "lee_trailing_12mo_collections_usd";
const METRIC_COLLIER_LATEST = "collier_latest_monthly_collections_usd";
const METRIC_COLLIER_TRAILING_12MO = "collier_trailing_12mo_collections_usd";

// ---------------------------------------------------------------------
// Stage 3 — deterministic corpus facts.
// ---------------------------------------------------------------------

function tourismTdtCorpusSummary(allFragments: RawFragment[]): SynthesisFact[] {
  const rows = tdtRowsFrom(allFragments);
  const snapshot = buildSnapshot(rows);
  lastSnapshot = snapshot;
  const sourceFragment = allFragments.find(
    (f) =>
      (f.normalized as unknown as TourismTdtNormalized)?.kind ===
      "tdt-collection",
  );
  lastFetchedAt = sourceFragment?.fetched_at ?? null;

  if (!snapshot.latest) return [];

  const facts: SynthesisFact[] = [];
  const latest = snapshot.latest;
  const latestUsd = latest.combined_usd;
  const vote = voteTdtDirection(snapshot);
  const season = seasonLabel(monthOf(latest.period_yyyymm));

  // f001 — SWFL overview snapshot
  facts.push({
    topic: "tdt_snapshot",
    fact: `SWFL TDT pulse — latest month ${latest.period_yyyymm} (${season})`,
    value:
      `SWFL Tourist Development Tax (Lee + Collier combined) — latest reported month ` +
      `${latest.period_yyyymm} (${season} season) at ${fmtUsdMillions(latestUsd)}. ` +
      (vote.yoyPct !== null
        ? `Year-over-year: ${fmtPct(vote.yoyPct)} vs same month prior year. `
        : `No same-month prior-year comparable in the loaded window. `) +
      (snapshot.trailing12moUsd !== null
        ? `Trailing 12 months: ${fmtUsdMillions(snapshot.trailing12moUsd)}. `
        : "") +
      (vote.recoveryRatio !== null
        ? `Trailing window stands at ${(vote.recoveryRatio * 100).toFixed(0)}% of the strongest pre-Ian 12-month run.`
        : "Pre-Ian baseline not computable from the loaded window."),
    source_fragment_ids: [],
  });

  // f002 — latest monthly combined
  facts.push({
    topic: `metric:${METRIC_LATEST}`,
    fact: `Latest monthly TDT collections (SWFL combined, ${latest.period_yyyymm})`,
    value:
      `SWFL TDT collections for ${latest.period_yyyymm}: ${fmtUsdMillions(latestUsd)} ` +
      `(Lee + Collier combined, fiscal_year ${latest.fiscal_year ?? "?"}, ${season} season).`,
    source_fragment_ids: [],
  });

  // f003 — YoY delta (SWFL combined)
  if (vote.yoyPct !== null && snapshot.priorYear) {
    facts.push({
      topic: `metric:${METRIC_YOY}`,
      fact: `SWFL combined same-month year-over-year delta`,
      value:
        `Year-over-year delta for ${latest.period_yyyymm} vs ${snapshot.priorYear.period_yyyymm}: ` +
        `${fmtPct(vote.yoyPct)} ` +
        `(${fmtUsdMillions(latestUsd)} vs ${fmtUsdMillions(snapshot.priorYear.combined_usd)}).`,
      source_fragment_ids: [],
    });
  }

  // f004 — trailing 12mo total (SWFL combined)
  if (snapshot.trailing12moUsd !== null) {
    facts.push({
      topic: `metric:${METRIC_TRAILING_12MO}`,
      fact: `Trailing 12 months of SWFL combined TDT collections`,
      value:
        `Trailing 12 months of SWFL TDT collections through ${latest.period_yyyymm}: ` +
        `${fmtUsdMillions(snapshot.trailing12moUsd)}.`,
      source_fragment_ids: [],
    });
  }

  // f005 — post-Ian recovery ratio (SWFL combined)
  if (vote.recoveryRatio !== null && snapshot.preIanBaseline12moUsd !== null) {
    facts.push({
      topic: `metric:${METRIC_RECOVERY}`,
      fact: `Post-Hurricane-Ian SWFL recovery ratio`,
      value:
        `Post-Ian recovery ratio (SWFL trailing 12mo / best pre-Ian 12mo): ` +
        `${(vote.recoveryRatio * 100).toFixed(0)}% ` +
        `(${fmtUsdMillions(snapshot.trailing12moUsd ?? 0)} vs ` +
        `${fmtUsdMillions(snapshot.preIanBaseline12moUsd)}). ` +
        `Ian landfall 2022-09-28; FY2023 onward treated as post-Ian window.`,
      source_fragment_ids: [],
    });
  }

  // f006 — seasonal position (SWFL combined)
  if (snapshot.sameMonthHistoricalMeanUsd !== null) {
    const seasonalPosition = latestUsd / snapshot.sameMonthHistoricalMeanUsd;
    facts.push({
      topic: `metric:${METRIC_SEASONAL}`,
      fact: `SWFL seasonal position vs same-month historical mean`,
      value:
        `Latest month is ${(seasonalPosition * 100).toFixed(0)}% of the SWFL historical mean ` +
        `for the same calendar month across ` +
        `${snapshot.swflPeriods.filter((p) => monthOf(p.period_yyyymm) === monthOf(latest.period_yyyymm) && p.combined_usd > 0).length} ` +
        `observed years (${fmtUsdMillions(latestUsd)} vs ` +
        `${fmtUsdMillions(snapshot.sameMonthHistoricalMeanUsd)} mean).`,
      source_fragment_ids: [],
    });
  }

  // f007 — Lee latest
  if (snapshot.leeLatestUsd !== null) {
    facts.push({
      topic: `metric:${METRIC_LEE_LATEST}`,
      fact: `Lee County latest monthly TDT collections`,
      value: `Lee County TDT for ${latest.period_yyyymm}: ${fmtUsdMillions(snapshot.leeLatestUsd)}.`,
      source_fragment_ids: [],
    });
  }

  // f008 — Lee trailing 12mo
  if (snapshot.leeTrailing12moUsd !== null) {
    facts.push({
      topic: `metric:${METRIC_LEE_TRAILING_12MO}`,
      fact: `Lee County trailing 12-month TDT collections`,
      value: `Lee County TDT trailing 12 months through ${latest.period_yyyymm}: ${fmtUsdMillions(snapshot.leeTrailing12moUsd)}.`,
      source_fragment_ids: [],
    });
  }

  // f009 — Collier latest
  if (snapshot.collierLatestUsd !== null) {
    facts.push({
      topic: `metric:${METRIC_COLLIER_LATEST}`,
      fact: `Collier County latest monthly TDT collections`,
      value: `Collier County TDT for ${latest.period_yyyymm}: ${fmtUsdMillions(snapshot.collierLatestUsd)}.`,
      source_fragment_ids: [],
    });
  }

  // f010 — Collier trailing 12mo
  if (snapshot.collierTrailing12moUsd !== null) {
    facts.push({
      topic: `metric:${METRIC_COLLIER_TRAILING_12MO}`,
      fact: `Collier County trailing 12-month TDT collections`,
      value: `Collier County TDT trailing 12 months through ${latest.period_yyyymm}: ${fmtUsdMillions(snapshot.collierTrailing12moUsd)}.`,
      source_fragment_ids: [],
    });
  }

  return facts;
}

// ---------------------------------------------------------------------
// Stage 4 — BrainOutput producer.
// ---------------------------------------------------------------------

type TdtMetricKind =
  | "latest"
  | "yoy"
  | "trailing_12mo"
  | "post_ian_recovery"
  | "seasonal_position"
  | "lee_latest"
  | "lee_trailing_12mo"
  | "collier_latest"
  | "collier_trailing_12mo";

function buildTdtSource(
  metricKind: TdtMetricKind,
  snapshot: TdtSnapshot,
  fetched_at: string,
  source_url: string,
): BrainOutputMetricSource {
  const latest = snapshot.latest;
  const priorYear = snapshot.priorYear;
  const trailing = snapshot.swflPeriods.slice(-12);
  const trailingSpan =
    trailing.length === 0
      ? "no trailing rows"
      : trailing.length === 1
        ? trailing[0].period_yyyymm
        : `${trailing[0].period_yyyymm} → ${trailing[trailing.length - 1].period_yyyymm} (${trailing.length} months)`;
  const sameMonthCount = latest
    ? snapshot.swflPeriods.filter(
        (p) =>
          monthOf(p.period_yyyymm) === monthOf(latest.period_yyyymm) &&
          p.combined_usd > 0,
      ).length
    : 0;
  const base =
    `Florida DOR Tourist Development Tax — SWFL (Lee + Collier) via Brains Supabase fl_dor_tdt_collections ` +
    `(${snapshot.rows.length} rows: ${snapshot.swflPeriods[0]?.period_yyyymm ?? "?"} → ${snapshot.swflPeriods[snapshot.swflPeriods.length - 1]?.period_yyyymm ?? "?"}); ` +
    `source: Florida Department of Revenue Form 3 XLSX (monthly, ~6-week lag)`;

  let detail = "";
  switch (metricKind) {
    case "latest":
      detail = latest
        ? ` — SWFL combined ${latest.period_yyyymm} = $${latest.combined_usd.toFixed(2)} (FY ${latest.fiscal_year ?? "?"}, post_ian=${latest.post_ian})`
        : "";
      break;
    case "yoy":
      detail =
        latest && priorYear
          ? ` — comparing ${latest.period_yyyymm} ($${latest.combined_usd.toFixed(2)}) against ${priorYear.period_yyyymm} ($${priorYear.combined_usd.toFixed(2)})`
          : "";
      break;
    case "trailing_12mo":
      detail = ` — SWFL combined sum, trailing 12-month window: ${trailingSpan}`;
      break;
    case "post_ian_recovery":
      detail =
        snapshot.preIanBaseline12moUsd !== null
          ? ` — SWFL trailing 12-month total (${trailingSpan}) ÷ best pre-Ian 12-month window ($${snapshot.preIanBaseline12moUsd.toFixed(2)}; Ian landfall 2022-09-28)`
          : "";
      break;
    case "seasonal_position":
      detail = latest
        ? ` — SWFL ${latest.period_yyyymm} ($${latest.combined_usd.toFixed(2)}) vs same-calendar-month mean across ${sameMonthCount} non-zero years`
        : "";
      break;
    case "lee_latest": {
      detail =
        snapshot.leeLatestUsd !== null
          ? ` — Lee County ${latest?.period_yyyymm ?? "?"} = $${snapshot.leeLatestUsd.toFixed(2)}`
          : "";
      break;
    }
    case "lee_trailing_12mo": {
      const leeRows = snapshot.rows
        .filter((r) => r.county.toLowerCase() === "lee")
        .sort((a, b) => a.period_yyyymm.localeCompare(b.period_yyyymm))
        .slice(-12);
      const leeSpan =
        leeRows.length === 0
          ? "no Lee rows"
          : `${leeRows[0].period_yyyymm} → ${leeRows[leeRows.length - 1].period_yyyymm} (${leeRows.length} months)`;
      detail = ` — Lee County trailing 12 months: ${leeSpan}`;
      break;
    }
    case "collier_latest": {
      detail =
        snapshot.collierLatestUsd !== null
          ? ` — Collier County ${latest?.period_yyyymm ?? "?"} = $${snapshot.collierLatestUsd.toFixed(2)}`
          : "";
      break;
    }
    case "collier_trailing_12mo": {
      const collierRows = snapshot.rows
        .filter((r) => r.county.toLowerCase() === "collier")
        .sort((a, b) => a.period_yyyymm.localeCompare(b.period_yyyymm))
        .slice(-12);
      const collierSpan =
        collierRows.length === 0
          ? "no Collier rows"
          : `${collierRows[0].period_yyyymm} → ${collierRows[collierRows.length - 1].period_yyyymm} (${collierRows.length} months)`;
      detail = ` — Collier County trailing 12 months: ${collierSpan}`;
      break;
    }
  }
  return {
    url: source_url,
    fetched_at,
    tier: 1,
    citation: `${base}${detail}.`,
  };
}

function tourismTdtOutputProducer(_out: PackOutput): BrainOutputProducerResult {
  const snapshot = lastSnapshot;
  if (!snapshot || !snapshot.latest) {
    return {
      conclusion:
        "tourism-tdt: no usable TDT rows in this build window — pack rendered with no metrics.",
      key_metrics: [],
      caveats: [
        "No fl_dor_tdt_collections rows survived normalization. Check REFINERY_SOURCE and the fixture file before treating this output as a real read.",
      ],
      direction: "neutral",
      magnitude: 0,
      drivers: [],
      overrides: [],
      contradicts: [],
      exogenous_signals: [],
    };
  }

  const latest = snapshot.latest;
  const latestUsd = latest.combined_usd;
  const vote = voteTdtDirection(snapshot);
  const season = seasonLabel(monthOf(latest.period_yyyymm));
  const fetched_at =
    lastFetchedAt ?? new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const source_url = latest.source_url;

  const key_metrics: BrainOutputMetric[] = [];

  // ── 5 SWFL combined (backward-compat slugs) ──────────────────────────

  key_metrics.push({
    metric: METRIC_LATEST,
    value: latestUsd,
    direction:
      vote.yoyPct === null
        ? "stable"
        : vote.yoyPct > 0
          ? "rising"
          : vote.yoyPct < 0
            ? "falling"
            : "stable",
    label: `Latest monthly TDT collections (SWFL combined, ${latest.period_yyyymm}, ${season} season)`,
    variable_type: "extensive",
    units: "USD/month",
    display_format: "currency",
    source: buildTdtSource("latest", snapshot, fetched_at, source_url),
  });

  if (vote.yoyPct !== null) {
    key_metrics.push({
      metric: METRIC_YOY,
      value: Math.round(vote.yoyPct * 10) / 10,
      direction:
        vote.yoyPct > 0 ? "rising" : vote.yoyPct < 0 ? "falling" : "stable",
      label: "Year-over-year delta vs same month prior year (SWFL combined)",
      variable_type: "intensive",
      units: "percent",
      display_format: "percent",
      source: buildTdtSource("yoy", snapshot, fetched_at, source_url),
    });
  }

  if (snapshot.trailing12moUsd !== null) {
    key_metrics.push({
      metric: METRIC_TRAILING_12MO,
      value: snapshot.trailing12moUsd,
      direction: "stable",
      label: "Trailing 12-month TDT collections total (SWFL combined)",
      variable_type: "extensive",
      units: "USD",
      display_format: "currency",
      source: buildTdtSource("trailing_12mo", snapshot, fetched_at, source_url),
    });
  }

  if (vote.recoveryRatio !== null) {
    key_metrics.push({
      metric: METRIC_RECOVERY,
      value: Math.round(vote.recoveryRatio * 100) / 100,
      direction:
        vote.recoveryRatio >= 0.95
          ? "rising"
          : vote.recoveryRatio < 0.85
            ? "falling"
            : "stable",
      label:
        "Post-Hurricane-Ian recovery ratio (SWFL trailing 12mo ÷ best pre-Ian 12mo)",
      variable_type: "intensive",
      units: "ratio",
      display_format: "ratio",
      source: buildTdtSource(
        "post_ian_recovery",
        snapshot,
        fetched_at,
        source_url,
      ),
    });
  }

  if (snapshot.sameMonthHistoricalMeanUsd !== null) {
    const seasonalPosition = latestUsd / snapshot.sameMonthHistoricalMeanUsd;
    key_metrics.push({
      metric: METRIC_SEASONAL,
      value: Math.round(seasonalPosition * 100) / 100,
      direction:
        seasonalPosition > 1.05
          ? "rising"
          : seasonalPosition < 0.95
            ? "falling"
            : "stable",
      label: "Seasonal position vs same-month historical mean (SWFL combined)",
      variable_type: "intensive",
      units: "ratio",
      display_format: "ratio",
      source: buildTdtSource(
        "seasonal_position",
        snapshot,
        fetched_at,
        source_url,
      ),
    });
  }

  // ── 4 per-county additive metrics ────────────────────────────────────

  if (snapshot.leeLatestUsd !== null) {
    key_metrics.push({
      metric: METRIC_LEE_LATEST,
      value: snapshot.leeLatestUsd,
      direction: "stable",
      label: `Lee County latest monthly TDT collections (${latest.period_yyyymm})`,
      variable_type: "extensive",
      units: "USD/month",
      display_format: "currency",
      source: buildTdtSource("lee_latest", snapshot, fetched_at, source_url),
    });
  }

  if (snapshot.leeTrailing12moUsd !== null) {
    key_metrics.push({
      metric: METRIC_LEE_TRAILING_12MO,
      value: snapshot.leeTrailing12moUsd,
      direction: "stable",
      label: "Lee County trailing 12-month TDT collections",
      variable_type: "extensive",
      units: "USD",
      display_format: "currency",
      source: buildTdtSource(
        "lee_trailing_12mo",
        snapshot,
        fetched_at,
        source_url,
      ),
    });
  }

  if (snapshot.collierLatestUsd !== null) {
    key_metrics.push({
      metric: METRIC_COLLIER_LATEST,
      value: snapshot.collierLatestUsd,
      direction: "stable",
      label: `Collier County latest monthly TDT collections (${latest.period_yyyymm})`,
      variable_type: "extensive",
      units: "USD/month",
      display_format: "currency",
      source: buildTdtSource(
        "collier_latest",
        snapshot,
        fetched_at,
        source_url,
      ),
    });
  }

  if (snapshot.collierTrailing12moUsd !== null) {
    key_metrics.push({
      metric: METRIC_COLLIER_TRAILING_12MO,
      value: snapshot.collierTrailing12moUsd,
      direction: "stable",
      label: "Collier County trailing 12-month TDT collections",
      variable_type: "extensive",
      units: "USD",
      display_format: "currency",
      source: buildTdtSource(
        "collier_trailing_12mo",
        snapshot,
        fetched_at,
        source_url,
      ),
    });
  }

  // ── Conclusion ──────────────────────────────────────────────────────

  const conclusionParts: string[] = [];
  conclusionParts.push(
    `SWFL TDT collections (Lee + Collier combined) for ${latest.period_yyyymm} (${season} season): ${fmtUsdMillions(latestUsd)}.`,
  );
  if (vote.yoyPct !== null) {
    conclusionParts.push(
      `Year-over-year ${fmtPct(vote.yoyPct)} against same month prior year.`,
    );
  }
  if (vote.recoveryRatio !== null) {
    conclusionParts.push(
      `Trailing 12 months stand at ${(vote.recoveryRatio * 100).toFixed(0)}% of the strongest pre-Hurricane-Ian annual run.`,
    );
  }
  conclusionParts.push(
    `Hospitality / accommodation operators should weight forward decisions against this SWFL seasonal pulse; the cross-vertical read lives downstream in master.`,
  );

  const caveats: string[] = [];
  if (env.source === "fixture") {
    caveats.push(
      "TDT collections in this build are SYNTHETIC fixture data — unset REFINERY_SOURCE or set it to `live` to read the real fl_dor_tdt_collections table.",
    );
  } else {
    caveats.push(
      "Florida DOR Form 3 may revise recent months for ~60 days after first publication — treat the latest month as directional, not final.",
    );
  }
  if (snapshot.leeLatestUsd === null || snapshot.leeLatestUsd === 0) {
    caveats.push(
      "Lee County data may be absent — Lee self-administers TDT and FL DOR may not carry Lee rows. Verify leeclerk.org is the ground truth for Lee-only analysis.",
    );
  }
  if (snapshot.latest && snapshot.latest.county_count < 2) {
    caveats.push(
      `Latest month ${snapshot.latest.period_yyyymm} reflects only ${snapshot.latest.county_count} of 2 expected counties (Collier data lags Lee by ~2 months). YoY comparison is suppressed to avoid apples-to-oranges inflation. Use per-county metrics or trailing_12mo_collections_usd for the cross-county read.`,
    );
  }
  if (vote.recoveryRatio === null) {
    caveats.push(
      "Post-Ian recovery ratio not computable: loaded window lacks ≥12 pre-Ian non-zero months. Surface trailing_12mo_collections_usd instead of a recovery framing.",
    );
  }
  if (season === "trough") {
    caveats.push(
      `Latest month is a trough-season reading (${season}). Do not extrapolate to an annual run rate — weight against trailing_12mo_collections_usd.`,
    );
  }
  if (vote.direction === "mixed") {
    caveats.push(
      "Direction is mixed: YoY momentum and post-Ian recovery point opposite ways. Read the metrics individually before acting on the headline direction.",
    );
  }

  return {
    conclusion: conclusionParts.join(" "),
    key_metrics,
    caveats,
    direction: vote.direction,
    magnitude: vote.magnitude,
    drivers: [],
    overrides: [],
    contradicts: [],
    exogenous_signals: [],
  };
}

export const tourismTdt: PackDefinition = {
  id: "tourism-tdt",
  brain_id: "tourism-tdt",
  public_label: "Tourism & Tourism Tax",
  domain: "hospitality",
  scope:
    "SWFL (Lee + Collier) hospitality pulse — monthly Tourist Development Tax collections from the Florida Department of Revenue Form 3, with seasonal, year-over-year, and post-Hurricane-Ian recovery context for accommodation / food-service operators.",
  ttl_seconds: 604800, // 7 days — DOR publishes monthly
  sources: [tourismTdtSource],
  input_brains: [],
  fitScore: (): number => 8,
  compositeCutoff: 0,
  skipTriageAgent: true,
  skipSynthesisAgent: true,
  corpusSummary: tourismTdtCorpusSummary,
  outputProducer: tourismTdtOutputProducer,
  synthesisStrategy: "deterministic",
  preferences: [
    "The user is an SWFL operator who reads TDT collections as the seasonal pulse for hospitality, accommodation, or food-service decisions in Lee and Collier counties.",
    "The user weights post-Hurricane-Ian recovery against the strongest pre-Ian annual run; a single trough-month read never overrides the trailing 12-month total.",
    "The user expects this brain to surface the SWFL combined direction and per-county breakdowns, then let master synthesize against macro, CRE, and franchise reads downstream.",
  ],
  activeProject:
    "tourism-tdt: standing SWFL hospitality pulse — monthly Lee + Collier TDT collections (FL DOR Form 3), YoY, trailing-12mo, post-Ian recovery, and per-county breakdowns.",
  prompts: {
    triageContext:
      "These fragments are SWFL TDT monthly collection rows (Lee + Collier) from the fl_dor_tdt_collections table. They are all decision-relevant by construction; the pack is pure deterministic aggregation.",
    synthesisContext:
      "This pack runs no synthesis agent (skipSynthesisAgent). Every fact is produced deterministically by tourismTdtCorpusSummary and the BrainOutput is built by tourismTdtOutputProducer.",
  },
};
