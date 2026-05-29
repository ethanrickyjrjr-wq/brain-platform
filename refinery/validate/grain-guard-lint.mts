/**
 * Grain-guard lint — structural validation of master's `grain_boundary`.
 *
 * STRUCTURAL ONLY. It cannot semantically tell a true scope gap from a smuggled
 * inference — it does two cheap, deterministic checks:
 *
 *   1. `finest_grain` matches the "<unit>-<period>" shape (e.g. "county-month").
 *   2. No `not_available` entry contains inference-shaped phrasing. The grain
 *      boundary states what the lake does NOT hold ("we have no per-ZIP data"),
 *      never a prediction ("ZIP prices will likely rise") — that belongs in
 *      `conditional_claims`. A blocklist of forecast verbs catches the leak.
 *
 * Stage 4 runs this before writing; a violation aborts the run (the previous
 * brain file is left intact). Absent `grain_boundary` (every leaf brain, plus
 * master's empty-synthesis path) is a no-op pass.
 */

import type { BrainOutput } from "../types/brain-output.mts";

export interface GrainGuardViolation {
  field: "finest_grain" | "not_available";
  index?: number;
  text: string;
  reason: string;
}

export interface GrainGuardResult {
  ok: boolean;
  violations: GrainGuardViolation[];
}

/** Lowercase unit + single hyphen + lowercase period, e.g. "county-month". */
const FINEST_GRAIN_RE = /^[a-z]+-[a-z]+$/;

/**
 * Forecast/inference phrasing that must NOT appear in a scope-gap statement.
 * Matched as case-insensitive substrings — deliberately conservative so it
 * never blocks an honest "we don't have X" line.
 */
const INFERENCE_PHRASES = [
  "likely",
  "probably",
  "expect",
  "forecast",
  "predict",
  "anticipate",
  "projected",
  "projection",
  "we think",
  "trending",
  "on track to",
  "will rise",
  "will fall",
  "should rise",
  "should fall",
];

export function lintGrainGuard(
  output: Pick<BrainOutput, "grain_boundary">,
): GrainGuardResult {
  const gb = output.grain_boundary;
  if (!gb) return { ok: true, violations: [] };

  const violations: GrainGuardViolation[] = [];

  if (!FINEST_GRAIN_RE.test(gb.finest_grain)) {
    violations.push({
      field: "finest_grain",
      text: gb.finest_grain,
      reason:
        'must match "<unit>-<period>" (lowercase, single hyphen), e.g. "county-month"',
    });
  }

  gb.not_available.forEach((s, i) => {
    const lower = s.toLowerCase();
    const hit = INFERENCE_PHRASES.find((p) => lower.includes(p));
    if (hit) {
      violations.push({
        field: "not_available",
        index: i,
        text: s,
        reason: `inference-shaped phrase "${hit}" — a scope gap states what is absent, not a prediction (that belongs in conditional_claims)`,
      });
    }
  });

  return { ok: violations.length === 0, violations };
}
