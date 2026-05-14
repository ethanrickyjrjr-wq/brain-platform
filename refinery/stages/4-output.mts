import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type {
  PackDefinition,
  PackOutput,
  CitationRow,
} from "../types/pack.mts";
import type { SynthesizedEvent } from "../types/event.mts";
import { citationId, factId } from "../lib/ids.mts";
import { isoDate, isoTimestamp } from "../lib/dates.mts";
import { writeStage } from "../lib/raw-store.mts";
import { renderMasterIndex } from "../render/master-index.mts";
import { validateSpec } from "../validate/spec-validator.mts";
import { lintFactsOnly } from "../validate/facts-only-lint.mts";

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
 * Stage 4 — Output. Deterministic, no LLM. Builds the citation table, finalizes
 * fact ids + src mapping, renders the spec-v1.1 Master Index, validates it, and
 * writes it. If validation fails the run aborts and the existing pack is left
 * intact.
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

  const output: PackOutput = {
    pack,
    version,
    refined_at,
    citations,
    facts,
    recentNote: `${verifiedDate}: pack refined by the Refinery — ${facts.length} fact(s) from ${citations.length} source(s).`,
  };

  const markdown = renderMasterIndex(output);

  // validate before writing — a failure aborts the run, leaving the old pack intact
  const spec = validateSpec(markdown);
  const lint = lintFactsOnly(markdown);
  if (!spec.ok || !lint.ok) {
    const errs = [
      ...spec.errors.map((e) => `  spec: ${e}`),
      ...lint.violations.map(
        (v) => `  facts-only [line ${v.line}, ${v.pattern}]: ${v.text}`,
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
  });

  const brainPath = path.join(BRAINS_DIR, `${pack.brain_id}.md`);
  if (opts.dryRun) {
    return { brainPath, written: false, markdown, version };
  }
  await mkdir(BRAINS_DIR, { recursive: true });
  await writeFile(brainPath, markdown, "utf-8");
  return { brainPath, written: true, markdown, version };
}
