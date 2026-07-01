import type { TriagedFragment } from "../types/fragment.mts";
import type { PackDefinition } from "../types/pack.mts";
import type { SynthesisFact } from "../types/event.mts";
import { SMOOTHING_TOKENS } from "../lib/smoothing-tokens.mts";
import { getAnthropic, SYNTHESIS_MODEL, agentsAreMocked } from "./anthropic.mts";

export type { SynthesisFact };

const SYSTEM_INSTRUCTIONS = `You are the synthesis agent in a vertical-intelligence refinery pipeline.
You receive a set of triaged data fragments. Turn them into short, citable reference facts via the record_facts tool.

Hard rules:
- Write in descriptive third-person. NEVER use the imperative mood. NEVER address the reader as "you". NEVER write instructions or preferences — only statements of fact.
- Each fact has a "fact" (a short description of what is asserted) and a "value" (the concrete refined value).
- Stay strictly grounded in the fragment data. Never invent or extrapolate numbers. Be precise about what each field means — do not conflate a total with a subset of it.
- This is a refinery, not a data dump. Produce a FOCUSED set of facts: detail the fragments that carry the clearest signal, and roll up the long tail into summary facts rather than emitting one fact per fragment.
- NEVER compute numeric cross-fragment aggregates — sums, counts, medians, averages, rankings, "X of Y" tallies. Those are computed deterministically and prepended as separate facts; recomputing them risks arithmetic errors. Per-fragment facts (framing a single fragment's own numbers) and QUALITATIVE cross-fragment observations (sectors, patterns, themes) are yours; numeric aggregates are not.
- "source_fragment_ids" must list the fragment_id(s) each fact draws from. Qualitative roll-ups list every fragment they summarize.
- NEVER use smoothing language: "approximately", "roughly", "ballpark", "on the order of", "smoothed", "interpolated", "extrapolated", "estimated from", "rounded to", "in the range of", "fairly confident", "high confidence", "moderate confidence", "low confidence", "we're confident", "the model suggests", "with reasonable certainty". Numbers in this pipeline are deterministic — never soften them.`;

const ALL_SMOOTHING_TOKENS: readonly string[] = [
  ...SMOOTHING_TOKENS.numeric_softening,
  ...SMOOTHING_TOKENS.prose_confidence_translation,
];

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const SMOOTHING_PATTERN = new RegExp(
  `\\b(?:${ALL_SMOOTHING_TOKENS.map(escapeRegex).join("|")})\\b`,
  "gi",
);

function scrubSmoothing(text: string, ctx: { factId: string; field: "fact" | "value" }): string {
  let scrubbed = text;
  const hits = text.match(SMOOTHING_PATTERN);
  if (hits && hits.length > 0) {
    for (const hit of hits) {
      console.warn(
        `Synthesis agent: stripped smoothing token "${hit}" from ${ctx.field} of fact "${ctx.factId}".`,
      );
    }
    scrubbed = scrubbed
      .replace(SMOOTHING_PATTERN, "")
      .replace(/\s{2,}/g, " ")
      .trim();
  }
  return scrubbed;
}

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

  const client = getAnthropic("synthesis");
  const input = fragments.map((f) => ({
    fragment_id: f.fragment_id,
    topic: f.classification.topic,
    content_score: f.scoring.content_score,
    data: f.normalized,
  }));

  // Use streaming so SSE keep-alive events prevent server-side connection drops
  // on long generations (cre-swfl: 93 fragments, ~14 min, consistently dropped
  // non-streaming connections even with the 25-min SDK timeout raised).
  console.log(`[stage 3] synthesis: streaming ${input.length} fragment(s) via ${SYNTHESIS_MODEL}`);
  const stream = client.messages.stream(
    {
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
    },
    { timeout: 25 * 60 * 1000 },
  );
  const response = await stream.finalMessage();

  const toolUse = response.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Synthesis agent: response contained no tool_use block");
  }
  const parsed = toolUse.input as SynthesisToolInput;
  if (!Array.isArray(parsed?.facts)) {
    console.warn(
      `Synthesis agent: tool_use input missing facts array. raw input: ${JSON.stringify(parsed)}`,
    );
    return [];
  }
  return parsed.facts.map((f) => ({
    ...f,
    fact: scrubSmoothing(f.fact, { factId: f.topic, field: "fact" }),
    value: scrubSmoothing(f.value, { factId: f.topic, field: "value" }),
  }));
}
