import { describe, test, mock } from "bun:test";
import assert from "node:assert/strict";

// Short-circuit paths (empty input + mock mode) run against the real
// anthropic.mts. They rely on agentsAreMocked() === true, which is the case
// when ANTHROPIC_API_KEY is unset.
delete process.env.ANTHROPIC_API_KEY;

const minimalPack = {
  prompts: { triageContext: "", synthesisContext: "" },
} as never;

function makeTriagedFragment(id: string, normalized: unknown) {
  return {
    fragment_id: id,
    source_id: "test",
    source_trust_tier: 1 as const,
    fetched_at: "2026-05-27T00:00:00Z",
    raw: {},
    normalized,
    classification: {
      topic: "test_topic",
      subtopic_key: id,
      decision_relevance_reason: "",
    },
    scoring: {
      pack_fit: 7,
      content_score: 7,
      type_multiplier: 1.5,
      composite: 21,
    },
  };
}

describe("synthesize() — short-circuit paths", () => {
  test("empty fragments returns []", async () => {
    const { synthesize } = await import("./synthesis-agent.mts");
    const result = await synthesize([], minimalPack);
    assert.deepEqual(result, []);
  });

  test("mock mode (no ANTHROPIC_API_KEY) returns one mock fact per fragment", async () => {
    // Guard against mock.module leakage from other test files (e.g. assistant tests that mock
    // anthropic.mts with agentsAreMocked: () => false). Re-establish mock-mode behavior here
    // so this test is order-independent in the full suite.
    mock.module("./anthropic.mts", () => ({
      SYNTHESIS_MODEL: "claude-sonnet-4-6",
      TRIAGE_MODEL: "claude-haiku-4-5",
      agentsAreMocked: () => true,
      getAnthropic: () => {
        throw new Error("getAnthropic should not be called in mock mode");
      },
    }));
    const { synthesize } = await import("./synthesis-agent.mts");
    const fragments = [
      makeTriagedFragment("test::1", { value: 42 }),
      makeTriagedFragment("test::2", { value: 43 }),
    ];
    const result = await synthesize(fragments as never, minimalPack);
    assert.equal(result.length, 2);
    assert.equal(result[0].topic, "test_topic");
    assert.deepEqual(result[0].source_fragment_ids, ["test::1"]);
    assert.match(result[0].fact, /Mock synthesized reference fact for fragment test::1/);
  });
});

describe("synthesize() — smoothing scrubber", () => {
  test("strips 'approximately' from fact + value on the live SDK path (mocked client)", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key-for-mock";

    // Replace the Anthropic adapter so synthesis-agent.mts's live bindings to
    // getAnthropic/agentsAreMocked point at the stub.
    mock.module("./anthropic.mts", () => ({
      SYNTHESIS_MODEL: "claude-sonnet-4-6",
      TRIAGE_MODEL: "claude-haiku-4-5",
      agentsAreMocked: () => false,
      getAnthropic: () => ({
        messages: {
          stream: () => ({
            finalMessage: async () => ({
              content: [
                {
                  type: "tool_use",
                  input: {
                    facts: [
                      {
                        topic: "test_topic",
                        fact: "Lee County issued approximately 100 permits",
                        value: "approximately 100",
                        source_fragment_ids: ["test::1"],
                      },
                    ],
                  },
                },
              ],
            }),
          }),
        },
      }),
    }));

    const { synthesize } = await import("./synthesis-agent.mts");
    const fragments = [makeTriagedFragment("test::1", { foo: "bar" })];
    const result = await synthesize(fragments as never, minimalPack);

    assert.equal(result.length, 1);
    assert.ok(
      !/approximately/i.test(result[0].fact),
      `expected 'approximately' to be scrubbed from fact, got: ${result[0].fact}`,
    );
    assert.ok(
      !/approximately/i.test(result[0].value),
      `expected 'approximately' to be scrubbed from value, got: ${result[0].value}`,
    );

    delete process.env.ANTHROPIC_API_KEY;
  });
});
