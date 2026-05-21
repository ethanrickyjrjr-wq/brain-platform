/**
 * Consumption-contract v3 build-time consistency check.
 *
 * Asserts that `docs/consumption-contract.md`:
 *
 *   1. Anchors the smoothing-token source of truth (Coupling 3).
 *   2. Enumerates ZERO smoothing tokens inline — drift guard.
 *   3. Carries the v3 paste block in its 8-rule form (FETCH FRESH /
 *      PROVE IT'S LIVE / ROUTE, DON'T GUESS / READ RATES AS WRITTEN /
 *      PICK THE TIER / SPEAK PLAINLY / SHOW INFERENCE / NO SMOOTHING).
 *      Rules 1-4 survive verbatim from v1.2 / v2.1 (Coupling 4); rules
 *      5/6/7 replace the v2.1 rigid-section / anti-confabulation /
 *      show-your-work-in-§Speculation rules with the tier model + speaker
 *      hygiene + inference discipline.
 *   4. Preserves the v1.2 cache-bust convention bumped to `?v=5` and
 *      carries no stale `?v=4` master URLs in active fetch sections.
 *   5. References `refinery/render/master-index.mts` (prompt-injection
 *      defense paragraph; Coupling 4 security regression guard).
 *   6. Mentions `freshness_token` at least twice (Rule 0 promotion +
 *      paste-block carry-through; Coupling 4).
 *   7. Carries the speaker-hygiene rule literals — names "bifurcate"
 *      and "siblings haven't shipped" as banned, and instructs Claude
 *      not to leak internal pack ids in prose.
 *   8. Carries the inference-discipline literals — the `[INFERENCE]`
 *      tag and a falsifier requirement.
 *   9. Names tier=1 / tier=2 / tier=3 and the `view=speak` query param
 *      so the tier model literally appears in the doc the validator
 *      gates.
 *
 * Failure here means the consumption contract drifted from its v3
 * blueprint locks. Fix the doc, not the test, unless the blueprint
 * itself changed.
 */

import { test } from "bun:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { SMOOTHING_TOKENS } from "../lib/smoothing-tokens.mts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONTRACT_PATH = join(
  __dirname,
  "..",
  "..",
  "docs",
  "consumption-contract.md",
);

const CONTRACT = readFileSync(CONTRACT_PATH, "utf8");

/** Locked anchor: doc points at the smoothing-token source of truth. */
const SMOOTHING_ANCHOR =
  "// Source: refinery/lib/smoothing-tokens.mts (SMOOTHING_TOKENS const)";

/** Eight rule headings the v3 paste block must carry, in order. */
const V3_PASTE_RULES = [
  "FETCH FRESH",
  "PROVE IT'S LIVE",
  "ROUTE, DON'T GUESS",
  "READ RATES AS WRITTEN",
  "PICK THE TIER",
  "SPEAK PLAINLY",
  "SHOW INFERENCE",
  "NO SMOOTHING",
] as const;

test("contract anchors the smoothing-token source of truth (Coupling 3)", () => {
  assert.ok(
    CONTRACT.includes(SMOOTHING_ANCHOR),
    `consumption-contract.md must include the literal anchor\n  ${SMOOTHING_ANCHOR}\n` +
      `so readers trace to the same file Stage 4 smoothing-lint enforces against.`,
  );
});

test("contract enumerates ZERO smoothing tokens inline (drift guard)", () => {
  const allTokens: string[] = [
    ...SMOOTHING_TOKENS.numeric_softening,
    ...SMOOTHING_TOKENS.prose_confidence_translation,
  ];
  const docLower = CONTRACT.toLowerCase();
  const leaks: string[] = [];
  for (const token of allTokens) {
    if (docLower.includes(token.toLowerCase())) {
      leaks.push(token);
    }
  }
  assert.deepEqual(
    leaks,
    [],
    `consumption-contract.md must NOT enumerate individual smoothing tokens ` +
      `inline. Leaked tokens found in doc body:\n  ${leaks.join(", ")}`,
  );
});

test("contract carries the v3 paste block in order (8 rule headings)", () => {
  const positions = V3_PASTE_RULES.map((rule) => {
    const idx = CONTRACT.indexOf(rule);
    assert.notEqual(
      idx,
      -1,
      `consumption-contract.md missing required v3 paste-block rule: "${rule}".`,
    );
    return { rule, pos: idx };
  });
  for (let i = 1; i < positions.length; i++) {
    assert.ok(
      positions[i].pos > positions[i - 1].pos,
      `paste-block rules out of order: "${positions[i].rule}" must appear ` +
        `AFTER "${positions[i - 1].rule}". v3 lock requires the 1-8 sequence ` +
        `as documented.`,
    );
  }
});

test("contract preserves v1.2 cache-bust convention (bumped to ?v=5)", () => {
  assert.ok(
    CONTRACT.includes("?v=5"),
    `consumption-contract.md must carry the bumped ?v=5 cache-bust marker ` +
      `(v3 forces refresh in existing Projects that have older paste cached).`,
  );
  // Active fetch URLs (those that follow the master endpoint host) must
  // use ?v=5. Stale ?v=4 master URLs in active fetch sections are a
  // regression. Historical-trail prose mentioning the trail is fine —
  // we only grep for the full master fetch URL with the stale param.
  const staleUrls = CONTRACT.match(
    /brain-platform-amber\.vercel\.app\/api\/b\/master\?(view=speak&tier=\d&)?v=4\b/g,
  );
  assert.equal(
    staleUrls,
    null,
    `consumption-contract.md must not carry any ?v=4 master URLs in active ` +
      `paste-block or fetch sections — v3 requires all active URLs at ?v=5. ` +
      `Stale URLs found: ${staleUrls?.join(", ")}`,
  );
});

test("contract references master-index.mts framing paragraph (Coupling 4)", () => {
  assert.ok(
    CONTRACT.includes("master-index.mts"),
    `consumption-contract.md must reference refinery/render/master-index.mts ` +
      `where the prompt-injection-defense framing paragraph lives (Coupling 4). ` +
      `Silent drop is a security regression.`,
  );
});

test("contract preserves freshness_token-quote-on-first-response rule (Coupling 4)", () => {
  const tokenMentions = CONTRACT.match(/freshness_token/g) ?? [];
  assert.ok(
    tokenMentions.length >= 2,
    `consumption-contract.md must mention freshness_token at least twice ` +
      `(promoted Rule 0 + preserved paste-block rule per Coupling 4). ` +
      `Found ${tokenMentions.length} mention(s).`,
  );
});

test("contract names speaker-hygiene rule targets (bifurcate, siblings, pack ids)", () => {
  assert.ok(
    CONTRACT.includes("bifurcate"),
    `consumption-contract.md must name "bifurcate" so the v3 SPEAK PLAINLY ` +
      `rule mechanically bans the word. Live agents have been emitting it ` +
      `as a style tic; the doc must say so explicitly.`,
  );
  assert.ok(
    CONTRACT.includes("siblings haven't shipped") ||
      CONTRACT.includes("siblings haven’t shipped"),
    `consumption-contract.md must name "siblings haven't shipped" as a ` +
      `banned admission so the v3 SPEAK PLAINLY rule has the literal target.`,
  );
  assert.ok(
    /internal pack id(entifier)?s?/i.test(CONTRACT),
    `consumption-contract.md must instruct agents not to leak internal pack ` +
      `identifiers (env-swfl, properties-lee-value, master, etc.) in prose.`,
  );
});

test("contract carries the inference-discipline literals", () => {
  assert.ok(
    CONTRACT.includes("[INFERENCE]"),
    `consumption-contract.md must carry the literal "[INFERENCE]" tag — ` +
      `the v3 SHOW INFERENCE rule requires every projection to mark itself ` +
      `inline with this tag.`,
  );
  assert.ok(
    /falsif(y|ier|ies|ying)/i.test(CONTRACT),
    `consumption-contract.md must require a falsifier on every projection ` +
      `(SHOW INFERENCE rule). The word "falsifier" or a conjugation MUST appear.`,
  );
});

test("contract names the tier model surface (view=speak + tier=1/2/3)", () => {
  assert.ok(
    CONTRACT.includes("view=speak"),
    `consumption-contract.md must name the speaker view query param ` +
      `(view=speak) — that's the surface the v3 paste block routes to.`,
  );
  for (const tier of ["tier=1", "tier=2", "tier=3"]) {
    assert.ok(
      CONTRACT.includes(tier),
      `consumption-contract.md must name ${tier} explicitly — the tier model ` +
        `is the v3 replacement for the rigid six-section format.`,
    );
  }
});

test("contract carries the v1.2 preservation audit table (Coupling 4)", () => {
  assert.ok(
    /preservation audit/i.test(CONTRACT),
    `consumption-contract.md must render the v1.2 preservation audit table ` +
      `so the rationale for keeping each load-bearing v1.2 mechanism is ` +
      `visible in the doc itself.`,
  );
});
