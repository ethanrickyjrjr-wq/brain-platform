import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { PackDefinition, PackOutput } from "../types/pack.mts";
import type { RawFragment } from "../types/fragment.mts";
import type { SynthesisFact } from "../types/event.mts";
import type {
  BrainOutput,
  BrainOutputMetric,
  BrainOutputMetricSource,
  BrainOutputProducerResult,
} from "../types/brain-output.mts";

// ICP + output rules for the CRE synthesis agent — strips YAML frontmatter.
const CRE_BROKER_PROFILE = readFileSync(
  fileURLToPath(new URL("../context/cre-broker-profile.md", import.meta.url)),
  "utf-8",
).replace(/^---[\s\S]*?---\n/, "");
import {
  corridorSource,
  groupCorridorsBySubmarket,
  type CorridorNormalized,
  type CorridorMetricDirection,
  type JoinedSubmarketGroup,
} from "../sources/cre-source.mts";
import {
  marketbeatSwflSource,
  type MarketbeatSwflNormalized,
} from "../sources/marketbeat-swfl-source.mts";
import { submarketSlug } from "../lib/marketbeat-submarket-aliases.mts";
import { displayNameFor } from "../lib/corridor-display.mts";
import {
  makeBrainInputSource,
  type BrainInputNormalized,
} from "../sources/brain-input-source.mts";
import { env } from "../config/env.mts";
import {
  computeCorridorFactor,
  bandFor,
  DEFAULT_CORRIDOR_FACTOR_CONFIG,
  type CorridorFactorInput,
} from "../lib/derived/corridor-factor.mts";

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
 * Stashed corridor-pulse contribution signal — populated by creCorpusSummary,
 * consumed by creSwflOutputProducer to emit ONE deterministic count key_metric
 * (`corridor_pulse_signals_live`). master gates its "ask about a specific area"
 * grain-boundary route on this count > 0 — gate on REAL contribution, not on
 * cre being wired: corridor-pulse is TTL-bounded and can empty while cre still
 * votes. The representative source receipt rides along so the count metric is a
 * well-formed citation. Thin-pipe intact — this is cre's distilled OUTPUT, never
 * corridor-pulse internals.
 */

let lastCorridorPulseSignalCount = 0;

let lastCorridorPulseSource: BrainOutputMetric["source"] | null = null;

/**
 * Stashed MarketBeat rows — populated by creCorpusSummary, consumed by
 * outputProducer. Each entry is one submarket at its latest verified quarter
 * (the source already applied the verified-filter + latest-per-submarket pick).
 */

let lastMarketbeatRows: MarketbeatSwflNormalized[] = [];

let lastMarketbeatFetchedAt: string | null = null;

/**
 * Stashed corridor-by-submarket join — populated by creCorpusSummary, consumed
 * by outputProducer to emit per-submarket MarketBeat key_metrics. Initialized
 * to an empty-but-defined value so the producer doesn't need a null branch;
 * the reset-at-top-of-creCorpusSummary block re-establishes that shape on
 * every run, so a stale prior-run join cannot bleed through.
 */

let lastJoinedBySubmarket: ReturnType<typeof groupCorridorsBySubmarket> = {
  matched: new Map(),
  unmatched: [],
};

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

const METRIC_SOURCE_FIELD = {
  cap_rate_pct: "cap_rate_source_url",
  vacancy_rate_pct: "vacancy_rate_source_url",
  absorption_sqft: "absorption_sqft_source_url",
  asking_rent_psf: "asking_rent_psf_source_url",
} as const satisfies Record<
  "cap_rate_pct" | "vacancy_rate_pct" | "absorption_sqft" | "asking_rent_psf",
  keyof CorridorNormalized
>;

function resolveMetricSource(
  c: CorridorNormalized,
  field: keyof typeof METRIC_SOURCE_FIELD,
): string | null {
  return (c[METRIC_SOURCE_FIELD[field]] as string | null) ?? c.source_url;
}

/**
 * Build a BrainOutputMetricSource for a cre-swfl aggregate metric.
 *
 * The URL is the reproducible PostgREST query against Brains Supabase
 * (`{SUPABASE_URL}/rest/v1/corridor_profiles?...`), filtered to the
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
      const resolved = resolveMetricSource(c, field);
      const tail = resolved ? ` [${resolved}]` : "";
      return `${displayNameFor(c.name)} (${c.city}, ${c.county})${tail}`;
    })
    .join("; ");
  return {
    url,
    fetched_at,
    tier: 2,
    citation: `Brains Supabase corridor_profiles (verified, non-deleted) — median across ${contributing.length} corridors reporting ${field}: ${named}.`,
  };
}

/**
 * Build a BrainOutputMetricSource for a MarketBeat aggregate metric.
 *
 * The denominator is broker-survey submarkets (Naples / Fort Myers / etc.),
 * NOT corridors — different shape and different freshness cadence than the
 * corridor-median blocks, which is why MarketBeat metrics live as their own
 * Option-A blocks rather than merging into the corridor medians.
 *
 * The citation enumerates the contributing submarkets with their reporting
 * quarter and source_url (when present), so a reader can trace any MarketBeat
 * value back to the originating broker report.
 */
function buildMarketbeatAggregateSource(
  field: "vacancy_rate" | "asking_rent_nnn",
  contributing: MarketbeatSwflNormalized[],
  fetched_at: string,
): BrainOutputMetricSource {
  const url =
    env.source === "live" && env.supabaseUrl
      ? `${env.supabaseUrl}/rest/v1/marketbeat_swfl?select=*&verified=eq.true&${field}=not.is.null`
      : "fixture://refinery/__fixtures__/marketbeat-swfl.sample.json";
  const named = contributing
    .map((r) => {
      const tail = r.source_url ? ` [${r.source_url}]` : "";
      return `${r.submarket} ${r.quarter}${tail}`;
    })
    .join("; ");
  return {
    url,
    fetched_at,
    tier: 2,
    citation: `MarketBeat SWFL CRE quarterly — median across ${contributing.length} submarket${contributing.length === 1 ? "" : "s"} reporting ${field}: ${named}.`,
  };
}

/**
 * Build a BrainOutputMetricSource for a per-submarket MarketBeat metric.
 *
 * The URL is the reproducible PostgREST query against Brains Supabase,
 * scoped to this one submarket via `submarket=eq.{encodedSubmarket}` so a
 * disputant can fetch exactly the rows that produced the value. Every
 * multi-word submarket ("Fort Myers", "Cape Coral", "Bonita Springs",
 * "Fort Myers Beach") MUST be URL-encoded — a raw space yields an
 * invalid HTTP request that PostgREST rejects or silently zero-results.
 *
 * Citation discloses `matched X of Y mapped` where Y is the alias-table
 * denominator captured at join time on the group — do NOT re-call
 * `corridorsForSubmarket()` here.
 */
function buildMarketbeatSubmarketSource(
  field: "vacancy_rate" | "asking_rent_nnn" | "absorption_sqft",
  group: JoinedSubmarketGroup,
  fetched_at: string,
): BrainOutputMetricSource {
  const encodedSubmarket = encodeURIComponent(group.submarket);
  const url =
    env.source === "live" && env.supabaseUrl
      ? `${env.supabaseUrl}/rest/v1/marketbeat_swfl?select=*&verified=eq.true&submarket=eq.${encodedSubmarket}&${field}=not.is.null`
      : "fixture://refinery/__fixtures__/marketbeat-swfl.sample.json";
  const matchedNames = group.corridors
    .map((c) => displayNameFor(c.name))
    .join(", ");
  const matchedDisclosure =
    group.corridors.length > 0
      ? `covers ${matchedNames} (matched ${group.corridors.length} of ${group.mappedCorridorNames.length} mapped in MARKETBEAT_SUBMARKET_MAP)`
      : `covers 0 of ${group.mappedCorridorNames.length} mapped corridors in the verified corpus this run`;
  const tail = group.row.source_url ? ` [${group.row.source_url}]` : "";
  return {
    url,
    fetched_at,
    tier: 2,
    citation: `MarketBeat ${group.submarket} ${group.row.quarter} — ${field} across the ${group.submarket} submarket; ${matchedDisclosure}${tail}.`,
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
  // MarketBeat submarket aggregates — quantitative, broker-verified, already
  // distilled to one row per submarket per quarter. Score above the bare
  // verified-corridor floor (6) but below the upstream brain ceiling (8).
  if (fragment.source_id === "marketbeat_swfl") return 7;
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
  // Reset every per-run stash at the very top — a typo'd reset is a silent
  // no-op that lets the prior run's state bleed through. Variable names are
  // grep-verified against the stash declarations above; do not copy-paste.
  // This also closes the cre-swfl-singleton-reset backlog item.
  lastPermitsSwflOutput = null;
  lastCorridors = [];
  lastCorridorFetchedAt = null;
  lastMarketbeatRows = [];
  lastMarketbeatFetchedAt = null;
  lastJoinedBySubmarket = { matched: new Map(), unmatched: [] };
  lastCorridorPulseSignalCount = 0;
  lastCorridorPulseSource = null;

  // Stash permits-swfl upstream OUTPUT for outputProducer (thin-pipe: read only
  // the distilled OUTPUT block, never the raw permit rows).
  lastPermitsSwflOutput = brainInputFrom(allFragments, "permits-swfl");

  // Stash MarketBeat fragments separately — they have a different normalized
  // shape (no corridor_type, no per-corridor direction reads) and feed Option-A
  // separate-block key_metrics rather than merging into corridor medians.
  const marketbeatFragments = allFragments.filter(
    (f) =>
      (f.normalized as { kind?: string } | null)?.kind === "marketbeat-swfl",
  );
  lastMarketbeatRows = marketbeatFragments.map(
    (f) => f.normalized as unknown as MarketbeatSwflNormalized,
  );
  lastMarketbeatFetchedAt = marketbeatFragments[0]?.fetched_at ?? null;

  const corridors = allFragments
    .map((f) => f.normalized as unknown as CorridorNormalized)
    .filter((c) => c?.corridor_type != null); // exclude brain-input + marketbeat fragments
  // Stash for creSwflOutputProducer — typed values + nullable metric fields can't
  // survive in SynthesisFact.value (string-only). Same pattern as macro-swfl.
  lastCorridors = corridors;
  // Pre-compute the corridor-by-submarket join once. The producer iterates
  // matched.values() to emit per-submarket key_metrics + caveats; keeping the
  // join here (not in the producer) means the cre-source helper is the only
  // place that knows the alias-table denominator shape.
  lastJoinedBySubmarket = groupCorridorsBySubmarket(
    corridors,
    lastMarketbeatRows,
  );
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

  // --- corridor-pulse-swfl thin-pipe context (Build #2, Option 4) ---
  // SCOPE (verified against master.mts + synth.mts:rollupKeyMetrics): these facts feed
  // cre-swfl's SYNTHESIS-AGENT NARRATIVE only (the human-facing .md prose). They do NOT
  // enter cre-swfl's deterministic `--- OUTPUT ---` (key_metrics/caveats/direction are
  // built by creSwflOutputProducer from closure state, not from these facts), so by
  // design they do NOT bubble into master's metro dossier — master reads only each
  // upstream's OUTPUT key_metrics (top 1-2 via rollupKeyMetrics, cap t1Count+1) +
  // caveats + direction, never an upstream's corpusSummary topics. Per-corridor news
  // therefore stays at corridor grain (its real surface is the corridor-pulse-swfl
  // brain's own page); this only nudges cre-swfl's drill-down narrative. Adds NO
  // key_metric and does not touch the corridor-median direction math. The brain-input
  // edge also keeps corridor-pulse-swfl in master's transitive build DAG so it renders
  // nightly (it is NOT a direct master input). Reads the distilled OUTPUT only —
  // never the raw data_lake.city_pulse_corridors rows (thin-pipe rule).
  //
  // Cap source: corpus-budget constraint, not UI. cre-swfl's corpus already carries
  // ~12+ deterministic facts (4 corridor medians + per-submarket MarketBeat + permits);
  // 6 caps the corridor-news context so the synthesis prompt stays bounded.
  const CORRIDOR_PULSE_NARRATIVE_CAP = 6;
  // source_fragment_ids stays [] — matches master.mts:masterCorpusSummary convention
  // for brain-input-derived facts; corridorPulseOutput is a BrainOutput (no fragment_id),
  // and deterministic provenance rides on each upstream metric's own `source` receipt.
  const corridorPulseOutput = brainInputFrom(
    allFragments,
    "corridor-pulse-swfl",
  );
  if (corridorPulseOutput != null) {
    const signals = corridorPulseOutput.key_metrics.filter((m) =>
      m.metric.startsWith("signal_"),
    );
    // Contribution signal for master's grain-boundary route gate (B1). Stash the
    // FULL live count (pre-narrative-cap) + a representative source receipt for
    // creSwflOutputProducer to emit as one deterministic count key_metric.
    lastCorridorPulseSignalCount = signals.length;
    lastCorridorPulseSource = signals[0]?.source ?? null;
    for (const s of signals.slice(0, CORRIDOR_PULSE_NARRATIVE_CAP)) {
      facts.push({
        topic: "corridor-pulse:recent",
        fact:
          typeof s.label === "string" && s.label.length > 0
            ? s.label
            : s.metric,
        value: `${String(s.value)} (source: ${s.source?.url ?? "brain://corridor-pulse-swfl"})`,
        source_fragment_ids: [],
      });
    }
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

  // --- MarketBeat (Option A: separate blocks) -------------------------
  // Submarket-level broker-survey aggregates land as their own key_metrics —
  // never merged with the corridor-median blocks above. Different denominator
  // (submarket vs corridor), different freshness cadence (broker quarterly vs
  // editorial), different source_url per row. Per the firecrawl-pipeline-skeleton
  // plan, merging would average across incompatible bases and silently lose
  // the freshness signal.
  const mbRows = lastMarketbeatRows;
  const mbFetchedAt = lastMarketbeatFetchedAt ?? fetched_at;
  const mbWithVac = mbRows.filter((r) => r.vacancy_rate != null);
  const mbWithRent = mbRows.filter((r) => r.asking_rent_nnn != null);
  const mbVacMedian = medianOf(mbWithVac.map((r) => r.vacancy_rate as number));
  const mbRentMedian = medianOf(
    mbWithRent.map((r) => r.asking_rent_nnn as number),
  );
  // Latest quarter present in the contributing rows — surfaced in the label so
  // a reader sees the freshness anchor without leaving the OUTPUT block.
  const mbLatestQuarter =
    mbRows.length > 0
      ? mbRows
          .map((r) => r.quarter)
          .sort()
          .at(-1)
      : null;
  if (mbVacMedian != null) {
    key_metrics.push({
      metric: "vacancy_rate_marketbeat_swfl",
      value: Math.round(mbVacMedian * 100) / 100,
      direction: "stable",
      label: `MarketBeat SWFL vacancy rate — median across ${mbWithVac.length} submarket${mbWithVac.length === 1 ? "" : "s"}${mbLatestQuarter ? ` (latest: ${mbLatestQuarter})` : ""}`,
      variable_type: "intensive",
      units: "percent",
      display_format: "percent",
      source: buildMarketbeatAggregateSource(
        "vacancy_rate",
        mbWithVac,
        mbFetchedAt,
      ),
    });
  }
  if (mbRentMedian != null) {
    key_metrics.push({
      metric: "asking_rent_nnn_marketbeat_swfl",
      value: Math.round(mbRentMedian * 100) / 100,
      direction: "stable",
      label: `MarketBeat SWFL asking rent NNN — median across ${mbWithRent.length} submarket${mbWithRent.length === 1 ? "" : "s"}${mbLatestQuarter ? ` (latest: ${mbLatestQuarter})` : ""}`,
      variable_type: "intensive",
      units: "USD/sqft",
      display_format: "currency",
      source: buildMarketbeatAggregateSource(
        "asking_rent_nnn",
        mbWithRent,
        mbFetchedAt,
      ),
    });
  }

  // --- MarketBeat per-submarket fan-out (augments the SWFL-wide medians) ---
  // Break the SWFL-wide medians apart into one key_metric per submarket-per-family
  // so a Naples 4.8% vacancy doesn't get averaged into a Fort Myers 8.2% read.
  // Today's SWFL-wide blocks stay intact (augment, not replace) — master and any
  // downstream consumers on contract today keep their existing keys.
  const emittedSubmarketSlugs: Record<
    "vacancy_rate" | "asking_rent_nnn" | "absorption_sqft",
    string[]
  > = { vacancy_rate: [], asking_rent_nnn: [], absorption_sqft: [] };
  const zeroMatchedCaveatGroups: JoinedSubmarketGroup[] = [];

  for (const group of lastJoinedBySubmarket.matched.values()) {
    const slug = submarketSlug(group.submarket);
    const row = group.row;
    const willEmitAny =
      row.vacancy_rate != null ||
      row.asking_rent_nnn != null ||
      row.absorption_sqft != null;
    if (willEmitAny && group.corridors.length === 0) {
      zeroMatchedCaveatGroups.push(group);
    }
    if (row.vacancy_rate != null) {
      const metricName = `vacancy_rate_marketbeat_${slug}`;
      key_metrics.push({
        metric: metricName,
        value: Math.round(row.vacancy_rate * 100) / 100,
        direction: "stable",
        label: `MarketBeat ${group.submarket} vacancy rate (${row.quarter})`,
        variable_type: "intensive",
        units: "percent",
        display_format: "percent",
        source: buildMarketbeatSubmarketSource(
          "vacancy_rate",
          group,
          mbFetchedAt,
        ),
      });
      emittedSubmarketSlugs.vacancy_rate.push(metricName);
    }
    if (row.asking_rent_nnn != null) {
      const metricName = `asking_rent_nnn_marketbeat_${slug}`;
      key_metrics.push({
        metric: metricName,
        value: Math.round(row.asking_rent_nnn * 100) / 100,
        direction: "stable",
        label: `MarketBeat ${group.submarket} asking rent NNN (${row.quarter})`,
        variable_type: "intensive",
        units: "USD/sqft",
        display_format: "currency",
        source: buildMarketbeatSubmarketSource(
          "asking_rent_nnn",
          group,
          mbFetchedAt,
        ),
      });
      emittedSubmarketSlugs.asking_rent_nnn.push(metricName);
    }
    if (row.absorption_sqft != null) {
      const metricName = `absorption_sqft_marketbeat_${slug}`;
      key_metrics.push({
        metric: metricName,
        value: Math.round(row.absorption_sqft),
        direction: "stable",
        label: `MarketBeat ${group.submarket} net absorption (${row.quarter})`,
        variable_type: "extensive",
        units: "sqft",
        display_format: "count",
        source: buildMarketbeatSubmarketSource(
          "absorption_sqft",
          group,
          mbFetchedAt,
        ),
      });
      emittedSubmarketSlugs.absorption_sqft.push(metricName);
    }
  }

  // --- corridor-pulse contribution signal (B1) -------------------------------
  // ONE deterministic count key_metric so master can gate its "ask about a
  // specific area" grain-boundary route on REAL contribution (count > 0), not on
  // cre merely being wired — corridor-pulse is TTL-bounded and can empty while
  // cre still votes (an unconditional route is the inverse-FMB false-offer bug).
  // Placed after cre's median + MarketBeat blocks. Load-bearing invariant:
  // rollupKeyMetrics only ever lifts each upstream's key_metrics[0]/[1] into
  // master's dossier, and those slots are cre's cap/vacancy medians — so this
  // count never displaces them there. composeGrainBoundary, by contrast, reads
  // the FULL array and still sees it. Thin-pipe intact: cre's distilled OUTPUT,
  // never corridor-pulse internals.
  if (lastCorridorPulseSignalCount > 0 && lastCorridorPulseSource != null) {
    key_metrics.push({
      metric: "corridor_pulse_signals_live",
      value: lastCorridorPulseSignalCount,
      direction: "stable",
      label: `Live corridor current-events signals informing this read (${lastCorridorPulseSignalCount})`,
      variable_type: "extensive",
      units: "count",
      display_format: "count",
      source: lastCorridorPulseSource,
    });
  }

  // --- corridor_factor (composite corridor health index) ---
  // Inputs come from lastCorridors (pack-internal closure state populated by
  // corridorSource — Tier 2 corridor_profiles). No reads from master,
  // housing-swfl, or any brain that cre-swfl feeds downstream. DAG safe.
  const cfInputs: CorridorFactorInput[] = corridors.map((c) => ({
    name: c.name,
    cap_rate_pct: c.cap_rate_pct,
    vacancy_rate_pct: c.vacancy_rate_pct,
    absorption_sqft: c.absorption_sqft,
    asking_rent_psf: c.asking_rent_psf,
  }));
  const cfResults = computeCorridorFactor(cfInputs);
  const cfScores = cfResults
    .map((r) => r.score)
    .filter((s): s is number => s !== null);
  const cfMedian = medianOf(cfScores);
  if (cfMedian != null) {
    const cfUrl =
      env.source === "live" && env.supabaseUrl
        ? `${env.supabaseUrl}/rest/v1/corridor_profiles?select=*&verification_status=eq.verified&deleted_at=is.null`
        : "fixture://refinery/__fixtures__/corridor-profiles.sample.json";
    key_metrics.push({
      metric: "corridor_factor",
      value: Math.round(cfMedian),
      direction: "stable",
      label: `Corridor Factor — SWFL CRE composite index (${cfScores.length} of ${corridors.length} corridors scored)`,
      variable_type: "intensive",
      units: "index 0-100",
      display_format: "raw",
      source: {
        url: cfUrl,
        fetched_at,
        tier: 2,
        citation: `Brains Supabase corridor_profiles (verified, non-deleted) — Corridor Factor composite: percentile-rank of cap_rate_pct (lower_is_better), vacancy_rate_pct (lower_is_better), absorption_sqft (higher_is_better), asking_rent_psf (higher_is_better); equal weights; corridor-health/landlord lens. Scored ${cfScores.length} of ${corridors.length} corridors.`,
      },
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

  // MarketBeat blocks ship point-in-time medians — direction is always set to
  // "stable" as a schema-required label, never measured. Disclose explicitly
  // for each block that ships a value so the fallback can't masquerade as a
  // trend read.
  if (mbVacMedian != null) {
    vote.caveats.push(
      `vacancy_rate_marketbeat_swfl: ${mbWithVac.length} submarket${mbWithVac.length === 1 ? "" : "s"} report a point-in-time value; v1 does not compute quarter-over-quarter direction, so the "stable" label is a schema-required fallback, not a measured trend.`,
    );
  }
  if (mbRentMedian != null) {
    vote.caveats.push(
      `asking_rent_nnn_marketbeat_swfl: ${mbWithRent.length} submarket${mbWithRent.length === 1 ? "" : "s"} report a point-in-time value; v1 does not compute quarter-over-quarter direction, so the "stable" label is a schema-required fallback, not a measured trend.`,
    );
  }

  // --- Per-submarket MarketBeat caveats ---
  // One rollup-direction caveat per family that actually emitted any metric.
  // Slug lists are built dynamically from the emit loop above so the caveat
  // text names the exact keys that shipped this run — no template-glob wording.
  const FAMILY_LABELS = {
    vacancy_rate: "vacancy_rate",
    asking_rent_nnn: "asking_rent_nnn",
    absorption_sqft: "absorption_sqft",
  } as const;
  for (const family of [
    "vacancy_rate",
    "asking_rent_nnn",
    "absorption_sqft",
  ] as const) {
    const slugs = emittedSubmarketSlugs[family];
    if (slugs.length === 0) continue;
    vote.caveats.push(
      `All per-submarket MarketBeat ${FAMILY_LABELS[family]} metrics ship direction=stable as a schema-required fallback; v1 does not compute quarter-over-quarter trends. Affected: ${slugs.join(", ")}.`,
    );
  }
  // Zero-matched-corridors guard — a submarket reports a value but none of its
  // alias-mapped corridors are in the verified corpus this run. The metric ships
  // (the broker survey stands on its own) but the citation can't tie it to
  // specific corridors — disclose loudly per affected submarket.
  // Gate on a live broker feed: when mbRows === [] (the feed was deleted — the
  // normal state) there are no submarket rows, so `matched` and therefore
  // zeroMatchedCaveatGroups are empty. The explicit guard documents that intent
  // and keeps a deleted-feed run from ever emitting a survey-coverage caveat.
  if (mbRows.length > 0) {
    for (const group of zeroMatchedCaveatGroups) {
      vote.caveats.push(
        `MarketBeat ${group.submarket} submarket reports a value but 0 of its ${group.mappedCorridorNames.length} mapped corridors are in the verified corpus this run — metric ships but cannot be tied to specific corridors.`,
      );
    }
  }
  // Unmatched corridors — verified corpus rows whose submarket either isn't in
  // the alias table, or resolves to a submarket with no MarketBeat row this
  // run. Calling these out so a reader knows which corridors were excluded
  // from the per-submarket fan-out, and why.
  // Gate on mbRows.length > 0: when the broker feed is absent (deleted — the
  // normal state) groupCorridorsBySubmarket buckets EVERY corridor into
  // `unmatched`, which used to fire a false "coverage is incomplete" caveat —
  // the "Fort Myers Beach did not join" bug. A missing survey is not an
  // incomplete one; only disclose a partial gap when a survey actually ran.
  if (mbRows.length > 0 && lastJoinedBySubmarket.unmatched.length > 0) {
    const names = lastJoinedBySubmarket.unmatched.map((c) =>
      displayNameFor(c.name),
    );
    // Build diagnostic, NOT a user caveat. The constant name + the per-area
    // list are internal noise that leaked into the live tier-2 payload as a
    // 25-item dump. Log the detail for the build; surface one plain line about
    // the coverage gap (no count, no constant, no list).
    console.warn(
      `[cre-swfl] ${names.length} area(s) did not join to a MarketBeat submarket this run: ${names.join(", ")}`,
    );
    vote.caveats.push(
      "Broker-survey (MarketBeat) coverage is incomplete for some areas this build — those areas are not reflected in the survey-backed rent and vacancy metrics.",
    );
  }

  // corridor_factor direction is always "stable" — v1 emits no period-over-period
  // delta. Disclose so the fallback label cannot masquerade as a trend read.
  if (cfMedian != null) {
    vote.caveats.push(
      `corridor_factor: direction ships as "stable" — v1 does not compute period-over-period index change; the label is a schema-required fallback, not a measured trend.`,
    );
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

  // Corridor Factor composite — one-line read in the conclusion (full receipt in
  // key_metrics; detail is per-corridor in components, not surfaced here).
  if (cfMedian != null) {
    const cfBand = bandFor(
      Math.round(cfMedian),
      DEFAULT_CORRIDOR_FACTOR_CONFIG.bands,
    );
    conclusionParts.push(
      `Corridor Factor: ${Math.round(cfMedian)}/100 (${cfBand}) — composite of cap rate, vacancy, absorption, and asking rent across ${cfScores.length} of ${corridors.length} corridors.`,
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
  public_label: "Commercial Real Estate",
  domain: "real-estate",
  scope:
    "SWFL commercial real estate corridors — verified corridor intelligence (profiles, character, active flags)",
  ttl_seconds: 604800, // corridor intelligence is editorial, slow-moving
  sources: [
    corridorSource,
    marketbeatSwflSource,
    makeBrainInputSource("permits-swfl"),
    makeBrainInputSource("corridor-pulse-swfl"),
  ],
  input_brains: [
    { id: "permits-swfl", edge_type: "input" },
    { id: "corridor-pulse-swfl", edge_type: "input" },
  ],
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
      "- 'NNN' always means triple-net rent (the lease structure) — never a place name. Never expand it to 'North Naples' or any area.",
      "- Weave in the character narrative, evolution_direction, and tenant_mix where present. The narrative source is the `character_render` field — it merges hand-authored character text with the quarterly broker-positioning line where both exist. Use it to SHAPE the tone and texture of the corridor fact — let it dissolve into a richer picture rather than surfacing as raw voice text; do NOT paste it through verbatim, and never reproduce its citation markers (e.g. '[internal-3]', '[web-12]'). When `character_render` is null, omit it gracefully — never invent prose. Keep every measurement and distance exact — never add softening words like 'approximately', 'about', 'roughly', 'around', or 'nearly' to any number in the narrative.",
      "- Surface the active_flags by name — they are the ground-truth intelligence layer (infrastructure, new projects, regulatory shifts, status changes a broker cannot get from public listings). This is the crown-jewel intel of the pack.",
      "",
      "Do NOT compute numeric cross-fragment aggregates — corridor counts, county splits, seasonal-index stats, and flag counts are all computed deterministically and prepended as separate facts. Qualitative observations (patterns and themes across corridors) are yours.",
      "",
      "--- CRE BROKER CONTEXT ---",
      CRE_BROKER_PROFILE,
    ].join("\n"),
  },
};
