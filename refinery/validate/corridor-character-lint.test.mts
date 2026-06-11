/**
 * Unit coverage for the corridor-character lint orchestrator + the two new
 * block-level linters (speculative + chart). These tests run independently
 * of the C1 synthesizer — they exercise the lint surface directly so a
 * regression in the lint contract surfaces here even if C1 changes.
 */

import { test } from "bun:test";
import assert from "node:assert/strict";

import {
  lintCorridorCharacterOutput,
  SPECULATIVE_DISCLAIMER,
  type CorridorCharacterOutput,
} from "./corridor-character-lint.mts";
import { lintChartBlock } from "./chart-block-lint.mts";
import { lintSpeculativeBlock } from "./speculative-block-lint.mts";
import { buildCorridorFactPack } from "../tools/build-corridor-fact-pack.mts";
import { makeNaplesFullDataInput } from "../tools/corridor-character-fixtures.mts";

const factPack = buildCorridorFactPack(makeNaplesFullDataInput());

// ── chart-block-lint ────────────────────────────────────────────────────────

test("chart-block: null is ok", () => {
  assert.deepEqual(lintChartBlock(null), { ok: true, errors: [], warnings: [] });
});

test("chart-block: well-formed shape passes", () => {
  const r = lintChartBlock({
    title: "x",
    columns: ["a", "b"],
    rows: [
      ["v1", 1],
      ["v2", null],
    ],
  });
  assert.equal(r.ok, true);
});

test("chart-block: missing title", () => {
  const r = lintChartBlock({ columns: ["a"], rows: [] });
  assert.equal(r.ok, false);
  assert.match(r.errors.join(" "), /title/);
});

test("chart-block: row width mismatch", () => {
  const r = lintChartBlock({
    title: "x",
    columns: ["a", "b", "c"],
    rows: [["only-one"]],
  });
  assert.equal(r.ok, false);
  assert.match(r.errors.join(" "), /1 cell.*expected 3/);
});

test("chart-block: rejects non-object non-null", () => {
  const r = lintChartBlock("string-not-allowed");
  assert.equal(r.ok, false);
});

// ── chart-block-lint: provenance ───────────────────────────────────────────

test("chart-block provenance: numeric cells must be in fact pack", () => {
  // Naples fixture's vacancy_rate.current.value is 5.2. Anything within
  // ±5% (4.94 - 5.46) passes; anything outside fails.
  const anchors = new Set([5.2, 32.5, 12000]);
  const r = lintChartBlock(
    {
      title: "Corridor metrics",
      columns: ["Metric", "Value"],
      rows: [
        ["Vacancy", 5.2], // in pack — passes
        ["Asking rent", 32.5], // in pack — passes
      ],
    },
    anchors,
  );
  assert.equal(r.ok, true);
});

test("chart-block provenance: rejects web-cited peer values that aren't in fact pack", () => {
  // The Vanderbilt failure shape from the all-26 run: model emitted
  // Tampa/Orlando/Miami office vacancies (15.4, 16.8, 21.0) sourced from
  // web — none of those are in the fact pack.
  const anchors = new Set([5.2, 3.3, 32.5]);
  const r = lintChartBlock(
    {
      title: "Office Vacancy vs Peer FL Metros",
      columns: ["Market", "Vacancy"],
      rows: [
        ["Corridor", 3.3], // in pack — passes
        ["Miami", 15.4], // NOT in pack — fails
        ["Orlando", 16.8], // NOT in pack — fails
        ["Tampa", 21.0], // NOT in pack — fails
      ],
    },
    anchors,
  );
  assert.equal(r.ok, false);
  assert.match(r.errors.join(" "), /chart-provenance/);
  assert.match(r.errors.join(" "), /15\.4/);
  assert.match(r.errors.join(" "), /16\.8/);
  assert.match(r.errors.join(" "), /21/);
});

test("chart-block provenance: string cells (labels, units) bypass the check", () => {
  // "Vanderbilt / Mercato", "$30.91/sqft", "—" are strings and exempt.
  // The "$30.91/sqft" string IS quantity-shaped but as a string it's a
  // label not a numeric cell.
  const anchors = new Set([5.2]);
  const r = lintChartBlock(
    {
      title: "Snapshot",
      columns: ["Metric", "Value"],
      rows: [
        ["Vacancy", 5.2], // numeric — checked, passes
        ["Asking rent", "$30.91/sqft"], // string — bypass
        ["Cap rate", "—"], // string — bypass
        ["Other", null], // null — bypass
      ],
    },
    anchors,
  );
  assert.equal(r.ok, true);
});

test("chart-block provenance: caller may opt out by passing null anchors (structural-only mode)", () => {
  // When the orchestrator hasn't built a fact pack (e.g. shape-only test),
  // provenance check is skipped.
  const r = lintChartBlock(
    {
      title: "Wild",
      columns: ["a"],
      rows: [[9999]], // would fail with anchors set; passes when null
    },
    null,
  );
  assert.equal(r.ok, true);
});

// ── speculative-block-lint ──────────────────────────────────────────────────

test("speculative-block: well-formed passes", () => {
  const block = "Vacancy could be tracking toward expansion. " + SPECULATIVE_DISCLAIMER;
  const r = lintSpeculativeBlock(block, factPack);
  assert.equal(r.ok, true);
});

test("speculative-block: missing disclaimer rejected", () => {
  const block = "Vacancy may be expanding.";
  const r = lintSpeculativeBlock(block, factPack);
  assert.equal(r.ok, false);
  assert.match(r.errors.join(" "), /requires-speculative-disclaimer/);
});

test("speculative-block: anchored fact-pack number does not need a hedge", () => {
  // 5.2 is the vacancy_rate.current.value in the Naples fixture.
  const block = "Vacancy is 5.2 currently. " + SPECULATIVE_DISCLAIMER;
  const r = lintSpeculativeBlock(block, factPack);
  assert.equal(r.ok, true);
});

test("speculative-block: bare inferred number without hedge rejected", () => {
  const block = "The next reading is 9999. " + SPECULATIVE_DISCLAIMER;
  const r = lintSpeculativeBlock(block, factPack);
  assert.equal(r.ok, false);
  assert.match(r.errors.join(" "), /requires-hedging-around-inference/);
});

test("speculative-block: [inference] marker satisfies hedging requirement", () => {
  const block = "The next reading is 9999 [inference]. " + SPECULATIVE_DISCLAIMER;
  const r = lintSpeculativeBlock(block, factPack);
  assert.equal(r.ok, true);
});

test("speculative-block: 'most likely' / 'tracking toward' satisfy hedging", () => {
  const block = "Vacancy is most likely 9999 next quarter. " + SPECULATIVE_DISCLAIMER;
  const r = lintSpeculativeBlock(block, factPack);
  assert.equal(r.ok, true);
});

test("speculative-block: bare 4-digit year [1900-2099] passes without a hedge", () => {
  // Years are temporal anchors, not inferred predictions. Without this
  // exemption, every speculative block that references "by 2026" or "the
  // 2024-2025 stretch" trips the hedging rule even when the prose is
  // properly disclaimed at the block level. Exemption is bare 4-digit
  // ints in 1900-2099 only — quantitative neighbors (%/$/./,) stay linted.
  const block = "The 2025 reading may shift the trajectory. " + SPECULATIVE_DISCLAIMER;
  const r = lintSpeculativeBlock(block, factPack);
  assert.equal(r.ok, true);
});

test("speculative-block: '25%' still rejected (quantitative neighbor disqualifies year exemption)", () => {
  // Surgical: the year exemption MUST not swallow legitimate quantities
  // that happen to fall in the year range. 25% is a percentage, not a
  // year — the % qualifier means findNumbers parses it as a quantity
  // and the bare-4-digit guard does not apply.
  const block = "Vacancy could approach 25% next cycle. " + SPECULATIVE_DISCLAIMER;
  const r = lintSpeculativeBlock(block, factPack);
  // 'approach' is not in the hedging-tokens list; expect a hedging error.
  assert.equal(r.ok, false);
  assert.match(r.errors.join(" "), /requires-hedging-around-inference/);
  assert.match(r.errors.join(" "), /"25%"/);
});

test("speculative-block: '[web-N]' source attribution exempts the number (sourced ≠ inferred)", () => {
  // A web-cited quantity IS the disclosure. The hedging requirement was
  // designed to gate inferred predictions, not gag the model from quoting
  // a sourced fact. Mirror shape: same exemption path as [inference].
  const block =
    "Coconut Point Mall draws 260 stores from a 1.2M sqft GLA [web-3]. " + SPECULATIVE_DISCLAIMER;
  const r = lintSpeculativeBlock(block, factPack);
  assert.equal(r.ok, true);
});

test("speculative-block: bare quantity with NO citation and NO hedge still rejected", () => {
  // Don't regress the inference guard — a number that's neither cited
  // nor hedged is still inferred-without-disclosure.
  const block = "Coconut Point Mall draws 260 stores. " + SPECULATIVE_DISCLAIMER;
  const r = lintSpeculativeBlock(block, factPack);
  assert.equal(r.ok, false);
  assert.match(r.errors.join(" "), /requires-hedging-around-inference/);
});

test("speculative-block: hedge without citation still passes (existing path)", () => {
  // Don't regress the hedging-phrase exemption.
  const block = "Coconut Point Mall most likely draws 260 stores. " + SPECULATIVE_DISCLAIMER;
  const r = lintSpeculativeBlock(block, factPack);
  assert.equal(r.ok, true);
});

test("speculative-block: '[inference]' marker exemption still works (no regression)", () => {
  // Don't regress the original [inference] exemption when adding [web-N].
  const block = "Coconut Point Mall draws 260 stores [inference]. " + SPECULATIVE_DISCLAIMER;
  const r = lintSpeculativeBlock(block, factPack);
  assert.equal(r.ok, true);
});

test("speculative-block: highway designators ('U.S. 41', 'I-75', 'SR-82', 'CR-951', 'US-41') are exempt as identifiers", () => {
  // Highway numbers are identifiers, not quantities. Same category-error
  // surgical exemption as years. Block contains no real quantity to flag.
  const variants = [
    "U.S. 41 carries the corridor's primary frontage.",
    "I-75 access shapes the catchment east of the property.",
    "The SR-82 alignment shifts AADT north toward the airport.",
    "Collier Blvd / CR-951 anchors the highway-strip-mall typology.",
    "US-41 access via the Pine Ridge interchange feeds the corridor.",
    "SR 82 carries north-south freight past the corridor.",
    "CR 951 anchors the east-west cross-traffic.",
  ];
  for (const v of variants) {
    const block = v + " " + SPECULATIVE_DISCLAIMER;
    const r = lintSpeculativeBlock(block, factPack);
    assert.equal(
      r.ok,
      true,
      `expected highway designator to be exempt, got errors for: ${v}\n${r.errors.join("\n")}`,
    );
  }
});

test("speculative-block: highway exemption does NOT transfer to adjacent quantities", () => {
  // "U.S. 41 carries 60,000 vehicles" — the highway "41" is exempt as an
  // identifier, but "60,000" is a real quantity and still needs a hedge
  // or citation. Don't let the highway exemption leak past its own digit.
  const block =
    "U.S. 41 carries 60,000 vehicles past the corridor each day. " + SPECULATIVE_DISCLAIMER;
  const r = lintSpeculativeBlock(block, factPack);
  assert.equal(r.ok, false);
  assert.match(r.errors.join(" "), /requires-hedging-around-inference/);
  assert.match(r.errors.join(" "), /"60,000"/);
});

test("speculative-block: highway + sentence-scoped [web-N] cite passes (real combined case)", () => {
  // Both fixes working together: "41" is highway-exempted, "60,000" picks
  // up the sentence-level [web-2] cite.
  const block =
    "U.S. 41 carries 60,000 vehicles past the corridor each day [web-2]. " + SPECULATIVE_DISCLAIMER;
  const r = lintSpeculativeBlock(block, factPack);
  assert.equal(r.ok, true);
});

test("speculative-block: sentence-scoped [web-N] covers numbers >60 chars from the cite (long enumeration)", () => {
  // The real failure shape from Coconut Point Mall: model writes a long
  // enumeration of cited quantities followed by a single [web-N] cluster
  // at the end. The cite distance was >60 chars from the leading number,
  // failing the old phrase-level window. Sentence-scope catches it because
  // a sourced sentence covers every quantity inside.
  const block =
    "Woodfield Estero is planned for 596 multifamily units, 82,000 sqft of retail and dining, and a 260-room hotel [web-31]. " +
    SPECULATIVE_DISCLAIMER;
  const r = lintSpeculativeBlock(block, factPack);
  assert.equal(
    r.ok,
    true,
    `expected sentence-scoped cite to cover all enumerated quantities, got: ${r.errors.join("\n")}`,
  );
});

test("speculative-block: sentence-scoped [web-N] does NOT cross sentence boundaries", () => {
  // The unsafe failure direction we want to prevent: a [web-N] in
  // sentence B should NOT cover an unhedged number in sentence A. Period
  // + space + capital letter is the sentence boundary.
  const block =
    "Inventory is 365 units. A separate sentence references the data [web-3]. " +
    SPECULATIVE_DISCLAIMER;
  const r = lintSpeculativeBlock(block, factPack);
  assert.equal(r.ok, false);
  assert.match(r.errors.join(" "), /requires-hedging-around-inference/);
  assert.match(r.errors.join(" "), /"365"/);
});

test("speculative-block: sentence splitter does not break on 'U.S. 41' (digit after period)", () => {
  // Edge case littlebird called out: a naive period-split would treat
  // "U.S. 41" as a sentence boundary. The (?=[A-Z]) lookahead prevents
  // it because "41" starts with a digit, not a capital. Verify the
  // sentence containing both "U.S. 41" and a later [web-N] still
  // treats them as one sentence (and exempts a quantity in between).
  const block =
    "U.S. 41 frontage carries 35,000 vehicles into the corridor each day [web-9]. " +
    SPECULATIVE_DISCLAIMER;
  const r = lintSpeculativeBlock(block, factPack);
  assert.equal(
    r.ok,
    true,
    `expected single-sentence treatment, got errors: ${r.errors.join("\n")}`,
  );
});

test("speculative-block: '2025' as $2025 / 2,025 / 2025.5 still linted (qualifier disqualifies year exemption)", () => {
  // Three quantitative neighbors that look year-like but aren't:
  //   $2025  — currency
  //   2,025  — thousand-separated quantity
  //   2025.5 — decimal
  // All three must still be linted as inferred quantities; the exemption
  // is only for BARE 4-digit ints with no qualifier.
  for (const raw of ["$2025", "2,025", "2025.5"]) {
    const block = `Rent might be ${raw} per sqft next quarter. ${SPECULATIVE_DISCLAIMER}`;
    const r = lintSpeculativeBlock(block, factPack);
    // 'might be' IS a hedging phrase — so this should pass; switch to a non-hedge verb.
    assert.equal(r.ok, true, `expected hedged '${raw}' to pass, got: ${r.errors.join(" ")}`);
    const block2 = `Rent should hit ${raw} per sqft next quarter. ${SPECULATIVE_DISCLAIMER}`;
    const r2 = lintSpeculativeBlock(block2, factPack);
    assert.equal(r2.ok, false, `expected ${raw} to be linted as quantity, got ok=true`);
    assert.match(r2.errors.join(" "), /requires-hedging-around-inference/);
  }
});

// ── orchestrator ────────────────────────────────────────────────────────────

function happyOutput(): CorridorCharacterOutput {
  return {
    facts_block: "Vacancy is 5.2% [internal-1]. Asking rent is $32.50 NNN [web-1].",
    chart_block: null,
    speculative_block: "Trends could be tracking toward expansion. " + SPECULATIVE_DISCLAIMER,
    citations: {
      internal: [
        {
          ref: "internal-1",
          source_url: "https://corridor-profiles.example/x",
        },
      ],
      web: [
        {
          ref: "web-1",
          url: "https://cushwake.example/x",
          title: "x",
          cited_text: "x",
        },
      ],
    },
  };
}

test("orchestrator: well-formed output returns ok", () => {
  const r = lintCorridorCharacterOutput(happyOutput(), factPack);
  assert.equal(r.ok, true);
  assert.equal(r.flat_errors.length, 0);
});

test("orchestrator: aggregates errors across blocks with prefixes", () => {
  const bad = happyOutput();
  bad.facts_block = "Vacancy is approximately 5.2%."; // no cite, plus smoothing
  bad.speculative_block = "Speculation."; // missing disclaimer
  bad.chart_block = { title: "x", columns: [], rows: "no" } as never;
  const r = lintCorridorCharacterOutput(bad, factPack);
  assert.equal(r.ok, false);
  assert.ok(r.errors.facts.length > 0);
  assert.ok(r.errors.speculative.length > 0);
  assert.ok(r.errors.chart.length > 0);
  assert.ok(r.flat_errors.some((e) => e.startsWith("[facts] ")));
  assert.ok(r.flat_errors.some((e) => e.startsWith("[speculative] ")));
  assert.ok(r.flat_errors.some((e) => e.startsWith("[chart] ")));
});

test("orchestrator: empty facts_block rejected with clear message", () => {
  const bad = happyOutput();
  bad.facts_block = "";
  const r = lintCorridorCharacterOutput(bad, factPack);
  assert.equal(r.ok, false);
  assert.match(r.errors.facts.join(" "), /non-empty string/);
});

test("orchestrator: dangling [web-N] anchor in speculative_block rejected", () => {
  // The plan's REJECT contract: a model emits [web-99] in the speculative
  // block, the citations payload only carries web-1, the renderer would
  // break trying to resolve web-99. Lint must catch it before DB write.
  const bad = happyOutput();
  bad.speculative_block =
    "Trends could be tracking toward expansion [web-99]. " + SPECULATIVE_DISCLAIMER;
  const r = lintCorridorCharacterOutput(bad, factPack);
  assert.equal(r.ok, false);
  assert.ok(
    r.errors.speculative.some((e) => /speculative_block cites "\[web-99\]"/.test(e)),
    `expected a dangling-anchor error in speculative errors, got: ${JSON.stringify(r.errors.speculative)}`,
  );
});

test("orchestrator: dangling [internal-N] anchor in speculative_block rejected", () => {
  const bad = happyOutput();
  bad.speculative_block =
    "Continuing the drift first flagged in Q3 [internal-42]. " + SPECULATIVE_DISCLAIMER;
  const r = lintCorridorCharacterOutput(bad, factPack);
  assert.equal(r.ok, false);
  assert.ok(r.errors.speculative.some((e) => /speculative_block cites "\[internal-42\]"/.test(e)));
});

test("orchestrator: speculative_block with resolved anchors passes", () => {
  // web-1 IS in the citations payload — should not trip the dangling check.
  const good = happyOutput();
  good.speculative_block =
    "The most recent reading [web-1] suggests trends could be tracking toward expansion. " +
    SPECULATIVE_DISCLAIMER;
  const r = lintCorridorCharacterOutput(good, factPack);
  assert.equal(r.ok, true, `expected ok=true, got errors: ${r.flat_errors}`);
});
