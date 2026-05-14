import type { PackDefinition } from "../types/pack.mts";
import type { RawFragment } from "../types/fragment.mts";
import { snapshotRaw, writeStage } from "../lib/raw-store.mts";

export interface IngestResult {
  fragments: RawFragment[];
  /** fragment count per source_id */
  sourceCounts: Record<string, number>;
}

/**
 * Stage 1 — Ingest. Deterministic: fetch every source, collect RawFragments,
 * snapshot the raw rows ("raw text never lost"). No LLM, no judgement.
 * The connectors decide live-vs-fixture internally from REFINERY_SOURCE.
 */
export async function ingest(pack: PackDefinition): Promise<IngestResult> {
  const fragments: RawFragment[] = [];
  const sourceCounts: Record<string, number> = {};

  for (const source of pack.sources) {
    const sourceFragments = await source.fetch();
    sourceCounts[source.source_id] = sourceFragments.length;
    await snapshotRaw(
      pack.id,
      source.source_id,
      sourceFragments.map((f) => f.raw),
    );
    fragments.push(...sourceFragments);
  }

  await writeStage(pack.id, "stage-1-ingest", { sourceCounts, fragments });
  return { fragments, sourceCounts };
}
