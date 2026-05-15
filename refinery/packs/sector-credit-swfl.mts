import type { PackDefinition, PackOutput } from "../types/pack.mts";
import type { RawFragment } from "../types/fragment.mts";
import type { SynthesisFact } from "../types/event.mts";
import type { BrainOutput, BrainOutputMetric } from "../types/brain-output.mts";
import {
  sectorCreditSwflSource,
  type SectorCreditNormalized,
} from "../sources/sector-credit-swfl-source.mts";
import {
  makeBrainInputSource,
  type BrainInputNormalized,
} from "../sources/brain-input-source.mts";

/**
 * sector-credit-swfl — "What sectors should I lend into in SWFL right now?"
 *
 * Branches:
 *   • sba_loans_by_naics_county (T1, SBA federal MV) — every (county, NAICS, FY)
 *     row of SBA 7(a)/504 loan outcomes filtered to Lee & Collier counties.
 *
 * Input brains:
 *   • franchise-outcomes — named survival rates by brand (cross-validation
 *     of the sector aggregates with brand-level signal)
 *   • macro-swfl — current funding-cost backdrop (SOFR direction, CPI YoY,
 *     Florida labor) so the sector recommendation reads against the macro tape
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
let lastMacroOutput: BrainOutput | null = null;

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

function sectorCreditCorpusSummary(
  allFragments: RawFragment[],
): SynthesisFact[] {
  const rows = rowsFrom(allFragments);
  const franchise = brainInputFrom(allFragments, "franchise-outcomes");
  const macro = brainInputFrom(allFragments, "macro-swfl");

  // Stash typed state for outputProducer
  lastSectors = aggregateBySector(rows);
  lastFranchiseOutput = franchise;
  lastMacroOutput = macro;

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

  if (macro) {
    const sofr = macro.key_metrics.find((m) => m.metric === "sofr_rate");
    const cpi = macro.key_metrics.find((m) => m.metric === "cpi_yoy");
    const flUnemp = macro.key_metrics.find(
      (m) => m.metric === "fl_unemployment",
    );
    const macroLine = [
      sofr ? `SOFR ${pct(sofr.value)}% (${sofr.direction})` : "",
      cpi ? `CPI YoY ${pct(cpi.value)}% (${cpi.direction})` : "",
      flUnemp
        ? `FL unemployment ${pct(flUnemp.value)}% (${flUnemp.direction})`
        : "",
    ]
      .filter(Boolean)
      .join(", ");
    facts.push({
      topic: "macro-swfl :: upstream_routing",
      fact: "Current macro funding-cost backdrop from the macro-swfl brain",
      value:
        `The macro-swfl brain (confidence ${macro.confidence.toFixed(2)} at ${macro.refined_at}) reports the SWFL macro backdrop: ${macroLine}. ` +
        `These rates set the funding-cost lens — a high-charge-off sector at a falling SOFR is a different bet from the same sector at a rising SOFR.`,
      source_fragment_ids: [],
    });
  }

  return facts;
}

function sectorCreditOutputProducer(
  _out: PackOutput,
): Pick<BrainOutput, "conclusion" | "key_metrics" | "caveats"> {
  const sectors = lastSectors;
  const macro = lastMacroOutput;
  const franchise = lastFranchiseOutput;

  const rankable = sectors.filter((s) => s.resolved >= RANKING_MIN_RESOLVED);
  const sortedSafe = [...rankable].sort(
    (a, b) => a.rate_resolved - b.rate_resolved,
  );
  const sortedRisk = [...rankable].sort(
    (a, b) => b.rate_resolved - a.rate_resolved,
  );

  // Key metrics: one per ranked sector, charge-off rate as the value, direction
  // is the directional flag a future YoY comparison would set; for now mark
  // "stable" since this is a point-in-time snapshot.
  const key_metrics: BrainOutputMetric[] = rankable
    .sort((a, b) => a.rate_resolved - b.rate_resolved)
    .map(
      (s): BrainOutputMetric => ({
        metric: `sector_${s.naics_2digit}_chargeoff_rate`,
        value: Math.round(s.rate_resolved * 10) / 10,
        direction: "stable",
        label: `${s.label} (NAICS ${s.naics_2digit})`,
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
  if (macro) {
    const sofr = macro.key_metrics.find((m) => m.metric === "sofr_rate");
    if (sofr) {
      conclusionParts.push(
        `Read these rates against the current SOFR of ${pct(sofr.value)}% (${sofr.direction}) — funding-cost direction sets the appetite for charge-off risk.`,
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

  return {
    conclusion: conclusionParts.join(" "),
    key_metrics,
    caveats,
  };
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
    makeBrainInputSource("franchise-outcomes"),
    makeBrainInputSource("macro-swfl"),
  ],
  input_brains: ["franchise-outcomes", "macro-swfl"],
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
