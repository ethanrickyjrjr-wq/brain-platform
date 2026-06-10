import { test, expect, mock, beforeEach } from "bun:test";

const scenario: { user: { id: string } | null } = { user: { id: "user-a" } };

mock.module("@/utils/supabase/server", () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: scenario.user } }) },
    from: () => ({ insert: async () => ({ error: null }) }),
  }),
}));
mock.module("next/headers", () => ({ cookies: async () => ({}) }));
mock.module("@/lib/highlighter/meter", () => ({ recordUse: async () => 1 }));

const { POST } = await import("./route");

function makeReq(body: unknown) {
  return new Request("http://localhost/api/projects/import", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as import("next/server").NextRequest;
}

const validItem = {
  id: "i1",
  added_at: "2026-06-10T00:00:00Z",
  origin: "web",
  kind: "note",
  text: "hello",
};

beforeEach(() => {
  scenario.user = { id: "user-a" };
});

test("unauthenticated import → 401", async () => {
  scenario.user = null;
  const res = await POST(makeReq({ items: [validItem] }));
  expect(res.status).toBe(401);
});

test("empty draft → 400 (nothing to import)", async () => {
  const res = await POST(makeReq({ items: [] }));
  expect(res.status).toBe(400);
});

test("valid draft → 200, 12-char id", async () => {
  const res = await POST(makeReq({ items: [validItem] }));
  expect(res.status).toBe(200);
  expect((await res.json()).id).toHaveLength(12);
});
