import type { PackDefinition, PackOutput } from "../types/pack.mts";
import type { RawFragment } from "../types/fragment.mts";
import type { SynthesisFact } from "../types/event.mts";
import type {
  BrainOutput,
  BrainOutputMetric,
  BrainOutputMetricSource,
  BrainOutputProducerResult,
} from "../types/brain-output.mts";
import {
  corridorSource,
  type CorridorNormalized,
  type CorridorMetricDirection,
} from "../sources/cre-source.mts";
import {
  makeBrainInputSource,
  type BrainInputNormalized,
} from "../sources/brain-input-source.mts";
import { env } from "../config/env.mts";

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

/** Stashed permits-swfl OUTPUT — populated by creCorpusSummary, consumed by outputProducer. */

let lastPermitsSwflOutput: BrainOutput | null = null;

/**
 * Extract one upstream brain's BrainOutput from the mixed fragment stream.
 * Same helper pattern as macro-florida.mts — brain-input fragments interleave
 * with corridor fragments in the allFragments array; we filter by kind + id.
 */
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
  field:
    | "cap_rate_pct"
    | "vacancy_rate_pct"
    | "absorption_sqft"
    | "asking_rent_psf",
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

/**
 * Direction summary across a slice of corridor direction reads. Returns the
 * modal direction PLUS a status that distinguishes three cases the call site
 * MUST surface differently in caveats — the earlier `modalDirection` helper
 * collapsed all three to "stable" and fabricated a label where no signal
 * existed.
 *
 *   - "modal":   one bucket strictly wins. Direction is real.
 *   - "tied":    two or more buckets tie for the lead. Direction defaults to
 *                "stable" as the schema-required label; caveats MUST disclose
 *                the split — "stable" here is a tiebreak, not a consensus.
 *   - "no-data": every input was null. Direction defaults to "stable" as the
 *                schema-required label; caveats MUST disclose that no
 *                directional signal was reported.
 *
 * Schema constraint: `BrainOutputMetric.direction` is the closed enum
 * "rising" | "falling" | "stable" — there is no null option. The call site
 * is responsible for converting `status !== "modal"` into a caveat so the
 * fallback label cannot masquerade as a measured trend.
 */
type DirectionSummary = {
  direction: CorridorMetricDirection;
  status: "modal" | "tied" | "no-data";
  counts: Record<CorridorMetricDirection, number>;
};

function summarizeDirection(
  values: (CorridorMetricDirection | null)[],
): DirectionSummary {
  const counts: Record<CorridorMetricDirection, number> = {
    rising: 0,
    falling: 0,
    stable: 0,
  };
  for (const v of values) {
    if (v != null) counts[v] += 1;
  }
  const total = counts.rising + counts.falling + counts.stable;
  if (total === 0) {
    return { direction: "stable", status: "no-data", counts };
  }
  if (counts.falling > counts.rising && counts.falling > counts.stable) {
    return { direction: "falling", status: "modal", counts };
  }
  if (counts.rising > counts.falling && counts.rising > counts.stable) {
    return { direction: "rising", status: "modal", counts };
  }
  if (counts.stable > counts.rising && counts.stable > counts.falling) {
    return { direction: "stable", status: "modal", counts };
  }
  return { direction: "stable", status: "tied", counts };
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
  // Brain-input fragments are already distilled upstream OUTPUT — Stage 2
  // forces their composite to max per the Brain Factory thin-pipe rule.
  if (fragment.source_id.startsWith("brain-input:")) return 8;
  const c = fragment.normalized as unknown as CorridorNormalized;
  let score = 6; // every verified corridor belongs in the pack
  if (c.character) score += 2; // carries a narrative
  if ((c.flags ?? []).length > 0) score += 2; // carries ground-truth flags
  return score;
}

/**
 * Deterministic corpus-level facts for the CRE pack — computed in code, never
 * by the LLM. Covers the five corridor aggregates: corridor count, count by
 * type, count by county, seasonal-index stats, and active-flag stats.
 */
function creCorpusSummary(allFragments: RawFragment[]): SynthesisFact[] {
  // Stash permits-swfl upstream OUTPUT for outputProducer (thin-pipe: read only
  // the distilled OUTPUT block, never the raw permit rows).
  lastPermitsSwflOutput = brainInputFrom(allFragments, "permits-swfl");

  const corridors = allFragments
    .map((f) => f.normalized as unknown as CorridorNormalized)
    .filter((c) => c?.corridor_type != null); // exclude brain-input fragments
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

  const flags = corridors.flatMap((c) => c.flags ?? []);
  const byFlagType: Record<string, number> = {};
  for (const fl of flags) byFlagType[fl.type] = (byFlagType[fl.type] ?? 0) + 1;
  const corridorsWithFlags = corridors.filter(
    (c) => (c.flags ?? []).length > 0,
  ).length;

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

  // Four CRE corpus medians — tagged with `metric:` prefix so they surface in
  // SAVED FACTS alongside the producer's BrainOutput.key_metrics.
  const withCap = corridors.filter((c) => c.cap_rate_pct != null);
  const withVac = corridors.filter((c) => c.vacancy_rate_pct != null);
  const withAbs = corridors.filter((c) => c.absorption_sqft != null);
  const withRent = corridors.filter((c) => c.asking_rent_psf != null);
  const capMedian = medianOf(withCap.map((c) => c.cap_rate_pct as number));
  const vacMedian = medianOf(withVac.map((c) => c.vacancy_rate_pct as number));
  const absMedian = medianOf(withAbs.map((c) => c.absorption_sqft as number));
  const rentMedian = medianOf(withRent.map((c) => c.asking_rent_psf as number));
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
  if (absMedian != null) {
    facts.push({
      topic: "metric:absorption_sqft_median",
      fact: "Median net absorption across SWFL CRE corridors with reported metrics",
      value: `Median net absorption is ${Math.round(absMedian).toLocaleString()} sqft across ${withAbs.length} of ${corridors.length} corridors that have reported metrics this period.`,
      source_fragment_ids: [],
    });
  }
  if (rentMedian != null) {
    facts.push({
      topic: "metric:asking_rent_psf_median",
      fact: "Median asking rent (PSF, NNN) across SWFL CRE corridors with reported metrics",
      value: `Median asking rent is $${round2(rentMedian)}/sqft across ${withRent.length} of ${corridors.length} corridors that have reported metrics this period.`,
      source_fragment_ids: [],
    });
  }

  return facts;
}

/**
 * Per-metric polarity. Each CRE metric's "rising" means something different —
 * we normalize to a polarity-corrected bullish / bearish / neutral side BEFORE
 * pooling.
 *
 *   cap_rate           : falling = bullish (yields compressing)
 *   vacancy_rate       : falling = bullish (space tightening)
 *   absorption_sqft    : rising  = bullish (leasing velocity up)
 *   asking_rent_psf    : rising  = bullish (pricing power)
 *
 * The non-monotone case the handoff flagged (rent ↑ + vacancy ↑ = distress)
 * surfaces correctly as `mixed` here because rent ↑ normalizes to bullish
 * while vacancy ↑ normalizes to bearish — the per-corridor join then sees
 * both sides and emits `mixed`, exactly the distress read.
 */
type CreMetric =
  | "cap_rate"
  | "vacancy_rate"
  | "absorption_sqft"
  | "asking_rent_psf";

type VoteSide = "bullish" | "bearish" | "neutral";

const BULLISH_WHEN: Record<CreMetric, "rising" | "falling"> = {
  cap_rate: "falling",
  vacancy_rate: "falling",
  absorption_sqft: "rising",
  asking_rent_psf: "rising",
};

function metricVote(
  metric: CreMetric,
  dir: CorridorMetricDirection | null,
): VoteSide | null {
  if (dir == null) return null;
  if (dir === "stable") return "neutral";
  return dir === BULLISH_WHEN[metric] ? "bullish" : "bearish";
}

/**
 * Per-corridor direction read from the polarity-normalized signal suite:
 *   - any "bullish" AND any "bearish"  → "mixed" corridor (split read)
 *   - any "bullish", no "bearish"      → "bullish" (landlord market)
 *   - any "bearish", no "bullish"      → "bearish" (distress)
 *   - all neutral (stable values only) → "neutral"
 *   - all signals null                 → "no-data"
 */
type CorridorVote = "bullish" | "bearish" | "mixed" | "neutral" | "no-data";

function voteCorridor(c: CorridorNormalized): CorridorVote {
  const sides = [
    metricVote("cap_rate", c.cap_rate_direction),
    metricVote("vacancy_rate", c.vacancy_rate_direction),
    metricVote("absorption_sqft", c.absorption_sqft_direction),
    metricVote("asking_rent_psf", c.asking_rent_psf_direction),
  ].filter((s): s is VoteSide => s != null);

  if (sides.length === 0) return "no-data";
  const hasBullish = sides.includes("bullish");
  const hasBearish = sides.includes("bearish");
  if (hasBullish && hasBearish) return "mixed";
  if (hasBullish) return "bullish";
  if (hasBearish) return "bearish";
  return "neutral";
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
      `${noData} of ${corridors.length} corridors have no reported metrics — direction is read from the ${withData.length} corridors with data.`,
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
  //
  // Magnitude is the leading directional share among corridors with signal —
  // `max(bullishRatio, bearishRatio)` — bounded to [0, 0.60) here by
  // construction (≥ 0.60 would have triggered the bullish/bearish branch
  // above). The edge case where bullish=bearish=0 and only per-corridor
  // `mixed` reads exist yields magnitude 0, which is the honest read: neither
  // side dominates. This is the deterministic strength-of-read, NOT a
  // confidence (which is computed separately in lib/confidence.mts from
  // trust tiers + freshness). Source: this file, voteCreDirection.
  if (bullish > 0 || bearish > 0 || mixed > 0) {
    return {
      direction: "mixed",
      magnitude: Math.max(bullishRatio, bearishRatio),
      caveats,
    };
  }
  // All neutral (everything stable) — emit neutral with magnitude scaled by
  // how unanimous "stable" was (loudly neutral when every corridor is stable).
  return { direction: "neutral", magnitude: neutral / total, caveats };
}

/**
 * CRE producer — emits cap_rate_median + vacancy_rate_median +
 * absorption_sqft_median + asking_rent_psf_median as headline key_metrics and
 * votes a deterministic direction from the polarity-normalized per-corridor
 * signal suite (see metricVote / voteCorridor).
 */
function creSwflOutputProducer(out: PackOutput): BrainOutputProducerResult {
  const corridors = lastCorridors;
  const withCap = corridors.filter((c) => c.cap_rate_pct != null);
  const withVac = corridors.filter((c) => c.vacancy_rate_pct != null);
  const withAbs = corridors.filter((c) => c.absorption_sqft != null);
  const withRent = corridors.filter((c) => c.asking_rent_psf != null);
  const capMedian = medianOf(withCap.map((c) => c.cap_rate_pct as number));
  const vacMedian = medianOf(withVac.map((c) => c.vacancy_rate_pct as number));
  const absMedian = medianOf(withAbs.map((c) => c.absorption_sqft as number));
  const rentMedian = medianOf(withRent.map((c) => c.asking_rent_psf as number));

  // Direction summaries computed once per metric — the `status` field drives
  // per-metric caveats below so a "stable" fallback label can't masquerade as
  // a measured trend.
  const capDir = summarizeDirection(withCap.map((c) => c.cap_rate_direction));
  const vacDir = summarizeDirection(
    withVac.map((c) => c.vacancy_rate_direction),
  );
  const absDir = summarizeDirection(
    withAbs.map((c) => c.absorption_sqft_direction),
  );
  const rentDir = summarizeDirection(
    withRent.map((c) => c.asking_rent_psf_direction),
  );

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
      direction: capDir.direction,
      label: `Median SWFL CRE cap rate (${withCap.length} of ${corridors.length} corridors)`,
      variable_type: "intensive",
      units: "percent",
      display_format: "percent",
      source: buildCreAggregateSource("cap_rate_pct", withCap, fetched_at),
    });
  }
  if (vacMedian != null) {
    key_metrics.push({
      metric: "vacancy_rate_median",
      value: Math.round(vacMedian * 100) / 100,
      direction: vacDir.direction,
      label: `Median SWFL CRE vacancy rate (${withVac.length} of ${corridors.length} corridors)`,
      variable_type: "intensive",
      units: "percent",
      display_format: "percent",
      source: buildCreAggregateSource("vacancy_rate_pct", withVac, fetched_at),
    });
  }
  if (absMedian != null) {
    key_metrics.push({
      metric: "absorption_sqft_median",
      value: Math.round(absMedian),
      direction: absDir.direction,
      label: `Median SWFL CRE net absorption (${withAbs.length} of ${corridors.length} corridors)`,
      variable_type: "extensive",
      units: "sqft",
      display_format: "count",
      source: buildCreAggregateSource("absorption_sqft", withAbs, fetched_at),
    });
  }
  if (rentMedian != null) {
    key_metrics.push({
      metric: "asking_rent_psf_median",
      value: Math.round(rentMedian * 100) / 100,
      direction: rentDir.direction,
      label: `Median SWFL CRE asking rent PSF NNN (${withRent.length} of ${corridors.length} corridors)`,
      variable_type: "intensive",
      units: "USD/sqft",
      display_format: "currency",
      source: buildCreAggregateSource("asking_rent_psf", withRent, fetched_at),
    });
  }

  const vote = voteCreDirection(corridors);

  // Per-metric direction-confidence caveats. Only emitted for metrics that
  // ship a value (n > 0); a metric with no value also has no row in
  // key_metrics, so its direction can't mislead anyone.
  const directionGuards = [
    ["cap_rate_median", capDir, withCap.length] as const,
    ["vacancy_rate_median", vacDir, withVac.length] as const,
    ["absorption_sqft_median", absDir, withAbs.length] as const,
    ["asking_rent_psf_median", rentDir, withRent.length] as const,
  ];
  for (const [name, sum, n] of directionGuards) {
    if (n === 0) continue;
    if (sum.status === "no-data") {
      vote.caveats.push(
        `${name}: ${n} corridor${n === 1 ? "" : "s"} report a value but none reports a direction — the "stable" label on this metric is a schema-required fallback, not a measured trend.`,
      );
    } else if (sum.status === "tied") {
      vote.caveats.push(
        `${name}: directional reads are tied (rising ${sum.counts.rising}, falling ${sum.counts.falling}, stable ${sum.counts.stable}) — no modal winner; "stable" is the tiebreak label, not a consensus signal.`,
      );
    }
  }

  // Conclusion: each metric stands on its own — no AND-gating between
  // cap/vac and abs/rent pairs. A populated absorption read must not be
  // silently dropped because asking_rent is null (or vice versa).
  const conclusionParts: string[] = [];
  if (corridors.length > 0) {
    conclusionParts.push(
      `The SWFL CRE pack covers ${corridors.length} verified corridors across Lee and Collier counties.`,
    );
  }
  const metricLines: string[] = [];
  if (capMedian != null) {
    metricLines.push(
      `median cap rate ${round2(capMedian)}% (${capDir.direction})`,
    );
  }
  if (vacMedian != null) {
    metricLines.push(
      `median vacancy ${round2(vacMedian)}% (${vacDir.direction})`,
    );
  }
  if (absMedian != null) {
    metricLines.push(
      `median net absorption ${Math.round(absMedian).toLocaleString()} sqft (${absDir.direction})`,
    );
  }
  if (rentMedian != null) {
    metricLines.push(
      `median asking rent $${round2(rentMedian)}/sqft NNN (${rentDir.direction})`,
    );
  }
  if (metricLines.length > 0) {
    conclusionParts.push(`Quantified reads: ${metricLines.join("; ")}.`);
  } else {
    conclusionParts.push(
      "Cap-rate, vacancy, absorption, and asking-rent metrics are not yet populated for enough corridors to anchor a median read.",
    );
  }
  if (vote.direction === "bullish") {
    conclusionParts.push(
      "Polarity-normalized corridor signals lean predominantly landlord-market — rates compressing, space tightening, leasing velocity up, or pricing power present.",
    );
  } else if (vote.direction === "bearish") {
    conclusionParts.push(
      "Polarity-normalized corridor signals lean predominantly distressed — yields widening, space emptying, absorption falling, or rents giving back.",
    );
  } else if (vote.direction === "mixed") {
    conclusionParts.push(
      "Corridor signals split between landlord-market and distress reads — no consensus direction at the SWFL CRE level. Common driver: asking rent rising alongside vacancy rising (asking-price stickiness, not pricing power).",
    );
  }

  // --- permits-swfl thin-pipe signal ---
  // Read ONLY the three named scalars from permits-swfl's distilled OUTPUT.
  // Never reads raw permit rows — thin-pipe rule enforced here.
  const permitsSignalSource = {
    url: "brain://permits-swfl",
    fetched_at: lastPermitsSwflOutput?.refined_at ?? fetched_at,
    tier: 2 as const,
    citation:
      "permits-swfl distilled OUTPUT — Lee County building permit saturation index and corridor-weighted z (thin-pipe read).",
  };
  if (lastPermitsSwflOutput != null) {
    const pm = lastPermitsSwflOutput.key_metrics;
    const satMetric = pm.find(
      (m) => m.metric === "permits_lee_saturation_index",
    );
    const zMetric = pm.find(
      (m) => m.metric === "permits_lee_county_weighted_avg_corridor_z",
    );
    const topHeatMetric = pm.find(
      (m) => m.metric === "permits_lee_top_heating_commercial_alteration",
    );

    const satValue =
      typeof satMetric?.value === "number" ? satMetric.value : null;
    const zValue = typeof zMetric?.value === "number" ? zMetric.value : null;
    const topHeat =
      typeof topHeatMetric?.value === "string" && topHeatMetric.value.length > 0
        ? topHeatMetric.value
        : null;

    if (satValue != null) {
      const satPct = (satValue * 100).toFixed(0);
      if (satValue >= 0.4) {
        // High saturation — contrarian "late mover into a crowd" framing.
        const heatClause =
          topHeat != null
            ? ` Top heating corridors (commercial alteration): ${topHeat}.`
            : "";
        key_metrics.push({
          metric: "permits_lee_saturation_signal",
          value: satValue,
          direction: "rising",
          label: `Lee County permit saturation — ${satPct}% of corridors above +2σ (contrarian: late mover into a crowd)`,
          variable_type: "intensive",
          units: "share",
          display_format: "percent",
          source: permitsSignalSource,
        });
        conclusionParts.push(
          `Permit saturation: ${satPct}% of Lee corridors are running above +2σ in commercial buckets — a late-mover-into-a-crowd signal.${heatClause}`,
        );
      } else if (zValue != null) {
        // Low-to-moderate saturation — surface the county-weighted z as a capital-flow read.
        key_metrics.push({
          metric: "permits_lee_capital_flow_z",
          value: zValue,
          direction:
            zValue > 0.1 ? "rising" : zValue < -0.1 ? "falling" : "stable",
          label: `Lee County permits — corridor-weighted z (capital-flow direction, 90d vs trailing-365d)`,
          variable_type: "intensive",
          units: "z-score",
          display_format: "ratio",
          source: permitsSignalSource,
        });
        conclusionParts.push(
          `Permit capital flow: Lee County corridor-weighted z = ${zValue.toFixed(2)} (${zValue > 0.1 ? "above baseline" : zValue < -0.1 ? "below baseline" : "near baseline"}).`,
        );
      }
    }
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

export const creSwfl: PackDefinition = {
  id: "cre-swfl",
  brain_id: "cre-swfl",
  domain: "real-estate",
  scope:
    "SWFL commercial real estate corridors — verified corridor intelligence (profiles, character, active flags)",
  ttl_seconds: 604800, // corridor intelligence is editorial, slow-moving
  sources: [corridorSource, makeBrainInputSource("permits-swfl")],
  input_brains: [{ id: "permits-swfl", edge_type: "input" }],
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
      "- Weave in the character narrative, evolution_direction, and tenant_mix where present. Some corridors have a null character — omit it gracefully, never invent prose. Quote character text verbatim — never paraphrase, never add softening words like 'approximately', 'about', 'roughly', 'around', or 'nearly' to any measurement or distance in the character field.",
      "- Surface the active_flags by name — they are the ground-truth intelligence layer (infrastructure, new projects, regulatory shifts, status changes a broker cannot get from public listings). This is the crown-jewel intel of the pack.",
      "",
      "Do NOT compute numeric cross-fragment aggregates — corridor counts, county splits, seasonal-index stats, and flag counts are all computed deterministically and prepended as separate facts. Qualitative observations (patterns and themes across corridors) are yours.",
    ].join("\n"),
  },
};
