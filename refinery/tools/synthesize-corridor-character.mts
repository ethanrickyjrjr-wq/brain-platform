/**
 * Corridor character generator — Stage C synthesizer.
 *
 * Plan of record:
 *   docs/superpowers/plans/2026-05-26-corridor-character-generator/README.md
 *   — Step 2 / Stage C + Step 3 lint stack.
 *
 * One Anthropic API call per corridor that emits a structured three-block
 * JSON object:
 *
 *   {
 *     facts_block:        string   // 3–5 sentences, [internal-N] / [web-N] cites,
 *                                  //   numbers verbatim from FACT_PACK with units.
 *     chart_block:        object|null  // {title, columns, rows} or null.
 *     speculative_block:  string   // 2–4 sentences ending with the verbatim
 *                                  //   disclaimer; hedging required around
 *                                  //   any inferred number.
 *     citations: {
 *       internal: [{ref, source_url}],
 *       web:      [{ref, url, title, cited_text}],
 *     }
 *   }
 *
 * After the model returns, the orchestrator lint stack runs
 * (`lintCorridorCharacterOutput`). A malformed run aborts with the lint
 * errors AND no DB write happens — that's the explicit Step 3 acceptance
 * criterion.
 *
 * --- DB writes ---
 * DB writes are gated behind `--write-db`. The default behavior is to
 * preview JSON to stdout. This keeps Step 2 acceptance ("run --preview on
 * Pine Ridge before any DB write") aligned with the plan's Step 4 gate.
 *
 * --- Vendor notes ---
 * Model: claude-sonnet-4-6. Forced tool_use to guarantee structured output
 * across SDK versions (same pattern as refinery/agents/synthesis-agent.mts).
 *
 * The synthesizer does NOT itself call web_search — it reads B1's already-
 * captured grounded NDJSON (one record per corridor per quarterly run) and
 * threads its `citations[]` into the model's context. This keeps the
 * synthesizer cheap and deterministic for testing (mock the Anthropic
 * client, no live web calls).
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";

import {
  getAnthropic,
  SYNTHESIS_MODEL,
  agentsAreMocked,
} from "../agents/anthropic.mts";
import {
  lintCorridorCharacterOutput,
  SPECULATIVE_DISCLAIMER,
  type CorridorCharacterOutput,
  type CharacterCitations,
  type WebCite,
  type CorridorCharacterLintResult,
} from "../validate/corridor-character-lint.mts";
import type { ChartBlock } from "../validate/chart-block-lint.mts";
import type {
  CorridorFactPack,
  PriorQuarterContext,
} from "./build-corridor-fact-pack.mts";

// ── Types ────────────────────────────────────────────────────────────────────

export interface SynthesizeInput {
  factPack: CorridorFactPack;
  /** Path to the B1-produced Tier 1 NDJSON capture for this corridor. */
  groundedNdjsonPath: string;
  /** Prior-quarter character_facts / character_speculative for continuity. */
  priorQuarter?: PriorQuarterContext | null;
  /**
   * Test seam — pass a mocked Anthropic-like client to bypass the live SDK.
   * Production callers omit this; the synthesizer falls back to
   * `getAnthropic()`.
   */
  client?: Pick<Anthropic, "messages">;
  /**
   * Preview-only: when true, lint failures return the rejected output in
   * `result.lint.ok=false` instead of throwing. The driver writes both
   * accepted and rejected preview JSONs so the operator can scan offline
   * and judge whether the prompt + lint pair are converging.
   *
   * Default false — DB-write path stays aligned with Step 3 acceptance
   * ("malformed runs abort, DB stays untouched"). Only the preview driver
   * sets this true.
   */
  acceptLintFailure?: boolean;
}

export interface SynthesizeResult {
  output: CorridorCharacterOutput;
  /** The lint result the orchestrator returned. `ok: true` is guaranteed
   *  when `acceptLintFailure` is false (default — failing lint throws).
   *  When `acceptLintFailure` is true, lint failures are returned to the
   *  caller as `lint.ok=false` with `lint.flat_errors` populated. */
  lint: CorridorCharacterLintResult;
  /** Token + finish telemetry, mirrored from the underlying SDK response. */
  usage: {
    input_tokens: number | null;
    output_tokens: number | null;
    stop_reason: string | null;
  };
}

// ── Grounded NDJSON reader ──────────────────────────────────────────────────

/** Citation entry as stored in the B1 NDJSON record (see _extract_citations). */
interface GroundedCitation {
  url: string | null;
  title: string | null;
  cited_text: string | null;
  type: string | null;
}

/** Minimal shape of a single B1 NDJSON record. */
interface GroundedRecord {
  corridor_name: string;
  corridor_slug: string;
  query: string;
  model: string;
  tool_version: string;
  run_at: string;
  citations: GroundedCitation[];
  cited_text_count: number;
}

export async function readGroundedNdjson(
  path: string,
): Promise<GroundedRecord> {
  const raw = await readFile(path, "utf-8");
  // NDJSON: one or more JSON-per-line records. B1 currently writes one
  // record per file (one corridor per run); we read the LAST non-empty
  // record (operator may concatenate multiple runs into a single file).
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) {
    throw new Error(
      `corridor-grounded NDJSON at ${path} is empty — re-run ingest/pipelines/corridor_grounded/pipeline.py for this corridor.`,
    );
  }
  return JSON.parse(lines[lines.length - 1]) as GroundedRecord;
}

// ── Prompt assembly ─────────────────────────────────────────────────────────

const SYSTEM_INSTRUCTIONS_BASE = `You are the corridor-character synthesis agent in a structured intelligence pipeline. You receive a deterministic FACT_PACK + a GROUNDED_WEB context block + (sometimes) a PRIOR_QUARTER continuity hint. You emit a structured three-block JSON object via the record_corridor_character tool.

Hard contract:

[FACTS BLOCK]
- 3–5 sentences. Use values from FACT_PACK verbatim with their units (e.g. "5.2%", "$32.50/sqft NNN", "12,000 sqft").
- Every claim cites inline as [internal-N] (data row in the fact pack) or [web-N] (citation from GROUNDED_WEB).
- No softening words, no rounding, no inference, no second-person ("you" / "your" / imperatives). The facts-block lint REJECTS softening qualifiers — this includes "approximately", "roughly", "about", "around", "nearly", "almost", "or so". These are banned even when the underlying web source uses them.
- WEB-CITED NUMBERS: strip softening qualifiers when transposing a number from a cited_text span. The citation tag IS the disclosure of the source's wording; the facts block restates the bare numeric value.
    ❌ "Pine Ridge has approximately 91,000 sqft of medical office [web-2]"
    ✅ "Pine Ridge has 91,000 sqft of medical office [web-2]"
    ❌ "Coconut Point Mall draws roughly 260 stores [web-3]"
    ✅ "Coconut Point Mall draws 260 stores [web-3]"
  If the underlying source's number is genuinely a range or estimate (e.g. "between 80,000 and 100,000 sqft") and you cannot pick a single value to restate verbatim, do NOT put the number in the facts block — push the qualified claim to the speculative block where hedging is allowed.
- If a value is null with a gap_reason in the fact pack, OMIT IT FROM THIS BLOCK — gaps live in the speculative block.
- At least one [internal-N] and at least one [web-N] citation should appear.

[CHART BLOCK]
- Emit a {title, columns, rows} object ONLY when a comparison is genuinely useful and every numeric cell value is present in FACT_PACK.
- HARD RULE — provenance: a regex-based lint REJECTS this block if ANY numeric cell is not in FACT_PACK (within ±5% tolerance). String cells (labels, units) are exempt; null cells are exempt. Numbers are not.
- Web-cited peer values (national averages, peer-metro vacancies like "Tampa 21%", "Miami 15.4%", "national shopping-center 5.9%") DO NOT belong here. Those go in the speculative block where hedging is allowed. The chart is for apples-to-apples values the system can vouch for.
- Acceptable chart shapes:
    ✅ Single-corridor YoY trio: vacancy, asking rent, absorption for this corridor (all values in FACT_PACK)
    ✅ Current snapshot vs. prior-year snapshot for this corridor (when both are in FACT_PACK)
    ✅ Single column of corridor metrics restating values verbatim
- Unacceptable shapes:
    ❌ Corridor vs. peer metros (Tampa / Orlando / Miami) — peer values not in FACT_PACK
    ❌ Corridor vs. national average — national value not in FACT_PACK
    ❌ Corridor vs. submarket peer — peer corridor's values not in this fact pack
- When no chart shape works with FACT_PACK values only, RETURN null. A missing chart is better than a chart that fails provenance.

[SPECULATIVE BLOCK]
- 2–4 sentences. Reads FACT_PACK gaps + GROUNDED_WEB context. Produces thought-provoking inference: where the next-quarter signal might be heading; what the gap_reason implies; what the operator should dig into next.

- PURPOSE — make hedged predictions, do NOT decline to predict. The block exists to give the operator something they can push back on. "Without a quarterly time series, direction cannot be confirmed" is a FAILURE MODE — it gives the operator nothing. Instead, USE the directional anchors available (unemployment trend, absorption signal, web-cited tenant activity, supply pipeline) to make a hedged estimate. Examples:
    ❌ "Without a verified quarterly cap rate series, we cannot confirm YoY direction." — refuses to engage; defeats the purpose
    ✅ "Without a verified quarterly cap rate series, direction is most likely tracking toward 25–50 bps of expansion [inference] given the 1.2 pp uptick in Collier unemployment [internal-5] and slowing absorption signals — confirmation requires the next quarterly snapshot."
    ❌ "Net absorption direction is unknown."
    ✅ "Net absorption is likely tracking flat-to-negative [inference] given the supply pipeline (2.8M sqft approved at Daniels–Treeline [web-26]) outrunning current 4,200 sqft quarterly take-up [internal-3]."
  When data is missing, REACH for the directional signal and DISCLOSE the inference. Hedging plus [inference] makes the guess legitimate; declining to guess is a content failure.

- HARD RULE — quantitative values: a regex-based lint REJECTS this block if ANY number appears that is (a) not present in FACT_PACK and (b) not immediately wrapped in a hedge phrase or [inference] tag. This is non-negotiable. The lint cannot be appeased after the fact. You have THREE legal options for any inferred quantity (sqft, rent, %, $, count, ratio):

    OPTION 1 — wrap in a hedge phrase BEFORE the number:
      ACCEPT: "vacancy is most likely tracking toward 6%"
      ACCEPT: "rent could be near $32/sqft"
      ACCEPT: "absorption may be approximately 12,000 sqft"
      ACCEPT: "permit volume probably hovering near 25 per quarter"
      Approved hedge phrases (use one verbatim before the number, ≤60 chars away):
        "most likely", "tracking toward", "likely", "likely hovering", "near",
        "approximately", "could be", "may be", "might be", "appears to be",
        "would put", "would suggest", "probably"

    OPTION 2 — attach an [inference] tag IMMEDIATELY after the number:
      ACCEPT: "rent could push past $35/sqft [inference]"
      ACCEPT: "12,000 sqft [inference] of give-back over the cycle"

    OPTION 3 — OMIT the number entirely. Prose without specific projected numbers is ALWAYS preferable to unhedged numbers. If you cannot find a way to satisfy options 1 or 2, REWRITE the sentence to make the same point without the number ("vacancy is drifting upward" instead of "vacancy is likely 6.1%").

  REJECT examples that the lint will catch:
    REJECT: "vacancy could approach 6%" — "approach" is not on the hedge list
    REJECT: "rent has hit $32/sqft" — declarative, no hedge, not in fact pack
    REJECT: "next quarter should clear 12,000 sqft" — "should clear" is not a hedge
  When in doubt, prefer option 3.

- YEARS — 4-digit ints in 1900-2099 ("by 2026", "the 2024-2025 stretch", "since 2023") are temporal anchors and DO NOT need hedging. This is the only number-shape the lint exempts.

- HIGHWAY DESIGNATORS — always use the full prefixed form: "I-75", "U.S. 41", "SR-82", "CR-951", "US-41". The lint exempts those. NEVER use SWFL colloquialisms that strip the prefix ("west of 75", "the 41 corridor", "off-75") — the bare digits will trip the lint as inferred quantities. Write "west of I-75", not "west-of-75".

- FACT-PACK NUMBERS — values that appear in FACT_PACK can be restated verbatim WITHOUT hedging (they are anchored, not inferred). e.g. if FACT_PACK has vacancy_rate.current.value = 5.2, you can write "vacancy is 5.2% [internal-1]" with no hedge.

- Use [web-N] for claims drawn from grounded sources. The GROUNDED_WEB cited_text spans are your raw material; attribute every claim drawn from them.

- The block MUST END WITH THIS EXACT STRING (verbatim, no quotes around it): ${SPECULATIVE_DISCLAIMER}

[CITATIONS]
- Populate the citations object with every [internal-N] and [web-N] anchor used. Internal entries carry the fact-pack source_url; web entries carry url + title + cited_text from the grounded NDJSON.`;

/**
 * Type-conditional synthesis instructions keyed by corridor_profiles.corridor_type.
 * Each block is appended to SYSTEM_INSTRUCTIONS_BASE for the matching corridor type,
 * telling the model which signals to lead with and what angle the speculative block
 * should take. The Broker Take instruction at the end of each block is the explicit
 * call for a 1–2 sentence practitioner quote as the speculative block's closing beat
 * (before the mandatory SPECULATIVE_DISCLAIMER).
 *
 * Keys must match the corridor_type values in corridor_profiles exactly.
 */
export const TYPE_VOICE_BLOCKS: Record<string, string> = {
  "beachfront-tourism": `[CORRIDOR TYPE GUIDANCE: beachfront-tourism]
This corridor's value is inseparable from tourism cycles and coastal geography.

FACTS BLOCK: Lead with vacancy and absorption as supply-constraint signals — beachfront expansion is limited by geography. Cite NFIP claim data if present in FACT_PACK; if NFIP is a gap, omit it from this block (per gap rule above).

SPECULATIVE BLOCK: Reason about tourism seasonality as a demand floor — the corridor's off-peak survivability for tenants. Consider hurricane-cycle exposure and post-Ian insurance premium changes where GROUNDED_WEB supports it. If NFIP data is absent, make a directional inference about flood-risk trajectory given the corridor's coastal position and disclose it with [inference]. Cap rate direction should be framed against beachfront supply constraint, not generic market trends. End with a 1–2 sentence Broker Take quote: a local retail broker placing a tenant here, framing whether the tenant can survive the seasonal dip and what beachfront supply constraint means for velocity and concessions.`,

  "highway-strip-mall": `[CORRIDOR TYPE GUIDANCE: highway-strip-mall]
This corridor's story is rooftop growth: residential supply drives retail demand. The core question is whether the supply pipeline matches the rooftop pace.

FACTS BLOCK: Lead with absorption as the rooftop-demand signal. Call out the supply pipeline (approved sqft in FACT_PACK) against current take-up rate. If FDOT AADT is in FACT_PACK, cite it as validation of the drive-thru outparcel thesis.

SPECULATIVE BLOCK: Frame the absorption signal as a function of rooftop delivery velocity. If the supply pipeline exceeds current take-up rate, estimate the quarters to equilibrium using [inference]. Name the leading national credit tenant categories (drive-thru QSR, value fitness, dollar-tier) as the bellwether for this corridor type. If Collier County permits are a gap (Lee-only pipeline), name that gap explicitly and make a directional inference about construction velocity. End with a 1–2 sentence Broker Take quote: a broker active on this corridor type, framing national credit appetite and the risk if rooftop delivery slows.`,

  "medical-anchored": `[CORRIDOR TYPE GUIDANCE: medical-anchored]
This corridor's demand driver is healthcare employment, not consumer discretionary spend. The fundamental question is whether the hospital system is expanding, stable, or contracting.

FACTS BLOCK: Lead with vacancy as a signal of institutional demand density. Call out cap rate as a risk-pricing indicator — medical office typically compresses faster than retail when a hospital system anchor expands. Cite healthcare employment growth data if available in GROUNDED_WEB.

SPECULATIVE BLOCK: Reason about the hospital system's expansion footprint — new MOB filings, announced new facilities, certificate-of-need activity if in GROUNDED_WEB. Frame any access constraint (intersection geometry, FDOT project status) as a short-term friction against otherwise strong institutional fundamentals. Healthcare employment trajectory is the forward indicator — anchor the directional call on BLS or regional job numbers. End with a 1–2 sentence Broker Take quote: a broker active on medical-office leasing, naming who wins here (medical, dental, wellness vs. general retail) and what keeps some national tenants away (access, parking, institutional pricing).`,

  "anchor-dependent": `[CORRIDOR TYPE GUIDANCE: anchor-dependent]
This corridor's occupancy story begins and ends with its anchor tenant. The central question is anchor health, succession risk, and what approved density means for the long-run competitive set.

FACTS BLOCK: Lead with the anchor tenant's lease status and any recent transaction history if in GROUNDED_WEB (a sale signals investor conviction or concern). Absorption as a secondary signal — weakest absorption in this corridor type is often a supply-overhang setup, not demand destruction.

SPECULATIVE BLOCK: Reason explicitly about anchor succession risk — if the anchor weakens or vacates, what's the redevelopment path? Frame the approved density pipeline as a double-edged signal: long-term upside (more rooftops, more demand) but near-term construction friction. Cap rate direction should be read against anchor health, not generic market trends. End with a 1–2 sentence Broker Take quote: a broker placing a co-tenant near the anchor, framing how anchor health affects co-tenant confidence and what near-term construction friction looks like.`,

  "industrial-flex": `[CORRIDOR TYPE GUIDANCE: industrial-flex]
This corridor's story is logistics and distribution demand. Seasonality is low; the driver is regional supply-chain positioning near ports, airports, and interstate interchanges.

FACTS BLOCK: Lead with vacancy and absorption as supply-demand balance indicators. If FDOT AADT is in FACT_PACK, use it as a proxy for freight movement intensity. Cap rate in industrial-flex reflects investor confidence in the logistics demand cycle — call it out relative to the corridor's proximity to regional distribution nodes.

SPECULATIVE BLOCK: Reason about the e-commerce distribution demand cycle and how it's flowing through SWFL. If the fact pack has a supply pipeline gap (permitted new industrial sqft), frame the directional vacancy call against that with [inference]. Anchor the forecast on employment trends in transportation/warehousing and regional permit velocity — ZORI residential data is a weaker signal here. End with a 1–2 sentence Broker Take quote: a broker active on industrial-flex leasing, naming whether national 3PL and distribution demand is active and whether this is a spec-build or build-to-suit market.`,

  "mixed-use-downtown": `[CORRIDOR TYPE GUIDANCE: mixed-use-downtown]
This corridor's story is live-work-play demand density. Fundamentals are driven by residential infill, F&B/entertainment anchors, and walkability. Office and retail co-perform — neither tells the story alone.

FACTS BLOCK: Lead with vacancy across the mixed-use components if FACT_PACK separates them; if not, lead with the dominant component (retail-level asking rent). Absorption for mixed-use reads as the rate of infill activation — growth signals (new restaurant openings, residential unit deliveries) in GROUNDED_WEB belong here.

SPECULATIVE BLOCK: Reason about the residential density trajectory as the demand multiplier. F&B/entertainment anchors are the volatile component — hospitality churn (closures, new openings) is the leading indicator of district health. Frame the speculative call around whether the current demand trajectory supports the next phase of vertical development. End with a 1–2 sentence Broker Take quote: a broker active on mixed-use district leasing, naming the tenant that anchors the district and what happens if the F&B anchor churns.`,
};

/** Build the full system prompt for a given corridor type.
 *  Unknown types fall back to the base instructions with no type block. */
function buildSystemInstructions(corridorType: string): string {
  const typeBlock = TYPE_VOICE_BLOCKS[corridorType];
  if (!typeBlock) return SYSTEM_INSTRUCTIONS_BASE;
  return `${SYSTEM_INSTRUCTIONS_BASE}\n\n${typeBlock}`;
}

const TOOL_SCHEMA = {
  type: "object" as const,
  additionalProperties: false,
  properties: {
    facts_block: { type: "string" },
    chart_block: {
      anyOf: [
        { type: "null" },
        {
          type: "object",
          additionalProperties: false,
          properties: {
            title: { type: "string" },
            columns: { type: "array", items: { type: "string" } },
            rows: {
              type: "array",
              items: {
                type: "array",
                items: {
                  anyOf: [
                    { type: "string" },
                    { type: "number" },
                    { type: "null" },
                  ],
                },
              },
            },
          },
          required: ["title", "columns", "rows"],
        },
      ],
    },
    speculative_block: { type: "string" },
    citations: {
      type: "object",
      additionalProperties: false,
      properties: {
        internal: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              ref: { type: "string" },
              source_url: { type: "string" },
            },
            required: ["ref", "source_url"],
          },
        },
        web: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              ref: { type: "string" },
              url: { type: "string" },
              title: { type: "string" },
              cited_text: { type: "string" },
            },
            required: ["ref", "url", "title", "cited_text"],
          },
        },
      },
      required: ["internal", "web"],
    },
  },
  required: ["facts_block", "chart_block", "speculative_block", "citations"],
};

function buildUserMessage(
  factPack: CorridorFactPack,
  grounded: GroundedRecord,
  priorQuarter: PriorQuarterContext | null,
): string {
  const sections: string[] = [];
  sections.push(
    `# Corridor\n${factPack.corridor_name} · ${factPack.city} (${factPack.county}) · ${factPack.corridor_type}`,
  );
  sections.push(`# Fact pack vintage\n${factPack.fact_pack_vintage}`);
  sections.push(`# FACT_PACK\n${JSON.stringify(factPack, null, 2)}`);

  // Index the web citations so the model can reference them as [web-1], [web-2], ...
  const webIndex = grounded.citations.map((c, i) => ({
    ref: `web-${i + 1}`,
    url: c.url,
    title: c.title,
    cited_text: c.cited_text,
  }));
  sections.push(
    `# GROUNDED_WEB (from ${grounded.tool_version}, run ${grounded.run_at}, ${grounded.cited_text_count} citations)\n${JSON.stringify(webIndex, null, 2)}`,
  );

  if (
    priorQuarter &&
    (priorQuarter.character_facts || priorQuarter.character_speculative)
  ) {
    sections.push(
      `# PRIOR_QUARTER (continuity context only — do NOT copy verbatim)\n${JSON.stringify(priorQuarter, null, 2)}`,
    );
  } else {
    sections.push(`# PRIOR_QUARTER\nnull (first run for this corridor)`);
  }

  sections.push(
    `# Task\nCall record_corridor_character with the three-block JSON. Remember: facts block omits null-gap fields, speculative block ends verbatim with the disclaimer.`,
  );
  return sections.join("\n\n");
}

// ── Tool-use response parsing ───────────────────────────────────────────────

interface SynthesisToolInput {
  facts_block: string;
  chart_block: ChartBlock | null;
  speculative_block: string;
  citations: CharacterCitations;
}

function parseToolUse(
  response: Anthropic.Messages.Message,
): SynthesisToolInput {
  const toolUse = response.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error(
      "synthesize-corridor-character: model response contained no tool_use block — model may have refused or hit max_tokens before emitting the tool call.",
    );
  }
  const raw = toolUse.input as Partial<SynthesisToolInput> | undefined;
  // Defensive shape coercion — TOOL_SCHEMA marks every field required, but
  // tool_use validation occasionally returns partial payloads when the model
  // hits max_tokens mid-emit. Coerce missing pieces to legal-but-empty values
  // so the lint layer (rather than this parser) decides whether the output
  // is acceptable. Missing citations.internal/web are the most common gap.
  return {
    facts_block: typeof raw?.facts_block === "string" ? raw.facts_block : "",
    chart_block: raw?.chart_block ?? null,
    speculative_block:
      typeof raw?.speculative_block === "string" ? raw.speculative_block : "",
    citations: {
      internal: Array.isArray(raw?.citations?.internal)
        ? raw.citations.internal
        : [],
      web: Array.isArray(raw?.citations?.web) ? raw.citations.web : [],
    },
  };
}

// ── Public entry point ──────────────────────────────────────────────────────

export async function synthesizeCorridorCharacter(
  input: SynthesizeInput,
): Promise<SynthesizeResult> {
  const grounded = await readGroundedNdjson(input.groundedNdjsonPath);
  const priorQuarter = input.priorQuarter ?? null;
  const userMessage = buildUserMessage(input.factPack, grounded, priorQuarter);

  // Mock mode — when no ANTHROPIC_API_KEY is set AND no client was injected,
  // refuse rather than emit fake corridor character text. This is different
  // from the rest of the agent layer (which mocks for offline pipeline runs)
  // because corridor character is end-user-facing content with no useful
  // deterministic fallback.
  let client = input.client;
  if (!client) {
    if (agentsAreMocked()) {
      throw new Error(
        "synthesize-corridor-character: ANTHROPIC_API_KEY is not set. Either set it in .env.local or pass a mocked client (test seam). This tool refuses to emit fake corridor-character prose.",
      );
    }
    client = getAnthropic();
  }

  const systemInstructions = buildSystemInstructions(
    input.factPack.corridor_type,
  );
  const response = await client.messages.create({
    model: SYNTHESIS_MODEL,
    max_tokens: 4096,
    system: [
      {
        type: "text",
        text: systemInstructions,
        cache_control: { type: "ephemeral" },
      },
    ],
    tools: [
      {
        name: "record_corridor_character",
        description:
          "Record the structured three-block corridor-character output (facts, optional chart, speculative) with per-claim citations.",
        input_schema: TOOL_SCHEMA,
      },
    ],
    tool_choice: { type: "tool", name: "record_corridor_character" },
    messages: [{ role: "user", content: userMessage }],
  });

  const parsed = parseToolUse(response);
  const output: CorridorCharacterOutput = {
    facts_block: parsed.facts_block,
    chart_block: parsed.chart_block,
    speculative_block: parsed.speculative_block,
    citations: parsed.citations,
  };

  const lint = lintCorridorCharacterOutput(output, input.factPack);
  if (!lint.ok && !input.acceptLintFailure) {
    const reasons = lint.flat_errors.join("\n  - ");
    throw new Error(
      `synthesize-corridor-character: lint REJECTED model output for "${input.factPack.corridor_name}". DB write blocked. Errors:\n  - ${reasons}`,
    );
  }

  return {
    output,
    lint,
    usage: {
      input_tokens: response.usage?.input_tokens ?? null,
      output_tokens: response.usage?.output_tokens ?? null,
      stop_reason: response.stop_reason ?? null,
    },
  };
}

// ── CLI ─────────────────────────────────────────────────────────────────────

interface CliArgs {
  corridor: string | null;
  preview: boolean;
  writeDb: boolean;
  groundedDir: string | null;
}

function parseCli(argv: readonly string[]): CliArgs {
  const out: CliArgs = {
    corridor: null,
    preview: true, // default to preview — safest posture
    writeDb: false,
    groundedDir: null,
  };
  for (const a of argv) {
    if (a === "--preview") out.preview = true;
    else if (a === "--write-db") {
      out.writeDb = true;
      out.preview = false;
    } else if (a.startsWith("--corridor=")) {
      out.corridor = a.slice("--corridor=".length).replace(/^"|"$/g, "");
    } else if (a.startsWith("--grounded-dir=")) {
      out.groundedDir = a.slice("--grounded-dir=".length);
    } else if (a === "--help" || a === "-h") {
      // handled in main()
    } else {
      throw new Error(
        `synthesize-corridor-character: unknown argument "${a}". Use --corridor="NAME" --preview or --write-db, plus --grounded-dir=PATH.`,
      );
    }
  }
  return out;
}

const USAGE = `Usage:
  bun refinery/tools/synthesize-corridor-character.mts \\
    --corridor="Pine Ridge Rd Naples" \\
    --grounded-dir=/tmp \\
    [--preview | --write-db]

Flags:
  --corridor=NAME    Run for one corridor by exact corridor_name. Required.
  --grounded-dir=DIR Directory containing the B1 NDJSON capture(s). The tool
                     looks for {dir}/{slug}-{YYYY}-{MM}.ndjson (the --dry-run
                     path B1 writes to /tmp), or the most recent matching
                     file under {dir}/corridor_grounded/{slug}/...
  --preview          Print the three-block output as JSON to stdout (default).
  --write-db         Write to corridor_profiles. NOT IMPLEMENTED in v1 —
                     follow-up PR will wire the Supabase upsert.

ANTHROPIC_API_KEY must be set in .env.local.`;

/**
 * Slugify a corridor name into a filesystem-safe path component. Must stay
 * byte-identical with the Python `slug()` in
 * `ingest/pipelines/corridor_grounded/pipeline.py` — divergence breaks the
 * `resolveGroundedPath()` lookup. Both implementations are pinned by
 * `fixtures/corridor-slug-parity.json` and verified in both language test
 * suites; if you change the rule here, update the Python copy + regenerate
 * the fixture's `expected` values.
 */
export function slug(corridorName: string): string {
  return corridorName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

async function resolveGroundedPath(
  dir: string,
  corridorName: string,
): Promise<string> {
  const { readdir, stat } = await import("node:fs/promises");
  const path = await import("node:path");
  const s = slug(corridorName);

  // Preferred: the B1 --dry-run drop at /tmp/{slug}-YYYY-MM.ndjson.
  const flatCandidates: string[] = [];
  try {
    const entries = await readdir(dir);
    for (const f of entries) {
      if (f.startsWith(`${s}-`) && f.endsWith(".ndjson")) {
        flatCandidates.push(path.join(dir, f));
      }
    }
  } catch {
    // dir doesn't exist or unreadable — try the nested layout next.
  }
  if (flatCandidates.length > 0) {
    // Most recent by mtime.
    const ranked = await Promise.all(
      flatCandidates.map(async (p) => ({
        path: p,
        mtime: (await stat(p)).mtimeMs,
      })),
    );
    ranked.sort((a, b) => b.mtime - a.mtime);
    return ranked[0].path;
  }

  // Nested production layout: {dir}/corridor_grounded/{slug}/year=YYYY/month=MM/run-{iso}.ndjson
  const nestedRoot = path.join(dir, "corridor_grounded", s);
  try {
    const yearDirs = await readdir(nestedRoot);
    const candidates: string[] = [];
    for (const yd of yearDirs) {
      const ydPath = path.join(nestedRoot, yd);
      try {
        const monthDirs = await readdir(ydPath);
        for (const md of monthDirs) {
          const mdPath = path.join(ydPath, md);
          try {
            const runs = await readdir(mdPath);
            for (const r of runs) {
              if (r.endsWith(".ndjson")) candidates.push(path.join(mdPath, r));
            }
          } catch {}
        }
      } catch {}
    }
    if (candidates.length > 0) {
      const ranked = await Promise.all(
        candidates.map(async (p) => ({
          path: p,
          mtime: (await stat(p)).mtimeMs,
        })),
      );
      ranked.sort((a, b) => b.mtime - a.mtime);
      return ranked[0].path;
    }
  } catch {}

  throw new Error(
    `synthesize-corridor-character: no grounded NDJSON found for "${corridorName}" (slug "${s}") under ${dir}. Run ingest/pipelines/corridor_grounded/pipeline.py first.`,
  );
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h") || argv.length === 0) {
    console.log(USAGE);
    return 0;
  }

  const args = parseCli(argv);
  if (!args.corridor) {
    console.error(
      "synthesize-corridor-character: --corridor=NAME is required (one-corridor mode only in v1).\n",
    );
    console.error(USAGE);
    return 2;
  }
  if (!args.groundedDir) {
    console.error(
      "synthesize-corridor-character: --grounded-dir=DIR is required.\n",
    );
    console.error(USAGE);
    return 2;
  }
  if (args.writeDb) {
    console.error(
      "synthesize-corridor-character: --write-db is not implemented in v1. Re-run with --preview, copy the JSON, and use a follow-up DB writer.",
    );
    return 2;
  }

  // Stage A is intentionally NOT done here — Stage A needs deterministic
  // pre-filtered Supabase pulls (a separate orchestrator, not in this PR).
  // The CLI's job in v1 is to take a hand-built fact pack OR a serialized
  // one and run the synthesizer + lint against it. The path forward in
  // Step 4 is a Stage A driver that produces the pack and feeds it here.
  console.error(
    "synthesize-corridor-character: CLI requires a pre-built fact pack. " +
      "v1 wiring is library-only; call synthesizeCorridorCharacter() from a " +
      "Stage A driver. (Step 4 ships the driver.)",
  );
  return 2;
}

// CLI-detect idiom matching refinery/tools/render-roles.mts (works under
// both `bun script.mts` and `node script.mts`; `import.meta.main` is
// Bun-only and tsc -p refinery/tsconfig.json rejects it).
if (
  process.argv[1] &&
  import.meta.url.endsWith(path.basename(process.argv[1]))
) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    });
}
