/**
 * lib/deliverable/build.ts — the assembly engine (Session 6, task-03).
 *
 * ONE forced-tool LLM call turns a project's filed items + an instruction into a
 * narrative-ONLY deliverable. The LLM never sees raw project internals and never
 * computes a number — it writes connective prose over numbered item snapshots
 * whose numbers it must quote verbatim. The narrative is then linted (the moat,
 * task-04): on any violation we regenerate once naming the violations, then
 * hard-strip the offending sentences. This is the structural guarantee — the
 * system prevents invention, not the model's good behavior.
 *
 * Vendor-First (verified in-session against the Anthropic contract): non-stream
 * `messages.create`, `tool_choice:{type:"tool",name}`, the tool's `input_schema`
 * shapes the output; `getAnthropic()` / `SYNTHESIS_MODEL` are the repo's shared
 * client + model (mirrors refinery/agents/synthesis-agent.mts exactly).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProjectItem } from "../project/items";
import type {
  Narrative,
  SnapshotItem,
  ResolvedChartItem,
  ResolvedFrameItem,
  ChartBlock,
} from "./templates";
import type { BrainOutput } from "../../refinery/types/brain-output.mts";
import { loadParsedBrain } from "../fetch-brain";
import { bindFrameSpec } from "./bind-frame";
import {
  lintDeliverableNarrative,
  lintVerdictFreshness,
  stripVerdictSentences,
  RECORDED_LABEL_RE,
  type NarrativeViolation,
} from "./narrative-lint";
import {
  getAnthropic,
  SYNTHESIS_MODEL,
  agentsAreMocked,
} from "../../refinery/agents/anthropic.mts";
import { RULES_OF_ENGAGEMENT } from "../../refinery/lib/rules-of-engagement.mts";
import { reconcileMetric } from "../reconcile/reconcile";
import { lookupLakeFact } from "../reconcile/lane1";
import { toAssertion } from "../reconcile/lane2";
import type { ReconciliationVerdict } from "../reconcile/types";

/** Env override for the assembly model; defaults to the repo's Sonnet synthesis model. */
const DELIVERABLE_MODEL = process.env.DELIVERABLE_MODEL || SYNTHESIS_MODEL;

/**
 * Plan C-4 — the reconciliation `ttl` gate. Default OFF (no-op): when unset,
 * `buildDeliverableNarrative` computes NO verdicts and appends NO ttl violations,
 * so its output is byte-identical to before C. Flipped ON (`"1"`) only after the
 * full rebuild has stamped `output.expires` on every brain AND C's catalog-gap
 * `not_found` branch is live (operator-gated — has live deliverable blast radius).
 */
function ttlGateEnabled(): boolean {
  return process.env.RECONCILE_TTL_GATE_ENABLED === "1";
}

/**
 * Reconcile every filed `metric` item against the live lake (C-2 + C-3). Only
 * called when the ttl gate is ON. Each verdict tells `lintVerdictFreshness`
 * which asserted numbers are stale (held but past TTL) and must not ship.
 */
async function computeMetricVerdicts(items: SnapshotItem[]): Promise<ReconciliationVerdict[]> {
  const verdicts: ReconciliationVerdict[] = [];
  for (const item of items) {
    if (item.kind !== "metric") continue;
    const assertion = toAssertion(item);
    if (assertion === null) continue;
    const fact = await lookupLakeFact(
      assertion.report_id,
      assertion.metric_slug ?? assertion.label,
    );
    verdicts.push(reconcileMetric(fact, assertion));
  }
  return verdicts;
}

// ---------------------------------------------------------------------------
// Freeze the snapshot — resolve chart refs so the deliverable never drifts
// ---------------------------------------------------------------------------

/**
 * Deep-copy the project's items and resolve every `{kind:"chart"}` ref into an
 * embedded `chart_block` by joining `saved_charts` (public-select). The result
 * is the frozen `items_snapshot` the deliverable renders from forever — it does
 * not re-fetch. A chart whose row is missing is dropped (it cannot render).
 */
export async function freezeSnapshot(
  db: SupabaseClient,
  items: ProjectItem[],
): Promise<SnapshotItem[]> {
  const chartIds = items
    .filter((i) => i.kind === "chart")
    .map((i) => (i as { chart_id: string }).chart_id);

  const blockById = new Map<string, { chart_block: ChartBlock; freshness_token: string | null }>();
  if (chartIds.length > 0) {
    const { data } = await db
      .from("saved_charts")
      .select("id, chart_block, freshness_token")
      .in("id", chartIds);
    for (const row of data ?? []) {
      blockById.set(row.id, {
        chart_block: row.chart_block as ChartBlock,
        freshness_token: row.freshness_token,
      });
    }
  }

  // Live frame recipes bind to brain data at BUILD time (FLAG-2: the first
  // live-data binding). Load each referenced brain once off disk; every frame on
  // that brain binds against the SAME parsed output, stamping its own as-of.
  const brainById = new Map<string, { output: BrainOutput; freshness_token: string }>();
  const frameBrainIds = [
    ...new Set(
      items
        .filter((i): i is Extract<ProjectItem, { kind: "frame" }> => i.kind === "frame")
        .map((i) => i.brain_id),
    ),
  ];
  for (const brainId of frameBrainIds) {
    const parsed = await loadParsedBrain(brainId);
    if (parsed) {
      brainById.set(brainId, { output: parsed.output, freshness_token: parsed.freshness_token });
    }
  }

  const out: SnapshotItem[] = [];
  for (const item of items) {
    if (item.kind === "chart") {
      const resolved = blockById.get(item.chart_id);
      if (!resolved) continue; // unresolvable chart — cannot render, drop it
      const ri: ResolvedChartItem = {
        kind: "chart",
        id: item.id,
        added_at: item.added_at,
        origin: item.origin,
        chart_id: item.chart_id,
        title: item.title,
        chart_block: resolved.chart_block,
        freshness_token: resolved.freshness_token ?? undefined,
      };
      out.push(ri);
    } else if (item.kind === "frame") {
      const brain = brainById.get(item.brain_id);
      if (!brain) continue; // brain missing/unreadable — cannot render, drop it
      const spec = bindFrameSpec(brain.output, {
        frame_id: item.frame_id,
        metric_keys: item.metric_keys,
        table_id: item.table_id,
        title: item.title,
      });
      if (!spec) continue; // un-bindable from this brain's live data — drop it
      const fi: ResolvedFrameItem = {
        kind: "frame",
        id: item.id,
        added_at: item.added_at,
        origin: item.origin,
        brain_id: item.brain_id,
        title: item.title,
        chart_spec: spec,
        freshness_token: brain.freshness_token,
        // Preserve the binding recipe so a later refresh re-binds faithfully (P4).
        frame_id: item.frame_id,
        metric_keys: item.metric_keys,
        table_id: item.table_id,
      };
      out.push(fi);
    } else {
      // structuredClone keeps the snapshot a true deep copy (no shared refs)
      out.push(structuredClone(item));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Collect the anchor numbers + render items for the prompt
// ---------------------------------------------------------------------------

/** Every value-bearing string in the snapshot. The lint extracts + normalizes
 *  the numbers from these to build the anchor set the narrative must match. */
export function collectSnapshotNumbers(items: SnapshotItem[]): string[] {
  const out: string[] = [];
  for (const item of items) {
    switch (item.kind) {
      case "metric":
        out.push(item.value, item.label);
        break;
      case "qa":
        out.push(item.answer);
        if (item.fact) out.push(item.fact);
        out.push(item.question);
        break;
      case "table_slice":
        for (const row of item.rows)
          for (const cell of row) if (cell != null) out.push(String(cell));
        break;
      case "chart":
        for (const row of item.chart_block.rows)
          for (const cell of row) if (cell != null) out.push(String(cell));
        break;
      case "frame":
        for (const row of item.chart_spec.rows)
          for (const cell of row) if (cell != null) out.push(String(cell));
        break;
      case "note":
        out.push(item.text);
        break;
      // report / source / file carry no figures
    }
  }
  return out;
}

/** Values from items whose LABEL marks them recorded/sold/closed — the anchor set
 *  the recorded-claim gate checks "sold for $X" sentences against. */
export function collectRecordedNumbers(items: SnapshotItem[]): string[] {
  const out: string[] = [];
  for (const item of items) {
    if (item.kind === "metric" && RECORDED_LABEL_RE.test(item.label)) {
      out.push(item.value, item.label);
    } else if (item.kind === "qa" && RECORDED_LABEL_RE.test(item.question)) {
      out.push(item.answer);
      if (item.fact) out.push(item.fact);
    }
  }
  return out;
}

/** Citation suffix for an item — source + as-of only, never internal ids. */
function citation(item: SnapshotItem): string {
  const parts: string[] = [];
  if ("source_label" in item && item.source_label) parts.push(item.source_label);
  if ("source_url" in item && item.source_url) parts.push(item.source_url);
  if ("freshness_token" in item && item.freshness_token)
    parts.push(`as of ${item.freshness_token}`);
  return parts.length ? ` (${parts.join(" · ")})` : "";
}

/** Render one filed item as a numbered, customer-clean fact line for the prompt.
 *  Exported for unit coverage of the file/extracted-text branches. */
export function renderItem(item: SnapshotItem, n: number): string {
  switch (item.kind) {
    case "metric":
      return `[${n}] METRIC — ${item.label}: ${item.value}${citation(item)}`;
    case "qa":
      return `[${n}] ANSWER — Q: ${item.question} A: ${item.answer}${citation(item)}`;
    case "table_slice": {
      const head = item.columns.join(" | ");
      const body = item.rows
        .slice(0, 12)
        .map((r) => r.map((c) => (c == null ? "" : String(c))).join(" | "))
        .join("; ");
      return `[${n}] TABLE — ${item.title} [${head}]: ${body}${citation(item)}`;
    }
    case "chart": {
      const body = item.chart_block.rows
        .slice(0, 12)
        .map((r) => r.map((c) => (c == null ? "" : String(c))).join("="))
        .join("; ");
      return `[${n}] CHART — ${item.title}: ${body}${citation(item)}`;
    }
    case "frame": {
      const body = item.chart_spec.rows
        .slice(0, 12)
        .map((r) => r.map((c) => (c == null ? "" : String(c))).join("="))
        .join("; ");
      return `[${n}] CHART — ${item.title}: ${body}${citation(item)}`;
    }
    case "source":
      return `[${n}] SOURCE — ${item.label}: ${item.url}`;
    case "report":
      return `[${n}] REPORT — ${item.title ?? item.slug}${citation(item)}`;
    case "note":
      return `[${n}] NOTE — ${item.text}`;
    case "file":
      // A PDF read at upload time carries its distilled content in
      // `extracted_text` — feed it to the narrative as a DOCUMENT so the prose
      // can quote real figures from the flyer, not just name the file. No
      // extraction (image, failed, or still processing) → the file-name label.
      if (item.extracted_text && item.extracted_text.trim()) {
        return `[${n}] DOCUMENT — ${item.caption ?? item.storage_path}\n${item.extracted_text.trim()}`;
      }
      return `[${n}] FILE — ${item.caption ?? item.storage_path} (pdf, content not available)`;
  }
}

// ---------------------------------------------------------------------------
// The forced tool
// ---------------------------------------------------------------------------

const NARRATIVE_TOOL = {
  name: "record_deliverable_narrative",
  description:
    "Record the connective narrative for the deliverable: a lead exec summary, action-titled sections, and any inference notes.",
  input_schema: {
    type: "object" as const,
    additionalProperties: false,
    properties: {
      exec_summary: { type: "string" },
      sections: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: { title: { type: "string" }, intro: { type: "string" } },
          required: ["title", "intro"],
        },
      },
      inference_notes: { type: "array", items: { type: "string" } },
    },
    required: ["exec_summary", "sections", "inference_notes"],
  },
};

function systemPrompt(): string {
  return `${RULES_OF_ENGAGEMENT}

You assemble a client-ready real-estate deliverable. You write ONLY connective narrative.
- The ONLY facts available are the numbered items in the user message. Never introduce a number, date, percentage, or place that is not present in them.
- Quote every number EXACTLY as it appears in the items — verbatim, with the same digits and units. Never round, approximate, or restate a figure in words ("about $30K" for "$30,074" is forbidden).
- Lead with the answer. Each section is ONE assertion, stated as its action title (e.g. "Rents are outrunning the county median", not "Rent data").
- Section intros and the exec summary are CITED FACTS only — no forecasts. Anything beyond the cited facts goes ONLY in inference_notes, each tagged "[INFERENCE]", naming the item it builds on, and ending with "falsifier: <a condition that would disprove it>".
- Plain English for a broker or investor. Never write the words master, brain, payload, grain, or dossier. No internal ids.`;
}

async function callModel(userContent: string): Promise<Narrative> {
  const client = getAnthropic("deliverable_build");
  const response = await client.messages.create({
    model: DELIVERABLE_MODEL,
    max_tokens: 2048,
    system: [{ type: "text", text: systemPrompt(), cache_control: { type: "ephemeral" } }],
    tools: [NARRATIVE_TOOL],
    tool_choice: { type: "tool", name: NARRATIVE_TOOL.name },
    messages: [{ role: "user", content: userContent }],
  });
  const toolUse = response.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Deliverable build: response contained no tool_use block");
  }
  const parsed = toolUse.input as Partial<Narrative>;
  return {
    exec_summary: typeof parsed.exec_summary === "string" ? parsed.exec_summary : "",
    sections: Array.isArray(parsed.sections) ? parsed.sections : [],
    inference_notes: Array.isArray(parsed.inference_notes) ? parsed.inference_notes : [],
  };
}

/** Deterministic mock narrative for offline / no-key builds. Always lint-clean:
 *  it only ever emits values verbatim from the items, and no forecasts. */
function mockNarrative(items: SnapshotItem[]): Narrative {
  const metrics = items.filter((i) => i.kind === "metric") as Extract<
    SnapshotItem,
    { kind: "metric" }
  >[];
  const exec_summary = metrics[0]
    ? `${metrics[0].label} is ${metrics[0].value}.`
    : "This deliverable compiles the filed research for review.";
  const sections = (metrics.length ? metrics.slice(0, 3) : [null]).map((m) =>
    m
      ? { title: m.label, intro: `${m.label} is ${m.value}.` }
      : { title: "Filed research", intro: "" },
  );
  return { exec_summary, sections, inference_notes: [] };
}

function describeViolations(violations: NarrativeViolation[]): string {
  const numbers = [
    ...new Set(violations.filter((v) => v.gate === "number" && v.token).map((v) => v.token)),
  ];
  const grounded = violations.filter((v) => v.gate === "grounded").map((v) => v.sentence);
  const smoothing = [
    ...new Set(violations.filter((v) => v.gate === "smoothing" && v.token).map((v) => v.token)),
  ];
  const jargon = [
    ...new Set(violations.filter((v) => v.gate === "jargon" && v.token).map((v) => v.token)),
  ];
  const lines: string[] = [];
  if (numbers.length)
    lines.push(
      `- These numbers are NOT in any item — remove them or quote the exact item value instead: ${numbers.join(", ")}`,
    );
  if (grounded.length)
    lines.push(
      `- These are forecasts in fact prose — restate as a cited fact, or move to an inference_note with "falsifier: ...": ${grounded.map((s) => `"${s}"`).join("; ")}`,
    );
  if (smoothing.length)
    lines.push(`- Remove smoothing language and give the exact figure: ${smoothing.join(", ")}`);
  if (jargon.length) lines.push(`- Remove internal jargon: ${jargon.join(", ")}`);
  const recorded = [
    ...new Set(violations.filter((v) => v.gate === "recorded").map((v) => v.sentence)),
  ];
  if (recorded.length)
    lines.push(
      `- These sentences claim a recorded sale, but the figure is not from a sold/closed/recorded item — reword as a list-price fact or drop the claim: ${recorded.map((s) => `"${s}"`).join("; ")}`,
    );
  const ttl = [
    ...new Set(violations.filter((v) => v.gate === "ttl" && v.token).map((v) => v.token)),
  ];
  if (ttl.length)
    lines.push(
      `- These figures are stale or unsourced — drop them or cite the lake fact + its freshness: ${ttl.join(", ")}`,
    );
  return lines.join("\n");
}

/**
 * Combine the standard narrative lint with the flag-gated reconciliation `ttl`
 * gate into ONE result the build loop consumes. PURE — no LLM, no I/O — so the
 * full gate (including the stale-figure strip) is unit-testable without a live
 * key or a module mock.
 *
 * Flag-OFF invariant: when `ttlGate` is false there are no ttl violations, so
 * this returns the standard `lintDeliverableNarrative` result UNCHANGED — the
 * build path stays byte-identical to before C.
 *
 * Seam robustness: the ttl violations used for the hard strip are recomputed
 * against `lint.stripped` (the standard-gate-stripped narrative), so the
 * exact-sentence match in `stripVerdictSentences` always operates on a
 * consistent sentence set — never against sentences the standard gates already
 * removed.
 */
export function gateNarrative(
  narrative: Narrative,
  anchors: ReadonlyArray<string | number>,
  verdicts: ReconciliationVerdict[],
  ttlGate: boolean,
  recordedNumbers: ReadonlyArray<string | number> = [],
): { ok: boolean; violations: NarrativeViolation[]; stripped: Narrative } {
  const lint = lintDeliverableNarrative(narrative, anchors, recordedNumbers);
  const ttlViolations = ttlGate ? lintVerdictFreshness(narrative, verdicts) : [];
  if (ttlViolations.length === 0) return lint;
  const onStripped = lintVerdictFreshness(lint.stripped, verdicts);
  return {
    ok: false,
    violations: [...lint.violations, ...ttlViolations],
    stripped:
      onStripped.length > 0 ? stripVerdictSentences(lint.stripped, onStripped) : lint.stripped,
  };
}

export interface BuildResult {
  narrative: Narrative;
  regenerations: number;
  stripped: boolean;
}

/**
 * Assemble the deliverable narrative for an instruction + frozen snapshot.
 * Forced-tool call → lint → (on violation) one regeneration naming the
 * violations → (still bad) hard-strip the offending sentences.
 */
export async function buildDeliverableNarrative(opts: {
  instruction: string;
  items: SnapshotItem[];
  template: string;
}): Promise<BuildResult> {
  const { instruction, items } = opts;
  const anchors = collectSnapshotNumbers(items);
  const recordedNumbers = collectRecordedNumbers(items);
  const itemBlock = items.map((it, i) => renderItem(it, i + 1)).join("\n");
  const baseUser = `Instruction: ${instruction || "Assemble a professional summary of the filed research."}

The numbered items are the ONLY facts you may use:
${itemBlock}`;

  if (agentsAreMocked()) {
    return { narrative: mockNarrative(items), regenerations: 0, stripped: false };
  }

  // Plan C-4 — reconcile filed metrics ONLY when the ttl gate is ON. Flag OFF ⇒
  // verdicts = [] ⇒ ttlViolations = [] ⇒ every branch below collapses to the
  // pre-C behavior, so this function's output is byte-identical to before.
  const ttlGate = ttlGateEnabled();
  const verdicts = ttlGate ? await computeMetricVerdicts(items) : [];

  let narrative = await callModel(baseUser);
  let gate = gateNarrative(narrative, anchors, verdicts, ttlGate, recordedNumbers);
  let regenerations = 0;
  let stripped = false;

  if (!gate.ok) {
    regenerations = 1;
    const retryUser = `${baseUser}

Your previous draft had these problems — fix every one and re-emit via the tool:
${describeViolations(gate.violations)}`;
    narrative = await callModel(retryUser);
    gate = gateNarrative(narrative, anchors, verdicts, ttlGate, recordedNumbers);
    if (!gate.ok) {
      narrative = gate.stripped; // hard-strip offending sentences and proceed
      stripped = true;
    }
  }

  return { narrative, regenerations, stripped };
}
