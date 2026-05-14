import type { PackDefinition } from "../types/pack.mts";
import type { RawFragment } from "../types/fragment.mts";
import type { SynthesisFact } from "../types/event.mts";
import {
  franchiseSource,
  type FranchiseNormalized,
} from "../sources/franchise-source.mts";
import {
  corridorSource,
  type CorridorNormalized,
} from "../sources/cre-source.mts";
import {
  franchiseIndexSource,
  creIndexSource,
  type MasterNormalized,
} from "../sources/master-source.mts";

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
    const named = chargeoff
      .map(
        (n) =>
          `${n.franchise_name} (${n.survival_rate ?? 0}% survival — ` +
          `${n.n_charged_off} of ${resolvedOf(n)} resolved charged off, ${n.n_loans} total)`,
      )
      .join("; ");
    facts.push({
      topic: "chargeoff_summary",
      fact: "Every franchise brand in the dataset that recorded an SBA loan charge-off",
      value:
        `${chargeoff.length} brands recorded at least one charge-off — ${totalChargedOff} loans ` +
        `charged off in total. Worst performer by survival rate: ${worst.franchise_name} ` +
        `(${worst.survival_rate ?? 0}% survival — ${worst.n_charged_off} of ${resolvedOf(worst)} ` +
        `resolved loans charged off). Full list (resolved-loan survival rate — charge-offs of resolved, total loans): ${named}.`,
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

  return facts;
}

const franchiseOutcomes: PackDefinition = {
  id: "franchise-outcomes",
  brain_id: "franchise-outcomes",
  scope: "SBA 7(a)/504 franchise loan outcomes — Lee & Collier counties, FL",
  ttl_seconds: 604800, // franchise outcome data is slow-moving
  sources: [franchiseSource],
  fitScore: franchiseFitScore,
  corpusSummary: franchiseCorpusSummary,
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

// Number.EPSILON guard: without it (0.3 + 0.35) / 2 = 0.32499999999999996
// floors to 0.32 instead of rounding to 0.33.
const round2 = (n: number): string =>
  (Math.round((n + Number.EPSILON) * 100) / 100).toString();

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

  return facts;
}

const creSwfl: PackDefinition = {
  id: "cre-swfl",
  brain_id: "cre-swfl",
  scope:
    "SWFL commercial real estate corridors — verified corridor intelligence (profiles, character, active flags)",
  ttl_seconds: 604800, // corridor intelligence is editorial, slow-moving
  sources: [corridorSource],
  fitScore: creFitScore,
  corpusSummary: creCorpusSummary,
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

// --- Master Index pack (master) -----------------------------------------

/**
 * Deterministic corpus facts for the master index. Reads the two sub-pack
 * fragments (each carrying a published pack's verbatim corpus facts) and emits:
 * one honest shared-scope fact, then each sub-pack's f001-f005 lifted verbatim.
 * No LLM, no synthesis, no cross-vertical inference — pure aggregation of what
 * is already verified and shipped.
 */
function masterCorpusSummary(allFragments: RawFragment[]): SynthesisFact[] {
  const subPacks = allFragments
    .map((f) => ({ frag: f, n: f.normalized as MasterNormalized }))
    .filter((x) => x.n?.kind === "sub-pack");
  if (subPacks.length === 0) return [];

  const byBrain = new Map(subPacks.map((x) => [x.n.brain_id, x]));
  const franchise = byBrain.get("franchise-outcomes");
  const cre = byBrain.get("cre-swfl");

  const facts: SynthesisFact[] = [];

  // 1. honest shared-scope fact — same market, explicitly NO record-level join
  if (franchise && cre) {
    facts.push({
      topic: "shared_market_scope",
      fact: "Both verticals in the SWFL Intelligence Lake cover the same Lee & Collier County, Florida market",
      value:
        "The Franchise Outcomes pack and the CRE Corridors pack are both scoped to Lee and Collier " +
        "counties in Southwest Florida. They share that geographic market but have no record-level " +
        "join: franchise outcomes are brand-level SBA loan data with no corridor geography, and " +
        "corridor profiles carry no franchise-loan data. Cross-vertical questions are answered by " +
        "fetching both sub-brains separately, not by inferring a link between an individual franchise " +
        "and an individual corridor.",
      source_fragment_ids: [franchise.frag.fragment_id, cre.frag.fragment_id],
    });
  }

  // 2. each sub-pack's deterministic corpus facts, lifted verbatim, in
  //    sources order (franchise = s01, cre = s02)
  for (const sp of [franchise, cre]) {
    if (!sp) continue;
    for (const cf of sp.n.corpus_facts) {
      facts.push({
        topic: `${sp.n.brain_id} :: ${cf.topic}`,
        fact: cf.fact,
        value: cf.value,
        source_fragment_ids: [sp.frag.fragment_id],
      });
    }
  }

  return facts;
}

const master: PackDefinition = {
  id: "master",
  brain_id: "master",
  scope:
    "SWFL Intelligence Lake — master index across the verified Franchise Outcomes and CRE Corridors packs (Lee & Collier counties, FL)",
  ttl_seconds: 604800, // refreshes on the same cadence as its sub-packs
  sources: [franchiseIndexSource, creIndexSource],
  // Every sub-pack fragment belongs — positive fit so it survives triage,
  // which lets the corpus facts resolve their s01/s02 citation via byId.
  fitScore: () => 8,
  // A 2-source index has no noise to filter — both fragments always survive.
  compositeCutoff: 0,
  // Pure deterministic pack — no synthesis agent. Every fact is the verbatim,
  // already-verified output of a sub-pack; there is nothing to synthesize and
  // no place for an LLM to re-derive or distort it.
  skipSynthesisAgent: true,
  corpusSummary: masterCorpusSummary,
  subBrainPointers: [
    "Franchise Outcomes — SBA 7(a)/504 franchise loan outcomes, Lee & Collier counties, FL: https://brain-platform-amber.vercel.app/api/b/franchise-outcomes",
    "CRE Corridors — verified Southwest Florida commercial real estate corridor profiles: https://brain-platform-amber.vercel.app/api/b/cre-swfl",
  ],
  preferences: [
    "The user maintains the SWFL Intelligence Lake — verified business intelligence for Lee and Collier County, Florida.",
    "The user treats this master index as a directory: the corpus summaries give the headline figures, and the sub-brain pointers are fetched for record-level detail.",
    "The user expects cross-vertical questions to be answered by consulting both sub-brains, never by inferring links between an individual franchise and an individual corridor.",
  ],
  activeProject:
    "swfl-intelligence-lake: master index aggregating the verified Franchise Outcomes and CRE Corridors packs.",
  prompts: {
    triageContext:
      "These fragments are sub-pack indexes aggregated into a master index — each represents one verified vertical pack. They are all high-relevance reference indexes.",
    // Unused — `skipSynthesisAgent` means the synthesis agent never runs for
    // this pack. Kept as an honest description of why.
    synthesisContext:
      "This pack runs no synthesis agent (skipSynthesisAgent). Every fact is the verbatim, already-verified output of a sub-pack, emitted deterministically by corpusSummary.",
  },
};

export const PACKS: Record<string, PackDefinition> = {
  [franchiseOutcomes.id]: franchiseOutcomes,
  [creSwfl.id]: creSwfl,
  [master.id]: master,
};

export function getPack(id: string): PackDefinition {
  const pack = PACKS[id];
  if (!pack) {
    const known = Object.keys(PACKS).join(", ") || "(none)";
    throw new Error(`Unknown pack "${id}". Known packs: ${known}`);
  }
  return pack;
}
