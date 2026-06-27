// Oracle tests for the report-grounding path of the one assistant (the /r/* dock).
// Relocated VERBATIM (assertions unchanged) from the deleted app/api/converse/route.test.ts
// so the GROUND-TRUTH injection, dead-end guard, needed-components gap-log, length-bound,
// and weekly-cap coverage is preserved after the /api/converse shim was deleted. The only
// change: each case calls runReportPath(request, AssistantRequest) directly — the dock's
// single `question` is the one user turn (the client shim's mapping, exercised at the contract).
import { test, expect, mock, afterAll } from "bun:test";
import * as meterModule from "@/lib/highlighter/meter";
import { buildGroundingContext } from "@/lib/highlighter/grounding";
import { RULES_OF_ENGAGEMENT } from "@/refinery/lib/rules-of-engagement.mts";
import type { AssistantRequest } from "@/lib/assistant/contract";

// mock.module is process-global and mock.restore() does NOT undo it (Bun docs); snapshot
// + re-install the real meter in afterAll so the stub below doesn't leak into later files
// (mcp, …). See conversation-path.test.ts.
const meterOrig = { ...meterModule };
afterAll(() => {
  mock.module("@/lib/highlighter/meter", () => meterOrig);
});

// Capture the last recordAsk meta so gap-logging can be asserted.
type AskMeta = {
  report_id: string;
  fact?: string;
  question: string;
  reach: string[];
  answered: boolean;
  needed_components?: string[];
};
let lastAsk: AskMeta | null = null;

// Capture the args passed to messages.stream so the grounded prompt can be asserted.
type StreamArgs = { system?: string; messages?: { role: string; content: string }[] };
let lastStreamArgs: StreamArgs | null = null;

mock.module("@/refinery/agents/anthropic.mts", () => ({
  TRIAGE_MODEL: "claude-haiku-4-5",
  SYNTHESIS_MODEL: "claude-sonnet-4-6",
  agentsAreMocked: () => false,
  getAnthropic: () => ({
    messages: {
      create: async () => {
        throw new Error("messages.create not expected in report-path tests");
      },
      stream: (args: StreamArgs) => {
        lastStreamArgs = args;
        return {
          async *[Symbol.asyncIterator]() {},
          textStream: (async function* () {
            yield "Median in 34102 is ";
            yield "$1.85M [Naples housing].";
          })(),
        };
      },
    },
  }),
}));
// Mutable meter state so a single file can exercise both the cap-disabled (default)
// and cap-tripped paths without re-importing the path module.
const meterState = { weekly: 0, capEnabled: false, clientId: "cid-1" };
mock.module("@/lib/highlighter/meter", () => ({
  recordUse: async () => 1,
  recordUseForClient: async () => 1,
  recordAsk: async (meta: AskMeta) => {
    lastAsk = meta;
  },
  actionCount: async () => 0,
  weeklyCount: async () => meterState.weekly,
  capEnabled: () => meterState.capEnabled,
  clientIdFromRequest: () => meterState.clientId,
}));

const { runReportPath } = await import("./report-path");

/** Drive the report path with an AssistantRequest (the dock's single question → one user turn). */
function run(
  fields: Omit<Partial<AssistantRequest>, "messages"> & { question?: string },
): Promise<Response> {
  const { question, ...rest } = fields;
  const req: AssistantRequest = {
    context: "outside",
    messages: typeof question === "string" ? [{ role: "user", content: question }] : [],
    ...rest,
  };
  const request = new Request("https://x/api/assistant", {
    method: "POST",
    body: JSON.stringify(req),
  });
  return runReportPath(request, req);
}

// The dead-end phrases the doctrine bans from the grounded system prompt. Demoted
// from a runtime answer-parser to this regression guard.
const DEAD_END = [
  "don't have that data",
  "no data available",
  "can't find that",
  "cannot find that",
];

test("grounded system prompt never instructs a dead-end (regression guard)", () => {
  const sys = buildGroundingContext({
    rules: RULES_OF_ENGAGEMENT,
    gazetteer: "G",
    blocks: [],
  });
  const lc = sys.toLowerCase();
  expect(DEAD_END.some((p) => lc.includes(p))).toBe(false);
});

test("injects ZIP<->place ground truth into the system prompt (33931 = Fort Myers Beach)", async () => {
  lastStreamArgs = null;
  const res = await run({ report_id: "master", question: "is 33931 a good buy?" });
  await res.text(); // drain so start() runs and messages.stream is called
  const sys = lastStreamArgs?.system ?? "";

  // The crosswalk data is ALREADY buried in the gazetteer JSON, so a bare toContain proves
  // nothing — it passes on the buried blob. The bug class only closes when the referenced
  // identity is surfaced as TOP-LINE ground truth: the deterministic `buildPlaceContext`
  // "GROUND TRUTH —" prefix, placed BEFORE the gazetteer JSON a small triage model can misread.
  const gtIdx = sys.indexOf("GROUND TRUTH");
  expect(gtIdx).toBeGreaterThanOrEqual(0); // the prefix must exist at all
  const gazIdx = sys.indexOf("GEOGRAPHY"); // start of the buried gazetteer dump
  expect(gtIdx).toBeLessThan(gazIdx); // ...and lead the buried blob, not follow it
  // The prefix's own block pairs the referenced ZIP with the correct town.
  const groundTruthBlock = sys.slice(gtIdx, gazIdx);
  expect(groundTruthBlock).toContain("33931");
  expect(groundTruthBlock).toContain("Fort Myers Beach");
});

test("streams grounded text for a known report", async () => {
  const res = await run({
    report_id: "master",
    fact: "median price",
    question: "what is 34102 median?",
  });
  expect(res.status).toBe(200);
  const body = await res.text();
  expect(body).toContain("$1.85M");
});

test("a slug with no brain file degrades to the master region read — never a user-facing 404 (#11)", async () => {
  // The unified resolver degrades a missing brain to the master region read instead of
  // throwing, so the user always gets a real answer at the nearest grain — never a 404.
  const res = await run({ report_id: "nope-not-real", fact: "x", question: "y" });
  expect(res.status).toBe(200); // degrade, not 404
  const body = await res.text();
  expect(body).toContain("$1.85M"); // a grounded answer streamed (master fallback), not an error
});

test("400 on a missing report_id", async () => {
  const res = await run({ question: "y" });
  expect(res.status).toBe(400);
});

test("a need-bearing slug logs needed_components and answered=false", async () => {
  lastAsk = null;
  const res = await run({
    report_id: "master",
    fact: "$27.51",
    slug: "asking_rent_psf_median",
    question: "break it down",
  });
  await res.text(); // drain the stream so the start() body runs recordAsk
  const ask = lastAsk as AskMeta | null;
  expect(ask?.answered).toBe(false);
  expect(ask?.needed_components).toContain("Property taxes");
});

test("no slug => floor path: answered=true, no logged components", async () => {
  lastAsk = null;
  const res = await run({ report_id: "master", fact: "median price", question: "what is it?" });
  await res.text();
  const ask = lastAsk as AskMeta | null;
  expect(ask?.answered).toBe(true);
  expect(ask?.needed_components).toEqual([]);
});

// --- Cost guards: input-length bounds + the env-gated per-client weekly cap ------

test("400 when the question exceeds the length bound (no model spend)", async () => {
  const res = await run({ report_id: "master", question: "q".repeat(2001) });
  expect(res.status).toBe(400);
});

test("400 when the fact exceeds the length bound", async () => {
  const res = await run({ report_id: "master", question: "ok", fact: "f".repeat(4001) });
  expect(res.status).toBe(400);
});

test("over the weekly cap → graceful SSE message, model never streams", async () => {
  const prev = process.env.HIGHLIGHTER_FREE_WEEKLY_CAP;
  process.env.HIGHLIGHTER_FREE_WEEKLY_CAP = "5";
  meterState.capEnabled = true;
  meterState.weekly = 5;
  meterState.clientId = "cid-over";
  try {
    const res = await run({ report_id: "master", question: "is 34102 hot?" });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("this week's free-question limit");
    expect(body).not.toContain("$1.85M"); // the mocked model text never ran
  } finally {
    process.env.HIGHLIGHTER_FREE_WEEKLY_CAP = prev;
    meterState.capEnabled = false;
    meterState.weekly = 0;
    meterState.clientId = "cid-1";
  }
});
