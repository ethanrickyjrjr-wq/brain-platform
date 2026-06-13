import { test, expect, mock, beforeEach } from "bun:test";

// Mutable scenario the mocked cookie client reads — lets each test vary auth/db.
const scenario: { user: { id: string } | null; insertError: unknown } = {
  user: { id: "user-a" },
  insertError: null,
};

mock.module("@/utils/supabase/server", () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: scenario.user } }) },
    // Chainable stub: project insert (.insert) PLUS the brand lookup that runs after
    // insert — resolveUserBrand() does .from("user_brand_profiles").select(...).eq(...)
    // .single(). { data: null } = "no brand on file", so the route's update branch is
    // skipped. Without .select this threw "supabase.from(...).select is not a function".
    from: () => {
      const chain = {
        insert: async () => ({ error: scenario.insertError }),
        select: () => chain,
        eq: () => chain,
        update: () => chain,
        single: async () => ({ data: null }),
      };
      return chain;
    },
  }),
}));
mock.module("next/headers", () => ({ cookies: async () => ({}) }));
mock.module("@/lib/highlighter/meter", () => ({ recordUse: async () => 1 }));

const { POST } = await import("./route");

function makeReq(body: unknown) {
  return new Request("http://localhost/api/projects", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as import("next/server").NextRequest;
}

beforeEach(() => {
  scenario.user = { id: "user-a" };
  scenario.insertError = null;
});

test("unauthenticated POST → 401", async () => {
  scenario.user = null;
  const res = await POST(makeReq({ title: "x" }));
  expect(res.status).toBe(401);
});

test("authed POST with no items → 200, 12-char id", async () => {
  const res = await POST(makeReq({ title: "My deck" }));
  expect(res.status).toBe(200);
  const json = await res.json();
  expect(json.id).toHaveLength(12);
});

test("invalid items payload → 422 (zod)", async () => {
  const res = await POST(makeReq({ items: [{ kind: "bogus" }] }));
  expect(res.status).toBe(422);
});
