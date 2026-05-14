import type { PackDefinition } from "../types/pack.mts";
import type { RawFragment, TriagedFragment } from "../types/fragment.mts";
import type { SynthesizedEvent, SynthesisFact } from "../types/event.mts";
import { synthesize as runSynthesisAgent } from "../agents/synthesis-agent.mts";
import { writeStage } from "../lib/raw-store.mts";
import { isoDate } from "../lib/dates.mts";
import { factId } from "../lib/ids.mts";

export interface SynthesisResult {
  events: SynthesizedEvent[];
}

/**
 * Stage 3 — Synthesis. The Sonnet agent turns triaged fragments into refined
 * facts; if the pack provides a deterministic `corpusSummary`, that header fact
 * is computed over ALL Stage-1 fragments (including ones the filter dropped) and
 * forced to the top via a max composite. This stage resolves each fact's
 * provenance — `src` (Stage 4 maps it to a citation id), `composite`, `date`.
 * event_id here is provisional; Stage 4 re-assigns f-ids after the final sort.
 */
export async function synthesisStage(
  triaged: TriagedFragment[],
  pack: PackDefinition,
  allFragments: RawFragment[],
): Promise<SynthesisResult> {
  const agentFacts = await runSynthesisAgent(triaged, pack);

  const byId = new Map(triaged.map((f) => [f.fragment_id, f]));
  const today = isoDate();
  const fallbackSrc =
    triaged[0]?.source_id ?? allFragments[0]?.source_id ?? "unknown";

  /** Convert a SynthesisFact to a SynthesizedEvent, resolving provenance. */
  function toEvent(
    fact: SynthesisFact,
    index: number,
    compositeOverride?: number,
  ): SynthesizedEvent {
    const resolved = fact.source_fragment_ids.filter((id) => byId.has(id));
    const firstSource = resolved.length > 0 ? byId.get(resolved[0]) : undefined;
    const src = firstSource ? firstSource.source_id : fallbackSrc;
    const composite =
      compositeOverride ??
      (resolved.length > 0
        ? Math.max(...resolved.map((id) => byId.get(id)!.scoring.composite))
        : 0);
    return {
      event_id: factId(index), // provisional — Stage 4 re-assigns after the final sort
      topic: fact.topic,
      fact: fact.fact,
      value: fact.value,
      src,
      date: today,
      source_event_ids:
        resolved.length > 0 ? resolved : fact.source_fragment_ids,
      composite,
    };
  }

  // Deterministic corpus facts first (max composites -> render as f001, f002,
  // ... in the order the pack returns them), then the agent's facts.
  const items: { fact: SynthesisFact; compositeOverride?: number }[] = [];
  const corpusFacts = pack.corpusSummary?.(allFragments) ?? [];
  corpusFacts.forEach((fact, i) => {
    items.push({ fact, compositeOverride: Number.MAX_SAFE_INTEGER - i });
  });
  for (const fact of agentFacts) items.push({ fact });

  const events: SynthesizedEvent[] = items
    .map(({ fact, compositeOverride }, i) =>
      toEvent(fact, i, compositeOverride),
    )
    .sort((a, b) => b.composite - a.composite);

  await writeStage(pack.id, "stage-3-synthesis", { events });
  return { events };
}
