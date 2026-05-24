import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  parseBrainMarkdown,
  speak,
  type SpeakerTier,
} from "../refinery/render/speaker.mts";

/**
 * Shared brain-fetch pipeline used by `/api/b/[slug]` and (Step 2) the MCP
 * route. Pure I/O wrapper around `parseBrainMarkdown` + `speak`. Transport-
 * agnostic: throws typed errors; callers map to HTTP, MCP tool errors, etc.
 *
 * Reads from `brains/{slug}.md` on disk — Node runtime only.
 */

const BRAINS_DIR = path.join(process.cwd(), "brains");

// Lowercase alphanumerics + hyphens. Blocks path traversal (../, leading dot, etc.).
const VALID_SLUG = /^[a-z0-9-]+$/;

export class BrainNotFoundError extends Error {
  constructor(slug: string) {
    super(`brain not found: ${slug}`);
    this.name = "BrainNotFoundError";
  }
}

export class BrainBadTierError extends Error {
  constructor(raw: unknown) {
    super(`tier must be 1, 2, or 3 (got ${JSON.stringify(raw)})`);
    this.name = "BrainBadTierError";
  }
}

/**
 * Resolve the public origin used to build the per-report URL inside the
 * speaker output. The MCP route can't rely on the request URL (Vercel's
 * internal hostname leaks through), so we fall back through env vars.
 *
 *   explicit param → BRAIN_PLATFORM_URL → https://VERCEL_URL → hardcoded
 *
 * `VERCEL_URL` is a hostname only (no protocol), per Vercel's docs.
 */
function resolveOrigin(explicit?: string): string {
  if (explicit) return explicit;
  if (process.env.BRAIN_PLATFORM_URL) return process.env.BRAIN_PLATFORM_URL;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "https://brain-platform-amber.vercel.app";
}

export interface FetchBrainOptions {
  tier: SpeakerTier;
  /**
   * Public origin override. `/api/b` passes `url.origin` so HTTP responses
   * keep their existing report-link behavior. Omit to use the env-derived
   * canonical origin (`resolveOrigin`).
   */
  origin?: string;
}

export interface FetchBrainResult {
  text: string;
  freshness_token: string;
}

export function parseTier(raw: unknown): SpeakerTier {
  if (raw === 1 || raw === "1") return 1;
  if (raw === 2 || raw === "2") return 2;
  if (raw === 3 || raw === "3") return 3;
  throw new BrainBadTierError(raw);
}

export async function fetchBrain(
  slug: string,
  opts: FetchBrainOptions,
): Promise<FetchBrainResult> {
  if (!VALID_SLUG.test(slug)) {
    throw new BrainNotFoundError(slug);
  }

  let content: string;
  try {
    content = await readFile(path.join(BRAINS_DIR, `${slug}.md`), "utf-8");
  } catch {
    throw new BrainNotFoundError(slug);
  }

  const brain = parseBrainMarkdown(content);
  const text = speak(brain, {
    tier: opts.tier,
    origin: resolveOrigin(opts.origin),
  });

  return { text, freshness_token: brain.freshness_token };
}

/**
 * Disk read without speaker rendering. Returns the raw `.md` content. Used
 * by `/api/b/[slug]` when `?view` is not `"speak"` so the brain `.md` ships
 * verbatim. Throws `BrainNotFoundError` on missing/invalid slug.
 */
export async function readBrainMarkdown(slug: string): Promise<string> {
  if (!VALID_SLUG.test(slug)) {
    throw new BrainNotFoundError(slug);
  }
  try {
    return await readFile(path.join(BRAINS_DIR, `${slug}.md`), "utf-8");
  } catch {
    throw new BrainNotFoundError(slug);
  }
}
