import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type {
  PackDefinition,
  PackOutput,
  CitationRow,
} from "../types/pack.mts";
import type { BrainOutput, BrainOutputMetric } from "../types/brain-output.mts";
import type { SynthesizedEvent } from "../types/event.mts";
import { citationId, factId } from "../lib/ids.mts";
import { isoDate, isoTimestamp } from "../lib/dates.mts";
import { writeStage } from "../lib/raw-store.mts";
import { renderMasterIndex } from "../render/master-index.mts";
import { validateSpec } from "../validate/spec-validator.mts";
import { lintFactsOnly } from "../validate/facts-only-lint.mts";
import { lintInferenceBait } from "../validate/inference-bait-lint.mts";
import { computeConfidence } from "../lib/confidence.mts";
import { readBrainOutput } from "../lib/brain-output-reader.mts";

const BRAINS_DIR = path.join(process.cwd(), "brains");

export interface OutputResult {
  brainPath: string;
  written: boolean;
  markdown: string;
  version: number;
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
 * `topic: "metric:*"` as key_metrics with placeholder direction. No caveats —
 * pack authors opt in to those explicitly via outputProducer.
 *
 * This intentionally stays minimal: rich narrative outputs are pack-author
 * code, not engine guesswork.
 */
function defaultOutputProducer(
  out: PackOutput,
): Pick<BrainOutput, "conclusion" | "key_metrics" | "caveats"> {
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
  return { conclusion, key_metrics, caveats: [] };
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
  for (const upstreamId of pack.input_brains) {
    const read = await readBrainOutput(upstreamId);
    if (read.kind === "missing") {
      throw new Error(
        `Stage 4: cannot harvest upstream confidence for "${upstreamId}" — ${read.reason}. ` +
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
  const brainOutput: BrainOutput = {
    brain_id: pack.brain_id,
    version,
    refined_at,
    conclusion: distilled.conclusion,
    confidence,
    key_metrics: distilled.key_metrics,
    caveats: distilled.caveats,
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
    return { brainPath, written: false, markdown, version };
  }
  await mkdir(BRAINS_DIR, { recursive: true });
  await writeFile(brainPath, markdown, "utf-8");
  return { brainPath, written: true, markdown, version };
}
