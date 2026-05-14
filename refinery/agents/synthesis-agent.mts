import type { TriagedFragment } from "../types/fragment.mts";
import type { PackDefinition } from "../types/pack.mts";
import type { SynthesisFact } from "../types/event.mts";
import {
  getAnthropic,
  SYNTHESIS_MODEL,
  agentsAreMocked,
} from "./anthropic.mts";

export type { SynthesisFact };

const SYSTEM_INSTRUCTIONS = `You are the synthesis agent in a vertical-intelligence refinery pipeline.
You receive a set of triaged data fragments. Turn them into short, citable reference facts via the record_facts tool.

Hard rules:
- Write in descriptive third-person. NEVER use the imperative mood. NEVER address the reader as "you". NEVER write instructions or preferences — only statements of fact.
- Each fact has a "fact" (a short description of what is asserted) and a "value" (the concrete refined value).
- Stay strictly grounded in the fragment data. Never invent or extrapolate numbers. Be precise about what each field means — do not conflate a total with a subset of it.
- This is a refinery, not a data dump. Produce a FOCUSED set of facts: detail the fragments that carry the clearest signal, and roll up the long tail into summary facts rather than emitting one fact per fragment.
- NEVER compute numeric cross-fragment aggregates — sums, counts, medians, averages, rankings, "X of Y" tallies. Those are computed deterministically and prepended as separate facts; recomputing them risks arithmetic errors. Per-fragment facts (framing a single fragment's own numbers) and QUALITATIVE cross-fragment observations (sectors, patterns, themes) are yours; numeric aggregates are not.
- "source_fragment_ids" must list the fragment_id(s) each fact draws from. Qualitative roll-ups list every fragment they summarize.`;

/** JSON schema for the forced tool — guarantees structured output across SDK versions. */
const SYNTHESIS_SCHEMA = {
  type: "object" as const,
  additionalProperties: false,
  properties: {
    facts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          topic: { type: "string" },
          fact: { type: "string" },
          value: { type: "string" },
          source_fragment_ids: { type: "array", items: { type: "string" } },
        },
        required: ["topic", "fact", "value", "source_fragment_ids"],
      },
    },
  },
  required: ["facts"],
};

interface SynthesisToolInput {
  facts: SynthesisFact[];
}

function mockSynthesize(fragments: TriagedFragment[]): SynthesisFact[] {
  return fragments.map((f) => ({
    topic: f.classification.topic || "mock_fact",
    fact: `Mock synthesized reference fact for fragment ${f.fragment_id}`,
    value: JSON.stringify(f.normalized).slice(0, 160),
    source_fragment_ids: [f.fragment_id],
  }));
}

/**
 * Stage 3 synthesis. One Sonnet call turns the surviving triaged fragments into
 * refined, citable facts via a forced tool call. Pack-agnostic: it sees
 * `normalized` + scores + the pack's synthesis context.
 */
export async function synthesize(
  fragments: TriagedFragment[],
  pack: PackDefinition,
): Promise<SynthesisFact[]> {
  if (fragments.length === 0) return [];
  if (agentsAreMocked()) return mockSynthesize(fragments);

  const client = getAnthropic();
  const input = fragments.map((f) => ({
    fragment_id: f.fragment_id,
    topic: f.classification.topic,
    content_score: f.scoring.content_score,
    data: f.normalized,
  }));

  const response = await client.messages.create({
    model: SYNTHESIS_MODEL,
    max_tokens: 16000,
    system: [
      {
        type: "text",
        text: `${SYSTEM_INSTRUCTIONS}\n\n--- PACK CONTEXT ---\n${pack.prompts.synthesisContext}`,
        cache_control: { type: "ephemeral" },
      },
    ],
    tools: [
      {
        name: "record_facts",
        description:
          "Record the refined, citable reference facts synthesized from the fragments.",
        input_schema: SYNTHESIS_SCHEMA,
      },
    ],
    tool_choice: { type: "tool", name: "record_facts" },
    messages: [
      {
        role: "user",
        content: `Synthesize reference facts from these ${input.length} triaged fragments:\n\n${JSON.stringify(input, null, 2)}`,
      },
    ],
  });

  const toolUse = response.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Synthesis agent: response contained no tool_use block");
  }
  const parsed = toolUse.input as SynthesisToolInput;
  return parsed.facts;
}
