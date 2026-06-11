/**
 * Stage C coverage for the corridor character generator.
 *
 * Tests the synthesizer end-to-end with a MOCKED Anthropic client (no live
 * API calls). Covers the Step 3 acceptance criterion explicitly: a
 * deliberately-malformed run is rejected and the DB write path is never
 * reached.
 *
 * The orchestrator lint stack (lintCorridorCharacterOutput) is exercised
 * implicitly here — these tests are about the synthesizer's wiring.
 * Block-level lint unit tests live in
 *   refinery/validate/speculative-block-lint.test.mts
 *   refinery/validate/chart-block-lint.test.mts
 *   refinery/validate/corridor-character-lint.test.mts
 * (sibling files).
 */

import { test } from "bun:test";
import assert from "node:assert/strict";
import { writeFile, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";

import {
  readGroundedNdjson,
  synthesizeCorridorCharacter,
  type SynthesizeInput,
} from "./synthesize-corridor-character.mts";
import { buildCorridorFactPack } from "./build-corridor-fact-pack.mts";
import { makeNaplesFullDataInput } from "./corridor-character-fixtures.mts";
import {
  SPECULATIVE_DISCLAIMER,
  type CorridorCharacterOutput,
} from "../validate/corridor-character-lint.mts";

// ── Test scaffolding ────────────────────────────────────────────────────────

/** Minimal grounded NDJSON record matching B1's pipeline.py output shape. */
function groundedRecord() {
  return {
    corridor_name: "Pine Ridge Rd Naples",
    corridor_slug: "pine-ridge-rd-naples",
    query: "test query",
    model: "claude-sonnet-4-6",
    tool_version: "web_search_20250305",
    run_at: "2026-05-26T12:00:00.000Z",
    input_tokens: 100,
    output_tokens: 500,
    stop_reason: "end_turn",
    response: {},
    citations: [
      {
        url: "https://cushwake.example/naples-2026q1",
        title: "Naples Office MarketBeat 2026 Q1",
        cited_text: "Naples office vacancy edged up to 6.1% in the first quarter of 2026.",
        type: "web_search_result_location",
      },
      {
        url: "https://gulfshorebusiness.example/medical-office",
        title: "Medical office demand softens in Naples",
        cited_text: "Brokers report slower medical office leasing through early 2026.",
        type: "web_search_result_location",
      },
    ],
    cited_text_count: 2,
  };
}

async function writeNdjsonFixture(name: string, record: unknown): Promise<string> {
  const dir = path.join(tmpdir(), "corridor-character-test");
  await mkdir(dir, { recursive: true });
  const p = path.join(dir, name);
  await writeFile(p, JSON.stringify(record) + "\n", "utf-8");
  return p;
}

/** Build a mocked Anthropic client whose messages.create returns the given tool input. */
function mockClient(toolInput: unknown, opts: { stopReason?: string } = {}) {
  let callCount = 0;
  const client = {
    messages: {
      create: async (_args: unknown) => {
        callCount++;
        return {
          id: "msg_test",
          type: "message",
          role: "assistant",
          model: "claude-sonnet-4-6",
          content: [
            {
              type: "tool_use",
              id: "toolu_test",
              name: "record_corridor_character",
              input: toolInput,
            },
          ],
          stop_reason: opts.stopReason ?? "tool_use",
          stop_sequence: null,
          usage: { input_tokens: 1000, output_tokens: 500 },
        };
      },
    },
  };
  return {
    client: client as unknown as SynthesizeInput["client"],
    getCallCount: () => callCount,
  };
}

/** A well-formed synthesizer output for the Naples fixture. */
function goodOutput(): CorridorCharacterOutput {
  return {
    facts_block:
      "Vacancy rate is 5.2% [internal-1], up 1.3pp from 2025-Q1 [internal-2]. " +
      "Asking rent is $32.50/sqft NNN [internal-1]. Unemployment in Collier " +
      "County is 3.6% [internal-3]. Brokers report slower medical-office " +
      "leasing through early 2026 [web-2].",
    chart_block: {
      title: "Naples vacancy + asking rent (latest)",
      columns: ["metric", "value", "unit"],
      rows: [
        ["vacancy_rate", 5.2, "%"],
        ["asking_rent_psf", 32.5, "$/sqft NNN"],
      ],
      asOf: "2026-06-01",
    },
    speculative_block:
      "The 1.3pp vacancy expansion paired with stable rent suggests landlords " +
      "may be holding sticker prices while concessions absorb the give-back. " +
      "If medical-office demand keeps softening [web-2], the next-quarter " +
      "reading is most likely tracking toward the 7% range [inference]. " +
      SPECULATIVE_DISCLAIMER,
    citations: {
      internal: [
        {
          ref: "internal-1",
          source_url: "https://corridor-profiles.example/pine-ridge",
        },
        {
          ref: "internal-2",
          source_url: "https://cushwake.example/2025q1",
        },
        {
          ref: "internal-3",
          source_url: "https://www.bls.gov/lau/",
        },
      ],
      web: [
        {
          ref: "web-1",
          url: "https://cushwake.example/naples-2026q1",
          title: "Naples Office MarketBeat 2026 Q1",
          cited_text: "Naples office vacancy edged up to 6.1% in the first quarter of 2026.",
        },
        {
          ref: "web-2",
          url: "https://gulfshorebusiness.example/medical-office",
          title: "Medical office demand softens in Naples",
          cited_text: "Brokers report slower medical office leasing through early 2026.",
        },
      ],
    },
  };
}

// ── readGroundedNdjson ──────────────────────────────────────────────────────

test("readGroundedNdjson: parses a single-record NDJSON file", async () => {
  const fixturePath = await writeNdjsonFixture("read-test.ndjson", groundedRecord());
  const r = await readGroundedNdjson(fixturePath);
  assert.equal(r.corridor_slug, "pine-ridge-rd-naples");
  assert.equal(r.citations.length, 2);
});

test("readGroundedNdjson: returns the LAST record when multiple records are present", async () => {
  const dir = path.join(tmpdir(), "corridor-character-test");
  await mkdir(dir, { recursive: true });
  const p = path.join(dir, "multi-record.ndjson");
  const a = { ...groundedRecord(), run_at: "2026-04-01T00:00:00.000Z" };
  const b = { ...groundedRecord(), run_at: "2026-05-26T12:00:00.000Z" };
  await writeFile(p, JSON.stringify(a) + "\n" + JSON.stringify(b) + "\n", "utf-8");
  const r = await readGroundedNdjson(p);
  assert.equal(r.run_at, "2026-05-26T12:00:00.000Z");
});

test("readGroundedNdjson: throws on empty file", async () => {
  const p = await writeNdjsonFixture("empty.ndjson", null);
  // Overwrite with empty content (writeNdjsonFixture stringifies null → "null").
  await writeFile(p, "", "utf-8");
  await assert.rejects(() => readGroundedNdjson(p), /is empty/);
});

// ── Happy path: well-formed output passes lint and returns ──────────────────

test("synthesizeCorridorCharacter: well-formed three-block output passes lint", async () => {
  const ndjsonPath = await writeNdjsonFixture("happy.ndjson", groundedRecord());
  const factPack = buildCorridorFactPack(makeNaplesFullDataInput());
  const { client, getCallCount } = mockClient(goodOutput());
  const result = await synthesizeCorridorCharacter({
    factPack,
    groundedNdjsonPath: ndjsonPath,
    client,
  });
  assert.equal(getCallCount(), 1);
  assert.equal(result.lint.ok, true);
  assert.equal(result.output.facts_block.includes("5.2%"), true);
  assert.equal(result.output.speculative_block.endsWith(SPECULATIVE_DISCLAIMER), true);
  assert.equal(result.usage.input_tokens, 1000);
});

// ── Reject paths: malformed runs MUST throw and never proceed to DB ────────

test("REJECT: speculative block missing the verbatim disclaimer", async () => {
  const ndjsonPath = await writeNdjsonFixture("reject-disclaimer.ndjson", groundedRecord());
  const factPack = buildCorridorFactPack(makeNaplesFullDataInput());
  const bad = goodOutput();
  bad.speculative_block = bad.speculative_block.replace(SPECULATIVE_DISCLAIMER, "Speculative.");
  const { client } = mockClient(bad);
  await assert.rejects(
    () =>
      synthesizeCorridorCharacter({
        factPack,
        groundedNdjsonPath: ndjsonPath,
        client,
      }),
    /requires-speculative-disclaimer/,
  );
});

test("REJECT: unhedged inferred number in speculative block", async () => {
  const ndjsonPath = await writeNdjsonFixture("reject-unhedged.ndjson", groundedRecord());
  const factPack = buildCorridorFactPack(makeNaplesFullDataInput());
  const bad = goodOutput();
  // Replace the hedged inference with a bare number — 9999 is not in the fact
  // pack, no hedging tokens nearby, no [inference] marker.
  bad.speculative_block = "The next-quarter reading is 9999. " + SPECULATIVE_DISCLAIMER;
  const { client } = mockClient(bad);
  await assert.rejects(
    () =>
      synthesizeCorridorCharacter({
        factPack,
        groundedNdjsonPath: ndjsonPath,
        client,
      }),
    /requires-hedging-around-inference/,
  );
});

test("REJECT: facts block cites a [web-N] anchor with no matching citation row", async () => {
  const ndjsonPath = await writeNdjsonFixture("reject-bad-cite.ndjson", groundedRecord());
  const factPack = buildCorridorFactPack(makeNaplesFullDataInput());
  const bad = goodOutput();
  // [web-99] does not exist in citations.web
  bad.facts_block = bad.facts_block + " A fictitious tenant signed a lease [web-99].";
  const { client } = mockClient(bad);
  await assert.rejects(
    () =>
      synthesizeCorridorCharacter({
        factPack,
        groundedNdjsonPath: ndjsonPath,
        client,
      }),
    /no matching web citation row/,
  );
});

test("REJECT: facts block carries a smoothing token (numeric_softening)", async () => {
  const ndjsonPath = await writeNdjsonFixture("reject-smoothing.ndjson", groundedRecord());
  const factPack = buildCorridorFactPack(makeNaplesFullDataInput());
  const bad = goodOutput();
  bad.facts_block =
    "Vacancy is approximately 5.2% [internal-1], with rent estimated from broker reports [web-1].";
  const { client } = mockClient(bad);
  await assert.rejects(
    () =>
      synthesizeCorridorCharacter({
        factPack,
        groundedNdjsonPath: ndjsonPath,
        client,
      }),
    /smoothing-lint/,
  );
});

test("REJECT: facts block has no citation markers at all", async () => {
  const ndjsonPath = await writeNdjsonFixture("reject-no-cite.ndjson", groundedRecord());
  const factPack = buildCorridorFactPack(makeNaplesFullDataInput());
  const bad = goodOutput();
  bad.facts_block =
    "Vacancy is 5.2%. Asking rent is $32.50 per square foot NNN. Unemployment in Collier County is 3.6%.";
  const { client } = mockClient(bad);
  await assert.rejects(
    () =>
      synthesizeCorridorCharacter({
        factPack,
        groundedNdjsonPath: ndjsonPath,
        client,
      }),
    /no citation marker/,
  );
});

test("REJECT: malformed chart_block (wrong row width)", async () => {
  const ndjsonPath = await writeNdjsonFixture("reject-chart.ndjson", groundedRecord());
  const factPack = buildCorridorFactPack(makeNaplesFullDataInput());
  const bad = goodOutput();
  // 3 columns but a row with only 2 cells.
  bad.chart_block = {
    title: "Bad chart",
    columns: ["a", "b", "c"],
    rows: [["x", 1]],
    asOf: "2026-06-01",
  };
  const { client } = mockClient(bad);
  await assert.rejects(
    () =>
      synthesizeCorridorCharacter({
        factPack,
        groundedNdjsonPath: ndjsonPath,
        client,
      }),
    /chart_block\.rows\[0\] has 2 cell/,
  );
});

test("REJECT: model response with no tool_use block surfaces a clear error", async () => {
  const ndjsonPath = await writeNdjsonFixture("reject-no-tool.ndjson", groundedRecord());
  const factPack = buildCorridorFactPack(makeNaplesFullDataInput());
  const client = {
    messages: {
      create: async () => ({
        id: "msg_test",
        type: "message",
        role: "assistant",
        model: "claude-sonnet-4-6",
        content: [{ type: "text", text: "I refuse." }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 5 },
      }),
    },
  } as unknown as SynthesizeInput["client"];
  await assert.rejects(
    () =>
      synthesizeCorridorCharacter({
        factPack,
        groundedNdjsonPath: ndjsonPath,
        client,
      }),
    /no tool_use block/,
  );
});

// ── Cleanup ────────────────────────────────────────────────────────────────

test("cleanup tmp NDJSON fixtures", async () => {
  const dir = path.join(tmpdir(), "corridor-character-test");
  await rm(dir, { recursive: true, force: true });
});
