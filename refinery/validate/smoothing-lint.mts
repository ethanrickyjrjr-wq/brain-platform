/**
 * Smoothing-language lint (Lane 1D per `cosmic-rolling-brook.md` v2): a brain
 * payload's prose must not soften the deterministic numbers Stage 4 computes.
 * Vague quantifiers ("approximately", "smoothed") and hand-wavy confidence
 * verbalizations ("fairly confident", "high confidence") let an LLM re-encode
 * the engine's hard-won numbers into ambiguous English — the exact failure
 * mode the thin-pipe contract exists to prevent.
 *
 * This lint scans ONLY the content inside the ```reference fence (same scope
 * as `facts-only-lint.mts`). The framing paragraph outside the fence is fixed
 * boilerplate and intentionally not scanned.
 *
 * Stage 4 runs this before writing; a violation aborts the run.
 *
 * Token list lives in `refinery/lib/smoothing-tokens.mts` — single source of
 * truth, shared with the Lane 2C consumption-contract rewrite (Coupling 3).
 */

import {
  SMOOTHING_TOKENS,
  type SmoothingTokenGroup,
} from "../lib/smoothing-tokens.mts";

export interface SmoothingViolation {
  /** 1-based line number within the reference block */
  line: number;
  text: string;
  token: string;
  group: SmoothingTokenGroup;
}

export interface SmoothingLintResult {
  ok: boolean;
  violations: SmoothingViolation[];
}

/**
 * Compiled patterns: one regex per token, in deterministic group/token order.
 * Each pattern is a case-insensitive whole-token match. Multi-word tokens
 * (e.g. "on the order of") are matched as a single regex with word boundaries
 * around the first and last word and `\s+` between interior words so the
 * linter survives an extra space without false-negative.
 */
interface CompiledPattern {
  group: SmoothingTokenGroup;
  token: string;
  re: RegExp;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function compileTokenRegex(token: string): RegExp {
  const parts = token.split(/\s+/).map(escapeRegex);
  // Word-boundary on the outer edges. For tokens like "we're" the apostrophe
  // breaks JS's \b semantics, so we use a permissive boundary that accepts
  // any non-letter (or start/end of string) on either side.
  const body = parts.join("\\s+");
  return new RegExp(`(^|[^A-Za-z])(${body})(?=$|[^A-Za-z])`, "i");
}

const PATTERNS: CompiledPattern[] = Object.entries(SMOOTHING_TOKENS).flatMap(
  ([group, tokens]) =>
    (tokens as readonly string[]).map((token) => ({
      group: group as SmoothingTokenGroup,
      token,
      re: compileTokenRegex(token),
    })),
);

export function lintSmoothing(md: string): SmoothingLintResult {
  const m = md.match(/```reference\n([\s\S]*?)\n```/);
  // A missing reference block is the spec-validator's problem, not ours.
  if (!m) return { ok: true, violations: [] };

  const violations: SmoothingViolation[] = [];
  m[1].split("\n").forEach((line, idx) => {
    for (const { group, token, re } of PATTERNS) {
      if (re.test(line)) {
        violations.push({ line: idx + 1, text: line.trim(), token, group });
      }
    }
  });

  return { ok: violations.length === 0, violations };
}
