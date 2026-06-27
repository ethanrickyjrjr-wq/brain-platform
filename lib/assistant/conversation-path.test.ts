// Oracle tests for the conversation path of the one assistant (PROJECT AI / OUTSIDE
// AI / public funnel). Relocated VERBATIM (assertions unchanged) from the deleted
// app/api/welcome/chat/route.test.ts so the grounding / no-invention / answer-first /
// off-topic-gate coverage is preserved after the /api/welcome/chat shim was deleted.
// The only change: each case now calls runConversationPath(request, AssistantRequest)
// directly instead of POSTing the legacy {mode, currentProjectId} body — the client
// shim mapping (mode:"analyst" → context outside/project, mode:"summarize" → action,
// else → public) is exercised at its real seam, the contract.
import { test, expect, mock, afterAll } from "bun:test";
import type { LocationDossier } from "@/lib/zip-dossier";
import * as fetchBrain from "@/lib/fetch-brain";
import * as meterModule from "@/lib/highlighter/meter";
import * as chatUsageModule from "@/lib/welcome/chat-usage";
import * as dossierCacheModule from "@/lib/welcome/dossier-cache";
import { parseSseFrame, type WelcomeFrame } from "@/lib/welcome/frames";
import type { AssistantRequest } from "@/lib/assistant/contract";

// Bun's mock.module is process-global and mock.restore() does NOT undo it (Bun docs:
// "does not reset the value of modules overridden with mock.module()"). So snapshot the
// real modules these tests stub and re-install the originals in afterAll — otherwise the
// stubs leak into every later test file that imports them for real (mcp, bind-frame,
// fetch-reach, meter-userid, lib/welcome/dossier-cache, …). This file used to live under
// app/api/** where file ordering hid the leak. (anthropic.mts is intentionally NOT
// restored: a stub Anthropic client is harmless to leak — unit tests never call the real
// one — and importing it here to snapshot would evaluate the real module.)
const ORIG = {
  "@/lib/fetch-brain": { ...fetchBrain },
  "@/lib/highlighter/meter": { ...meterModule },
  "@/lib/welcome/chat-usage": { ...chatUsageModule },
  "@/lib/welcome/dossier-cache": { ...dossierCacheModule },
};
afterAll(() => {
  for (const [path, orig] of Object.entries(ORIG)) mock.module(path, () => orig);
});

// Capture the system prompt AND messages handed to Haiku + a sentinel proving the model streamed.
const captured: { system?: string; messages?: { role: string; content: string }[] } = {};
const MODEL_SENTINEL = "We track flood risk"; // appears only when the model actually streams
mock.module("@/refinery/agents/anthropic.mts", () => ({
  TRIAGE_MODEL: "claude-haiku-4-5",
  SYNTHESIS_MODEL: "claude-sonnet-4-6",
  agentsAreMocked: () => true,
  getAnthropic: () => ({
    messages: {
      stream: (args: { system?: string; messages?: { role: string; content: string }[] }) => {
        captured.system = args?.system;
        captured.messages = args?.messages;
        return {
          async *[Symbol.asyncIterator]() {},
          textStream: (async function* () {
            yield "We track flood risk, permits, ";
            yield "and prices across Southwest Florida.";
          })(),
        };
      },
    },
  }),
}));
// Mutable cost-guard state so one file covers both cap-disabled and cap-tripped.
const welcomeState = { weekly: 0, capEnabled: false, clientId: "cid-1" };
mock.module("@/lib/welcome/chat-usage", () => ({
  recordWelcomeChat: async () => {},
  welcomeCapEnabled: () => welcomeState.capEnabled,
  welcomeChatWeeklyCount: async () => welcomeState.weekly,
}));
// Full meter surface (not just clientIdFromRequest): when bun runs the whole suite in
// one process, a narrow mock here would leak and break report-path.test.ts's `import
// { recordAsk }` from this same module. Provide every export the assistant paths touch.
mock.module("@/lib/highlighter/meter", () => ({
  clientIdFromRequest: () => welcomeState.clientId,
  recordUse: async () => 1,
  recordUseForClient: async () => 1,
  recordAsk: async () => {},
  actionCount: async () => 0,
  weeklyCount: async () => 0,
  capEnabled: () => false,
}));
// Mock the guarded fan-out so these tests never read real brains/*.md.
const guardState: { result: { dossier?: LocationDossier; capped: boolean; fromCache: boolean } } = {
  result: { capped: false, fromCache: false },
};
mock.module("@/lib/welcome/dossier-cache", () => ({
  assembleGuardedDossier: async () => guardState.result,
}));
// Stub ONLY the {answer} producer's brain loader; keep every other fetch-brain
// export real (the prose path imports renderDetailRowText etc. from this module).
const brainState: { map: Record<string, unknown> } = { map: {} };
// Master read for the analyst no-location path. null → the mock throws and
// buildGroundedRegionSystem falls back to the un-grounded premise.
const masterState: { output: Record<string, unknown> | null } = { output: null };
// cre-swfl read for the analyst CRE-grain grounding. null → not pulled.
const creState: { output: Record<string, unknown> | null } = { output: null };
mock.module("@/lib/fetch-brain", () => ({
  ...fetchBrain,
  loadParsedBrain: async (slug: string) => brainState.map[slug] ?? null,
  fetchBrain: async (slug: string) => {
    if (slug === "master" && masterState.output) {
      return { output: masterState.output, freshness_token: "SWFL-7421-v9-20260601" };
    }
    if (slug === "cre-swfl" && creState.output) {
      return { output: creState.output, freshness_token: "SWFL-7421-v9-20260601" };
    }
    throw new Error(`unexpected fetchBrain("${slug}") in test`);
  },
}));
function stubBrain(output: Record<string, unknown>) {
  return {
    brain_id: "stub",
    version: 1,
    freshness_token: "SWFL-7421-v9-20260601",
    scope: "",
    refined_at: "2026-06-01",
    raw_md: "",
    output,
  };
}

function dossierWith(lines: LocationDossier["lines"]): LocationDossier {
  return {
    resolved_as: "zip",
    zip: "33913",
    in_scope: true,
    resolution: null,
    lines,
    freshness_tokens: { "housing-swfl": "SWFL-7421-v9-20260601" },
    coverage_caveats: [],
  };
}

const { runConversationPath, PUBLIC_SYSTEM, buildClientContextBlock } =
  await import("./conversation-path");

/** Drive the conversation path with an AssistantRequest (the unified contract). */
function run(req: Partial<AssistantRequest> & { messages: AssistantRequest["messages"] }) {
  const request = new Request("https://x/api/assistant", {
    method: "POST",
    body: JSON.stringify(req),
  });
  return runConversationPath(request, {
    context: req.context ?? "public",
    ...req,
  } as AssistantRequest);
}

const ask = (content: string, context: AssistantRequest["context"] = "public") =>
  run({ context, messages: [{ role: "user", content }] });

test("system prompt forbids inventing a SWFL number and leads with the recurring-email hook", () => {
  const lc = PUBLIC_SYSTEM.toLowerCase();
  expect(lc).toContain("never"); // no-invention guardrail intact
  expect(lc).toContain("auto-email"); // leads with the recurring client-feed hook, not "sign up"
  expect(lc).toContain("client"); // the value is mailing THEIR clients
  expect(lc).not.toContain("freshness_token"); // un-grounded: no payload mechanics leak
});

test("streams the explainer text", async () => {
  const res = await ask("what can you do?");
  expect(res.status).toBe(200);
  const body = await res.text();
  expect(body).toContain("Southwest Florida");
  expect(body).toContain('"done":true');
});

test("400 on empty messages", async () => {
  expect((await run({ context: "public", messages: [] })).status).toBe(400);
});

// --- Cost guards: per-message + aggregate bounds, and the weekly cap -------------

test("400 when a single message exceeds the per-message bound", async () => {
  expect((await ask("x".repeat(4001))).status).toBe(400);
});

test("400 when the model-bound slice exceeds the aggregate bound", async () => {
  // 12 messages (the whole slice), each under the per-message cap, summing > 16000.
  const msgs = Array.from({ length: 12 }, (_, i) => ({
    role: (i % 2 === 0 ? "assistant" : "user") as "assistant" | "user",
    content: "y".repeat(1400),
  }));
  msgs[msgs.length - 1].role = "user"; // last must be user
  expect((await run({ context: "public", messages: msgs })).status).toBe(400);
});

test("over the weekly cap → graceful SSE message, model never streams", async () => {
  const prev = process.env.WELCOME_CHAT_FREE_WEEKLY_CAP;
  process.env.WELCOME_CHAT_FREE_WEEKLY_CAP = "5";
  welcomeState.capEnabled = true;
  welcomeState.weekly = 5;
  welcomeState.clientId = "cid-over";
  try {
    const res = await ask("what can you do?");
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("hit this week's limit");
    expect(body).not.toContain("Southwest Florida"); // model never streamed
  } finally {
    process.env.WELCOME_CHAT_FREE_WEEKLY_CAP = prev;
    welcomeState.capEnabled = false;
    welcomeState.weekly = 0;
    welcomeState.clientId = "cid-1";
  }
});

// --- Grounded path -----------------------------------------------------------

test("an in-scope ZIP grounds Haiku on the real dossier (cited, no-math floor, clean source)", async () => {
  captured.system = undefined;
  guardState.result = {
    capped: false,
    fromCache: false,
    dossier: dossierWith([
      {
        brain_id: "housing-swfl",
        domain: "real-estate",
        grain: "zip",
        coverage_label: "ZIP 33913",
        is_true_zip: true,
        text: "**Median value** — $512,000.\n\nSource: Redfin Data Center weekly metrics",
        source_citation: "Redfin Data Center weekly metrics",
        source_url: "https://www.redfin.com",
      },
    ]),
  };
  const res = await ask("what's the housing read for 33913?");
  const body = await res.text();
  expect(body).toContain(MODEL_SENTINEL); // the model streamed (grounded answer)
  // the dossier + guardrails reached the system prompt
  expect(captured.system).toContain("$512,000");
  expect(captured.system).toContain("Source: redfin.com"); // cleaned, not the verbose citation
  expect(captured.system).toContain("arithmetic"); // no-math floor
  expect(captured.system).toContain("ZIP 33913 ="); // ground truth pinned, ZIP not raw-interpolated
});

test("an out-of-scope ZIP → honest gap, no fetch, no model", async () => {
  const res = await ask("what about 90210?");
  const body = await res.text();
  expect(body).toContain("outside the six Southwest Florida counties");
  expect(body).not.toContain(MODEL_SENTINEL); // model never streamed
});

test("in-scope ZIP with no covering reads → honest no-coverage line, no model", async () => {
  guardState.result = {
    capped: false,
    fromCache: false,
    dossier: { ...dossierWith([]), lines: [] },
  };
  const res = await ask("anything for 33913?");
  const body = await res.text();
  expect(body).toContain("No covering reads");
  expect(body).not.toContain(MODEL_SENTINEL);
});

test("daily ceiling tripped → busy message, no model", async () => {
  guardState.result = { capped: true, fromCache: false };
  const res = await ask("housing in 33913?");
  const body = await res.text();
  expect(body).toContain("paused live reads");
  expect(body).not.toContain(MODEL_SENTINEL);
});

// --- Live {answer} producer on the grounded path (typed SSE frames) -----------

/** Parse the SSE body into typed WelcomeFrames (drops blanks/noise). */
function frames(body: string): WelcomeFrame[] {
  return body
    .split("\n")
    .map((l) => parseSseFrame(l))
    .filter((f): f is WelcomeFrame => f !== null);
}

const HOUSING_STUB = stubBrain({
  detail_tables: [
    {
      id: "housing_by_zip",
      title: "",
      grain: "zip",
      columns: [{ id: "median_sale_price", label: "", display_format: "currency", units: "USD" }],
      rows: [{ key: "33913", label: "33913", cells: { median_sale_price: 512000 } }],
      source: {
        url: "https://www.redfin.com/news/data-center/",
        fetched_at: "2026-06-03T00:00:00Z",
        tier: 1,
        citation: "Redfin Data Center.",
      },
    },
  ],
  key_metrics: [],
});
const RENTALS_STUB = stubBrain({
  detail_tables: [
    {
      id: "rentals_by_zip",
      title: "",
      grain: "zip",
      columns: [
        { id: "rent_index_latest", label: "", display_format: "currency", units: "USD/month" },
      ],
      rows: [{ key: "33913", label: "33913", cells: { rent_index_latest: 2075 } }],
      source: {
        url: "https://files.zillowstatic.com/x.csv",
        fetched_at: "2026-06-12T00:00:00Z",
        tier: 2,
        citation: "Zillow ZORI.",
      },
    },
  ],
  key_metrics: [],
});
const ENV_STUB = stubBrain({
  detail_tables: [],
  key_metrics: [
    {
      metric: "swfl_zip_33931_flood_aal_usd_per_insured_property",
      value: 30074.61,
      direction: "stable",
      label: "",
      variable_type: "intensive",
      units: "USD/year",
      display_format: "currency",
      source: {
        url: "https://www.fema.gov/api/open/v2/FimaNfipClaims",
        fetched_at: "2026-06-12T01:08:17Z",
        tier: 1,
        citation: "OpenFEMA.",
      },
    },
  ],
});

test("grounded ZIP streams typed place + data (cited cards) BEFORE any prose text", async () => {
  brainState.map = { "housing-swfl": HOUSING_STUB, "rentals-swfl": RENTALS_STUB };
  guardState.result = {
    capped: false,
    fromCache: false,
    dossier: dossierWith([
      {
        brain_id: "housing-swfl",
        domain: "real-estate",
        grain: "zip",
        coverage_label: "ZIP 33913",
        is_true_zip: true,
        text: "",
        source_citation: "Redfin Data Center.",
        source_url: "https://www.redfin.com/news/data-center/",
      },
      {
        brain_id: "rentals-swfl",
        domain: "real-estate",
        grain: "zip",
        coverage_label: "ZIP 33913",
        is_true_zip: true,
        text: "",
        source_citation: "Zillow ZORI.",
        source_url: "https://files.zillowstatic.com/x.csv",
      },
    ]),
  };
  const res = await ask("what's the read for 33913?");
  const fs = frames(await res.text());
  const placeIdx = fs.findIndex((f) => f.type === "place");
  const dataIdx = fs.findIndex((f) => f.type === "data");
  const firstText = fs.findIndex((f) => f.type === "text");
  expect(placeIdx).toBeGreaterThanOrEqual(0);
  expect(dataIdx).toBeGreaterThanOrEqual(0);
  expect(firstText).toBeGreaterThanOrEqual(0);
  expect(placeIdx).toBeLessThan(firstText); // place before prose
  expect(dataIdx).toBeLessThan(firstText); // cards before prose
  const data = fs[dataIdx] as Extract<WelcomeFrame, { type: "data" }>;
  expect(data.answer.metrics.length).toBeGreaterThanOrEqual(1);
  for (const m of data.answer.metrics) {
    expect(typeof m.is_true_zip).toBe("boolean");
    expect(m.coverage_label.length).toBeGreaterThan(0); // honest scope, always present
  }
});

test("FLOOD GATE — an explicit ZIP whose env line is coarse emits cards but no flood card", async () => {
  brainState.map = { "housing-swfl": HOUSING_STUB, "env-swfl": ENV_STUB };
  guardState.result = {
    capped: false,
    fromCache: false,
    dossier: dossierWith([
      {
        brain_id: "housing-swfl",
        domain: "real-estate",
        grain: "zip",
        coverage_label: "ZIP 33913",
        is_true_zip: true,
        text: "",
        source_citation: "Redfin Data Center.",
        source_url: "https://www.redfin.com/news/data-center/",
      },
      {
        brain_id: "env-swfl",
        domain: "environment",
        grain: "county",
        coverage_label: "Collier county-wide — covers 33913",
        is_true_zip: false,
        text: "",
        source_citation: "OpenFEMA.",
        source_url: "https://www.fema.gov",
      },
    ]),
  };
  const res = await ask("flood read for 33913?");
  const fs = frames(await res.text());
  const data = fs.find((f) => f.type === "data") as
    | Extract<WelcomeFrame, { type: "data" }>
    | undefined;
  expect(data).toBeDefined();
  expect(data!.answer.metrics.some((m) => m.key === "home_value")).toBe(true);
  expect(data!.answer.metrics.some((m) => m.key === "flood_aal")).toBe(false);
});

// --- Voice split: analyst (context !== public) vs public funnel + summarize ------

// Minimal master read — enough for buildDossier + renderBlock (conclusion is the
// grounding sentinel; refined_at is required by computeMetricChart).
const MASTER_OUTPUT = {
  conclusion: "SWFL is cooling into summer 2026 as inventory builds.",
  direction: "bearish",
  magnitude: 0.42,
  confidence: 0.71,
  refined_at: "2026-06-12",
  key_metrics: [],
  detail_tables: [],
  caveats: [],
};

test("analyst (context=outside), no location → grounds on the master read, not the funnel hook", async () => {
  captured.system = undefined;
  masterState.output = MASTER_OUTPUT;
  const res = await ask("what's the bottom line right now?", "outside");
  const body = await res.text();
  expect(body).toContain(MODEL_SENTINEL); // the model streamed a grounded answer
  expect(captured.system).toContain("cooling into summer 2026"); // grounded on the master read
  expect(captured.system).toContain("market analyst"); // analyst premise, not the funnel bot
  expect(captured.system).not.toContain("auto-email"); // never the recurring-email pitch
  masterState.output = null;
});

test("public (no-auth), on-topic no location → GROUNDS on master, answer-first, login-capture close (not the deflect funnel)", async () => {
  captured.system = undefined;
  masterState.output = MASTER_OUTPUT;
  // public path — a region-wide market question with no ZIP/place.
  const res = await ask("what's driving SWFL prices and rents right now?", "public");
  const body = await res.text();
  expect(body).toContain(MODEL_SENTINEL); // the model streamed a grounded answer
  expect(captured.system).toContain("cooling into summer 2026"); // grounded on the master read
  expect(captured.system).toContain("market analyst"); // grounded public premise, not the deflect bot
  // The public posture: a LIGHT login-capture nudge AFTER the answer, never the in-app
  // "File this answer" affordance and never the pre-answer recurring-email pitch.
  expect(captured.system).toContain("free account"); // login-capture nudge present
  expect(captured.system).not.toContain("File this answer"); // in-app only — never public
  expect(captured.system).not.toContain("auto-email"); // not the pre-answer funnel pitch
  // Answer-first / no-deflect: the grounded public path must NOT demand a ZIP before answering.
  expect(captured.system).toContain("never demand a ZIP");
  // No-invention floor PRESERVED on the grounded public path.
  expect(captured.system!.toLowerCase()).toContain("never invent");
  expect(captured.system).toContain("arithmetic"); // no-math floor rides along
  masterState.output = null;
});

test("public, master unavailable → un-grounded public premise (answer-first, no-invention floor intact, still no deflect-pitch)", async () => {
  captured.system = undefined;
  masterState.output = null; // fetchBrain("master") throws → un-grounded public fallback
  const res = await ask("what's driving SWFL prices and rents right now?", "public");
  await res.text();
  // Graceful floor is the un-grounded PUBLIC_GROUNDED premise — still answer-first, still
  // no-invention, and crucially NOT the pre-answer recurring-email funnel pitch.
  expect(captured.system).toContain("market analyst");
  expect(captured.system).not.toContain("cooling into summer 2026"); // master never loaded
  expect(captured.system).not.toContain("auto-email"); // not the deflect funnel pitch
  expect(captured.system!.toLowerCase()).toContain("never invent"); // no-invention floor intact
});

test("public, OFF-TOPIC no location → un-grounded funnel explainer, master never touched, no SWFL prelude", async () => {
  captured.system = undefined;
  masterState.output = MASTER_OUTPUT; // present, but an off-topic ask must NOT ground on it
  // off-domain (food) + a SWFL place name → the off-topic gate fires (RULES OF ENGAGEMENT 7).
  const res = await ask("best Arby's near Cleveland Ave in Fort Myers?", "public");
  const body = await res.text();
  expect(captured.system).toContain("auto-email"); // off-topic public stays the funnel explainer
  expect(captured.system).not.toContain("cooling into summer 2026"); // master NOT fetched off-topic
  // no place/data prelude on an off-topic ask
  expect(frames(body).some((f) => f.type === "place")).toBe(false);
  masterState.output = null;
});

// cre-swfl read carrying the per-corridor vacancy detail_table.
const CRE_OUTPUT = {
  conclusion: "SWFL commercial corridors are holding steady into summer 2026.",
  direction: "neutral",
  magnitude: 0.3,
  confidence: 0.7,
  refined_at: "2026-06-12",
  key_metrics: [],
  detail_tables: [
    {
      id: "corridor_vacancy",
      title: "SWFL CRE corridor vacancy rate",
      grain: "corridor",
      columns: [
        { id: "vacancy_rate_pct", label: "Vacancy", display_format: "percent", units: "%" },
      ],
      rows: [
        { key: "Pine Ridge Rd Naples", label: "Pine Ridge Rd", cells: { vacancy_rate_pct: 3.2 } },
        {
          key: "Lee Blvd Lehigh Acres",
          label: "Lee Blvd",
          cells: {
            vacancy_rate_pct: 0.2,
            coverage_note:
              "From the MarketBeat submarket survey — incomplete corridor-level coverage.",
          },
        },
      ],
      source: {
        url: "https://x.supabase.co/rest/v1/corridor_profiles?select=corridor_name,vacancy_rate_pct",
        fetched_at: "2026-06-15T00:00:00Z",
        tier: 2,
        citation:
          "Brains Supabase corridor_profiles (verified, non-deleted) — vacancy_rate_pct per corridor.",
      },
    },
  ],
  caveats: [],
};

test("analyst CRE-vacancy question → grounds on cre-swfl per-corridor detail, not just master's median", async () => {
  captured.system = undefined;
  masterState.output = MASTER_OUTPUT;
  creState.output = CRE_OUTPUT;
  const res = await ask("commercial real estate vacancy by corridor", "outside");
  const body = await res.text();
  expect(body).toContain(MODEL_SENTINEL); // grounded answer streamed
  // per-corridor grain reached the system prompt (the table + a corridor name)
  expect(captured.system).toContain("SWFL CRE corridor vacancy rate");
  expect(captured.system).toContain("Pine Ridge Rd");
  // the at-grain coverage flag rode along for the prose to surface
  expect(captured.system).toContain("MarketBeat submarket survey");
  // master is still present for the region-wide bottom line
  expect(captured.system).toContain("cooling into summer 2026");
  masterState.output = null;
  creState.output = null;
});

test("analyst NON-corridor question → does NOT pull cre-swfl (master-only grounding)", async () => {
  captured.system = undefined;
  masterState.output = MASTER_OUTPUT;
  creState.output = CRE_OUTPUT; // present, but the intent must NOT route to CRE
  const res = await ask("what's the bottom line right now?", "outside");
  await res.text();
  expect(captured.system).toContain("cooling into summer 2026"); // master grounding
  expect(captured.system).not.toContain("SWFL CRE corridor vacancy rate"); // cre-swfl NOT pulled
  masterState.output = null;
  creState.output = null;
});

test("summarize action → synthesis prompt over the thread, dedups against filed Q&A", async () => {
  captured.system = undefined;
  const res = await run({
    context: "outside",
    action: "summarize",
    alreadyFiled: [{ question: "flood read for 33931?", answer: "AAL is $30,074/yr." }],
    messages: [
      { role: "user", content: "flood read for 33931?" },
      { role: "assistant", content: "AAL is $30,074/yr for ZIP 33931 [OpenFEMA]." },
      {
        role: "user",
        content: "Summarize the important findings from this conversation so far.",
      },
    ],
  });
  const body = await res.text();
  expect(body).toContain(MODEL_SENTINEL); // the model streamed the summary
  expect(captured.system).toContain("summarizing"); // the summarize premise
  expect(captured.system).toContain("flood read for 33931?"); // filed question in the dedup list
  expect(captured.system).not.toContain("auto-email");
});

// --- Client context injection: page + briefcase, on every page ----------------

test("buildClientContextBlock folds page + briefcase into a data-framed block", () => {
  const block = buildClientContextBlock(
    "the Market Trends charts page (home values, rents)",
    "[metric] Median rent: $1,750",
  );
  expect(block).toContain("Market Trends charts page");
  expect(block).toContain("Median rent: $1,750");
  expect(block.toLowerCase()).toContain("not instructions"); // framed as data, never commands
});

test("buildClientContextBlock returns empty when there's no context", () => {
  expect(buildClientContextBlock(undefined, undefined)).toBe("");
  expect(buildClientContextBlock("", "  ")).toBe("");
});

test("buildClientContextBlock bounds an over-long page context", () => {
  const block = buildClientContextBlock("Z".repeat(5000), undefined);
  expect(block).not.toContain("Z".repeat(700)); // truncated well under the raw length
});

test("the chat folds page + briefcase context into the system prompt", async () => {
  captured.system = undefined;
  const res = await run({
    context: "public",
    messages: [{ role: "user", content: "what's driving this?" }],
    pageContext: "the Market Trends charts page (home values, rents)",
    briefcase: "[metric] Median rent: $1,750",
  });
  await res.text();
  expect(captured.system).toContain("Market Trends charts page");
  expect(captured.system).toContain("Median rent: $1,750");
  expect(captured.system).toContain("WHERE THE USER IS");
});

test("chat with no page/briefcase context injects no context block", async () => {
  captured.system = undefined;
  await (await ask("what can you do?")).text();
  expect(captured.system ?? "").not.toContain("WHERE THE USER IS");
});

// --- Fact injection: the highlighted figure must reach the model on ALL paths ------
// This is the root of the "$340K / 356 — I don't see a number" regression.
// The conversation path received req.fact but never injected it into the user
// message, so the model always answered "I don't see a specific number".
// Every path below must surface "About this fact" in the final user turn.

test("FACT INJECTION — off-topic path: fact prepended to user message", async () => {
  captured.messages = undefined;
  masterState.output = MASTER_OUTPUT;
  const res = await run({
    context: "outside",
    fact: "$340K",
    selection_type: "metric",
    messages: [{ role: "user", content: "What does this number tell me?" }],
  });
  await res.text();
  const lastContent = captured.messages?.[captured.messages.length - 1]?.content ?? "";
  expect(lastContent).toContain('About this fact (a metric): "$340K"');
  expect(lastContent).toContain("What does this number tell me?");
  masterState.output = null;
});

test("FACT INJECTION — no-location grounded path: fact prepended to user message", async () => {
  captured.messages = undefined;
  masterState.output = MASTER_OUTPUT;
  const res = await run({
    context: "outside",
    fact: "356",
    selection_type: "metric",
    messages: [{ role: "user", content: "What does this number tell me?" }],
  });
  await res.text();
  const lastContent = captured.messages?.[captured.messages.length - 1]?.content ?? "";
  expect(lastContent).toContain('About this fact (a metric): "356"');
  expect(lastContent).toContain("What does this number tell me?");
  masterState.output = null;
});

test("FACT INJECTION — located ZIP path: fact prepended to user message", async () => {
  captured.messages = undefined;
  guardState.result = {
    capped: false,
    fromCache: false,
    dossier: dossierWith([
      {
        brain_id: "housing-swfl",
        domain: "real-estate",
        grain: "zip",
        coverage_label: "ZIP 33920",
        is_true_zip: true,
        text: "**Median value** — $340,000.",
        source_citation: "Zillow ZHVI",
        source_url: "https://www.zillow.com",
      },
    ]),
  };
  const res = await run({
    context: "outside",
    fact: "$340K",
    selection_type: "metric",
    messages: [{ role: "user", content: "What does this median value tell me about 33920?" }],
  });
  await res.text();
  const lastContent = captured.messages?.[captured.messages.length - 1]?.content ?? "";
  expect(lastContent).toContain('About this fact (a metric): "$340K"');
  expect(lastContent).toContain("What does this median value tell me about 33920?");
});

test("FACT INJECTION — no fact in request: user message is unchanged", async () => {
  captured.messages = undefined;
  masterState.output = MASTER_OUTPUT;
  const res = await run({
    context: "outside",
    messages: [{ role: "user", content: "What is the bottom line?" }],
  });
  await res.text();
  const lastContent = captured.messages?.[captured.messages.length - 1]?.content ?? "";
  expect(lastContent).toBe("What is the bottom line?");
  expect(lastContent).not.toContain("About this fact");
  masterState.output = null;
});

test("FACT INJECTION — selection_type absent: typeHint omitted from prefix", async () => {
  captured.messages = undefined;
  masterState.output = MASTER_OUTPUT;
  const res = await run({
    context: "outside",
    fact: "82",
    messages: [{ role: "user", content: "What does this tell me?" }],
  });
  await res.text();
  const lastContent = captured.messages?.[captured.messages.length - 1]?.content ?? "";
  // No type hint when selection_type is absent
  expect(lastContent).toContain('About this fact: "82"');
  expect(lastContent).not.toContain("About this fact (");
  masterState.output = null;
});
