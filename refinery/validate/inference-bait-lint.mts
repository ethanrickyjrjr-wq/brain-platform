/**
 * Inference-bait lint: a fact value must not pair an explicit percentage with a
 * second count a reader could mistake for an alternative denominator.
 *
 * The historical bug: the charge-off summary listed each brand as
 *   `Zoom Room (0% survival — 1 of 1 resolved charged off, 2 total)`
 * and models anchored on "1 ... 2 total", computed 1/2 = 50%, and discarded the
 * explicit "0% survival". Survival is always over RESOLVED loans; the
 * total-incl-active count is a different denominator for a different question.
 *
 * This lint flags the exact bait class: a single parenthetical group `(...)`
 * carrying BOTH a percentage AND a "<number> total" count. It is a focused
 * regression fence — the legitimate per-brand synthesis facts state totals and
 * rates in full sentences, not crammed into one parenthesis, so they don't trip.
 *
 * Stage 4 runs this before writing; a violation aborts the run.
 */

import type { LintResult, LintViolation } from "./facts-only-lint.mts";

const PERCENT = /\d+(?:\.\d+)?\s*%/;
const COUNT_TOTAL = /\b\d+\s+total\b/i;
const PAREN_GROUP = /\(([^()]*)\)/g;

/** Pull the `--- SAVED FACTS ---` body out of the ```reference fence. */
function extractFactsBlock(
  md: string,
): { body: string; refLines: string[] } | null {
  const fence = md.match(/```reference\n([\s\S]*?)\n```/);
  if (!fence) return null;
  const refLines = fence[1].split("\n");
  const start = refLines.indexOf("--- SAVED FACTS ---");
  if (start === -1) return null;
  const body: string[] = [];
  for (let i = start + 1; i < refLines.length; i++) {
    if (/^--- .* ---$/.test(refLines[i])) break;
    body.push(refLines[i]);
  }
  return { body: body.join("\n").trim(), refLines };
}

export function lintInferenceBait(md: string): LintResult {
  const extracted = extractFactsBlock(md);
  // A missing/garbled facts block is the spec-validator's problem, not ours.
  if (!extracted) return { ok: true, violations: [] };

  let facts: unknown;
  try {
    facts = JSON.parse(extracted.body);
  } catch {
    return { ok: true, violations: [] };
  }
  if (!Array.isArray(facts)) return { ok: true, violations: [] };

  const violations: LintViolation[] = [];
  for (const f of facts) {
    const fact = f as Record<string, unknown>;
    const id = typeof fact.id === "string" ? fact.id : "?";
    const value = typeof fact.value === "string" ? fact.value : "";
    for (const m of value.matchAll(PAREN_GROUP)) {
      const inner = m[1];
      if (PERCENT.test(inner) && COUNT_TOTAL.test(inner)) {
        const lineIdx = extracted.refLines.findIndex((l) =>
          l.includes(`"id":"${id}"`),
        );
        violations.push({
          line: lineIdx === -1 ? 0 : lineIdx + 1,
          text: `${id}: (${inner})`,
          pattern: "ambiguous denominator",
        });
      }
    }
  }

  return { ok: violations.length === 0, violations };
}
