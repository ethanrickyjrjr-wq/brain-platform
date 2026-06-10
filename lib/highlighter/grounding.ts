import type { Dossier } from "../fetch-brain";
import type { BrainOutputMetric } from "../../refinery/types/brain-output.mts";
import type { MethodologyEntry } from "../../refinery/lib/methodology-registry.mts";

export interface GroundingBlock {
  /** Human label the model uses to attribute a number ("Naples housing", "Naples flood (env-swfl)"). */
  label: string;
  dossier: Dossier;
}

export interface GroundingInput {
  rules: string; // RULES_OF_ENGAGEMENT, verbatim
  gazetteer: string; // GEOGRAPHY_GAZETTEER, verbatim
  blocks: GroundingBlock[]; // [0] = current report; [1..] = reach targets
  /** Authored derivation for the highlighted metric, when its slug resolved to a
   *  registry entry. Injected so the model recites the real equation + held/need
   *  components instead of guessing (never-dead-end doctrine). */
  method?: MethodologyEntry | null;
}

/** Inline a dossier's detail_tables as compact rows so cross-area lookups are in-context (R0). */
function renderDetailTables(d: Dossier): string {
  if (!d.detail_tables || d.detail_tables.length === 0) return "";
  const out: string[] = [];
  for (const t of d.detail_tables) {
    // Map column id → human label so cells read "Cap Rate=6.2%", never the raw
    // snake_case column id (e.g. `cap_rate_median`) — those are internal slugs
    // the customer must never see (CLEAN rule).
    const colLabel = new Map(t.columns.map((c) => [c.id, c.label]));
    out.push(`  Table "${t.title}" (grain: ${t.grain}; source: ${t.source.citation}):`);
    for (const r of t.rows) {
      const cells = Object.entries(r.cells)
        .filter(([, v]) => v !== null && v !== undefined && v !== "")
        .map(([k, v]) => `${colLabel.get(k) ?? k}=${v}`)
        .join(", ");
      out.push(`    - ${r.key} (${r.label}): ${cells}`);
    }
  }
  return out.join("\n");
}

function renderKeyMetrics(d: Dossier): string {
  // Use the human label, NOT `m.metric` (the snake_case slug). Feeding the slug
  // is what made the chat recite "cap_rate_median, vacancy_rate_median, …" to a
  // customer. The grounding must carry only customer-clean names (CLEAN rule).
  return d.key_metrics
    .map(
      (m: BrainOutputMetric) =>
        `  - ${m.label || m.metric}: ${m.value}${m.source?.citation ? ` [${m.source.citation}]` : ""}`,
    )
    .join("\n");
}

/**
 * Mirror of the report header's DIRECTION_LABEL (app/r/[slug]/page.tsx). The
 * header badge renders DIRECTION_LABEL[direction]; we serialize the SAME string
 * so a click on the Direction/Mixed highlighter lands on context the chat brain
 * can read, with zero value drift between badge and grounding.
 */
const DIRECTION_LABEL: Record<Dossier["direction"], string> = {
  bullish: "Bullish",
  bearish: "Bearish",
  mixed: "Mixed",
  neutral: "Neutral",
};

function renderBlock(b: GroundingBlock): string {
  const d = b.dossier;
  const parts = [
    `### ${b.label}`,
    `Conclusion: ${d.conclusion}`,
    // Header synthesis badges (Strength / Confidence / Direction) — serialized in
    // the SAME human-facing shape the report header shows: page.tsx renders
    // `${magnitudePct}%`, `${confidencePct}%`, and DIRECTION_LABEL[direction],
    // where pct = Math.round(scalar * 100) (speaker.mts toDisplayBrain). Both the
    // badge and this block derive from the same `--- OUTPUT ---`, so matching the
    // transform keeps them identical. Without these, a click on the Strength /
    // Confidence / Mixed highlighter dead-ends as "not a metric I hold".
    `Direction: ${DIRECTION_LABEL[d.direction]}`,
    `Strength: ${Math.round(d.magnitude * 100)}%`,
    `Confidence: ${Math.round(d.confidence * 100)}%`,
    `Key metrics:\n${renderKeyMetrics(d)}`,
  ];
  const tables = renderDetailTables(d);
  if (tables) parts.push(`Detail rows (every covered area — use these to compare):\n${tables}`);
  if (d.caveats.length) parts.push(`Caveats: ${d.caveats.join("; ")}`);
  if (d.grain_boundary) parts.push(`What we do NOT hold: ${JSON.stringify(d.grain_boundary)}`);
  return parts.join("\n");
}

/**
 * Render an authored methodology entry as a "use ONLY this, never guess" block.
 * The `components` list is the anti-invention allowlist: a `have` part is the
 * published figure (state it as HELD, never partial); a `need` part is offered
 * to find, never estimated.
 */
function renderMethod(m: MethodologyEntry): string {
  const have = (m.components ?? []).filter((c) => c.role === "have").map((c) => c.name);
  const need = (m.components ?? []).filter((c) => c.role === "need");
  const lines = [
    `How "${m.label}" works (authored — use ONLY this, never guess):`,
    `Means: ${m.measures}`,
    m.equation ? `Equation: ${m.equation}` : "",
    have.length
      ? `We HOLD: ${have.join(", ")} (this is the published figure — state it as held, never as partial).`
      : "",
    need.length
      ? `We do NOT hold: ${need
          .map((c) => `${c.name} (could come from ${c.candidateSource})`)
          .join("; ")}. Offer to find these; do not estimate them.`
      : "",
  ];
  return lines.filter(Boolean).join("\n");
}

/**
 * Build the model's system prompt from N grounded dossier blocks.
 *
 * TRUST ASSUMPTION: every block is server-authored, pre-validated brain output —
 * NEVER user-authored text. Dossier strings are interpolated raw (no delimiter
 * escaping) on that basis. Do NOT pipe user input through a GroundingBlock, or
 * the never-invent guarantee breaks (prompt-injection surface).
 */
export function buildGroundingContext(input: GroundingInput): string {
  const primary = input.blocks[0];
  const token = primary?.dossier.freshness_token ?? "";
  return [
    "You are the SWFL Data Gulf in-page analyst. The user highlighted something on a live report and asked about it. Lead straight with the substance in plain prose — no 'I'll pull…', no setup sentence, and do NOT echo back what they highlighted (they can see it; skip 'That $22.29 you're looking at is…' openers). Keep it tight: a few sentences for a simple ask, a short paragraph or two at most. Don't define obvious words — if they highlighted 'rising', give the number and what's rising, not a definition of the word. Surface the key point and let the follow-up chips carry the rest.",
    "Three kinds of question; pick the lane and answer in it:",
    "  LANE 1 — about THIS report, our data, or our terms (a metric, the direction / strength / confidence, the freshness token, a term like NNN, 'what's driving this', 'how does this compare'): answer in our voice FROM the grounded blocks below, using your full reasoning to explain, compare and connect them. Define our terms plainly. This is grounded analysis WITH real AI help — never a canned line. Cite the block label for every figure you state.",
    "  LANE 2 — general knowledge or off-topic (a common-word definition, weather, another region, an ordinary answerable like a store's hours): just be a normal, helpful assistant and answer it directly. No lake framing, no offer-to-pull, no pitch.",
    "  LANE 3 — a SWFL data NUMBER finer than the blocks hold (a single-address loss, an unlisted ZIP, a breakdown we don't carry): do NOT invent it. Offer to find it — say we can pull it, or that they can hand the report to their own Claude. An offer, never a fabricated number.",
    "HARD FLOOR (absolute, overrides everything above): every SWFL data number you state must come from a block below. NEVER invent or guess a SWFL figure, component, driver, or breakdown finer than a block provides. A published figure in a block is HELD — state it as held, never as partial or missing. If an authored method block is present, name ONLY the components it lists.",
    "Never dead-end with 'I don't know' or 'not something I hold' for anything shown on this page — it is LANE 1 (grounded), LANE 2 (general), or LANE 3 (offer to find). Pick one; do not refuse.",
    "CLEAN — you are talking to a customer: NEVER output an internal field name, slug, snake_case identifier, brain/metric ID, or any 'the data is held in… / stored in…' phrasing. Use the plain-English label for every figure. No jargon (NNN = triple-net rent, never a place).",
    "FOCUS — answer about exactly what was highlighted. If it names a place (a county like Lee or Collier, a corridor, a town, a ZIP), speak to THAT place using its specific row in the data below — do not fall back to the SWFL-wide aggregate. Match the grain of the highlight.",
    "NATURAL — sound like a person, not a template. Don't mechanically repeat the same count or framing in every answer (not '27 corridors' every time — say 'across our corridors', or name the relevant ones). Vary it.",
    "BUILD — prior questions and answers from this session may be included in the question; build on them, don't repeat what you already said.",
    "CHARTS — if asked to chart or visualize, NEVER tell the user to build it themselves (no 'pull it into Excel / Sheets / Tableau / Python'). Keep your answer about the numbers; the report shows a chart of its key data.",
    "ABOUT SWFL DATA GULF — only if asked what the platform/system is (2-3 sentences, precise, never cheesy, never sector-locked): a data-analytics engine for Southwest Florida (Lee + Collier) spanning real estate, permits, the economy, and risk — not one sector. Every answer is grounded in verified local data, which keeps the AI honest and surfaces real patterns across the region. It compounds — the more it's used the sharper its read on SWFL gets, and the more YOU use it the better it works as your data-grounded sidekick: faster answers, simpler workflows, better calls on real deals.",
    "Tag any projection beyond the cited numbers inline with [INFERENCE] and give one falsifying condition.",
    `Quote this freshness token exactly once in your answer: ${token}`,
    "",
    input.method ? "=== METHOD ===\n" + renderMethod(input.method) + "\n" : "",
    "=== RULES OF ENGAGEMENT ===",
    input.rules,
    "",
    "=== GEOGRAPHY ===",
    input.gazetteer,
    "",
    "=== GROUNDED DATA ===",
    input.blocks.map(renderBlock).join("\n\n"),
  ]
    .filter((s) => s !== "")
    .join("\n");
}
