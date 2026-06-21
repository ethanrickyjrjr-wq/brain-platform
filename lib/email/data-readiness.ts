// Data-readiness verification ladder — runs T-60min before each scheduled email blast.
// Checks whether metric items still have fresh data; if stale, climbs the tiers below
// to substitute an honest value rather than cancelling the send.
//
// Tier 1 — two web_search-grounded calls over disjoint domains agree  → web_consensus
// Tier 2 — one web_search-grounded cited value                        → web_single
// Tier 3 — model answer with NO web search (ungrounded last resort)   → model_only
// Tier 4 — last known value within max_stale_days                     → last_known
// (no tier succeeded)                                                 → omitted
//
// Grounding uses the Anthropic web_search server tool (web_search_20250305) — a
// verification surface, not an ingest crawler. Failures are LOUD: the chosen tier
// is always recorded in data_readiness_alerts, and a web_search infra error is
// surfaced on VerificationResult.grounding_error + logged to the runtime log so a
// "grounding broke" run is never mistaken for "grounding ran and found nothing".
//
// Never cancels a blast — substitutes with an honest sourcing note on the result.

import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import type { ProjectItem } from "@/lib/project/items";
import { verificationQuery, splitDomains, extractNumericValue } from "./verification-sources";

export type VerificationTier =
  | "brain_fresh"
  | "web_consensus"
  | "web_single"
  | "model_only"
  | "last_known"
  | "omitted";

export interface VerificationResult {
  metric_slug: string;
  metric_label: string;
  scope_kind: string | null;
  scope_value: string | null;
  tier_used: VerificationTier;
  value_used: string | null;
  source_urls: string[];
  snapshot_value: string;
  within_tolerance: boolean;
  /** web_search infra error (rate-limit / unavailable / throw) when a grounded
   *  tier failed and we fell back; null otherwise. Diagnostic — distinguishes
   *  "grounding broke" from "grounding ran and found nothing". Not yet persisted
   *  (the data_readiness_alerts.gate_reason column is not live; see follow-up). */
  grounding_error: string | null;
}

// ── Tolerance loading ────────────────────────────────────────────────────────

interface ToleranceEntry {
  tolerance_abs: number | null;
  tolerance_pct: number | null;
  max_stale_days: number;
  z_flag_threshold: number | null;
}
type ToleranceConfig = Record<string, ToleranceEntry>;

// Fallback when the tolerances yaml isn't bundled into the serverless function or
// is malformed — never let a missing config throw the whole cron (the file read
// is via process.cwd(); next.config.ts outputFileTracingIncludes bundles it, this
// guard is belt-and-suspenders so a tracing miss degrades to defaults, not a 500).
const DEFAULT_TOLERANCE: ToleranceEntry = {
  tolerance_abs: null,
  tolerance_pct: 10.0,
  max_stale_days: 30,
  z_flag_threshold: 3.0,
};

let _tolerances: ToleranceConfig | null = null;
function loadTolerances(): ToleranceConfig {
  if (_tolerances) return _tolerances;
  try {
    const raw = readFileSync(
      join(process.cwd(), "ingest", "data-verification-tolerances.yaml"),
      "utf-8",
    );
    _tolerances = parse(raw) as ToleranceConfig;
  } catch (err) {
    console.error(
      "[data-readiness] could not load tolerances yaml — using built-in default for all slugs:",
      err instanceof Error ? err.message : err,
    );
    _tolerances = { _default: DEFAULT_TOLERANCE };
  }
  return _tolerances;
}

/** Match slug to a tolerance key — tries full slug, then common prefixes, then _default. */
function toleranceFor(slug: string): ToleranceEntry {
  const cfg = loadTolerances();
  if (cfg[slug]) return cfg[slug];
  // Prefix matching for slugs like "mortgage_rate_30yr_swfl" → "mortgage_rate"
  for (const key of Object.keys(cfg)) {
    if (key !== "_default" && slug.startsWith(key)) return cfg[key];
  }
  return cfg["_default"]!;
}

function withinTolerance(a: number, b: number, tol: ToleranceEntry): boolean {
  if (tol.tolerance_abs != null) return Math.abs(a - b) <= tol.tolerance_abs;
  if (tol.tolerance_pct != null) {
    const ref = Math.max(Math.abs(a), Math.abs(b), 0.001);
    return (Math.abs(a - b) / ref) * 100 <= tol.tolerance_pct;
  }
  return true;
}

// ── web_search grounding ──────────────────────────────────────────────────────

const anthropic = new Anthropic();

/** Model used for both grounded and ungrounded verification calls. */
const MODEL = "claude-sonnet-4-6";
/** Cap searches per grounded call — bounds cost on latency-sensitive lookups. */
const SEARCH_MAX_USES = 4;
/** Bound the pause_turn continuation loop (server tools can pause mid-turn). */
const PAUSE_TURN_LIMIT = 4;

export interface GroundedResult {
  /** The model's stated value (units preserved), or null if none/UNKNOWN. */
  value: string | null;
  /** Real cited URLs from web_search results (empty for ungrounded calls). */
  sourceUrls: string[];
  /** Non-null when the call threw or web_search returned an error block. */
  error: string | null;
}

export interface LookupOpts {
  label: string;
  scope: string;
  query: string;
  /** Domains to restrict web_search to (omit for unrestricted/ungrounded). */
  allowedDomains?: string[];
  /** false → no web_search tool (ungrounded model_only fallback). */
  grounded: boolean;
}

export type LookupFn = (opts: LookupOpts) => Promise<GroundedResult>;

/**
 * Parse an accumulated list of response content blocks into the model's stated
 * value + the real source URLs it cited. Pure — unit-tested without network.
 * Detects web_search_tool_result_error blocks (the API returns these as HTTP 200).
 */
export function parseGroundedResponse(content: unknown[]): {
  answer: string | null;
  sourceUrls: string[];
  searchError: string | null;
} {
  const texts: string[] = [];
  const urls: string[] = [];
  let searchError: string | null = null;

  for (const raw of content) {
    const block = raw as Record<string, unknown>;
    if (block.type === "text" && typeof block.text === "string") {
      texts.push(block.text);
      if (Array.isArray(block.citations)) {
        for (const c of block.citations) {
          const u = (c as Record<string, unknown>)?.url;
          if (typeof u === "string" && u) urls.push(u);
        }
      }
    } else if (block.type === "web_search_tool_result") {
      const c = block.content;
      if (Array.isArray(c)) {
        for (const r of c) {
          const u = (r as Record<string, unknown>)?.url;
          if (typeof u === "string" && u) urls.push(u);
        }
      } else if (
        c &&
        typeof c === "object" &&
        (c as Record<string, unknown>).type === "web_search_tool_result_error"
      ) {
        searchError = String((c as Record<string, unknown>).error_code ?? "unknown");
      }
    }
  }

  return { answer: extractAnswer(texts.join("\n")), sourceUrls: [...new Set(urls)], searchError };
}

/** Pull the value off the last `ANSWER: <value>` line; UNKNOWN/empty → null. */
function extractAnswer(text: string): string | null {
  const matches = [...text.matchAll(/ANSWER:\s*(.+)/gi)];
  if (!matches.length) return null;
  const val = matches[matches.length - 1][1].trim();
  if (!val || /^unknown\.?$/i.test(val)) return null;
  return val;
}

/**
 * Default LookupFn: ask the model for the current value, optionally grounded by
 * web_search over `allowedDomains`. Never throws — on any failure it logs LOUD
 * and returns a null value with the error attached.
 */
async function groundedLookup(opts: LookupOpts): Promise<GroundedResult> {
  const { label, scope, query, allowedDomains, grounded } = opts;
  try {
    const prompt = grounded
      ? `Find the current ${label} for ${scope} using web search of authoritative sources` +
        ` (search guidance: ${query}).\nOn the FINAL line output exactly "ANSWER: <value>" —` +
        ` a single figure with its unit (e.g. "ANSWER: 6.75%" or "ANSWER: $425,000").` +
        ` If no reputable current value is found, output "ANSWER: UNKNOWN".`
      : `From your own knowledge, what is the current ${label} for ${scope}? Do NOT guess.` +
        `\nOn the FINAL line output exactly "ANSWER: <value>" with its unit, or "ANSWER: UNKNOWN"` +
        ` if you do not reliably know a current value.`;

    const messages: Anthropic.MessageParam[] = [{ role: "user", content: prompt }];
    const accumulated: unknown[] = [];

    for (let i = 0; i < PAUSE_TURN_LIMIT; i++) {
      const params: Anthropic.MessageCreateParamsNonStreaming = {
        model: MODEL,
        max_tokens: 1024,
        messages,
      };
      if (grounded) {
        params.tools = [
          {
            type: "web_search_20250305",
            name: "web_search",
            max_uses: SEARCH_MAX_USES,
            ...(allowedDomains && allowedDomains.length ? { allowed_domains: allowedDomains } : {}),
          },
        ];
      }
      const msg = await anthropic.messages.create(params);
      accumulated.push(...msg.content);
      if (msg.stop_reason === "pause_turn") {
        messages.push({ role: "assistant", content: msg.content });
        continue;
      }
      break;
    }

    const parsed = parseGroundedResponse(accumulated);
    if (parsed.searchError) {
      console.warn(
        `[data-readiness] web_search error ${parsed.searchError} for "${label}" (${scope})`,
      );
    }
    return { value: parsed.answer, sourceUrls: parsed.sourceUrls, error: parsed.searchError };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[data-readiness] web_search threw for "${label}" (${scope}): ${msg}`);
    return { value: null, sourceUrls: [], error: msg };
  }
}

// ── Main verification ladder ─────────────────────────────────────────────────

type MetricItem = Extract<ProjectItem, { kind: "metric" }>;

export async function verifyMetricItem(
  item: MetricItem,
  asOf: Date = new Date(),
  deps: { lookup?: LookupFn } = {},
): Promise<VerificationResult> {
  const lookup = deps.lookup ?? groundedLookup;

  const slug = item.metric_slug ?? item.label.toLowerCase().replace(/\s+/g, "_");
  const scope = {
    zip: item.scope_kind === "zip" ? (item.scope_value ?? undefined) : undefined,
    place:
      item.scope_kind === "city" || item.scope_kind === "state"
        ? (item.scope_value ?? undefined)
        : undefined,
    county: item.scope_kind === "county" ? (item.scope_value ?? undefined) : undefined,
  };
  const scopeStr = scope.zip ?? scope.place ?? scope.county ?? "Southwest Florida";
  const tol = toleranceFor(slug);
  const snapshotValue = item.value;
  const snapshotNum = extractNumericValue(snapshotValue);

  const base = {
    metric_slug: slug,
    metric_label: item.label,
    scope_kind: item.scope_kind ?? null,
    scope_value: item.scope_value ?? null,
    snapshot_value: snapshotValue,
  } as const;

  /** within_tolerance vs the snapshot — defaults true when either side isn't numeric. */
  const inTol = (n: number | null): boolean =>
    snapshotNum != null && n != null ? withinTolerance(n, snapshotNum, tol) : true;

  const vq = verificationQuery(slug, scope, asOf);
  const [groupA, groupB] = splitDomains(vq.preferred_domains);
  // web_search infra error captured from a failed grounded tier, carried onto the
  // fallback result so a degraded row records WHY grounding didn't produce a value.
  let groundingError: string | null = null;

  // TIER 1 + 2 — grounded web_search. Two disjoint domain groups → consensus;
  // exactly one side with a usable value → web_single. A genuine cross-source
  // DISAGREEMENT is reported as web_single but flagged NOT within tolerance, with
  // BOTH sources kept, so a contradicted reading is never dressed up as clean.
  if (groupB.length > 0) {
    const [a, b] = await Promise.all([
      lookup({
        label: item.label,
        scope: scopeStr,
        query: vq.query,
        allowedDomains: groupA,
        grounded: true,
      }),
      lookup({
        label: item.label,
        scope: scopeStr,
        query: vq.query,
        allowedDomains: groupB,
        grounded: true,
      }),
    ]);
    const numA = a.value != null ? extractNumericValue(a.value) : null;
    const numB = b.value != null ? extractNumericValue(b.value) : null;

    // Both sides produced numeric values → consensus or honest conflict.
    if (a.value != null && numA != null && b.value != null && numB != null) {
      const bothSources = [...new Set([...a.sourceUrls, ...b.sourceUrls])];
      if (withinTolerance(numA, numB, tol)) {
        return {
          ...base,
          tier_used: "web_consensus",
          value_used: a.value,
          source_urls: bothSources,
          within_tolerance: inTol(numA),
          grounding_error: null,
        };
      }
      console.warn(
        `[data-readiness] ${slug}: grounded sources disagree (${a.value} vs ${b.value}) — web_single, flagged out-of-tolerance`,
      );
      return {
        ...base,
        tier_used: "web_single",
        value_used: a.value,
        // A contradicted value is NOT within tolerance regardless of the snapshot;
        // keep both URLs so the disagreeing source stays traceable.
        source_urls: bothSources,
        within_tolerance: false,
        grounding_error: null,
      };
    }

    // Exactly one side produced a usable value → genuine single-source read.
    let single: { res: GroundedResult; num: number } | null = null;
    if (a.value != null && numA != null) single = { res: a, num: numA };
    else if (b.value != null && numB != null) single = { res: b, num: numB };
    if (single) {
      console.warn(
        `[data-readiness] ${slug}: only one grounded source produced a value — web_single`,
      );
      return {
        ...base,
        tier_used: "web_single",
        value_used: single.res.value,
        source_urls: single.res.sourceUrls,
        within_tolerance: inTol(single.num),
        grounding_error: null,
      };
    }
    groundingError = a.error ?? b.error ?? null;
    console.warn(`[data-readiness] ${slug}: web_search returned no value — falling to model_only`);
  } else {
    const only = await lookup({
      label: item.label,
      scope: scopeStr,
      query: vq.query,
      allowedDomains: groupA,
      grounded: true,
    });
    const num = only.value != null ? extractNumericValue(only.value) : null;
    if (only.value != null && num != null) {
      return {
        ...base,
        tier_used: "web_single",
        value_used: only.value,
        source_urls: only.sourceUrls,
        within_tolerance: inTol(num),
        grounding_error: null,
      };
    }
    groundingError = only.error ?? null;
    console.warn(
      `[data-readiness] ${slug}: single-domain web_search returned no value — falling to model_only`,
    );
  }

  // TIER 3 — ungrounded model answer (clearly flagged; no sources).
  const model = await lookup({
    label: item.label,
    scope: scopeStr,
    query: vq.query,
    grounded: false,
  });
  if (model.value != null) {
    return {
      ...base,
      tier_used: "model_only",
      value_used: model.value,
      source_urls: [],
      within_tolerance: inTol(extractNumericValue(model.value)),
      grounding_error: groundingError,
    };
  }

  // TIER 4 — last known value if within max_stale_days (measured at send time).
  if (item.freshness_token) {
    const tokenDate = item.freshness_token.match(/(\d{8})$/)?.[1];
    if (tokenDate) {
      const tokenTs = new Date(
        `${tokenDate.slice(0, 4)}-${tokenDate.slice(4, 6)}-${tokenDate.slice(6, 8)}`,
      ).getTime();
      const ageDays = Math.floor((asOf.getTime() - tokenTs) / 86_400_000);
      if (ageDays <= tol.max_stale_days) {
        return {
          ...base,
          tier_used: "last_known",
          value_used: snapshotValue,
          source_urls: [],
          within_tolerance: true,
          grounding_error: groundingError,
        };
      }
    }
  }

  // OMIT — all tiers exhausted, data too stale.
  console.warn(`[data-readiness] ${slug}: all verification tiers exhausted — omitting`);
  return {
    ...base,
    tier_used: "omitted",
    value_used: null,
    source_urls: [],
    within_tolerance: false,
    grounding_error: groundingError,
  };
}

/** Insert a verification result row into data_readiness_alerts. */
export async function logVerificationResult(
  supabase: SupabaseClient,
  projectId: string,
  scheduleId: string | null,
  result: VerificationResult,
  sendAt?: string,
): Promise<void> {
  const { error } = await supabase.from("data_readiness_alerts").insert({
    project_id: projectId,
    schedule_id: scheduleId,
    metric_slug: result.metric_slug,
    metric_label: result.metric_label,
    scope_kind: result.scope_kind,
    scope_value: result.scope_value,
    tier_used: result.tier_used,
    value_used: result.value_used,
    source_urls: result.source_urls.length > 0 ? result.source_urls : null,
    snapshot_value: result.snapshot_value,
    within_tolerance: result.within_tolerance,
    send_at: sendAt ?? null,
  });
  if (error) {
    console.error(
      `[data_readiness] log error (${result.metric_slug}, tier=${result.tier_used}):`,
      error.message,
    );
  }
}
