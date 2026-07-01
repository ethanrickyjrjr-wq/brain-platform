import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import { env, requireEnv } from "../config/env.mts";

/** Triage = cheap classification. Haiku 4.5. */
export const TRIAGE_MODEL = "claude-haiku-4-5";
/** Synthesis = turning data into refined prose facts. Sonnet 4.6. */
export const SYNTHESIS_MODEL = "claude-sonnet-4-6";

/**
 * When no ANTHROPIC_API_KEY is set, the agents run in deterministic mock mode
 * so the full pipeline (Stages 1-4) is testable offline with zero credentials.
 * A real key → real agents.
 */
export function agentsAreMocked(): boolean {
  return !env.anthropicApiKey;
}

export type CallType =
  | "synthesis"
  | "triage"
  | "assistant_stream"
  | "assistant_chart"
  | "email_build"
  | "deliverable_build"
  | "other";

export interface UsageLike {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

/** $/MTok. Source: platform.claude.com/docs/en/about-claude/pricing,
 *  verified via crawl4ai 07/01/2026 — mirrors swfldatagulf-ops/lib/spend.ts. */
const RATES: Record<string, { in: number; out: number }> = {
  "claude-sonnet-4-6": { in: 3.0, out: 15.0 },
  "claude-haiku-4-5": { in: 1.0, out: 5.0 },
  // Reachable via EMAIL_MODEL_OPUS (lib/email/model-router.ts, "max"/"opus" mode
  // -> email_build call type). Missing this silently priced every Opus call at $0.
  "claude-opus-4-8": { in: 5.0, out: 25.0 },
};
const CACHE_READ_FRACTION = 0.1; // 10% of base input rate
const CACHE_WRITE_PREMIUM = 1.25; // 25% premium on input rate

/**
 * Models before the Claude 4.6 generation (e.g. "claude-haiku-4-5") are
 * convenience aliases that the API resolves to a dated snapshot for serving
 * (verified live via crawl4ai 07/01/2026 against platform.claude.com/docs/en/
 * about-claude/models/model-ids-and-versions). The response `.model` field
 * reports that resolved snapshot (e.g. "claude-haiku-4-5-20251001"), not the
 * alias sent in the request — strip a trailing date so the rate lookup still
 * hits. 4.6-generation-and-later IDs (e.g. "claude-sonnet-4-6") are already
 * pinned snapshots, not aliases, so they're unaffected by this and match
 * RATES directly.
 */
function baseModelId(model: string): string {
  return model.replace(/-\d{8}$/, "");
}

/**
 * Pure cost calculator. An unrecognized model returns 0 rather than guessing
 * a rate — the row still logs (model + token counts preserved) for manual
 * reconciliation instead of inventing a number.
 */
export function computeCostUsd(model: string, usage: UsageLike): number {
  const rate = RATES[model] ?? RATES[baseModelId(model)];
  if (!rate) return 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  return (
    (usage.input_tokens / 1_000_000) * rate.in +
    (usage.output_tokens / 1_000_000) * rate.out +
    (cacheRead / 1_000_000) * rate.in * CACHE_READ_FRACTION +
    (cacheWrite / 1_000_000) * rate.in * CACHE_WRITE_PREMIUM
  );
}

export interface LogApiUsageOpts {
  model: string;
  callType: CallType;
  packId?: string | null;
  usage: UsageLike;
  /** Test injection points; production calls omit these and fall through to env.*. */
  supabaseUrl?: string;
  supabaseKey?: string;
}

/**
 * Insert one row into public.api_usage_log. Never throws — a logging failure
 * must not affect the real API call it's reporting on. Skips entirely when
 * mocked, when SKIP_USAGE_LOG=1, or when Supabase env isn't configured.
 */
export async function logApiUsage(opts: LogApiUsageOpts): Promise<void> {
  if (agentsAreMocked()) return;
  if (process.env.SKIP_USAGE_LOG === "1") return;
  const url = opts.supabaseUrl ?? env.supabaseUrl;
  const key = opts.supabaseKey ?? env.supabaseKey;
  if (!url || !key) return;

  try {
    const sb = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error } = await sb.from("api_usage_log").insert({
      model: opts.model,
      call_type: opts.callType,
      pack_id: opts.packId ?? null,
      input_tokens: opts.usage.input_tokens,
      output_tokens: opts.usage.output_tokens,
      cache_read_tokens: opts.usage.cache_read_input_tokens ?? 0,
      cache_creation_tokens: opts.usage.cache_creation_input_tokens ?? 0,
      cost_usd: computeCostUsd(opts.model, opts.usage),
      env:
        process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production"
          ? "production"
          : "development",
    });
    if (error) console.error("[api-usage-log] insert failed:", error.message);
  } catch (e) {
    console.error("[api-usage-log] insert threw:", e instanceof Error ? e.message : e);
  }
}

let cached: Anthropic | null = null;

function getRawClient(): Anthropic {
  if (cached) return cached;
  requireEnv(["anthropicApiKey"]);
  cached = new Anthropic({ apiKey: env.anthropicApiKey });
  return cached;
}

/**
 * Wraps only `.messages.create` / `.messages.stream` — the only two methods
 * any call site in this codebase invokes on the client (verified via grep
 * for `client\.(beta|models|batches)\.` — zero hits). A `Proxy` `get` trap,
 * not a plain-object spread: `raw.messages`'s own-enumerable keys are only
 * `_client`/`batches` (verified directly against the installed SDK) —
 * `create`/`stream` live on the `Messages` class prototype, so
 * `{...raw.messages}` silently drops them. `Reflect.get(target, prop,
 * target)` (passing `target`, not the proxy, as the receiver) forwards every
 * other property through correctly, including prototype getters, without
 * risking a private-class-field `this`-binding surprise (those would throw
 * if invoked with `this` = the proxy instead of the real instance).
 */
function wrapMessages(raw: Anthropic, callType: CallType): Anthropic["messages"] {
  const realCreate = raw.messages.create.bind(raw.messages);
  const realStream = raw.messages.stream.bind(raw.messages);

  const wrappedCreate = (async (...args: Parameters<typeof realCreate>) => {
    const response = await realCreate(...args);
    // Non-streaming Message has `.usage` directly; a `stream:true` Message
    // stream response does not — skip those (call sites use .stream() for
    // streaming today; this guard just keeps the wrapper honest either way).
    if (response && typeof response === "object" && "usage" in response) {
      void logApiUsage({
        model: (response as Anthropic.Message).model,
        callType,
        usage: (response as Anthropic.Message).usage,
      }).catch((e) => console.error("[api-usage-log] create hook failed:", e));
    }
    return response;
  }) as typeof realCreate;

  const wrappedStream = ((...args: Parameters<typeof realStream>) => {
    const stream = realStream(...args);
    stream
      .finalMessage()
      .then((msg) => logApiUsage({ model: msg.model, callType, usage: msg.usage }))
      .catch((e) => console.error("[api-usage-log] stream hook failed:", e));
    return stream;
  }) as typeof realStream;

  return new Proxy(raw.messages, {
    get(target, prop, _receiver) {
      if (prop === "create") return wrappedCreate;
      if (prop === "stream") return wrappedStream;
      return Reflect.get(target, prop, target);
    },
  });
}

const wrappedByCallType = new Map<CallType, Anthropic>();

/** Shared Anthropic client. Only call when NOT in mock mode. Every real call
 *  is logged to public.api_usage_log; pass callType to label it (defaults to
 *  "other", fully backward compatible with existing zero-arg call sites).
 *  A `Proxy` `get` trap intercepts only `.messages`, forwarding every other
 *  top-level property (models/beta/apiKey/...) straight through to `raw`. */
export function getAnthropic(callType: CallType = "other"): Anthropic {
  const existing = wrappedByCallType.get(callType);
  if (existing) return existing;
  const raw = getRawClient();
  const wrappedMessages = wrapMessages(raw, callType);
  const wrapped = new Proxy(raw, {
    get(target, prop, _receiver) {
      if (prop === "messages") return wrappedMessages;
      return Reflect.get(target, prop, target);
    },
  }) as Anthropic;
  wrappedByCallType.set(callType, wrapped);
  return wrapped;
}
