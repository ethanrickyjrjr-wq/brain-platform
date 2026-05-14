import type { PackDefinition } from "../types/pack.mts";
import type { RawFragment, TriagedFragment } from "../types/fragment.mts";
import { TYPE_MULTIPLIER, COMPOSITE_CUTOFF } from "../types/scoring.mts";
import { triage as runTriageAgent } from "../agents/triage-agent.mts";
import { writeStage } from "../lib/raw-store.mts";

export interface TriageResult {
  triaged: TriagedFragment[];
  /** dropped because pack_fit === 0 (don't belong in the pack) */
  droppedByFit: number;
  /** dropped because composite fell below the cutoff */
  droppedByCutoff: number;
}

/**
 * Stage 2 — Triage. Three-layer scoring:
 *   1. deterministic pack_fit (free) — hard-drop fragments that don't belong (fit === 0)
 *      before spending a triage call on them
 *   2. Haiku content_score for the survivors
 *   3. composite = (pack_fit + content_score) * type_multiplier; drop below cutoff
 * Output is sorted composite-descending.
 */
export async function triageStage(
  fragments: RawFragment[],
  pack: PackDefinition,
): Promise<TriageResult> {
  const cutoff = pack.compositeCutoff ?? COMPOSITE_CUTOFF;

  // 1. deterministic pack-fit; fit === 0 means "not pack material" — hard drop
  const fitScored = fragments.map((fragment) => ({
    fragment,
    pack_fit: pack.fitScore(fragment),
  }));
  const belong = fitScored.filter((x) => x.pack_fit > 0);
  const droppedByFit = fitScored.length - belong.length;

  // 2. Haiku triage for content_score — only on fragments that belong
  const classifications = await runTriageAgent(
    belong.map((x) => x.fragment),
    pack,
  );

  // 3. assemble composite, drop below cutoff
  const triaged: TriagedFragment[] = [];
  let droppedByCutoff = 0;
  for (const { fragment, pack_fit } of belong) {
    const cls = classifications.get(fragment.fragment_id);
    const content_score = cls?.content_score ?? 0;
    const type_multiplier = TYPE_MULTIPLIER[fragment.source_trust_tier];
    const composite = (pack_fit + content_score) * type_multiplier;
    if (composite < cutoff) {
      droppedByCutoff++;
      continue;
    }
    triaged.push({
      ...fragment,
      classification: {
        topic: cls?.topic ?? "unknown",
        subtopic_key: cls?.subtopic_key ?? fragment.fragment_id,
        decision_relevance_reason: cls?.decision_relevance_reason ?? "",
      },
      scoring: { pack_fit, content_score, type_multiplier, composite },
    });
  }

  triaged.sort((a, b) => b.scoring.composite - a.scoring.composite);
  await writeStage(pack.id, "stage-2-triage", {
    droppedByFit,
    droppedByCutoff,
    triaged,
  });
  return { triaged, droppedByFit, droppedByCutoff };
}
