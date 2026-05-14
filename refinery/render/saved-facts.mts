import type { SynthesizedEvent } from "../types/event.mts";

/** One SAVED FACTS entry — the exact field set the spec defines. */
interface SavedFact {
  id: string;
  topic: string;
  fact: string;
  value: string;
  src: string;
  date: string;
}

/**
 * Render the SAVED FACTS JSON array (spec section 3d) — one compact object
 * per line, array brackets on their own lines. Facts arrive already ordered
 * (composite-descending) and already id-assigned (f001, f002, ...).
 */
export function renderSavedFacts(facts: SynthesizedEvent[]): string {
  if (facts.length === 0) return "[]";
  const lines = facts.map((f) => {
    const entry: SavedFact = {
      id: f.event_id,
      topic: f.topic,
      fact: f.fact,
      value: f.value,
      src: f.src,
      date: f.date,
    };
    return `  ${JSON.stringify(entry)}`;
  });
  return `[\n${lines.join(",\n")}\n]`;
}
