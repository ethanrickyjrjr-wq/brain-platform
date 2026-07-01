import type { RawFragment } from "../types/fragment.mts";
import type { PackDefinition } from "../types/pack.mts";
import { getAnthropic, TRIAGE_MODEL, agentsAreMocked } from "./anthropic.mts";

/** What triage assigns to one fragment. */
export interface TriageClassification {
  /** 0-10 decision-impact */
  content_score: number;
  topic: string;
  subtopic_key: string;
  decision_relevance_reason: string;
}

const MOCK_SCORE = 7;

const SYSTEM_INSTRUCTIONS = `You are the triage classifier in a vertical-intelligence refinery pipeline.
You receive a batch of structured data fragments. For EACH fragment, assign:
- content_score: an integer 0-10 measuring how decision-relevant the fragment is (10 = directly changes a decision; 0 = no relevance).
- topic: a short snake_case topic key.
- subtopic_key: a short snake_case sub-key (use the fragment's natural identifier if unsure).
- decision_relevance_reason: one terse sentence on why the score is what it is.
Return every fragment exactly once via the record_classifications tool. Do not invent fragments. Score on the merits of the data, not its volume.`;

/** JSON schema for the forced tool — guarantees structured output across SDK versions. */
const TRIAGE_SCHEMA = {
  type: "object" as const,
  additionalProperties: false,
  properties: {
    classifications: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          fragment_id: { type: "string" },
          content_score: { type: "integer" },
          topic: { type: "string" },
          subtopic_key: { type: "string" },
          decision_relevance_reason: { type: "string" },
        },
        required: [
          "fragment_id",
          "content_score",
          "topic",
          "subtopic_key",
          "decision_relevance_reason",
        ],
      },
    },
  },
  required: ["classifications"],
};

interface TriageToolInput {
  classifications: Array<{
    fragment_id: string;
    content_score: number;
    topic: string;
    subtopic_key: string;
    decision_relevance_reason: string;
  }>;
}

function clampScore(n: unknown): number {
  const v = typeof n === "number" && Number.isFinite(n) ? n : 0;
  return Math.max(0, Math.min(10, Math.round(v)));
}

function mockTriage(fragments: RawFragment[]): Map<string, TriageClassification> {
  const out = new Map<string, TriageClassification>();
  for (const f of fragments) {
    out.set(f.fragment_id, {
      content_score: MOCK_SCORE,
      topic: "mock",
      subtopic_key: f.fragment_id,
      decision_relevance_reason: "mock mode — ANTHROPIC_API_KEY not set; content not classified",
    });
  }
  return out;
}

const TRIAGE_BATCH_SIZE = 50;

async function triageBatch(
  fragments: RawFragment[],
  pack: PackDefinition,
  client: ReturnType<typeof getAnthropic>,
): Promise<Map<string, TriageClassification>> {
  const batch = fragments.map((f) => ({
    fragment_id: f.fragment_id,
    data: f.normalized,
  }));

  const response = await client.messages.create({
    model: TRIAGE_MODEL,
    max_tokens: 16000,
    system: [
      {
        type: "text",
        text: `${SYSTEM_INSTRUCTIONS}\n\n--- PACK CONTEXT ---\n${pack.prompts.triageContext}`,
        cache_control: { type: "ephemeral" },
      },
    ],
    tools: [
      {
        name: "record_classifications",
        description: "Record the content classification for every fragment in the batch.",
        input_schema: TRIAGE_SCHEMA,
      },
    ],
    tool_choice: { type: "tool", name: "record_classifications" },
    messages: [
      {
        role: "user",
        content: `Classify these ${batch.length} fragments:\n\n${JSON.stringify(batch, null, 2)}`,
      },
    ],
  });

  const toolUse = response.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Triage agent: response contained no tool_use block");
  }
  const parsed = toolUse.input as TriageToolInput;
  if (!parsed.classifications || !Array.isArray(parsed.classifications)) {
    throw new Error(
      `Triage agent: tool input missing classifications array (got ${JSON.stringify(parsed)})`,
    );
  }

  const out = new Map<string, TriageClassification>();
  for (const c of parsed.classifications) {
    out.set(c.fragment_id, {
      content_score: clampScore(c.content_score),
      topic: c.topic,
      subtopic_key: c.subtopic_key,
      decision_relevance_reason: c.decision_relevance_reason,
    });
  }
  return out;
}

/**
 * Stage 2 triage. Fragments are chunked into batches of TRIAGE_BATCH_SIZE
 * so large packs (e.g. Census CBP with 700+ fragments) don't overflow the
 * model's output token budget. Pack-agnostic: it only sees `normalized`
 * blocks plus the pack's triage context.
 */
export async function triage(
  fragments: RawFragment[],
  pack: PackDefinition,
): Promise<Map<string, TriageClassification>> {
  if (fragments.length === 0) return new Map();
  if (agentsAreMocked()) return mockTriage(fragments);

  const client = getAnthropic("triage");
  const chunks: RawFragment[][] = [];
  for (let i = 0; i < fragments.length; i += TRIAGE_BATCH_SIZE) {
    chunks.push(fragments.slice(i, i + TRIAGE_BATCH_SIZE));
  }

  const out = new Map<string, TriageClassification>();
  for (const chunk of chunks) {
    const result = await triageBatch(chunk, pack, client);
    for (const [k, v] of result) out.set(k, v);
  }
  return out;
}
