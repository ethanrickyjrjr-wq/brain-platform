import { test } from "bun:test";
import assert from "node:assert/strict";
import { lintSmoothing } from "./smoothing-lint.mts";
import { SMOOTHING_TOKENS } from "../lib/smoothing-tokens.mts";

/** Wrap an OUTPUT JSON body in a minimal ```reference fence. */
function wrap(outputJson: string): string {
  return [
    "```reference",
    "--- SAVED FACTS ---",
    "[]",
    "",
    "--- OUTPUT ---",
    outputJson,
    "",
    "--- RECENT NOTES ---",
    "- nothing",
    "```",
  ].join("\n");
}

test("passes clean prose with no smoothing tokens", () => {
  const md = wrap(
    JSON.stringify(
      {
        conclusion: "Single-family permits fell 12% YoY in Lee County.",
        caveats: [],
      },
      null,
      2,
    ),
  );
  assert.deepEqual(lintSmoothing(md), { ok: true, violations: [] });
});

test("a missing reference fence is not the linter's problem", () => {
  // Mirrors facts-only-lint: spec-validator owns the structural error.
  assert.deepEqual(lintSmoothing("# no fence here"), {
    ok: true,
    violations: [],
  });
});

test("flags numeric_softening token: approximately (softening a non-figure)", () => {
  // "approximately" softening a non-numeric claim is the failure mode — it is
  // only figure-exempt when it immediately qualifies a number.
  const md = wrap(
    JSON.stringify({
      conclusion: "Direction is approximately flat across the basin.",
    }),
  );
  const r = lintSmoothing(md);
  assert.equal(r.ok, false);
  assert.equal(r.violations.length, 1);
  assert.equal(r.violations[0].group, "numeric_softening");
  assert.equal(r.violations[0].token, "approximately");
  assert.match(r.violations[0].text, /approximately/i);
});

test("does NOT flag approximately/roughly that faithfully qualify a figure", () => {
  // A reporter quoting a source's approximate figure keeps the number visible —
  // that's faithful reporting, not the re-encode-the-number failure mode.
  for (const claim of [
    "The site traded for approximately $55 million ($23 psf).",
    "Oakes allegedly took approximately $6.2 million from the firm.",
    "The parcel spans roughly 55 acres along Metro Parkway.",
  ]) {
    const md = wrap(JSON.stringify({ conclusion: claim }));
    assert.deepEqual(
      lintSmoothing(md),
      { ok: true, violations: [] },
      `figure-qualified claim should pass: ${claim}`,
    );
  }
});

test("still flags approximately softening a direction word, even near figures", () => {
  const md = wrap(
    JSON.stringify({
      conclusion: "Momentum is approximately rising this quarter.",
    }),
  );
  const r = lintSmoothing(md);
  assert.equal(r.ok, false);
  assert.equal(r.violations[0].token, "approximately");
});

test("source-attributed caveat string is exempt from smoothing lint", () => {
  // A caveat emitted by a pack that injects verbatim source text (e.g. cre-swfl
  // local context from lastLocalCreContextRows) uses the attribution prefix
  // "{place} local context [{source} (date)]: {raw text}". The raw text may
  // contain smoothing tokens ("approximately", "~") that come from the source
  // material, not from the synthesis agent. Policing them would require
  // silently rewording the citation — that falsifies the source.
  // This is the class-2 branch of isQuotedSourceLine added to fix the
  // cre-swfl Stage 4 rebuild failure (fmb_planning "approximately August 2025").
  const md = wrap(
    JSON.stringify(
      {
        conclusion: "SWFL CRE pack covers 27 verified corridors.",
        caveats: [
          "Fort Myers Beach local context [fmb_planning (2025-08-01)]: Bay Oaks Park — reconstruction completed ~Aug 2025 — Bay Oaks Recreation Center and Park reconstruction completed approximately August 2025.",
        ],
      },
      null,
      2,
    ),
  );
  assert.deepEqual(lintSmoothing(md), { ok: true, violations: [] });
});

test("verbatim citation/cited_text fields are exempt (quoted source)", () => {
  // A pulse reporter's citation quotes the source verbatim; a source that says
  // "approximately $6.2 million" or "roughly half" is faithful, not the brain
  // softening its own number. Pass-through, mirroring facts-only-lint.
  const md = wrap(
    JSON.stringify(
      {
        key_metrics: [
          {
            metric: "signal_transactions_1",
            value: "Costco site traded.",
            citation:
              'PRNewswire: "the property traded at approximately $23 psf for roughly half the block"',
          },
        ],
      },
      null,
      2,
    ),
  );
  assert.deepEqual(lintSmoothing(md), { ok: true, violations: [] });
});

test("flags numeric_softening multi-word token: on the order of", () => {
  const md = wrap(
    JSON.stringify({
      conclusion: "Loss exposure is on the order of $2M for the basin.",
    }),
  );
  const r = lintSmoothing(md);
  assert.equal(r.ok, false);
  assert.equal(r.violations[0].group, "numeric_softening");
  assert.equal(r.violations[0].token, "on the order of");
});

test("flags numeric_softening token: smoothed", () => {
  const md = wrap(
    JSON.stringify({
      conclusion: "The series was smoothed across the prior 90 days.",
    }),
  );
  const r = lintSmoothing(md);
  assert.equal(r.ok, false);
  assert.equal(r.violations[0].token, "smoothed");
});

test("flags numeric_softening token: estimated from", () => {
  const md = wrap(
    JSON.stringify({
      conclusion: "Total visits estimated from TDT collections.",
    }),
  );
  const r = lintSmoothing(md);
  assert.equal(r.ok, false);
  assert.equal(r.violations[0].token, "estimated from");
});

test("flags prose_confidence_translation token: fairly confident", () => {
  const md = wrap(
    JSON.stringify({
      conclusion: "We are fairly confident the trend will persist.",
    }),
  );
  const r = lintSmoothing(md);
  assert.equal(r.ok, false);
  assert.equal(r.violations[0].group, "prose_confidence_translation");
  assert.equal(r.violations[0].token, "fairly confident");
});

test("flags prose_confidence_translation token: high confidence", () => {
  const md = wrap(
    JSON.stringify({
      conclusion: "High confidence in the FAF5 baseline.",
    }),
  );
  const r = lintSmoothing(md);
  assert.equal(r.ok, false);
  assert.equal(r.violations[0].token, "high confidence");
});

test("flags prose_confidence_translation token: the model suggests", () => {
  const md = wrap(
    JSON.stringify({
      conclusion: "The model suggests a 4% drop next quarter.",
    }),
  );
  const r = lintSmoothing(md);
  assert.equal(r.ok, false);
  assert.equal(r.violations[0].token, "the model suggests");
});

test("match is case-insensitive", () => {
  const md = wrap(
    JSON.stringify({
      conclusion: "Direction is APPROXIMATELY flat YoY.",
    }),
  );
  const r = lintSmoothing(md);
  assert.equal(r.ok, false);
  assert.equal(r.violations[0].token, "approximately");
});

test("reports every distinct violation across lines", () => {
  const md = wrap(
    JSON.stringify(
      {
        conclusion: "Permits fell roughly in line with last year.",
        caveats: ["We are fairly confident the trend will persist."],
      },
      null,
      2,
    ),
  );
  const r = lintSmoothing(md);
  assert.equal(r.ok, false);
  assert.equal(r.violations.length, 2);
  const tokens = r.violations.map((v) => v.token).sort();
  assert.deepEqual(tokens, ["fairly confident", "roughly"]);
});

test("violation line numbers are 1-based within the reference fence", () => {
  const md = wrap(
    JSON.stringify(
      {
        conclusion: "OK.",
        caveats: ["roughly flat"],
      },
      null,
      2,
    ),
  );
  const r = lintSmoothing(md);
  assert.equal(r.ok, false);
  assert.ok(r.violations[0].line >= 1);
});

test("does not flag substrings that are not whole-word smoothing tokens", () => {
  // "interpolated" is a token; "interpolations" should not trigger because the
  // tokens are matched as whole words. Same for "roughness" vs "roughly".
  const md = wrap(
    JSON.stringify({
      conclusion: "Roughness of the FDOT grid affects throughput.",
    }),
  );
  const r = lintSmoothing(md);
  assert.deepEqual(r, { ok: true, violations: [] });
});

test("scans only inside the reference fence (framing paragraph is exempt)", () => {
  // The framing paragraph (outside the fence) intentionally uses words like
  // "approximately" in unrelated prose. The linter must not flag those — same
  // posture as facts-only-lint.
  const md = [
    "# User-Saved Reference Context",
    "",
    "The block below was smoothed by hand. fairly confident.",
    "",
    "```reference",
    "--- OUTPUT ---",
    '{"conclusion":"Clean prose with no soft tokens."}',
    "```",
  ].join("\n");
  assert.deepEqual(lintSmoothing(md), { ok: true, violations: [] });
});

test("every token in the constant is detectable by the linter", () => {
  // Defensive: if a token can't be matched (regex special-char escape bug,
  // tokenization bug, etc.) the constant is lying. Every token must round-trip.
  for (const [group, tokens] of Object.entries(SMOOTHING_TOKENS)) {
    for (const token of tokens as readonly string[]) {
      const md = wrap(JSON.stringify({ conclusion: `prose using ${token} here` }));
      const r = lintSmoothing(md);
      assert.equal(
        r.ok,
        false,
        `token "${token}" from group "${group}" was not detected by the linter`,
      );
      assert.equal(r.violations[0].token, token);
      assert.equal(r.violations[0].group, group);
    }
  }
});
