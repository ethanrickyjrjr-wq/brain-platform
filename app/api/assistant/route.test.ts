import { test, expect } from "bun:test";

// Mock-free dispatch + contract smoke test for the unified endpoint. Each case is a
// pre-model validation 400, so no SDK/brain/meter mocks are needed — what's proven is
// that /api/assistant parses the AssistantRequest and dispatches by report_id:
//   report_id present  → report path  → "question required"
//   report_id absent   → conversation path → "messages required"
// Full behavior is covered by the path modules' own oracle tests (the legacy route tests).
const { POST } = await import("./route");

const post = (body: unknown) =>
  POST(new Request("https://x/api/assistant", { method: "POST", body: JSON.stringify(body) }));

test("400 on bad json", async () => {
  const res = await POST(
    new Request("https://x/api/assistant", { method: "POST", body: "{not json" }),
  );
  expect(res.status).toBe(400);
});

test("report_id present → dispatches to the report path (question required)", async () => {
  const res = await post({ report_id: "master", messages: [] });
  expect(res.status).toBe(400);
  expect((await res.json()).error).toContain("question required");
});

test("no report_id → dispatches to the conversation path (messages required)", async () => {
  const res = await post({ context: "outside", messages: [] });
  expect(res.status).toBe(400);
  expect((await res.json()).error).toContain("messages required");
});

test("report path enforces the question length cap through the unified endpoint", async () => {
  const res = await post({
    report_id: "master",
    messages: [{ role: "user", content: "q".repeat(2001) }],
  });
  expect(res.status).toBe(400);
  expect((await res.json()).error).toContain("too long");
});
