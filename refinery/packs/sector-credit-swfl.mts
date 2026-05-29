import type { PackDefinition, PackOutput } from "../types/pack.mts";
import type { RawFragment } from "../types/fragment.mts";
import type { SynthesisFact } from "../types/event.mts";
import type {
  BrainOutput,
  BrainOutputDirection,
  BrainOutputMetric,
  BrainOutputMetricSource,
  BrainOutputProducerResult,
} from "../types/brain-output.mts";
import {
  sectorCreditSwflSource,
  type SectorCreditNormalized,
} from "../sources/sector-credit-swfl-source.mts";
import {
  flDorSalesTaxSource,
  type SalesTaxNormalized,
} from "../sources/fl-dor-sales-tax-source.mts";
import {
  makeBrainInputSource,
  type BrainInputNormalized,
} from "../sources/brain-input-source.mts";
import { env } from "../config/env.mts";

/**
 * sector-credit-swfl — "What sectors should I lend into in SWFL right now?"
 *
 * Branches:
 *   • sba_loans_by_naics_county (T1, SBA federal MV) — every (county, NAICS, FY)
 *     row of SBA 7(a)/504 loan outcomes filtered to Lee & Collier counties.
 *   • fl_dor_sales_tax (T1, FL DOR Form 10) — monthly taxable sales by business
 *     type for Lee & Collier; last 26 months. Adds demand-side pulse metrics.
 *
 * Input brains:
 *   • franchise-outcomes — named survival rates by brand (cross-validation
 *     of the sector aggregates with brand-level signal)
 *   • macro-us — national funding-cost backdrop (SOFR direction, CPI YoY)
 *   • macro-florida — Florida state-level labor (FLUR)
 *
 * The macro-swfl edge was dropped in the 2026-05-17 restructure: macro-swfl
 * is now a pure delta brain that emits no metrics until county-level BLS
 * LAUS lands. Consuming macro-us + macro-florida directly is the honest
 * shape — sofr_rate / cpi_yoy live on the national brain, fl_unemployment
 * on the state brain, and the conclusion-line confidence cites the weaker
 * of the two upstreams.
 *
 * Pure deterministic — every fact is computed in code from typed fragments.
 * `chargeoff_rate_resolved` (charge-offs / resolved loans) is the consistent
 * convention across the lake's finance brains; chargeoff_pct from the live MV
 * is intentionally ignored because it under-states risk on still-active loans.
 */

// ---------------------------------------------------------------------
// Closure state — populated by corpusSummary, read by outputProducer.
// Per-pipeline-run scope only; safe for one build at a time.
// ---------------------------------------------------------------------
interface SectorAggregate {
  naics_2digit: string;
  label: string;
  n_chargeoffs: number;
  n_paid_in_full: number;
  n_loans_total: number;
  resolved: number;
  rate_resolved: number;
  total_approved: number;
  sample_brands: number;
}
let lastSectors: SectorAggregate[] = [];
let lastFranchiseOutput: BrainOutput | null = null;
let lastMacroUsOutput: BrainOutput | null = null;
let lastMacroFloridaOutput: BrainOutput | null = null;
let lastFetchedAt: string | null = null;
let lastSinceFy: number | null = null;

/** SWFL combined (Lee + Collier) taxable sales for one month. */
interface SwflSalesPeriod {
  period_yyyymm: string;
  swfl_total_usd: number;
  source_url: string;
}

interface SalesTaxSnapshot {
  /** All SWFL combined periods, ascending. */
  swflPeriods: SwflSalesPeriod[];
  latest: SwflSalesPeriod | null;
  /** Same calendar month 12 months prior — for YoY comparison. */
  priorYear: SwflSalesPeriod | null;
  trailing12moUsd: number | null;
}

let lastSalesTaxSnapshot: SalesTaxSnapshot | null = null;

/**
 * Build the per-metric receipt for a sector-credit metric. URL is the live
 * Brains Supabase PostgREST query the source ran (county + FY filter +
 * optional naics_code prefix when narrowing to a single 2-digit sector).
 * Citation names the contributing sector, resolved-loan denominator, FY
 * span, and underlying federal source so the receipt is self-contained.
 */
function buildSectorSource(
  scope:
    | { kind: "swfl_all" }
    | { kind: "sector"; naics_2digit: string; label: string },
  sector: SectorAggregate | null,
  fetched_at: string,
  since_fy: number,
): BrainOutputMetricSource {
  const fyClause = `&approval_fy=gte.${since_fy}`;
  const countyClause = "&project_county=in.(LEE,COLLIER)";
  const naicsClause =
    scope.kind === "sector" ? `&naics_code=like.${scope.naics_2digit}%25` : "";
  const url =
    env.source === "live" && env.supabaseUrl
      ? `${env.supabaseUrl}/rest/v1/sba_loans_by_naics_county?select=*${countyClause}${fyClause}${naicsClause}`
      : `fixture://refinery/__fixtures__/sector-credit-swfl.sample.json${
          scope.kind === "sector" ? `#naics_2digit=${scope.naics_2digit}` : ""
        }`;
  const fySpan = `FY ${since_fy}+`;
  const sectorDetail =
    sector !== null
      ? ` — ${sector.label} (NAICS ${sector.naics_2digit}): ${sector.n_chargeoffs} charged off of ${sector.resolved} resolved loans (${sector.n_loans_total} total approved across ${sector.sample_brands} sub-industries; $${(sector.total_approved / 1_000_000).toFixed(1)}M gross approved capital)`
      : "";
  const citation =
    `SBA 7(a)/504 loan outcomes via Brains Supabase sba_loans_by_naics_county MV ` +
    `(Lee + Collier counties, ${fySpan}); federal source: Small Business Administration loan-status reporting${sectorDetail}.`;
  return {
    url,
    fetched_at,
    tier: 1,
    citation,
  };
}

/** 2-digit NAICS → human-readable major sector label. */
const NAICS_2DIGIT_LABEL: Record<string, string> = {
  "11": "Agriculture, Forestry, Fishing",
  "21": "Mining, Quarrying, Oil & Gas",
  "22": "Utilities",
  "23": "Construction",
  "31": "Manufacturing",
  "32": "Manufacturing",
  "33": "Manufacturing",
  "42": "Wholesale Trade",
  "44": "Retail Trade",
  "45": "Retail Trade",
  "48": "Transportation & Warehousing",
  "49": "Transportation & Warehousing",
  "51": "Information",
  "52": "Finance & Insurance",
  "53": "Real Estate, Rental & Leasing",
  "54": "Professional, Scientific & Technical Services",
  "55": "Management of Companies",
  "56": "Administrative & Support Services",
  "61": "Educational Services",
  "62": "Health Care & Social Assistance",
  "71": "Arts, Entertainment & Recreation",
  "72": "Accommodation & Food Services",
  "81": "Other Services (Personal & Repair)",
};

function sectorLabel(twoDigit: string): string {
  return NAICS_2DIGIT_LABEL[twoDigit] ?? `NAICS ${twoDigit}`;
}

/** Minimum resolved-loan sample for a sector to be ranked. Below this it's
 * directional only, not actionable for lending recommendation. */
const RANKING_MIN_RESOLVED = 5;

function rowsFrom(fragments: RawFragment[]): SectorCreditNormalized[] {
  return fragments
    .map((f) => f.normalized as unknown as SectorCreditNormalized)
    .filter((n) => n?.kind === "sector-credit-row");
}

function brainInputFrom(
  fragments: RawFragment[],
  upstreamId: string,
): BrainOutput | null {
  for (const f of fragments) {
    const n = f.normalized as unknown as BrainInputNormalized;
    if (n?.kind === "brain-input" && n.upstream_id === upstreamId) {
      return n.output;
    }
  }
  return null;
}

const pct = (n: number): string =>
  Number.isFinite(n) ? (Math.round(n * 10) / 10).toString() : "n/a";
const usdM = (n: number): string => `$${(n / 1_000_000).toFixed(1)}M`;

function aggregateBySector(rows: SectorCreditNormalized[]): SectorAggregate[] {
  const byPrefix = new Map<
    string,
    {
      n_chargeoffs: number;
      n_paid_in_full: number;
      n_loans_total: number;
      total_approved: number;
      naics_codes: Set<string>;
    }
  >();
  for (const r of rows) {
    const cur = byPrefix.get(r.naics_2digit) ?? {
      n_chargeoffs: 0,
      n_paid_in_full: 0,
      n_loans_total: 0,
      total_approved: 0,
      naics_codes: new Set<string>(),
    };
    cur.n_chargeoffs += r.n_chargeoffs;
    cur.n_paid_in_full += r.n_paid_in_full;
    cur.n_loans_total += r.n_loans;
    cur.total_approved += r.total_approved;
    cur.naics_codes.add(r.naics_code);
    byPrefix.set(r.naics_2digit, cur);
  }
  const sectors: SectorAggregate[] = [];
  for (const [naics_2digit, v] of byPrefix.entries()) {
    const resolved = v.n_chargeoffs + v.n_paid_in_full;
    sectors.push({
      naics_2digit,
      label: sectorLabel(naics_2digit),
      n_chargeoffs: v.n_chargeoffs,
      n_paid_in_full: v.n_paid_in_full,
      n_loans_total: v.n_loans_total,
      resolved,
      rate_resolved: resolved === 0 ? 0 : (v.n_chargeoffs / resolved) * 100,
      total_approved: v.total_approved,
      sample_brands: v.naics_codes.size,
    });
  }
  return sectors;
}

function salesTaxRowsFrom(fragments: RawFragment[]): SalesTaxNormalized[] {
  return fragments
    .map((f) => f.normalized as unknown as SalesTaxNormalized)
    .filter((n) => n?.kind === "sales-tax-row");
}

function buildSalesTaxSnapshot(rows: SalesTaxNormalized[]): SalesTaxSnapshot {
  // Sum all kind_codes per (county, period), then combine Lee + Collier per period.
  const byPeriod = new Map<
    string,
    { lee: number; collier: number; source_url: string }
  >();
  for (const r of rows) {
    if (r.taxable_sales_usd == null) continue;
    const cur = byPeriod.get(r.period_yyyymm) ?? {
      lee: 0,
      collier: 0,
      source_url: r.source_url,
    };
    if (r.county === "Lee") cur.lee += r.taxable_sales_usd;
    else cur.collier += r.taxable_sales_usd;
    byPeriod.set(r.period_yyyymm, cur);
  }
  const swflPeriods: SwflSalesPeriod[] = [...byPeriod.entries()]
    .filter(([, v]) => v.lee + v.collier > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([period_yyyymm, v]) => ({
      period_yyyymm,
      swfl_total_usd: v.lee + v.collier,
      source_url: v.source_url,
    }));

  const latest =
    swflPeriods.length > 0 ? swflPeriods[swflPeriods.length - 1] : null;
  const priorYearPeriod = latest
    ? (() => {
        const [yy, mm] = latest.period_yyyymm.split("-");
        return `${Number(yy) - 1}-${mm}`;
      })()
    : null;
  const priorYear = priorYearPeriod
    ? (swflPeriods.find((p) => p.period_yyyymm === priorYearPeriod) ?? null)
    : null;

  const last12 = swflPeriods.slice(-12);
  const trailing12moUsd =
    last12.length === 12
      ? last12.reduce((s, p) => s + p.swfl_total_usd, 0)
      : null;

  return { swflPeriods, latest, priorYear, trailing12moUsd };
}

function sectorCreditCorpusSummary(
  allFragments: RawFragment[],
): SynthesisFact[] {
  const rows = rowsFrom(allFragments);
  const franchise = brainInputFrom(allFragments, "franchise-outcomes");
  const macroUs = brainInputFrom(allFragments, "macro-us");
  const macroFl = brainInputFrom(allFragments, "macro-florida");

  // Stash typed state for outputProducer
  lastSectors = aggregateBySector(rows);
  lastFranchiseOutput = franchise;
  lastMacroUsOutput = macroUs;
  lastMacroFloridaOutput = macroFl;

  // Capture fetched_at + since_fy from the first sector-credit row so the
  // outputProducer can rebuild the exact PostgREST query URL the source ran.
  const firstRow = rows[0];
  const sectorFragment = allFragments.find(
    (f) =>
      (f.normalized as unknown as SectorCreditNormalized)?.kind ===
      "sector-credit-row",
  );
  lastFetchedAt = sectorFragment?.fetched_at ?? null;
  lastSinceFy = firstRow?.since_fy ?? null;

  if (rows.length === 0) return [];

  const sectors = lastSectors;
  const rankable = sectors.filter((s) => s.resolved >= RANKING_MIN_RESOLVED);
  const sortedSafe = [...rankable].sort(
    (a, b) => a.rate_resolved - b.rate_resolved,
  );
  const sortedRisk = [...rankable].sort(
    (a, b) => b.rate_resolved - a.rate_resolved,
  );

  const totalLoans = sectors.reduce((s, x) => s + x.n_loans_total, 0);
  const totalResolved = sectors.reduce((s, x) => s + x.resolved, 0);
  const totalChargeoffs = sectors.reduce((s, x) => s + x.n_chargeoffs, 0);
  const totalApproved = sectors.reduce((s, x) => s + x.total_approved, 0);
  const overallRate =
    totalResolved === 0 ? 0 : (totalChargeoffs / totalResolved) * 100;

  const facts: SynthesisFact[] = [];

  // f001 — corpus overview
  facts.push({
    topic: "corpus_overview",
    fact: "SBA loan corpus — every 2-digit NAICS sector with Lee & Collier county loan activity",
    value:
      `${sectors.length} 2-digit NAICS sectors represented across Lee & Collier counties. ` +
      `${totalLoans} total SBA loans, ${totalResolved} resolved (${totalChargeoffs} charged off, ${totalResolved - totalChargeoffs} paid in full), ` +
      `${usdM(totalApproved)} in gross approved capital. ` +
      `Overall resolved-loan charge-off rate across all sectors: ${pct(overallRate)}%. ` +
      `Charge-off rates throughout this brain use the resolved-loan denominator (n_chargeoffs / (n_chargeoffs + n_paid_in_full)) — never total loans — to keep them comparable with the franchise-outcomes brain.`,
    source_fragment_ids: [],
  });

  // f002 — safest sectors (lowest resolved charge-off rate, ranked)
  if (sortedSafe.length > 0) {
    const top = sortedSafe.slice(0, 3);
    const named = top
      .map(
        (s) =>
          `${s.label} (NAICS ${s.naics_2digit}) — ${pct(s.rate_resolved)}% resolved charge-off rate (${s.n_chargeoffs} of ${s.resolved} resolved loans charged off; ${usdM(s.total_approved)} approved across ${s.sample_brands} sub-industries)`,
      )
      .join("; ");
    facts.push({
      topic: "safest_sectors",
      fact: "Top SWFL sectors by SBA resolved-loan survival rate — sectors with at least 5 resolved loans, ranked",
      value: `Lowest charge-off rates across sectors with material samples (>=${RANKING_MIN_RESOLVED} resolved loans): ${named}.`,
      source_fragment_ids: [],
    });
  }

  // f003 — riskiest sectors
  if (sortedRisk.length > 0) {
    const top = sortedRisk.slice(0, 3);
    const named = top
      .map(
        (s) =>
          `${s.label} (NAICS ${s.naics_2digit}) — ${pct(s.rate_resolved)}% resolved charge-off rate (${s.n_chargeoffs} of ${s.resolved} resolved loans charged off; ${usdM(s.total_approved)} approved across ${s.sample_brands} sub-industries)`,
      )
      .join("; ");
    facts.push({
      topic: "riskiest_sectors",
      fact: "Top SWFL sectors by SBA resolved-loan charge-off rate — highest credit risk",
      value: `Highest charge-off rates across sectors with material samples (>=${RANKING_MIN_RESOLVED} resolved loans): ${named}.`,
      source_fragment_ids: [],
    });
  }

  // f004+ — one per-sector metric fact, tagged with metric: prefix
  for (const s of rankable) {
    facts.push({
      topic: `metric:sector_${s.naics_2digit}_chargeoff_rate`,
      fact: `${s.label} (NAICS ${s.naics_2digit}) resolved charge-off rate`,
      value: `${s.label} — ${pct(s.rate_resolved)}% resolved-loan charge-off rate (${s.n_chargeoffs} charged off out of ${s.resolved} resolved loans; ${s.n_loans_total} total loans approved including still-active; ${usdM(s.total_approved)} gross approved capital).`,
      source_fragment_ids: [],
    });
  }

  // Upstream routing facts — franchise + macro context for the lending pitch
  if (franchise) {
    facts.push({
      topic: "franchise-outcomes :: upstream_routing",
      fact: "Per-brand SBA survival rates from the franchise-outcomes brain",
      value:
        `The franchise-outcomes brain (confidence ${franchise.confidence.toFixed(2)} at ${franchise.refined_at}) carries named per-brand resolved-loan survival rates for every franchise in this lake. ` +
        `Cross-validate any sector-level claim against the named brand outcomes — a sector that looks safe in aggregate can hide a single dominant brand with a charge-off run.`,
      source_fragment_ids: [],
    });
  }

  if (macroUs || macroFl) {
    const sofr = macroUs?.key_metrics.find((m) => m.metric === "sofr_rate");
    const cpi = macroUs?.key_metrics.find((m) => m.metric === "cpi_yoy");
    const flUnemp = macroFl?.key_metrics.find(
      (m) => m.metric === "fl_unemployment",
    );
    const macroLine = [
      sofr ? `SOFR ${pct(Number(sofr.value))}% (${sofr.direction})` : "",
      cpi ? `CPI YoY ${pct(Number(cpi.value))}% (${cpi.direction})` : "",
      flUnemp
        ? `FL unemployment ${pct(Number(flUnemp.value))}% (${flUnemp.direction})`
        : "",
    ]
      .filter(Boolean)
      .join(", ");
    const minConfidence = Math.min(
      macroUs?.confidence ?? 1,
      macroFl?.confidence ?? 1,
    );
    facts.push({
      topic: "macro-chain :: upstream_routing",
      fact: "Current macro funding-cost backdrop from the macro-us + macro-florida brains",
      value:
        `The macro chain (macro-us + macro-florida, weaker upstream confidence ${minConfidence.toFixed(2)}) reports the macro backdrop: ${macroLine}. ` +
        `These rates set the funding-cost lens — a high-charge-off sector at a falling SOFR is a different bet from the same sector at a rising SOFR.`,
      source_fragment_ids: [],
    });
  }

  // Sales-tax demand pulse
  const stRows = salesTaxRowsFrom(allFragments);
  lastSalesTaxSnapshot = buildSalesTaxSnapshot(stRows);
  if (lastSalesTaxSnapshot.latest) {
    const st = lastSalesTaxSnapshot;
    const latestUsdM = usdM(st.latest!.swfl_total_usd);
    const yoyLine = (() => {
      if (!st.priorYear) return "";
      const delta =
        ((st.latest!.swfl_total_usd - st.priorYear.swfl_total_usd) /
          st.priorYear.swfl_total_usd) *
        100;
      return ` YoY ${delta >= 0 ? "+" : ""}${pct(delta)}% vs ${st.priorYear.period_yyyymm}.`;
    })();
    const trailingLine = st.trailing12moUsd
      ? ` Trailing 12-month SWFL taxable sales: ${usdM(st.trailing12moUsd)}.`
      : "";
    facts.push({
      topic: "fl_dor_taxable_sales",
      fact: "SWFL taxable sales demand pulse — FL DOR Form 10, Lee + Collier combined",
      value:
        `Combined Lee + Collier taxable sales in ${st.latest!.period_yyyymm}: ${latestUsdM}.` +
        yoyLine +
        trailingLine +
        " Source: Florida DOR Form 10 (biennial XLSX, cy2425).",
      source_fragment_ids: [],
    });
  }

  return facts;
}

function sectorCreditOutputProducer(
  _out: PackOutput,
): BrainOutputProducerResult {
  const sectors = lastSectors;
  const macroUs = lastMacroUsOutput;
  const macroFl = lastMacroFloridaOutput;
  const franchise = lastFranchiseOutput;
  const fetched_at =
    lastFetchedAt ?? new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const since_fy = lastSinceFy ?? new Date().getUTCFullYear() - 6;

  const rankable = sectors.filter((s) => s.resolved >= RANKING_MIN_RESOLVED);
  const sortedSafe = [...rankable].sort(
    (a, b) => a.rate_resolved - b.rate_resolved,
  );
  const sortedRisk = [...rankable].sort(
    (a, b) => b.rate_resolved - a.rate_resolved,
  );

  // Headline metrics for master roll-up — best/worst named NAICS (MANDATORY
  // Week 1, redistributed from franchise-outcomes since NAICS data lives here).
  // `best_naics_survival` = highest survival rate among rankable sectors;
  // `worst_naics_chargeoff` = highest charge-off rate among rankable sectors.
  const headlineMetrics: BrainOutputMetric[] = [];
  if (sortedSafe.length > 0) {
    const best = sortedSafe[0];
    headlineMetrics.push({
      metric: "best_naics_survival",
      value: Math.round((100 - best.rate_resolved) * 10) / 10,
      direction: "stable",
      label: `${best.label} (NAICS ${best.naics_2digit}) — best SWFL SBA survival rate`,
      variable_type: "intensive",
      units: "percent",
      display_format: "percent",
      source: buildSectorSource(
        { kind: "sector", naics_2digit: best.naics_2digit, label: best.label },
        best,
        fetched_at,
        since_fy,
      ),
    });
  }
  if (sortedRisk.length > 0) {
    const worst = sortedRisk[0];
    headlineMetrics.push({
      metric: "worst_naics_chargeoff",
      value: Math.round(worst.rate_resolved * 10) / 10,
      direction: "stable",
      label: `${worst.label} (NAICS ${worst.naics_2digit}) — worst SWFL SBA charge-off rate`,
      variable_type: "intensive",
      units: "percent",
      display_format: "percent",
      source: buildSectorSource(
        {
          kind: "sector",
          naics_2digit: worst.naics_2digit,
          label: worst.label,
        },
        worst,
        fetched_at,
        since_fy,
      ),
    });
  }

  // Per-sector metrics: charge-off rate as the value, direction is the
  // directional flag a future YoY comparison would set; for now mark
  // "stable" since this is a point-in-time snapshot.
  const sectorMetrics: BrainOutputMetric[] = rankable
    .sort((a, b) => a.rate_resolved - b.rate_resolved)
    .map(
      (s): BrainOutputMetric => ({
        metric: `sector_${s.naics_2digit}_chargeoff_rate`,
        value: Math.round(s.rate_resolved * 10) / 10,
        direction: "stable",
        label: `${s.label} (NAICS ${s.naics_2digit})`,
        variable_type: "intensive",
        units: "percent",
        display_format: "percent",
        source: buildSectorSource(
          { kind: "sector", naics_2digit: s.naics_2digit, label: s.label },
          s,
          fetched_at,
          since_fy,
        ),
      }),
    );

  const conclusionParts: string[] = [];
  if (sortedSafe.length > 0) {
    const safe3 = sortedSafe
      .slice(0, 3)
      .map((s) => `${s.label} (${pct(s.rate_resolved)}%)`)
      .join(", ");
    conclusionParts.push(
      `For SWFL lenders, the three lowest-risk 2-digit NAICS sectors by SBA resolved-loan charge-off rate are: ${safe3}.`,
    );
  }
  if (sortedRisk.length > 0) {
    const risk3 = sortedRisk
      .slice(0, 3)
      .map((s) => `${s.label} (${pct(s.rate_resolved)}%)`)
      .join(", ");
    conclusionParts.push(
      `The three highest-risk sectors are: ${risk3} — meaningful sample size in each case.`,
    );
  }
  if (macroUs) {
    const sofr = macroUs.key_metrics.find((m) => m.metric === "sofr_rate");
    if (sofr) {
      conclusionParts.push(
        `Read these rates against the current SOFR of ${pct(Number(sofr.value))}% (${sofr.direction}) — funding-cost direction sets the appetite for charge-off risk.`,
      );
    }
  }
  if (franchise) {
    conclusionParts.push(
      `Cross-validate any sector-level call against the named brand outcomes in the franchise-outcomes brain before underwriting a specific borrower.`,
    );
  }

  const caveats: string[] = [
    "Charge-off rates use the resolved-loan denominator (n_chargeoffs / (n_chargeoffs + n_paid_in_full)); the materialized view's `chargeoff_pct` is intentionally ignored because it understates risk on still-active loans.",
    `Sectors with fewer than ${RANKING_MIN_RESOLVED} resolved loans are not ranked — small-sample charge-off rates are directional, not actionable.`,
  ];

  // Sales-tax demand metrics — demand-side pulse to complement SBA credit-risk data
  const salesTaxMetrics: BrainOutputMetric[] = [];
  const st = lastSalesTaxSnapshot;
  if (st?.latest) {
    const stSource: BrainOutputMetricSource = {
      url: st.latest.source_url,
      fetched_at,
      tier: 1,
      citation:
        `Florida DOR Form 10 — Taxable Sales by Business Type ` +
        `(Lee + Collier combined, ${st.latest.period_yyyymm}); ` +
        `source: fl_dor_sales_tax table (biennial XLSX cy2425).`,
    };
    salesTaxMetrics.push({
      metric: "swfl_taxable_sales_latest_usd",
      value: Math.round(st.latest.swfl_total_usd),
      direction: (() => {
        if (!st.priorYear) return "stable" as const;
        const delta = st.latest.swfl_total_usd - st.priorYear.swfl_total_usd;
        return delta > 0
          ? ("rising" as const)
          : delta < 0
            ? ("falling" as const)
            : ("stable" as const);
      })(),
      label: `SWFL taxable sales — ${st.latest.period_yyyymm} (Lee + Collier)`,
      variable_type: "extensive",
      units: "usd",
      display_format: "currency",
      source: stSource,
    });
    if (st.priorYear) {
      const yoyPct =
        ((st.latest.swfl_total_usd - st.priorYear.swfl_total_usd) /
          st.priorYear.swfl_total_usd) *
        100;
      salesTaxMetrics.push({
        metric: "swfl_taxable_sales_yoy_pct",
        value: Math.round(yoyPct * 10) / 10,
        direction: yoyPct > 0 ? "rising" : yoyPct < 0 ? "falling" : "stable",
        label: `SWFL taxable sales YoY (${st.latest.period_yyyymm} vs ${st.priorYear.period_yyyymm})`,
        variable_type: "intensive",
        units: "percent",
        display_format: "percent",
        source: stSource,
      });
    }
    if (st.trailing12moUsd != null) {
      salesTaxMetrics.push({
        metric: "swfl_taxable_sales_trailing_12mo_usd",
        value: Math.round(st.trailing12moUsd),
        direction: "stable",
        label: "SWFL taxable sales — trailing 12 months (Lee + Collier)",
        variable_type: "extensive",
        units: "usd",
        display_format: "currency",
        source: stSource,
      });
    }
  }

  // Headline best/worst NAICS metrics lead so master rolls them up first
  // (master caps key_metrics at 8 per upstream's top-1-2 slice per spec §2 step 6).
  const key_metrics: BrainOutputMetric[] = [
    ...headlineMetrics,
    ...salesTaxMetrics,
    ...sectorMetrics,
  ];

  const vote = voteSectorCreditDirection(rankable, sortedRisk, sortedSafe);

  return {
    conclusion: conclusionParts.join(" "),
    key_metrics,
    caveats: [...caveats, ...vote.caveats],
    direction: vote.direction,
    magnitude: vote.magnitude,
    drivers: [],
    overrides: [],
    contradicts: [],
    exogenous_signals: [],
  };
}

/**
 * Sector-credit direction = a deterministic read on aggregate SWFL SBA risk:
 *  - worst rankable sector charge-off > CHARGEOFF_BEARISH_THRESHOLD (30%) →
 *    bearish; magnitude scales (worst − 30) / 70 (so 100% charge-off → 1.0).
 *  - worst ≤ CHARGEOFF_BULLISH_CEILING (15%) AND best survival ≥
 *    SURVIVAL_BULLISH_FLOOR (95%) → bullish; magnitude scales with how clean
 *    the picture is.
 *  - otherwise neutral.
 *
 * "Rankable" sectors only (≥5 resolved loans) — thin samples don't vote.
 */
const CHARGEOFF_BEARISH_THRESHOLD = 30;
const CHARGEOFF_BULLISH_CEILING = 15;
const SURVIVAL_BULLISH_FLOOR = 95;

function voteSectorCreditDirection(
  rankable: SectorAggregate[],
  sortedRisk: SectorAggregate[],
  sortedSafe: SectorAggregate[],
): {
  direction: BrainOutputDirection;
  magnitude: number;
  caveats: string[];
} {
  if (rankable.length === 0) {
    return {
      direction: "neutral",
      magnitude: 0,
      caveats: [
        `No sector carries the ${RANKING_MIN_RESOLVED}+ resolved-loan minimum needed to read a credit-risk direction.`,
      ],
    };
  }
  const worst = sortedRisk[0];
  const safest = sortedSafe[0];
  const bestSurvival = 100 - safest.rate_resolved;

  if (worst.rate_resolved > CHARGEOFF_BEARISH_THRESHOLD) {
    const span = 100 - CHARGEOFF_BEARISH_THRESHOLD;
    const magnitude = Math.max(
      0,
      Math.min(1, (worst.rate_resolved - CHARGEOFF_BEARISH_THRESHOLD) / span),
    );
    return {
      direction: "bearish",
      magnitude,
      caveats: [
        `Worst-sector charge-off ${pct(worst.rate_resolved)}% (${worst.label}, NAICS ${worst.naics_2digit}) above ${CHARGEOFF_BEARISH_THRESHOLD}% bearish threshold — sector-level credit risk is elevated.`,
      ],
    };
  }
  if (
    worst.rate_resolved <= CHARGEOFF_BULLISH_CEILING &&
    bestSurvival >= SURVIVAL_BULLISH_FLOOR
  ) {
    // Magnitude grows with how clean the picture is: worst near 0 + best at 100% → ~1.0
    const magnitude = Math.max(
      0,
      Math.min(
        1,
        (CHARGEOFF_BULLISH_CEILING - worst.rate_resolved) /
          CHARGEOFF_BULLISH_CEILING,
      ),
    );
    return { direction: "bullish", magnitude, caveats: [] };
  }
  return { direction: "neutral", magnitude: 0.5, caveats: [] };
}

export const sectorCreditSwfl: PackDefinition = {
  id: "sector-credit-swfl",
  brain_id: "sector-credit-swfl",
  domain: "finance",
  scope:
    "SBA 7(a)/504 sector credit risk — resolved-loan charge-off rates by 2-digit NAICS sector across Lee & Collier counties, FL, paired with named-brand outcomes and current macro funding backdrop.",
  ttl_seconds: 604800, // 7 days — SBA loan data is slow-moving
  sources: [
    sectorCreditSwflSource,
    flDorSalesTaxSource,
    makeBrainInputSource("franchise-outcomes"),
    makeBrainInputSource("macro-us"),
    makeBrainInputSource("macro-florida"),
  ],
  input_brains: [
    { id: "franchise-outcomes", edge_type: "input" },
    { id: "macro-us", edge_type: "input" },
    { id: "macro-florida", edge_type: "input" },
  ],
  // Every SBA row matters; rows with no resolved loans still belong (the sector
  // may have resolved data elsewhere). Brain-input fragments bypass via the
  // generic always-keep score.
  fitScore: (): number => 8,
  compositeCutoff: 0,
  // Pure deterministic — every fact is computed in sectorCreditCorpusSummary.
  // Skip BOTH agents: triage's content-score adds nothing (constant fitScore +
  // zero cutoff), synthesis is entirely deterministic. Important for the live
  // source because 6 years × 2 counties × ~75 NAICS = ~900 raw MV rows; that
  // overwhelms Haiku triage but is trivial to aggregate in code.
  skipTriageAgent: true,
  skipSynthesisAgent: true,
  corpusSummary: sectorCreditCorpusSummary,
  outputProducer: sectorCreditOutputProducer,
  preferences: [
    "The user is an SWFL credit underwriter or operator who reads sector-level SBA outcomes to decide which industries to lend into right now.",
    "The user reads charge-off rates as resolved-loan ratios — never as charge-offs over total loans, which understates risk by including still-active borrowers.",
    "The user treats sector risk as a starting point and always cross-validates against named-brand survival rates before underwriting a specific franchise borrower.",
  ],
  activeProject:
    "sector-credit-swfl: standing reference on SBA 7(a)/504 sector charge-off risk across the Lee & Collier market.",
  prompts: {
    triageContext:
      "These fragments are per-(NAICS, county, fiscal-year) SBA loan outcome rows plus two upstream brain outputs (franchise survival + macro funding). The pack is pure deterministic aggregation — every fragment belongs.",
    synthesisContext:
      "This pack runs no synthesis agent (skipSynthesisAgent). Every fact is produced deterministically by sectorCreditCorpusSummary and the BrainOutput is built by sectorCreditOutputProducer.",
  },
};
