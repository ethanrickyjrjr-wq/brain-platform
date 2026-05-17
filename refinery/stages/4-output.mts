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
import {
  computeConfidence,
  attributeError,
  tierToScore,
  type WeightedSource,
} from "../lib/confidence.mts";
import { readBrainOutput } from "../lib/brain-output-reader.mts";

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
  opts: { dryRun: boolean },
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

  // Harvest upstream confidences for the multiplicative propagation. The DAG
  // resolver guarantees upstreams have already been built (or skipped fresh),
  // so the local .md files are the source of truth. Missing upstream is a hard
  // error — by this point the DAG walker has already certified the upstream
  // exists; if the read fails here, the lake is in an inconsistent state.
  const upstream_confidences: number[] = [];
  for (const upstream of pack.input_brains) {
    const read = await readBrainOutput(upstream.id);
    if (read.kind === "missing") {
      throw new Error(
        `Stage 4: cannot harvest upstream confidence for "${upstream.id}" — ${read.reason}. ` +
          `DAG resolver should have caught this; the lake may be in an inconsistent state.`,
      );
    }
    upstream_confidences.push(read.output.confidence);
  }

  const confidence = computeConfidence({
    sources: pack.sources,
    refined_at,
    ttl_seconds: pack.ttl_seconds,
    upstream_confidences,
  });
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
    caveats,
    contradicts: distilled.contradicts,
    confidence,
    trust_tier,
    upstream_count,
    relevance,
    exogenous_signals: distilled.exogenous_signals ?? [],
  };

  const markdown = renderMasterIndex(packOutput, brainOutput);

  // validate before writing — a failure aborts the run, leaving the old pack intact
  const spec = validateSpec(markdown);
  const lint = lintFactsOnly(markdown);
  const bait = lintInferenceBait(markdown);
  if (!spec.ok || !lint.ok || !bait.ok) {
    const errs = [
      ...spec.errors.map((e) => `  spec: ${e}`),
      ...lint.violations.map(
        (v) => `  facts-only [line ${v.line}, ${v.pattern}]: ${v.text}`,
      ),
      ...bait.violations.map(
        (v) => `  inference-bait [line ${v.line}, ${v.pattern}]: ${v.text}`,
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
  await mkdir(BRAINS_DIR, { recursive: true });
  await writeFile(brainPath, markdown, "utf-8");
  return { brainPath, written: true, markdown, version, brainOutput };
}
