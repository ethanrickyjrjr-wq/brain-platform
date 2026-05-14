import Anthropic from "@anthropic-ai/sdk";
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

let cached: Anthropic | null = null;

/** Shared Anthropic client. Only call when NOT in mock mode. */
export function getAnthropic(): Anthropic {
  if (cached) return cached;
  requireEnv(["anthropicApiKey"]);
  cached = new Anthropic({ apiKey: env.anthropicApiKey });
  return cached;
}
