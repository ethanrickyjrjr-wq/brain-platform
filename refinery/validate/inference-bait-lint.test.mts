import { test } from "node:test";
import assert from "node:assert/strict";
import { lintInferenceBait } from "./inference-bait-lint.mts";

/** Wrap a SAVED FACTS JSON array in a minimal ```reference fence. */
function wrap(factsJson: string): string {
  return [
    "```reference",
    "--- SAVED FACTS ---",
    factsJson,
    "",
    "--- RECENT NOTES ---",
    "- nothing",
    "```",
  ].join("\n");
}

test("flags the historical charge-off bait (% and 'N total' in one paren)", () => {
  const md = wrap(
    JSON.stringify([
      {
        id: "f003",
        topic: "chargeoff_summary",
        fact: "x",
        value:
          "Full list: Zoom Room (0% survival — 1 of 1 resolved charged off, 2 total).",
        src: "s01",
        date: "2026-05-14",
      },
    ]),
  );
  const r = lintInferenceBait(md);
  assert.equal(r.ok, false);
  assert.equal(r.violations.length, 1);
  assert.equal(r.violations[0].pattern, "ambiguous denominator");
  assert.match(r.violations[0].text, /f003/);
});

test("passes the fixed format (rate outside the paren, resolved-only inside)", () => {
  const md = wrap(
    JSON.stringify([
      {
        id: "f003",
        topic: "chargeoff_summary",
        fact: "x",
        value:
          "Zoom Room — 0% survival (1 of 1 resolved loans charged off); " +
          "The Grounds Guys — 0% survival (2 of 2 resolved loans charged off).",
        src: "s01",
        date: "2026-05-14",
      },
    ]),
  );
  assert.deepEqual(lintInferenceBait(md), { ok: true, violations: [] });
});

test("passes a per-brand sentence that mentions total and a rate (not crammed in a paren)", () => {
  const md = wrap(
    JSON.stringify([
      {
        id: "f006",
        topic: "franchise_loan_outcome",
        fact: "x",
        value:
          "Culver's (franchise code 11023) carries 6 total SBA loans, of which " +
          "4 are resolved (all paid in full, none charged off), yielding a 100% " +
          "survival rate on resolved loans.",
        src: "s01",
        date: "2026-05-14",
      },
    ]),
  );
  assert.deepEqual(lintInferenceBait(md), { ok: true, violations: [] });
});

test("passes strong-performers format ('N resolved, M total' paren has no percentage)", () => {
  const md = wrap(
    JSON.stringify([
      {
        id: "f005",
        topic: "strong_performers",
        fact: "x",
        value:
          "7 brands have a 100% survival rate: TROPICAL SMOOTHIE (4 resolved, 4 total); " +
          "GREAT CLIPS (4 resolved, 6 total).",
        src: "s01",
        date: "2026-05-14",
      },
    ]),
  );
  assert.deepEqual(lintInferenceBait(md), { ok: true, violations: [] });
});

test("returns ok on a missing or garbled facts block", () => {
  assert.deepEqual(lintInferenceBait("no reference fence here"), {
    ok: true,
    violations: [],
  });
  const garbled = wrap("[ this is not json ]");
  assert.deepEqual(lintInferenceBait(garbled), { ok: true, violations: [] });
});

test("flags every offending fact in a multi-fact array", () => {
  const md = wrap(
    JSON.stringify([
      {
        id: "f001",
        topic: "ok",
        fact: "x",
        value: "Clean fact, nothing here.",
        src: "s01",
        date: "2026-05-14",
      },
      {
        id: "f002",
        topic: "bait",
        fact: "x",
        value: "Brand A (50% survival — 1 of 2 resolved charged off, 4 total).",
        src: "s01",
        date: "2026-05-14",
      },
    ]),
  );
  const r = lintInferenceBait(md);
  assert.equal(r.ok, false);
  assert.equal(r.violations.length, 1);
  assert.match(r.violations[0].text, /f002/);
});
