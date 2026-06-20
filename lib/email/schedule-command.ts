/**
 * Pure logic for the AI email-schedule command interface (Unit G).
 *
 * The route (`app/api/email/schedule-command/route.ts`) hands a tenant's
 * natural-language command to Claude with a FORCED tool call; the model returns
 * one structured action. Everything in this file is deterministic and has no I/O —
 * the tool schema, the system prompt, the defense-in-depth validation (never trust
 * the model's params), and the human-readable confirmation summary — so it is fully
 * unit-testable without the model or a DB.
 *
 * Two-step contract: the route PROPOSES (parse → validate → summary, no write) and
 * the user CONFIRMS before any row is written. No silent mutations.
 */

import { z } from "zod";
import type { Cadence } from "./schedule-cadence";

export const SCHEDULE_ACTIONS = [
  "create",
  "pause",
  "stop",
  "change-template",
  "change-cadence",
  "change-audience",
] as const;
export type ScheduleAction = (typeof SCHEDULE_ACTIONS)[number];

/**
 * Forced-tool JSON schema handed to Claude. Only `action` is required; the model
 * fills only the params relevant to the action it picks. `additionalProperties:
 * false` so the model can't smuggle in unknown fields.
 */
export const SCHEDULE_COMMAND_TOOL = {
  name: "propose_email_schedule_action",
  description:
    "Translate the user's natural-language email-schedule command into exactly ONE structured action. Fill only the parameters relevant to the chosen action.",
  input_schema: {
    type: "object" as const,
    additionalProperties: false,
    properties: {
      action: { type: "string", enum: [...SCHEDULE_ACTIONS, "clarify"] },
      schedule_id: {
        type: "integer",
        description:
          "Target schedule id for pause / stop / change-* — copy it from the EXISTING SCHEDULES list. Omit for create.",
      },
      cadence: { type: "string", enum: ["daily", "weekly", "monthly"] },
      day_of_week: { type: "integer", description: "0 = Sunday … 6 = Saturday. Weekly only." },
      day_of_month: { type: "integer", description: "1–28. Monthly only." },
      send_hour_et: { type: "integer", description: "Send hour in US Eastern time, 0–23." },
      ambiguous_hour: {
        type: "integer",
        description:
          "Set ONLY with action 'clarify': the bare 12-hour number (1–12) the user gave with NO am/pm (e.g. 'send it at 6' -> 6). Never guess am/pm — emit clarify so the user picks.",
      },
      audience_slug: {
        type: "string",
        description:
          "Audience to send to. Only if named by the user or present on an existing schedule.",
      },
      template_id: {
        type: "string",
        description:
          "Template to use. Only if named by the user or present on an existing schedule.",
      },
      scope_kind: {
        type: "string",
        enum: ["zip", "place", "county"],
        description:
          "Geographic grain of the digest, ONLY when the user named a specific geography: a ZIP code -> 'zip', a named town/beach/corridor -> 'place', a county -> 'county'. Omit entirely for a whole-region digest.",
      },
      scope_value: {
        type: "string",
        description:
          "The named geography verbatim, exactly as the user said it (e.g. 'Cape Coral', '33904', 'Lee County'). Set ONLY together with scope_kind; omit for a whole-region digest.",
      },
      topic: {
        type: "string",
        description:
          "The subject the user wants the digest about, verbatim (e.g. 'flood', 'permits', 'prices', 'tourism', 'freight', 'jobs'). Free text. Set ONLY when the user named a subject; omit for a general digest.",
      },
    },
    required: ["action"],
  },
};

export interface ExistingSchedule {
  id: number;
  status: string;
  cadence: string | null;
  day_of_week: number | null;
  day_of_month: number | null;
  send_hour_et: number | null;
  audience_slug: string | null;
  template_id: string | null;
}

export interface ParsedCommand {
  action: ScheduleAction;
  schedule_id?: number;
  cadence?: Cadence;
  day_of_week?: number;
  day_of_month?: number;
  send_hour_et?: number;
  audience_slug?: string;
  template_id?: string;
  // ── Additive "scope" capability (optional everywhere). ──
  // scope_kind + scope_value pin the digest to a geography; topic pins it to a
  // subject. All optional: the NULL+NULL absence is the valid default => today's
  // whole-region global digest (there is deliberately NO 'general' magic value).
  // scope_value and topic arrive ALREADY normalized to the canonical contract
  // form (lowercase + trimmed) by the rawSchema transforms.
  scope_kind?: "zip" | "place" | "county";
  scope_value?: string;
  topic?: string;
}

/** System prompt: the 6 intents, the ET-hour rule, and the tenant's existing rows
 *  so the model can target a mutation by `schedule_id`. */
export function buildSystemPrompt(existing: ExistingSchedule[]): string {
  return [
    "You convert a tenant's natural-language request into ONE email-schedule action via the propose_email_schedule_action tool.",
    "Actions: create (a new schedule), pause, stop, change-template, change-cadence, change-audience, clarify (ask the user a disambiguating question).",
    "Rules:",
    "- send_hour_et is the hour in US Eastern time, 0–23. Convert '7am' -> 7, '5pm' -> 17, 'noon' -> 12, 'midnight' -> 0.",
    "- If the user gives an hour with NO am/pm that is genuinely ambiguous ('at 6', 'around 8'), do NOT guess: set action 'clarify' and ambiguous_hour to the bare number (1–12). Unambiguous words ('noon', 'midnight', '7am', '5pm') need no clarify.",
    "- weekly needs day_of_week (0 = Sunday … 6 = Saturday). monthly needs day_of_month (1–28).",
    "- For pause / stop / change-*, set schedule_id to the matching row from EXISTING SCHEDULES. If none clearly matches, still pick the closest action and omit schedule_id — a confirmation step follows.",
    "- Never invent an audience_slug or template_id. Use only a value the user named or one already present on an existing schedule.",
    "- SCOPE: when the user names a geography, set scope_kind (zip | place | county) AND scope_value (the named place verbatim, e.g. 'Cape Coral', '33904', 'Lee County'). When the user names a subject (flood, permits, prices, tourism, freight, jobs, etc.), set topic to it verbatim. Omit BOTH scope_kind/scope_value and topic for a whole-region general digest — never invent a geography or subject the user did not name.",
    "EXISTING SCHEDULES (JSON):",
    JSON.stringify(existing),
  ].join("\n");
}

// ── primitive field schemas ──────────────────────────────────────────────────
const hourSchema = z.number().int().min(0).max(23);
const dowSchema = z.number().int().min(0).max(6);
const domSchema = z.number().int().min(1).max(28);
const cadenceSchema = z.enum(["daily", "weekly", "monthly"]);

const rawSchema = z.object({
  action: z.enum(SCHEDULE_ACTIONS),
  schedule_id: z.number().int().positive().optional(),
  cadence: cadenceSchema.optional(),
  day_of_week: dowSchema.optional(),
  day_of_month: domSchema.optional(),
  send_hour_et: hourSchema.optional(),
  audience_slug: z.string().min(1).optional(),
  template_id: z.string().min(1).optional(),
  // ── Additive "scope" fields. The .trim().toLowerCase() transforms ENFORCE the
  //    canonical contract form (lowercase + trimmed) at the parse boundary — this
  //    is THE form the future build-time ZIP expander reads. scope_kind is a
  //    geographic-grain enum; topic is free text (the consumer owns topic ->
  //    brain-slug mapping). All optional: a no-scope create stays valid and the
  //    NULL+NULL absence is the default => today's whole-region global digest.
  scope_kind: z.enum(["zip", "place", "county"]).optional(),
  scope_value: z.string().trim().min(1).toLowerCase().optional(),
  topic: z.string().trim().min(1).toLowerCase().optional(),
});

export type ValidationResult =
  | { ok: true; command: ParsedCommand }
  | { ok: false; errors: string[] };

/**
 * Defense-in-depth validation of a tool-call input (or a confirm-step proposal).
 * Validates primitive field shapes via zod, then the per-action cross-field
 * requirements. Used on BOTH the parsed model output (after the route merges
 * existing-row defaults) and the client's confirm payload — never trust either.
 */
export function validateToolInput(input: unknown): ValidationResult {
  const parsed = rawSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
    };
  }
  // `parsed.data` already carries the CANONICAL CONTRACT FORM of the scope fields:
  // rawSchema's `.trim().toLowerCase()` transforms ran during safeParse, so
  // `c.scope_value` / `c.topic` are lowercase + trimmed here — THE form the
  // future build-time ZIP expander reads. No scope is the valid default: a create
  // with scope_kind/scope_value/topic all absent stays valid (NULL+NULL =>
  // today's whole-region global digest; there is deliberately no 'general' magic
  // value). The returned command therefore carries the normalized scope fields
  // unchanged — we add NO new hard requirement for them below.
  const c = parsed.data as ParsedCommand;
  const errors: string[] = [];

  const requireCadence = () => {
    if (!c.cadence) {
      errors.push("cadence is required (daily | weekly | monthly)");
      return;
    }
    if (c.cadence === "weekly" && c.day_of_week == null)
      errors.push("weekly schedule requires day_of_week (0 = Sunday … 6 = Saturday)");
    if (c.cadence === "monthly" && c.day_of_month == null)
      errors.push("monthly schedule requires day_of_month (1–28)");
  };

  switch (c.action) {
    case "create":
      requireCadence();
      if (c.send_hour_et == null) errors.push("send_hour_et is required");
      break;
    case "change-cadence":
      requireCadence();
      // send_hour_et is filled from the existing row by the route before validation.
      if (c.send_hour_et == null) errors.push("send_hour_et is required for change-cadence");
      break;
    case "change-template":
      if (!c.template_id) errors.push("change-template requires template_id");
      break;
    case "change-audience":
      if (!c.audience_slug) errors.push("change-audience requires audience_slug");
      break;
    case "pause":
    case "stop":
      // schedule_id is resolved by the route (explicit, or inferred when the tenant
      // has exactly one schedule); not a hard param requirement here.
      break;
  }
  return errors.length ? { ok: false, errors } : { ok: true, command: c };
}

function fmtHour(h?: number): string {
  if (h == null) return "?";
  const isAm = h < 12;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${isAm ? "am" : "pm"}`;
}

/**
 * Bare-hour disambiguation candidates. A natural-language hour with NO am/pm ("send it at
 * 6") is ambiguous; the model emits action "clarify" + the bare 12-hour number, and the
 * route turns it into two explicit choices so a user never silently gets 6am for 6pm.
 * Pure. Returns null for any input outside 1–12 (or non-integer).
 *
 * DEFENSIVE / FORWARD-LOOKING: no current UI feeds a free-text hour into the NL parser
 * (every hour today is picked from explicit am/pm options, or the action route hard-codes
 * 10am). This is wired for the planned inbound-email-reply parser (`email_inbound_reply`),
 * which WILL carry free text. Until that ships, the route returns the candidates but no
 * surface renders them.
 */
export function hourClarifyCandidates(
  h: number | null | undefined,
): [{ hour: number; label: string }, { hour: number; label: string }] | null {
  if (typeof h !== "number" || !Number.isInteger(h) || h < 1 || h > 12) return null;
  const amHour = h === 12 ? 0 : h;
  const pmHour = h === 12 ? 12 : h + 12;
  return [
    { hour: amHour, label: `${h}am` },
    { hour: pmHour, label: `${h}pm` },
  ];
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** ` ("flood" / "cape coral")` from whichever of topic/scope_value is set — used in
 *  the honest "coming soon" note when the scope consumer isn't live yet. */
function scopeBitsForNote(c: ParsedCommand): string {
  const bits = [c.topic, c.scope_value].filter((b): b is string => Boolean(b)).map((b) => `"${b}"`);
  return bits.length ? ` (${bits.join(" / ")})` : "";
}

/**
 * Plain-English confirmation line shown to the tenant before they confirm.
 *
 * SCOPE GATE: scope_kind/scope_value/topic are CAPTURED on the row, but the digest
 * worker does not yet FILTER by them (Task 02 — scoped content via the grounded
 * engine). Until it does, promising a scoped digest in this confirmation would be a
 * lie ("flood digest for Cape Coral" → ships the region-wide digest). So when the
 * consumer isn't live we drop the active "about X for Y" clause and instead append an
 * honest note that still echoes the captured intent. Flip `SCOPE_CONSUMER_LIVE=true`
 * (or pass scopeConsumerLive:true) the day the consumer ships and the promise returns.
 */
export function summarizeCommand(c: ParsedCommand, opts?: { scopeConsumerLive?: boolean }): string {
  const scopeLive = opts?.scopeConsumerLive ?? process.env.SCOPE_CONSUMER_LIVE === "true";
  const when = (): string => {
    if (c.cadence === "daily") return `every day at ${fmtHour(c.send_hour_et)} ET`;
    if (c.cadence === "weekly")
      return `every ${WEEKDAYS[c.day_of_week ?? 0]} at ${fmtHour(c.send_hour_et)} ET`;
    if (c.cadence === "monthly")
      return `on day ${c.day_of_month} of each month at ${fmtHour(c.send_hour_et)} ET`;
    return "";
  };
  const to = c.audience_slug ? ` to "${c.audience_slug}"` : "";
  const tmpl = c.template_id ? ` using template "${c.template_id}"` : "";
  // Active scope clause ONLY when the consumer is live — e.g. ` about flood for "cape coral"`.
  const about = scopeLive && c.topic ? ` about ${c.topic}` : "";
  const forPlace = scopeLive && c.scope_value ? ` for "${c.scope_value}"` : "";
  // Scope captured but consumer not live → honest note (echoes intent, promises nothing).
  const pendingScope =
    !scopeLive && (c.topic || c.scope_value)
      ? ` Note: it sends the full Southwest Florida digest for now — per-place/topic filtering${scopeBitsForNote(c)} is coming soon.`
      : "";
  switch (c.action) {
    case "create":
      return `Create a ${c.cadence} schedule that sends ${when()}${about}${forPlace}${to}${tmpl}.${pendingScope}`;
    case "pause":
      return `Pause schedule #${c.schedule_id ?? "?"}.`;
    case "stop":
      return `Stop schedule #${c.schedule_id ?? "?"} (it will no longer send).`;
    case "change-template":
      return `Change schedule #${c.schedule_id ?? "?"} to use template "${c.template_id}".`;
    case "change-cadence":
      return `Change schedule #${c.schedule_id ?? "?"} to send ${when()}.`;
    case "change-audience":
      return `Change schedule #${c.schedule_id ?? "?"} to send to audience "${c.audience_slug}".`;
  }
}

/** Short human description of an existing schedule, for clarification candidates. */
export function describeExisting(s: ExistingSchedule): string {
  const cad =
    s.cadence === "weekly"
      ? `weekly (${WEEKDAYS[s.day_of_week ?? 0]})`
      : s.cadence === "monthly"
        ? `monthly (day ${s.day_of_month})`
        : (s.cadence ?? "—");
  return `${cad} at ${fmtHour(s.send_hour_et ?? undefined)} ET → ${s.audience_slug ?? "no audience"} [${s.status}]`;
}
