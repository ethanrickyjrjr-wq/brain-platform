import type { PackDefinition } from "../types/pack.mts";
import type { RawFragment } from "../types/fragment.mts";
import type { SynthesisFact } from "../types/event.mts";
import {
  franchiseSource,
  type FranchiseNormalized,
} from "../sources/franchise-source.mts";

/**
 * Pack registry. The Refinery engine is pack-agnostic — a pack is just this
 * config object. Adding a vertical = adding an entry here + a source connector.
 *
 * NOTE: the CRE pack (`cre-swfl`) is intentionally NOT registered yet. It is
 * plan step 7 — built after the Franchise pack proves the engine end-to-end,
 * and it requires confirming the `corridorProfile` schema/count on Sanity
 * `go8u2esq` via `get_schema` first.
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
      .map((n) => `${n.franchise_name} (${n.n_charged_off}/${n.n_loans})`)
      .join("; ");
    facts.push({
      topic: "chargeoff_summary",
      fact: "Every franchise brand in the dataset that recorded an SBA loan charge-off",
      value:
        `${chargeoff.length} brands recorded at least one charge-off — ${totalChargedOff} loans ` +
        `charged off in total. Worst performer by survival rate: ${worst.franchise_name} ` +
        `(${worst.survival_rate ?? 0}% survival — ${worst.n_charged_off} of ${resolvedOf(worst)} ` +
        `resolved loans charged off). Full list (loans charged off / total loans): ${named}.`,
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

export const PACKS: Record<string, PackDefinition> = {
  [franchiseOutcomes.id]: franchiseOutcomes,
};

export function getPack(id: string): PackDefinition {
  const pack = PACKS[id];
  if (!pack) {
    const known = Object.keys(PACKS).join(", ") || "(none)";
    throw new Error(`Unknown pack "${id}". Known packs: ${known}`);
  }
  return pack;
}
