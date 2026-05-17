import type { PackDefinition, PackOutput } from "../types/pack.mts";
import type { RawFragment } from "../types/fragment.mts";
import type { SynthesisFact } from "../types/event.mts";
import type {
  BrainOutputMetric,
  BrainOutputMetricSource,
  BrainOutputProducerResult,
} from "../types/brain-output.mts";
import {
  franchiseSource,
  type FranchiseNormalized,
} from "../sources/franchise-source.mts";
import {
  corridorSource,
  type CorridorNormalized,
  type CorridorMetricDirection,
} from "../sources/cre-source.mts";
import { env } from "./env.mts";

/**
 * Pack registry. The Refinery engine is pack-agnostic — a pack is just this
 * config object. Adding a vertical = adding an entry here + source connector(s).
 * A pack may have multiple sources, though both v1 packs are single-source.
 */

/**
 * Deterministic pack-fit score for a franchise-outcomes fragment.
 *
 * SOFT-SCORE (not a hard filter). The only hard drop is `survival_rate == null`
 * — a brand with zero resolved loans genuinely cannot be assessed for survival.
 * Every brand WITH resolved-loan data stays in the corpus; sample size scales
 * CONFIDENCE in the signal, it does not gate inclusion. This is deliberate: a
 * 1-loan brand that charged off is decision-critical for a franchise consultant
 * and must never be filtered away (the earlier `n_loans >= 5` hard floor dropped
 * 100% of the charge-off signal — survivorship bias).
 */
function franchiseFitScore(fragment: RawFragment): number {
  const n = fragment.normalized as unknown as FranchiseNormalized;
  if (n.survival_rate == null) return 0; // no resolved loans — cannot assess survival
  let score = 4; // base: an assessable franchise-outcome row
  score += Math.min(n.n_loans, 40) / 4; // sample-size confidence: 0.25 (n=1) .. 10 (n>=40)
  if (n.franchise_code) score += 1; // identifiable brand
  return score;
}

const resolvedOf = (n: FranchiseNormalized): number =>
  n.n_paid_in_full + n.n_charged_off;

const usd = (n: number): string => `$${Math.round(n).toLocaleString("en-US")}`;

/** A survival/charge-off rate, rounded to 1 dp — guards against raw-float ugliness
 * like "33.300000000000004%" leaking into a fact. */
const pct = (n: number): string => String(Math.round(n * 10) / 10);

/**
 * Boundary between the charge-off fact's headline and its full per-brand list.
 * franchiseCorpusSummary joins on it; masterCorpusSummary splits on it to route
 * (keep the headline, drop the list, point at the sub-brain). Single source of
 * truth — keep producer and splitter in sync via this constant.
 */
const CHARGEOFF_LIST_SEP =
  " Full per-brand list (each brand's resolved-loan survival rate): ";

// ---------------------------------------------------------------------
// Franchise aggregate state — populated by franchiseCorpusSummary, read by
// franchiseOutputProducer. Per-pipeline-run scope only; safe within one build.
// `overall_survival_rate` is the master plan's MANDATORY Week 1 metric —
// system-wide survival across resolved loans, weighted by loan count
// (not a mean of per-brand rates).
// ---------------------------------------------------------------------
interface FranchiseAggregate {
  assessableBrands: number;
  totalResolved: number;
  totalPaidInFull: number;
  totalChargedOff: number;
  overallSurvivalRate: number;
}

let lastFranchiseAggregate: FranchiseAggregate | null = null;

/**
 * One charge-off brand, formatted with a SINGLE denominator (resolved loans).
 * The rate sits outside the parenthesis and the parenthesis carries only the
 * resolved-loan counts — there is no `n_loans` ("total") number for a reader to
 * misread as an alternative denominator. (Survival is always over resolved
 * loans; total-incl-active answers a different question and is the bait that
 * made models compute e.g. 1/2 = 50% instead of reading the explicit 0%.)
 */
const chargeoffEntry = (n: FranchiseNormalized): string =>
  `${n.franchise_name} — ${pct(n.survival_rate ?? 0)}% survival ` +
  `(${n.n_charged_off} of ${resolvedOf(n)} resolved loans charged off)`;

/**
 * Deterministic corpus-level facts, computed in code (not the LLM) over ALL
 * Stage-1 fragments — including the ones soft-score dropped (null survival).
 * Every numeric cross-brand aggregate lives HERE; the synthesis agent is
 * forbidden from computing sums / counts / medians / rankings (LLM arithmetic
 * over ~137 rows is not reliable — it hallucinated a ~15% error in v2). Stage 3
 * prepends these as the pack's header facts f001..f00N.
 */
function franchiseCorpusSummary(allFragments: RawFragment[]): SynthesisFact[] {
  if (allFragments.length === 0) return [];
  const norms = allFragments.map(
    (f) => f.normalized as unknown as FranchiseNormalized,
  );
  const total = norms.length;
  const assessable = norms.filter((n) => n.survival_rate != null);
  const tooNew = total - assessable.length;

  // charge-off brands, worst survival first (ties broken by most loans charged off)
  const chargeoff = norms
    .filter((n) => n.n_charged_off > 0)
    .sort(
      (a, b) =>
        (a.survival_rate ?? 0) - (b.survival_rate ?? 0) ||
        b.n_charged_off - a.n_charged_off,
    );
  const totalChargedOff = chargeoff.reduce((s, n) => s + n.n_charged_off, 0);

  // System-wide resolved-loan aggregates — weighted by loan count, not a mean
  // of per-brand rates. (`metric:overall_survival_rate` — MANDATORY Week 1.)
  const totalPaidInFull = assessable.reduce((s, n) => s + n.n_paid_in_full, 0);
  const totalSystemChargedOff = assessable.reduce(
    (s, n) => s + n.n_charged_off,
    0,
  );
  const totalResolved = totalPaidInFull + totalSystemChargedOff;
  const overallSurvivalRate =
    totalResolved === 0 ? 0 : (totalPaidInFull / totalResolved) * 100;
  lastFranchiseAggregate = {
    assessableBrands: assessable.length,
    totalResolved,
    totalPaidInFull,
    totalChargedOff: totalSystemChargedOff,
    overallSurvivalRate,
  };

  // total approved capital
  const capitalAssessable = assessable.reduce(
    (s, n) => s + n.total_gross_approval,
    0,
  );
  const capitalAll = norms.reduce((s, n) => s + n.total_gross_approval, 0);

  // median survival rate across the assessable brands
  const rates = assessable
    .map((n) => n.survival_rate as number)
    .sort((a, b) => a - b);
  const mid = Math.floor(rates.length / 2);
  const median =
    rates.length === 0
      ? null
      : rates.length % 2 === 1
        ? rates[mid]
        : (rates[mid - 1] + rates[mid]) / 2;
  const below100 = rates.filter((r) => r < 100).length;

  // strong performers: 3+ resolved loans, zero charge-offs
  const strong = assessable
    .filter((n) => resolvedOf(n) >= 3 && n.n_charged_off === 0)
    .sort((a, b) => resolvedOf(b) - resolvedOf(a));

  const facts: SynthesisFact[] = [
    {
      topic: "corpus_overview",
      fact: "Dataset scope — SBA franchise loan outcomes across Lee & Collier counties",
      value:
        `${total} franchise brands in the dataset. ${assessable.length} have at least one resolved ` +
        `loan (paid in full or charged off) and are assessable for survival; ${tooNew} have only ` +
        `still-active loans and are not yet assessable. ${chargeoff.length} of the assessable brands ` +
        `recorded at least one charge-off (named in the charge-off summary fact).`,
      source_fragment_ids: [],
    },
    {
      topic: "total_approved_capital",
      fact: "Total SBA gross approval across the assessable franchise brands",
      value:
        `${usd(capitalAssessable)} in total SBA 7(a)/504 gross loan approval across the ` +
        `${assessable.length} brands with resolved-loan data. Across all ${total} brands ` +
        `(including the ${tooNew} not yet assessable), total gross approval is ${usd(capitalAll)}.`,
      source_fragment_ids: [],
    },
  ];

  if (chargeoff.length > 0) {
    const worst = chargeoff[0];
    const named = chargeoff.map(chargeoffEntry).join("; ");
    facts.push({
      topic: "chargeoff_summary",
      fact: "Every franchise brand in the dataset that recorded an SBA loan charge-off",
      value:
        `${chargeoff.length} brands recorded at least one charge-off — ${totalChargedOff} loans ` +
        `charged off in total. Worst performer by survival rate: ${chargeoffEntry(worst)}.` +
        `${CHARGEOFF_LIST_SEP}${named}.`,
      source_fragment_ids: [],
    });
  }

  if (strong.length > 0) {
    const named = strong
      .map(
        (n) =>
          `${n.franchise_name} (${resolvedOf(n)} resolved, ${n.n_loans} total)`,
      )
      .join("; ");
    facts.push({
      topic: "strong_performers",
      fact: "Franchise brands with a meaningful resolved-loan sample and a perfect survival rate",
      value:
        `${strong.length} brands have 3 or more resolved SBA loans and a 100% survival rate ` +
        `(zero charge-offs) — the safe-harbor shortlist for this corpus: ${named}.`,
      source_fragment_ids: [],
    });
  }

  if (median != null) {
    facts.push({
      topic: "median_survival_rate",
      fact: "Median survival rate across the assessable franchise brands",
      value:
        `The median resolved-loan survival rate across the ${assessable.length} assessable brands ` +
        `is ${median}%. ${below100} of the ${assessable.length} brands fall below 100% survival; ` +
        `the remaining ${assessable.length - below100} sit at exactly 100%.`,
      source_fragment_ids: [],
    });
  }

  // Tagged metric fact — surfaces in SAVED FACTS and is rolled up by master.
  // The numeric value lives in BrainOutput.key_metrics via franchiseOutputProducer.
  if (totalResolved > 0) {
    facts.push({
      topic: "metric:overall_survival_rate",
      fact: "Overall SBA franchise loan survival rate across the SWFL assessable corpus",
      value:
        `${totalPaidInFull} of ${totalResolved} resolved SBA franchise loans across ` +
        `${assessable.length} assessable brands were paid in full — an overall survival rate of ` +
        `${(Math.round(overallSurvivalRate * 10) / 10).toString()}% weighted by loan count.`,
      source_fragment_ids: [],
    });
  }

  return facts;
}

/**
 * Build BrainOutput's narrative + qualitative slice for franchise-outcomes.
 * Reads the system-aggregate state stashed by franchiseCorpusSummary so the
 * key_metrics carry a real numeric value (the default producer would emit 0
 * because it only sees the fact's string `value`). v1 placeholders for the
 * direction-voting fields — master synthesizes those Week 2.
 */
function franchiseOutputProducer(out: PackOutput): BrainOutputProducerResult {
  const agg = lastFranchiseAggregate;
  const conclusion = out.facts[0]?.value ?? "(no facts produced this run)";
  const key_metrics: BrainOutputMetric[] = [];
  if (agg && agg.totalResolved > 0) {
    key_metrics.push({
      metric: "overall_survival_rate",
      value: Math.round(agg.overallSurvivalRate * 10) / 10,
      direction: "stable",
      label: `SBA franchise overall survival rate (${agg.totalResolved} resolved loans, ${agg.assessableBrands} brands)`,
    });
  }
  return {
    conclusion,
    key_metrics,
    caveats: [],
    direction: "neutral",
    magnitude: 0.5,
    drivers: [],
    overrides: [],
    contradicts: [],
    exogenous_signals: [],
  };
}

const franchiseOutcomes: PackDefinition = {
  id: "franchise-outcomes",
  brain_id: "franchise-outcomes",
  domain: "real-estate",
  scope: "SBA 7(a)/504 franchise loan outcomes — Lee & Collier counties, FL",
  ttl_seconds: 604800, // franchise outcome data is slow-moving
  sources: [franchiseSource],
  input_brains: [],
  fitScore: franchiseFitScore,
  corpusSummary: franchiseCorpusSummary,
  outputProducer: franchiseOutputProducer,
  preferences: [
    "The user reviews SBA 7(a)/504 franchise loan outcomes across Lee and Collier counties, Florida.",
    "The user reads survival and charge-off figures as resolved-loan ratios; rates drawn from small samples are directional, not definitive.",
    "The user values franchise figures presented alongside the loan count behind them and the source's verification date.",
  ],
  activeProject:
    "franchise-outcomes-swfl: standing reference on SBA franchise loan survival across the Lee–Collier market.",
  prompts: {
    triageContext:
      "These fragments describe SBA 7(a)/504 loan outcomes for individual franchise brands in Southwest Florida (Lee & Collier counties). Score how decision-relevant each brand's outcome profile is to someone evaluating franchise lending risk or a franchise investment in this market. A large, clear survival/charge-off signal is highly relevant; a thin sample is less certain — but a thin-sample brand that recorded a charge-off is still highly decision-relevant.",
    synthesisContext: [
      'Turn franchise SBA loan outcome statistics into short, citable reference facts. Write in descriptive third-person ("Culver\'s resolved loans show...").',
      "",
      "Field semantics — be precise, do not conflate:",
      "- n_loans is the TOTAL loan count for the brand, INCLUDING loans still active (neither paid in full nor charged off).",
      "- Resolved loans = n_paid_in_full + n_charged_off. survival_rate and chargeoff_rate are computed over RESOLVED loans only — never over n_loans.",
      "- Example: a brand with n_loans 6, n_paid_in_full 4, n_charged_off 0 has 4 resolved loans (all paid in full) and 2 still active — its survival_rate is 100% of resolved loans, NOT '4 of 6'.",
      "- Presentation: never pack a survival/charge-off percentage and a total-loan count into the same parenthetical (e.g. '(1 resolved of 3 total, 100% survival)'). A reader misbinds the percentage to 'total'. State the rate and its resolved-loan basis in a sentence; keep parentheticals to a single denominator.",
      "- jobs_supported is not populated in this source — do not produce facts about it.",
      "",
      "What to produce (this is a refinery, not a data dump):",
      "- Detail the brands carrying the clearest signal first — larger resolved-loan samples.",
      "- NAME every brand that recorded a charge-off, regardless of how few loans it has — give each its own per-brand fact (its own numbers, framed). These are the decision-critical data points and must never be summarized away.",
      "- Roll up the long tail of thin-sample, charge-off-free brands into summary facts rather than one fact per brand.",
      "- For cross-brand observations, stay QUALITATIVE — sectors, patterns, themes (e.g. 'food-service brands cluster in the thin-sample tail'). Do NOT compute numeric aggregates: sums, counts, medians, rankings, 'X of Y' tallies.",
      "- Corpus-level numeric aggregates (total approved capital, charge-off summary, strong-performer shortlist, median survival rate) are computed deterministically and prepended automatically — do not reproduce or recompute them.",
    ].join("\n"),
  },
};

// --- CRE pack (cre-swfl) -------------------------------------------------

// Per-pipeline-run state for the cre producer. Same pattern as macro-swfl /
// sector-credit-swfl / master: typed values cannot survive in SynthesisFact.value,
// so the producer reads from closure state instead of re-parsing facts.
//
// P2 RETROFIT (Session 8 Part 3): cre-swfl is the second brain on the per-metric
// provenance contract (env-swfl was first). Every key_metric carries an inline
// `source` with the Brains Supabase PostgREST URL, the single-query fetched_at,
// trust tier 2 (verified editorial), and a citation that names every
// contributing corridor + its editorial source_url — a disputant can trace any
// median back to the exact rows that produced it.

let lastCorridors: CorridorNormalized[] = [];
 
let lastCorridorFetchedAt: string | null = null;

/**
 * Build a BrainOutputMetricSource for a cre-swfl aggregate metric.
 *
 * The URL is the reproducible PostgREST query against Brains Supabase
 * (`{BRAINS_SUPABASE_URL}/rest/v1/corridor_profiles?...`), filtered to the
 * same rows that fed the median — verified, non-deleted, and non-null for the
 * specific metric column. In fixture mode the URL collapses to the fixture
 * file path so the receipt still points at the actual data origin.
 *
 * The citation enumerates the contributing corridors with their editorial
 * `source_url`s (when present), so a reader can trace value → corridor → its
 * own source without leaving the OUTPUT block.
 */
function buildCreAggregateSource(
  field: "cap_rate_pct" | "vacancy_rate_pct",
  contributing: CorridorNormalized[],
  fetched_at: string,
): BrainOutputMetricSource {
  const url =
    env.source === "live" && env.supabaseUrl
      ? `${env.supabaseUrl}/rest/v1/corridor_profiles?select=*&verification_status=eq.verified&deleted_at=is.null&${field}=not.is.null`
      : "fixture://refinery/__fixtures__/corridor-profiles.sample.json";
  const named = contributing
    .map((c) => {
      const tail = c.source_url ? ` [${c.source_url}]` : "";
      return `${c.name} (${c.city}, ${c.county})${tail}`;
    })
    .join("; ");
  return {
    url,
    fetched_at,
    tier: 2,
    citation: `Brains Supabase corridor_profiles (verified, non-deleted) — median across ${contributing.length} corridors reporting ${field}: ${named}.`,
  };
}

// Number.EPSILON guard: without it (0.3 + 0.35) / 2 = 0.32499999999999996
// floors to 0.32 instead of rounding to 0.33.
const round2 = (n: number): string =>
  (Math.round((n + Number.EPSILON) * 100) / 100).toString();

/** Median of a numeric array. Returns null on empty input. */
function medianOf(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Most-common direction across a slice of corridors (modal direction). */
function modalDirection(
  values: (CorridorMetricDirection | null)[],
): CorridorMetricDirection {
  const counts: Record<CorridorMetricDirection, number> = {
    rising: 0,
    falling: 0,
    stable: 0,
  };
  for (const v of values) {
    if (v != null) counts[v] += 1;
  }
  // Tiebreak: stable > falling > rising (descriptive over directional when tied).
  if (counts.falling > counts.rising && counts.falling > counts.stable) {
    return "falling";
  }
  if (counts.rising > counts.falling && counts.rising > counts.stable) {
    return "rising";
  }
  return "stable";
}

/** Sorted "label (count)" breakdown of a string-keyed tally, count-descending. */
function breakdown(counts: Record<string, number>): string {
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k} (${v})`)
    .join(", ");
}

/**
 * Pack-fit for a CRE corridor fragment. Every corridor that arrives is already
 * verified, so nothing is hard-dropped — the score scales with how much
 * intelligence a corridor actually carries (narrative + ground-truth flags).
 */
function creFitScore(fragment: RawFragment): number {
  const c = fragment.normalized as unknown as CorridorNormalized;
  let score = 6; // every verified corridor belongs in the pack
  if (c.character) score += 2; // carries a narrative
  if (c.flags.length > 0) score += 2; // carries ground-truth flags
  return score;
}

/**
 * Deterministic corpus-level facts for the CRE pack — computed in code, never
 * by the LLM. Covers the five corridor aggregates: corridor count, count by
 * type, count by county, seasonal-index stats, and active-flag stats.
 */
function creCorpusSummary(allFragments: RawFragment[]): SynthesisFact[] {
  const corridors = allFragments.map(
    (f) => f.normalized as unknown as CorridorNormalized,
  );
  // Stash for creSwflOutputProducer — typed values + nullable metric fields can't
  // survive in SynthesisFact.value (string-only). Same pattern as macro-swfl.
  lastCorridors = corridors;
  // Single batch query — every fragment carries the same fetched_at. Stash it
  // for the producer's per-metric provenance receipts. Falls back to null if
  // the fragment array is somehow empty downstream of the early return.
  lastCorridorFetchedAt = allFragments[0]?.fetched_at ?? null;
  if (corridors.length === 0) return [];

  const byType: Record<string, number> = {};
  const byCounty: Record<string, number> = {};
  for (const c of corridors) {
    byType[c.corridor_type] = (byType[c.corridor_type] ?? 0) + 1;
    byCounty[c.county] = (byCounty[c.county] ?? 0) + 1;
  }

  const seasonal = corridors
    .map((c) => c.seasonal_index)
    .filter((v): v is number => v != null)
    .sort((a, b) => a - b);
  const mid = Math.floor(seasonal.length / 2);
  const median =
    seasonal.length === 0
      ? null
      : seasonal.length % 2 === 1
        ? seasonal[mid]
        : (seasonal[mid - 1] + seasonal[mid]) / 2;
  const avg =
    seasonal.length === 0
      ? null
      : seasonal.reduce((s, v) => s + v, 0) / seasonal.length;

  const flags = corridors.flatMap((c) => c.flags);
  const byFlagType: Record<string, number> = {};
  for (const fl of flags) byFlagType[fl.type] = (byFlagType[fl.type] ?? 0) + 1;
  const corridorsWithFlags = corridors.filter((c) => c.flags.length > 0).length;

  const facts: SynthesisFact[] = [
    {
      topic: "corpus_overview",
      fact: "Dataset scope — verified SWFL commercial real estate corridors",
      value:
        `${corridors.length} verified SWFL CRE corridors: ` +
        `${byCounty["Lee"] ?? 0} in Lee County, ${byCounty["Collier"] ?? 0} in Collier County` +
        `${byCounty["Unknown"] ? `, ${byCounty["Unknown"]} unmapped` : ""}, across ${Object.keys(byType).length} corridor types.`,
      source_fragment_ids: [],
    },
    {
      topic: "corridors_by_type",
      fact: "Verified corridor count by corridor type",
      value: `Corridor count by type: ${breakdown(byType)}.`,
      source_fragment_ids: [],
    },
    {
      topic: "corridors_by_county",
      fact: "Verified corridor count by county (derived from city)",
      value:
        `Corridor count by county, derived from city: ${breakdown(byCounty)}. ` +
        `County is not a column in the source — Naples maps to Collier, all other corpus cities to Lee.`,
      source_fragment_ids: [],
    },
  ];

  if (seasonal.length > 0 && median != null && avg != null) {
    facts.push({
      topic: "seasonal_index_stats",
      fact: "Seasonal-index distribution across the verified corridors",
      value:
        `Seasonal index across ${seasonal.length} corridors: min ${round2(seasonal[0])}, ` +
        `max ${round2(seasonal[seasonal.length - 1])}, median ${round2(median)}, average ${round2(avg)}. ` +
        `The scale runs 0 (no seasonality) to 1 (extreme seasonality).`,
      source_fragment_ids: [],
    });
  }

  if (flags.length > 0) {
    facts.push({
      topic: "active_flags_summary",
      fact: "Active corridor flags — the ground-truth intelligence layer",
      value:
        `${flags.length} active corridor flags across ${corridorsWithFlags} of ${corridors.length} corridors. ` +
        `By type: ${breakdown(byFlagType)}. These flags capture infrastructure, new-project, regulatory, ` +
        `construction, and status changes that are not visible in public listings.`,
      source_fragment_ids: [],
    });
  }

  // Cap-rate / vacancy-rate aggregates — tagged with `metric:` prefix so they
  // surface in SAVED FACTS alongside the producer's BrainOutput.key_metrics.
  const withCap = corridors.filter((c) => c.cap_rate_pct != null);
  const withVac = corridors.filter((c) => c.vacancy_rate_pct != null);
  const capMedian = medianOf(withCap.map((c) => c.cap_rate_pct as number));
  const vacMedian = medianOf(withVac.map((c) => c.vacancy_rate_pct as number));
  if (capMedian != null) {
    facts.push({
      topic: "metric:cap_rate_median",
      fact: "Median cap rate across SWFL CRE corridors with reported metrics",
      value: `Median cap rate is ${round2(capMedian)}% across ${withCap.length} of ${corridors.length} corridors that have reported metrics this period.`,
      source_fragment_ids: [],
    });
  }
  if (vacMedian != null) {
    facts.push({
      topic: "metric:vacancy_rate_median",
      fact: "Median vacancy rate across SWFL CRE corridors with reported metrics",
      value: `Median vacancy rate is ${round2(vacMedian)}% across ${withVac.length} of ${corridors.length} corridors that have reported metrics this period.`,
      source_fragment_ids: [],
    });
  }

  return facts;
}

/**
 * Per-corridor direction read from the (cap_rate, vacancy) signal pair:
 *   - any "falling" AND any "rising"           → "mixed" corridor (no clear read)
 *   - any "falling", no "rising"               → "bullish" (rates compressing
 *                                                 or space tightening — landlord
 *                                                 market)
 *   - any "rising", no "falling"               → "bearish" (yields widening or
 *                                                 vacancy climbing — distress)
 *   - both stable, or one stable + null        → "neutral"
 *   - both null                                → "no-data"
 */
type CorridorVote = "bullish" | "bearish" | "mixed" | "neutral" | "no-data";

function voteCorridor(c: CorridorNormalized): CorridorVote {
  const cap = c.cap_rate_direction;
  const vac = c.vacancy_rate_direction;
  if (cap == null && vac == null) return "no-data";
  const hasFalling = cap === "falling" || vac === "falling";
  const hasRising = cap === "rising" || vac === "rising";
  if (hasFalling && hasRising) return "mixed";
  if (hasFalling) return "bullish";
  if (hasRising) return "bearish";
  return "neutral"; // any combination of stable + null with no directional signal
}

/**
 * Brain-level CRE direction. Counts per-corridor votes among corridors that
 * have metrics, and applies the spec's 0.60 agreement floor — a single side
 * must hit ≥60% to claim the direction, else the brain reads "mixed".
 */
function voteCreDirection(corridors: CorridorNormalized[]): {
  direction: "bullish" | "bearish" | "mixed" | "neutral";
  magnitude: number;
  caveats: string[];
} {
  const votes = corridors.map(voteCorridor);
  const withData = votes.filter((v) => v !== "no-data");
  const noData = votes.length - withData.length;

  const caveats: string[] = [];
  if (noData > 0) {
    caveats.push(
      `${noData} of ${corridors.length} corridors have no cap_rate / vacancy_rate metrics — direction is read from the ${withData.length} corridors with data.`,
    );
  }
  if (withData.length === 0) {
    return { direction: "neutral", magnitude: 0, caveats };
  }

  const bullish = withData.filter((v) => v === "bullish").length;
  const bearish = withData.filter((v) => v === "bearish").length;
  const mixed = withData.filter((v) => v === "mixed").length;
  const neutral = withData.filter((v) => v === "neutral").length;
  const total = withData.length;

  const bullishRatio = bullish / total;
  const bearishRatio = bearish / total;

  if (bullishRatio >= 0.6) {
    return { direction: "bullish", magnitude: bullishRatio, caveats };
  }
  if (bearishRatio >= 0.6) {
    return { direction: "bearish", magnitude: bearishRatio, caveats };
  }
  // Any directional or mixed signal but no majority → mixed at brain level.
  if (bullish > 0 || bearish > 0 || mixed > 0) {
    return { direction: "mixed", magnitude: 0.5, caveats };
  }
  // All neutral (everything stable) — emit neutral with magnitude scaled by
  // how unanimous "stable" was (loudly neutral when every corridor is stable).
  return { direction: "neutral", magnitude: neutral / total, caveats };
}

/**
 * CRE producer — emits cap_rate_median + vacancy_rate_median as headline
 * key_metrics and votes a deterministic direction from the per-corridor
 * cap_rate_direction / vacancy_rate_direction signals.
 */
function creSwflOutputProducer(out: PackOutput): BrainOutputProducerResult {
  const corridors = lastCorridors;
  const withCap = corridors.filter((c) => c.cap_rate_pct != null);
  const withVac = corridors.filter((c) => c.vacancy_rate_pct != null);
  const capMedian = medianOf(withCap.map((c) => c.cap_rate_pct as number));
  const vacMedian = medianOf(withVac.map((c) => c.vacancy_rate_pct as number));

  // P2 provenance — single-query fetched_at shared across all corridors in
  // this run. If the closure capture missed (zero fragments), fall back to a
  // generated timestamp so the receipt is still well-formed.
  const fetched_at =
    lastCorridorFetchedAt ?? new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

  const key_metrics: BrainOutputMetric[] = [];
  if (capMedian != null) {
    key_metrics.push({
      metric: "cap_rate_median",
      value: Math.round(capMedian * 100) / 100,
      direction: modalDirection(withCap.map((c) => c.cap_rate_direction)),
      label: `Median SWFL CRE cap rate (${withCap.length} of ${corridors.length} corridors)`,
      source: buildCreAggregateSource("cap_rate_pct", withCap, fetched_at),
    });
  }
  if (vacMedian != null) {
    key_metrics.push({
      metric: "vacancy_rate_median",
      value: Math.round(vacMedian * 100) / 100,
      direction: modalDirection(withVac.map((c) => c.vacancy_rate_direction)),
      label: `Median SWFL CRE vacancy rate (${withVac.length} of ${corridors.length} corridors)`,
      source: buildCreAggregateSource("vacancy_rate_pct", withVac, fetched_at),
    });
  }

  const vote = voteCreDirection(corridors);

  const conclusionParts: string[] = [];
  if (corridors.length > 0) {
    conclusionParts.push(
      `The SWFL CRE pack covers ${corridors.length} verified corridors across Lee and Collier counties.`,
    );
  }
  if (capMedian != null && vacMedian != null) {
    conclusionParts.push(
      `Median cap rate sits at ${round2(capMedian)}% (${modalDirection(withCap.map((c) => c.cap_rate_direction))}); median vacancy at ${round2(vacMedian)}% (${modalDirection(withVac.map((c) => c.vacancy_rate_direction))}).`,
    );
  } else {
    conclusionParts.push(
      "Cap-rate and vacancy metrics are not yet populated for enough corridors to anchor a median read.",
    );
  }
  if (vote.direction === "bullish") {
    conclusionParts.push(
      "Cap rates and vacancy are predominantly compressing — landlord-market read.",
    );
  } else if (vote.direction === "bearish") {
    conclusionParts.push(
      "Cap rates and vacancy are predominantly expanding — yield distress read.",
    );
  } else if (vote.direction === "mixed") {
    conclusionParts.push(
      "Corridor reads split between compressing and expanding — no consensus direction at the SWFL CRE level.",
    );
  }

  return {
    conclusion: conclusionParts.join(" "),
    key_metrics,
    caveats: vote.caveats,
    direction: vote.direction,
    magnitude: vote.magnitude,
    drivers: [],
    overrides: [],
    contradicts: [],
    exogenous_signals: [],
  };
}

const creSwfl: PackDefinition = {
  id: "cre-swfl",
  brain_id: "cre-swfl",
  domain: "real-estate",
  scope:
    "SWFL commercial real estate corridors — verified corridor intelligence (profiles, character, active flags)",
  ttl_seconds: 604800, // corridor intelligence is editorial, slow-moving
  sources: [corridorSource],
  input_brains: [],
  fitScore: creFitScore,
  corpusSummary: creCorpusSummary,
  outputProducer: creSwflOutputProducer,
  preferences: [
    "The user is a commercial real estate broker working Southwest Florida corridors — tenant rep, landlord rep, retail leasing.",
    "The user reads corridor intelligence to qualify tenants against what a corridor can actually support, and to arm the landlord-value conversation.",
    "The user treats the active-flags layer — infrastructure, new projects, regulatory shifts — as the on-the-ground intelligence that is not in public listings.",
  ],
  activeProject:
    "cre-swfl: standing reference on verified SWFL commercial real estate corridors.",
  prompts: {
    triageContext:
      "These fragments are SWFL CRE corridor profiles. Score how decision-relevant each corridor is to a commercial real estate broker working Southwest Florida. A corridor with a clear character narrative and active ground-truth flags is highly relevant. Score on substance, not length.",
    synthesisContext: [
      "Each fragment is a SWFL CRE corridor profile. Write every fact in descriptive third-person — never imperative, never second-person. Produce a per-corridor fact:",
      "- Lead with name, city, county, corridor_type, and seasonal_index (0-1; higher = more seasonal).",
      "- Weave in the character narrative, evolution_direction, and tenant_mix where present. Some corridors have a null character — omit it gracefully, never invent prose.",
      "- Surface the active_flags by name — they are the ground-truth intelligence layer (infrastructure, new projects, regulatory shifts, status changes a broker cannot get from public listings). This is the crown-jewel intel of the pack.",
      "",
      "Do NOT compute numeric cross-fragment aggregates — corridor counts, county splits, seasonal-index stats, and flag counts are all computed deterministically and prepended as separate facts. Qualitative observations (patterns and themes across corridors) are yours.",
    ].join("\n"),
  },
};

import { PER_PACK_REGISTRY } from "../packs/index.mts";

/**
 * Unified pack registry. Two v1 packs (`franchise-outcomes`, `cre-swfl`) live
 * in this file above; every other pack — including `master`, which became a
 * deterministic synthesizer in Week 2 — lives at `refinery/packs/{id}.mts`
 * and is re-exported via `PER_PACK_REGISTRY`. PACKS is the union.
 */
export const PACKS: Record<string, PackDefinition> = {
  [franchiseOutcomes.id]: franchiseOutcomes,
  [creSwfl.id]: creSwfl,
  ...PER_PACK_REGISTRY,
};

export function getPack(id: string): PackDefinition {
  const pack = PACKS[id];
  if (!pack) {
    const known = Object.keys(PACKS).join(", ") || "(none)";
    throw new Error(`Unknown pack "${id}". Known packs: ${known}`);
  }
  return pack;
}
