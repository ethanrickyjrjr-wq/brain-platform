import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type {
  PackDefinition,
  PackOutput,
  CitationRow,
} from "../types/pack.mts";
import type {
  BrainDriver,
  BrainOutput,
  BrainOutputMetric,
  BrainOutputProducerResult,
  BrainOutputRelevance,
  BrainTrustTier,
} from "../types/brain-output.mts";
import type { SynthesizedEvent } from "../types/event.mts";
import { citationId, factId } from "../lib/ids.mts";
import { isoDate, isoTimestamp } from "../lib/dates.mts";
import { writeStage } from "../lib/raw-store.mts";
import { renderMasterIndex } from "../render/master-index.mts";
import { validateSpec } from "../validate/spec-validator.mts";
import { lintFactsOnly } from "../validate/facts-only-lint.mts";
import { lintInferenceBait } from "../validate/inference-bait-lint.mts";
import { lintSmoothing } from "../validate/smoothing-lint.mts";
import { lintGrainGuard } from "../validate/grain-guard-lint.mts";
import { hasFixtureSentinel } from "../lib/fixture-sentinels.mts";
import { env } from "../config/env.mts";
import {
  attributeError,
  chainDepth,
  confidenceDispersion,
  jointIntegrity,
  tierToScore,
  trustTierWeightedConfidence,
  type UpstreamConfidence,
  type WeightedSource,
} from "../lib/confidence.mts";
import { readBrainOutput } from "../lib/brain-output-reader.mts";
import {
  evaluateMasterGate,
  computeDegradedCriticalIds,
  type MasterGateInput,
} from "../lib/master-gate.mts";
import { brainStatus } from "../lib/dag.mts";
import { logPrediction } from "../lib/predictions-log.mts";
import { logMetricObservations } from "../lib/metric-observations-log.mts";
import { writeShockLogRow } from "../sources/fdot-freight-source.mts";
import { PACKS } from "../config/packs.mts";
import type { BrainEdge } from "../types/pack.mts";
import type { RawFragment } from "../types/fragment.mts";
import { writeJsonAtomic } from "../lib/write-json-atomic.mts";

const FIXTURES_DIR = path.join(process.cwd(), "fixtures");

const BRAINS_DIR = path.join(process.cwd(), "brains");

/**
 * Lift the producer's flat list of driver brain_ids to typed BrainDriver[] by
 * looking each id up in the pack's `input_brains` for its edge_type. Producers
 * never need to know edge semantics — those live on the DAG. A producer that
 * names an id NOT declared as an upstream edge throws here, surfacing the
 * mistake before the rendered file is written.
 */
function liftDrivers(
  pack: PackDefinition,
  driverIds: readonly string[],
): BrainDriver[] {
  return driverIds.map((id) => {
    const edge = pack.input_brains.find((e) => e.id === id);
    if (!edge) {
      const declared =
        pack.input_brains.map((e) => e.id).join(", ") || "(none)";
      throw new Error(
        `Stage 4: producer for "${pack.id}" named driver "${id}" that is not declared in input_brains. Declared upstreams: ${declared}.`,
      );
    }
    return { brain_id: id, edge_type: edge.edge_type };
  });
}

/**
 * Confidence threshold below which Stage 4 runs the attribution engine and
 * appends a weakest-contributor caveat. Per arsenal-master-stack Pillar 1
 * §4: "If the final confidence of a brain output is < 0.6, trigger the
 * attribution engine and append a caveat."
 */
const ATTRIBUTION_CAVEAT_THRESHOLD = 0.6;

/**
 * Format the weakest-contributor caveat string. Exposed for testing.
 * Format mirrors arsenal-master-stack Pillar 1 §4 verbatim:
 *   "Weakest contributor: source '{id}' (trust {score}, contribution {ratio})."
 */
export function formatWeakestContributorCaveat(
  weakest: import("../lib/confidence.mts").AttributionEntry,
): string {
  const score = weakest.trust_tier_score.toFixed(2);
  const ratio = weakest.error_contribution.toFixed(2);
  return `Weakest contributor: source '${weakest.source_id}' (trust ${score}, contribution ${ratio}).`;
}

export interface OutputResult {
  brainPath: string;
  written: boolean;
  markdown: string;
  version: number;
  brainOutput: BrainOutput;
}

// ---------------------------------------------------------------------------
// Lane 2E — stale-upstream cascade (CLAUDE.md non-negotiable #5)
// ---------------------------------------------------------------------------

/** Shape returned by `harvestUpstreams`. Exposed for testing. */
export interface UpstreamHarvest {
  /** Upstream confidence + trust_tier contributions for Lane 1A's weighted mean. */
  upstreams: UpstreamConfidence[];
  /**
   * Verbatim staleness caveats (one per stale upstream, in input_brains order).
   * Empty when every upstream is fresh. Format is locked to non-negotiable #5:
   *   "Upstream brain '{id}' was stale at build time (expired YYYY-MM-DD)."
   */
  stalenessCaveats: string[];
  /** Caveat per degraded upstream (failed rebuild, using last-good). */
  degradationCaveats: string[];
  /** ISO YYYY-MM-DD of last-good read per degraded upstream id. */
  degradedUpstreamDates: Map<string, string>;
  /**
   * `min(stale_upstream_confidences)` — the floor a self-confidence cap applies
   * at. `Infinity` when no upstream is stale (sentinel: `applyStalenessCap`
   * treats Infinity as "no cap to apply").
   */
  minStaleUpstreamConfidence: number;
  /**
   * IDs of critical upstreams that were stale or missing at build time. Empty
   * in Phase 1 (behavior-neutral). Phase 2 reads this to populate
   * BrainOutput.degraded_inputs via pack.public_label lookups.
   */
  degradedUpstreamIds: ReadonlySet<string>;
}

/**
 * Harvest upstream confidence + trust_tier AND surface staleness. Exported so
 * the cap mechanism can be unit-tested in isolation from the rest of Stage 4.
 *
 * For each `input_brains` edge, reads the rendered .md output AND the freshness
 * status in parallel. A missing upstream is a hard error (preserves the
 * pre-2E behavior — the DAG walker already certified it exists; getting here
 * means the lake is inconsistent). A STALE upstream produces a per-upstream
 * caveat and contributes its confidence to the `min` floor for the cap; its
 * confidence + trust_tier still flow into Lane 1A's weighted mean (we cap the
 * headline, we don't drop the contribution).
 *
 * Pure-ish: filesystem I/O only via the existing `readBrainOutput()` and
 * `brainStatus()` helpers. No side effects.
 */
export async function harvestUpstreams(
  input_brains: readonly BrainEdge[],
  degradedIds: ReadonlySet<string> = new Set(),
): Promise<UpstreamHarvest> {
  const upstreams: UpstreamConfidence[] = [];
  const stalenessCaveats: string[] = [];
  const degradationCaveats: string[] = [];
  const degradedUpstreamDates = new Map<string, string>();
  let minCappedUpstreamConfidence = Infinity;

  for (const upstream of input_brains) {
    const [read, status] = await Promise.all([
      readBrainOutput(upstream.id),
      brainStatus(upstream.id),
    ]);
    if (read.kind === "missing" && degradedIds.has(upstream.id)) {
      // Soft-skip: no last-good file on disk; computeMasterDecision already held
      // master if this was critical. Non-critical: add a hole caveat, skip contribution.
      degradationCaveats.push(
        `Upstream brain '${upstream.id}' was unavailable at build time (no last-good read).`,
      );
      continue;
    }
    if (read.kind === "missing") {
      throw new Error(
        `Stage 4: cannot harvest upstream confidence for "${upstream.id}" — ${read.reason}. ` +
          `DAG resolver should have caught this; the lake may be in an inconsistent state.`,
      );
    }
    if (status.kind === "stale") {
      stalenessCaveats.push(
        `Upstream brain '${upstream.id}' was stale at build time (expired ${status.expires_at}).`,
      );
      minCappedUpstreamConfidence = Math.min(
        minCappedUpstreamConfidence,
        read.output.confidence,
      );
    }
    if (degradedIds.has(upstream.id) && read.kind === "ok") {
      const today = new Date().toISOString().slice(0, 10);
      const lastDate = read.output.refined_at.slice(0, 10);
      degradationCaveats.push(
        `Upstream brain '${upstream.id}' failed to rebuild on ${today}; using last good read from ${lastDate} (v${read.output.version}).`,
      );
      degradedUpstreamDates.set(upstream.id, lastDate);
      minCappedUpstreamConfidence = Math.min(
        minCappedUpstreamConfidence,
        read.output.confidence,
      );
    }
    upstreams.push({
      brain_id: upstream.id,
      confidence: read.output.confidence,
      trust_tier: read.output.trust_tier,
    });
  }

  return {
    upstreams,
    stalenessCaveats,
    degradationCaveats,
    degradedUpstreamDates,
    minStaleUpstreamConfidence: minCappedUpstreamConfidence,
    degradedUpstreamIds: new Set(
      [...degradedIds].filter((id) => input_brains.some((e) => e.id === id)),
    ),
  };
}

/**
 * Cap a brain's headline confidence at the min stale-upstream confidence. The
 * cap is UNIDIRECTIONAL — it only DROPS self (it never lifts). When no
 * upstream is stale (`stalenessCaveats.length === 0`, equivalently
 * `minStaleUpstreamConfidence === Infinity`), the input flows through
 * unchanged. Exposed for testing.
 *
 * Tradeoff documented in the Lane 2E blueprint: a fresh upstream at 0.20 does
 * NOT cap a downstream at 0.85 — the cap is the *stale* floor, not the
 * global floor. This preserves Lane 1A's headline math for fresh chains.
 */
export function applyStalenessCap(
  baseConfidence: number,
  minStaleUpstreamConfidence: number,
  stalenessCaveats: readonly string[],
): number {
  if (stalenessCaveats.length === 0) return baseConfidence;
  return Math.min(baseConfidence, minStaleUpstreamConfidence);
}

/** Read the prior version from an existing brain file (0 if none). */
async function readPriorVersion(brainId: string): Promise<number> {
  try {
    const content = await readFile(
      path.join(BRAINS_DIR, `${brainId}.md`),
      "utf-8",
    );
    const m = content.match(/^version:\s*(\d+)/m);
    return m ? parseInt(m[1], 10) : 0;
  } catch {
    return 0;
  }
}

/**
 * Default outputProducer used when a pack does not provide its own. Extracts
 * the conclusion from the top-composite fact (facts are composite-sorted by the
 * caller, so facts[0] is the headline) and surfaces any facts a pack tagged
 * `topic: "metric:*"` as key_metrics with placeholder direction. v1
 * placeholders for the qualitative fields: direction "neutral", magnitude 0.5,
 * empty driver / override / contradicts / exogenous_signals arrays.
 *
 * This intentionally stays minimal: rich narrative outputs are pack-author
 * code, not engine guesswork. Packs that want a real direction / magnitude
 * read inject their own outputProducer.
 */
function defaultOutputProducer(out: PackOutput): BrainOutputProducerResult {
  const conclusion = out.facts[0]?.value ?? "(no facts produced this run)";
  const nowIso = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const key_metrics: BrainOutputMetric[] = out.facts
    .filter((f) => typeof f.topic === "string" && f.topic.startsWith("metric:"))
    .map((f) => ({
      metric: f.topic.replace(/^metric:/, ""),
      // SynthesizedEvent.value is a string narrative; a pack that wants typed
      // metric values must provide its own outputProducer. Default falls back
      // to 0 + stable direction so the JSON shape stays valid.
      value: 0,
      direction: "stable",
      label: f.fact,
      // Lane 1B (metric contract). Default producer ships a placeholder source
      // pointing back at the pack id — any pack that wants real provenance
      // must supply its own outputProducer.
      variable_type: "extensive",
      units: "count",
      source: {
        url: `pack:${out.pack.id}`,
        fetched_at: nowIso,
        tier: out.pack.sources[0]?.trust_tier ?? 4,
        citation: `Default-producer metric synthesized from fact "${f.fact}" (${out.pack.id}).`,
      },
    }));
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

/**
 * Engine-computed trust_tier — worst (highest number) wins per spec §2 step 7.
 * v1 takes the max across `pack.sources[].trust_tier` for direct sources (not
 * brain-input wrappers). Pure index brains with no direct sources fall back to
 * tier 4 (a no-current-pack situation; defensive default).
 */
function computeTrustTier(pack: PackDefinition): BrainTrustTier {
  const directSources = pack.sources.filter(
    (s) => !s.source_id.startsWith("brain-input:"),
  );
  if (directSources.length === 0) return 4;
  const max = directSources.reduce(
    (acc, s) => (s.trust_tier > acc ? s.trust_tier : acc),
    1 as BrainTrustTier,
  );
  return max;
}

/**
 * Stage 4 — Output. Deterministic, no LLM. Builds the citation table, finalizes
 * fact ids + src mapping, computes the BrainOutput (confidence + narrative
 * fields), renders the spec-v1.1 Master Index, validates it, and writes it.
 * If validation fails the run aborts and the existing pack is left intact.
 */
export async function outputStage(
  events: SynthesizedEvent[],
  pack: PackDefinition,
  rawFragments: ReadonlyArray<RawFragment>,
  opts: {
    dryRun: boolean;
    /** Phase 2 reads this to populate BrainOutput.degraded_inputs. Unused in Phase 1. */
    degradedUpstreamIds?: ReadonlySet<string>;
    /** Phase 4 — re-darkened critical holes; the master gate (below) reads this. */
    criticalHoleIds?: ReadonlySet<string>;
    /** Phase 6 (issue #6) — never-built ("not-yet-online") upstreams: soft-skipped via
     *  degradedUpstreamIds, but excluded from the gate's degraded-fraction numerator. */
    neverBuiltIds?: ReadonlySet<string>;
  },
): Promise<OutputResult> {
  const version = (await readPriorVersion(pack.brain_id)) + 1;
  const refined_at = isoTimestamp();
  const verifiedDate = isoDate();

  // citation table: one row per source, s01/s02..., plus a source_id -> id map
  const citations: CitationRow[] = [];
  const srcToCitation = new Map<string, string>();
  pack.sources.forEach((source, i) => {
    const id = citationId(i);
    srcToCitation.set(source.source_id, id);
    citations.push({
      id,
      ...source.citationMeta(verifiedDate, pack.ttl_seconds),
    });
  });
  const defaultCitation = citations[0]?.id ?? "s01";

  // finalize: composite-descending, assign f-ids, remap src (source_id -> citation id)
  const facts: SynthesizedEvent[] = [...events]
    .sort((a, b) => b.composite - a.composite)
    .map((e, i) => ({
      ...e,
      event_id: factId(i),
      src: srcToCitation.get(e.src) ?? defaultCitation,
    }));

  const packOutput: PackOutput = {
    pack,
    version,
    refined_at,
    citations,
    facts,
    recentNote: `${verifiedDate}: pack refined by the Refinery — ${facts.length} fact(s) from ${citations.length} source(s).`,
  };

  // Build BrainOutput — deterministic confidence + narrative fields from
  // outputProducer (or the default minimal lift).
  const producer = pack.outputProducer ?? defaultOutputProducer;
  const distilled = producer(packOutput);

  // Harvest upstream confidence + trust_tier for the Lane 1A weighted-mean
  // headline AND the joint_integrity / confidence_dispersion diagnostics. The
  // DAG resolver guarantees upstreams have already been built (or skipped
  // fresh), so the local .md files are the source of truth. Missing upstream
  // is a hard error — by this point the DAG walker has already certified the
  // upstream exists; if the read fails here, the lake is in an inconsistent
  // state.
  //
  // Lane 2E (CLAUDE.md non-negotiable #5): `harvestUpstreams` also surfaces
  // staleness — `stalenessCaveats` carry the per-upstream "expired YYYY-MM-DD"
  // strings to append to BrainOutput.caveats below, and
  // `minStaleUpstreamConfidence` is the floor we cap self.confidence at after
  // Lane 1A's weighted mean.
  const {
    upstreams,
    stalenessCaveats,
    degradationCaveats,
    degradedUpstreamDates,
    minStaleUpstreamConfidence,
  } = await harvestUpstreams(
    pack.input_brains,
    opts.degradedUpstreamIds ?? new Set(),
  );
  const upstream_confidences = upstreams.map((u) => u.confidence);

  // Lane 1A: headline confidence is now a trust-tier-weighted mean across
  // direct sources + upstream brains, multiplied by the TTL freshness ratio.
  // The legacy multiplicative cap (`self × avg(upstream_conf)`) survives as
  // `joint_integrity` below — a diagnostic for "what would the cap have been
  // under the old math?" without recomputing.
  //
  // Lane 2E applies a SECOND cap on top: when any upstream was stale at build
  // time, self.confidence is capped at min(stale_upstream_confidences). The
  // cap is unidirectional (only drops, never lifts) and fresh upstreams DO NOT
  // contribute to the floor — that's the design point that keeps Lane 1A's
  // headline intact for fresh chains.
  const laneOneAConfidence = trustTierWeightedConfidence({
    sources: pack.sources,
    refined_at,
    ttl_seconds: pack.ttl_seconds,
    upstreams,
  });
  const confidence = applyStalenessCap(
    laneOneAConfidence,
    minStaleUpstreamConfidence,
    stalenessCaveats,
  );
  const joint_integrity = jointIntegrity(upstream_confidences);
  const confidence_dispersion = confidenceDispersion(upstream_confidences);
  const chain_depth = chainDepth(pack.id, PACKS);
  // Engine-owned v3 fields. Producer-owned fields (direction, magnitude,
  // drivers, overrides, contradicts, exogenous_signals + conclusion /
  // key_metrics / caveats) come from `distilled`. The master synthesizer
  // additionally returns its own `upstream_count` (passing relevance floor),
  // `trust_tier` (worst-wins among passing), and `relevance` (weighted-avg
  // decay) — Stage 4 prefers the producer's value when present, otherwise
  // falls back to the engine default below.
  const trust_tier: BrainTrustTier =
    distilled.trust_tier ?? computeTrustTier(pack);
  const upstream_count = distilled.upstream_count ?? pack.input_brains.length;
  const relevance: BrainOutputRelevance = distilled.relevance ?? {
    decay_curve: "weeks",
    half_life_hours: 720,
    computed_at: refined_at,
  };
  // Backprop-inspired attribution: when confidence falls below the threshold,
  // run attributeError over the direct sources and append a caveat naming the
  // weakest contributor. brain-input wrappers are excluded — their share of
  // the error already lives in the upstream brain's own attribution chain.
  const caveats = [...distilled.caveats];
  if (confidence < ATTRIBUTION_CAVEAT_THRESHOLD) {
    const directSources = pack.sources.filter(
      (s) => !s.source_id.startsWith("brain-input:"),
    );
    if (directSources.length > 0) {
      const weighted: WeightedSource[] = directSources.map((s) => ({
        source_id: s.source_id,
        trust_tier_score: tierToScore(s.trust_tier),
      }));
      const attribution = attributeError(confidence, weighted);
      if (attribution.length > 0) {
        caveats.push(formatWeakestContributorCaveat(attribution[0]));
      }
    }
  }

  // Lane 2E: append per-upstream staleness caveats (one per stale upstream,
  // in input_brains order). Appended LAST so the producer's own caveats and
  // the weakest-contributor caveat stay at the top of the list — staleness is
  // the DAG-integrity footnote, not the headline. Empty array (every upstream
  // fresh) → no-op.
  caveats.push(...stalenessCaveats);
  caveats.push(...degradationCaveats);

  // P5 Group B — lift producer's flat string[] drivers to typed BrainDriver[]
  // using the pack's typed input_brains for edge_type lookup. Unknown driver
  // (id not declared as an upstream edge) is a hard error: the DAG declaration
  // is the source of truth for who's allowed to drive.
  const drivers = liftDrivers(pack, distilled.drivers);

  const brainOutput: BrainOutput = {
    brain_id: pack.brain_id,
    version,
    refined_at,
    direction: distilled.direction,
    magnitude: distilled.magnitude,
    drivers,
    overrides: distilled.overrides,
    conclusion: distilled.conclusion,
    key_metrics: distilled.key_metrics,
    // Bulk per-row detail (e.g. housing-by-ZIP). Optional; undefined on brains
    // that don't emit it (JSON.stringify omits the key, so their OUTPUT blocks
    // are unaffected). Rides into the dossier via buildDossier.
    detail_tables: distilled.detail_tables,
    caveats,
    contradicts: distilled.contradicts,
    confidence,
    joint_integrity,
    confidence_dispersion,
    chain_depth,
    trust_tier,
    upstream_count,
    relevance,
    exogenous_signals: distilled.exogenous_signals ?? [],
    // master-only dossier fields — undefined on leaf brains (JSON.stringify
    // omits undefined keys, so leaf OUTPUT blocks are unaffected).
    conditional_claims: distilled.conditional_claims,
    grain_boundary: distilled.grain_boundary,
    prediction_window: distilled.prediction_window,
    degraded_inputs:
      degradationCaveats.length > 0
        ? [...(opts.degradedUpstreamIds ?? new Set())]
            .filter((id) =>
              pack.input_brains.some((e) => e.id === id && e.critical),
            )
            .map((id) => ({
              label: PACKS[id]?.public_label ?? "a regional input",
              date:
                degradedUpstreamDates.get(id) ??
                new Date().toISOString().slice(0, 10),
            }))
            .filter((entry) => entry !== undefined)
        : undefined,
  };

  const markdown = renderMasterIndex(packOutput, brainOutput);

  // validate before writing — a failure aborts the run, leaving the old pack intact
  const spec = validateSpec(markdown);
  const lint = lintFactsOnly(markdown);
  // Pass the live brain-id set so the causal-chain-across-brains rule fires.
  // Object.keys(PACKS) is the authoritative registry at runtime.
  const bait = lintInferenceBait(markdown, Object.keys(PACKS));
  // Lane 1D — smoothing-lint: ban vague quantifiers + hand-wavy confidence
  // verbalizations from the prose. Token list is the single source of truth
  // in `refinery/lib/smoothing-tokens.mts` (also consumed by the consumption
  // contract — Coupling 3 in the v2 roll-out plan).
  const smoothing = lintSmoothing(markdown);
  // Grain-guard runs on the structured output (not the markdown): master's
  // grain_boundary must name absences, not predictions, and finest_grain must
  // be well-formed. No-op when grain_boundary is absent (every leaf brain).
  const grainGuard = lintGrainGuard(brainOutput);
  // A LIVE build must never ship a fixture-mode sentinel lifted from a stale
  // upstream (the master v60/v61 leak). Scans the rendered markdown; never
  // fires in fixture mode (sentinels are expected there) nor on a clean live
  // build. Self-correcting — master can't be produced until its upstreams are
  // re-rendered live. Single-sourced patterns: refinery/lib/fixture-sentinels.
  const fixtureLeak = env.source === "live" && hasFixtureSentinel(markdown);
  if (
    !spec.ok ||
    !lint.ok ||
    !bait.ok ||
    !smoothing.ok ||
    !grainGuard.ok ||
    fixtureLeak
  ) {
    const errs = [
      ...(fixtureLeak
        ? [
            `  fixture-leak: live build of ${pack.brain_id} contains a fixture sentinel — an upstream is stale. Re-render it live first (bun refinery/cli.mts <upstream>).`,
          ]
        : []),
      ...spec.errors.map((e) => `  spec: ${e}`),
      ...lint.violations.map(
        (v) => `  facts-only [line ${v.line}, ${v.pattern}]: ${v.text}`,
      ),
      ...bait.violations.map(
        (v) => `  inference-bait [line ${v.line}, ${v.pattern}]: ${v.text}`,
      ),
      ...smoothing.violations.map(
        (v) =>
          `  smoothing [line ${v.line}, ${v.group}/"${v.token}"]: ${v.text}`,
      ),
      ...grainGuard.violations.map(
        (v) =>
          `  grain-guard [${v.field}${v.index !== undefined ? `[${v.index}]` : ""}]: ${v.reason} — "${v.text}"`,
      ),
    ].join("\n");
    throw new Error(
      `Stage 4: rendered pack failed validation — NOT writing brains/${pack.brain_id}.md\n${errs}`,
    );
  }

  await writeStage(pack.id, "stage-4-output", {
    version,
    citations,
    factCount: facts.length,
    confidence,
  });

  const brainPath = path.join(BRAINS_DIR, `${pack.brain_id}.md`);
  if (opts.dryRun) {
    return { brainPath, written: false, markdown, version, brainOutput };
  }

  // Phase 4 — circuit breaker. Last-line-of-defense before a LIVE master write:
  // refuse to overwrite a serving `master.md` when a critical upstream has
  // re-darkened (last-good eligibility expired) or the render is hollow. The
  // `if (opts.dryRun) return` above already exits the dry-run path, so this only
  // fires on real writes — no extra guard needed. See refinery/lib/master-gate.mts.
  if (pack.brain_id === "master") {
    const priorRead = await readBrainOutput("master");
    const criticalUpstreamIds = new Set(
      (pack.input_brains ?? []).filter((e) => e.critical).map((e) => e.id),
    );
    const allDegraded = opts.degradedUpstreamIds ?? new Set<string>();
    const holes = opts.criticalHoleIds ?? new Set<string>();
    // issue #6: never-built upstreams are soft-skipped (still in allDegraded) but must not
    // inflate the degraded-fraction numerator. See computeDegradedCriticalIds.
    const degradedCriticalIds = computeDegradedCriticalIds({
      allDegraded,
      criticalUpstreamIds,
      holes,
      neverBuilt: opts.neverBuiltIds ?? new Set<string>(),
    });
    const gateInput: MasterGateInput = {
      rendered: brainOutput,
      priorMasterExists: priorRead.kind === "ok",
      criticalHoleIds: new Set(
        [...holes].filter((id) => criticalUpstreamIds.has(id)),
      ),
      criticalUpstreamIds,
      degradedCriticalIds,
    };
    const decision = evaluateMasterGate(gateInput);
    if (decision === "HOLD") {
      console.warn(
        `[output] HOLD: master gate blocked write — ${JSON.stringify([...gateInput.criticalHoleIds])}`,
      );
      return {
        brainPath,
        written: false,
        markdown: "",
        version: brainOutput.version,
        brainOutput,
      };
    }
  }

  await mkdir(BRAINS_DIR, { recursive: true });
  await writeFile(brainPath, markdown, "utf-8");

  // Sidecar emit. Optional per-pack hook that publishes named JSON artifacts
  // alongside the brain `.md` — e.g. permits-swfl's per-corridor cells, which
  // PackOutput.facts deliberately doesn't carry. Empty `data` entries are
  // skipped so an upstream fetch flake (Accela returning 0 permits) never
  // zero-byte-overwrites a previously-good fixture. A sidecar producer that
  // throws aborts the run BEFORE telemetry inserts — the brain `.md` is
  // already on disk, but no partial sidecar lands.
  if (pack.sidecarProducer) {
    const sidecars = await pack.sidecarProducer(packOutput, rawFragments);
    for (const entry of sidecars) {
      if (!entry || !entry.name) continue;
      if (Array.isArray(entry.data) && entry.data.length === 0) continue;
      const sidecarPath = path.join(FIXTURES_DIR, `${entry.name}.json`);
      await writeJsonAtomic(sidecarPath, entry.data);
      console.log(
        `[stage 4] sidecar: wrote ${sidecarPath} (${
          Array.isArray(entry.data) ? `${entry.data.length} rows` : "object"
        })`,
      );
    }
  }

  // Roadmap §6.1.4 — log master refines to predictions table (silent no-op
  // for non-master packs or when Supabase env is unset). Insert failures are
  // surfaced as warnings, not thrown: a successful .md write must not be
  // retroactively aborted by a telemetry insert hiccup.
  const logResult = await logPrediction({
    packId: pack.id,
    brainOutput,
  });
  if (logResult.kind === "error") {
    console.warn(
      `Stage 4: predictions insert failed for "${pack.id}" — ${logResult.message}. ` +
        `Brain file was written; only the telemetry row is missing.`,
    );
  }

  // Goal 9 Phase 1 (1c) — snapshot this brain's numeric key_metrics to
  // metric_observations, the grader's window-end value source. Fires for EVERY
  // pack, not just master. Silent no-op without Supabase env; insert failures
  // are warnings — a successful .md write must not be aborted by telemetry.
  const metricObsResult = await logMetricObservations({ brainOutput });
  if (metricObsResult.kind === "error") {
    console.warn(
      `Stage 4: metric_observations insert failed for "${pack.id}" — ${metricObsResult.message}. ` +
        `Brain file was written; only the metric snapshot is missing.`,
    );
  }

  // Lane 2D.1 — INSERT one shock_log row per successful logistics-swfl-nowcast
  // refine. Silent no-op for every other pack id, for fixture-mode runs, and
  // when the supabase env is unset. Error returns are warnings — the writer
  // never throws (see fdot-freight-source.mts::writeShockLogRow). Closes the
  // reader/writer loop: without this, live mode would never accumulate the
  // 90-day rolling history the brain needs to leave cold-start.
  const shockResult = await writeShockLogRow({
    packId: pack.id,
    brainOutput,
  });
  if (shockResult.kind === "error") {
    console.warn(
      `Stage 4: shock_log insert failed for "${pack.id}" — ${shockResult.message}. ` +
        `Brain file was written; only the shock_log row is missing — next live refine will leave the rolling window one entry short.`,
    );
  }

  return { brainPath, written: true, markdown, version, brainOutput };
}
