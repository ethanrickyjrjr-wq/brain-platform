import { test, expect, mock } from "bun:test";

mock.module("@/refinery/agents/anthropic.mts", () => ({
  TRIAGE_MODEL: "claude-haiku-4-5",
  getAnthropic: () => ({
    messages: {
      stream: () => ({
        async *[Symbol.asyncIterator]() {},
        textStream: (async function* () {
          yield "We track flood risk, permits, ";
          yield "and prices across Southwest Florida.";
        })(),
      }),
    },
  }),
}));
mock.module("@/lib/welcome/chat-usage", () => ({ recordWelcomeChat: async () => {} }));

const { POST, WELCOME_SYSTEM, buildPlaceContext } = await import("./route");

test("system prompt forbids inventing a SWFL number and steers to sign-up", () => {
  const lc = WELCOME_SYSTEM.toLowerCase();
  expect(lc).toContain("never");
  expect(lc).toContain("sign up");
  expect(lc).not.toContain("freshness_token"); // un-grounded: no payload mechanics leak
});

test("streams the explainer text", async () => {
  const req = new Request("https://x/api/welcome/chat", {
    method: "POST",
    body: JSON.stringify({ messages: [{ role: "user", content: "what can you do?" }] }),
  });
  const res = await POST(req);
  expect(res.status).toBe(200);
  const body = await res.text();
  expect(body).toContain("Southwest Florida");
  expect(body).toContain('"done":true');
});

test("400 on empty/non-user-last messages", async () => {
  const req = new Request("https://x/api/welcome/chat", {
    method: "POST",
    body: JSON.stringify({ messages: [] }),
  });
  expect((await POST(req)).status).toBe(400);
});

test("400 on bad json", async () => {
  const req = new Request("https://x/api/welcome/chat", { method: "POST", body: "{not json" });
  expect((await POST(req)).status).toBe(400);
});

test("injects deterministic ZIP->place ground truth from the crosswalk, SWFL only", () => {
  // 33931 = Fort Myers Beach, NOT Lehigh Acres — the exact gloss the un-grounded model botched.
  const fmb = buildPlaceContext("is 33931 a good buy?");
  expect(fmb).toContain("Fort Myers Beach");
  expect(fmb).not.toContain("Lehigh");

  // The neighboring Lehigh code resolves to the right town.
  expect(buildPlaceContext("what about 33936?")).toContain("Lehigh Acres");

  // A non-SWFL ZIP injects nothing — un-grounded stays un-grounded, no fabricated identity.
  expect(buildPlaceContext("tell me about 90210")).toBe("");
});
