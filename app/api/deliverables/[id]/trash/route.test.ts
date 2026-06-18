import { test, expect, mock, beforeEach } from "bun:test";

const scenario: {
  user: { id: string } | null;
  deliverable: { user_id: string } | null;
  updateError: unknown;
  lastUpdate: Record<string, unknown> | null;
} = {
  user: { id: "user-a" },
  deliverable: { user_id: "user-a" },
  updateError: null,
  lastUpdate: null,
};

mock.module("@/utils/supabase/server", () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: scenario.user } }) },
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: scenario.deliverable }) }) }),
    }),
  }),
}));
mock.module("@/utils/supabase/service-role", () => ({
  createServiceRoleClient: () => ({
    from: () => ({
      update: (patch: Record<string, unknown>) => {
        scenario.lastUpdate = patch;
        return { eq: async () => ({ error: scenario.updateError }) };
      },
    }),
  }),
}));
mock.module("next/headers", () => ({ cookies: async () => ({}) }));

const { POST } = await import("./route");

function makeReq(body: unknown) {
  return new Request("http://localhost/api/deliverables/d1/trash", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as import("next/server").NextRequest;
}
const params = Promise.resolve({ id: "d1" });

beforeEach(() => {
  scenario.user = { id: "user-a" };
  scenario.deliverable = { user_id: "user-a" };
  scenario.updateError = null;
  scenario.lastUpdate = null;
});

test("unauthenticated → 401", async () => {
  scenario.user = null;
  expect((await POST(makeReq({}), { params })).status).toBe(401);
});

test("not found → 404", async () => {
  scenario.deliverable = null;
  expect((await POST(makeReq({}), { params })).status).toBe(404);
});

test("not owner → 403", async () => {
  scenario.deliverable = { user_id: "someone-else" };
  expect((await POST(makeReq({}), { params })).status).toBe(403);
});

test("trash sets deleted_at to a timestamp string", async () => {
  const res = await POST(makeReq({}), { params });
  expect(res.status).toBe(200);
  expect(typeof (await res.json()).deleted_at).toBe("string");
  expect(typeof scenario.lastUpdate?.deleted_at).toBe("string");
});

test("restore clears deleted_at to null", async () => {
  const res = await POST(makeReq({ restore: true }), { params });
  expect(res.status).toBe(200);
  expect((await res.json()).deleted_at).toBeNull();
  expect(scenario.lastUpdate).toEqual({ deleted_at: null });
});

test("update failure → 500", async () => {
  scenario.updateError = { message: "boom" };
  expect((await POST(makeReq({}), { params })).status).toBe(500);
});
