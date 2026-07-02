import { test, expect, mock, beforeEach } from "bun:test";

// RLS makes a non-owned row invisible → maybeSingle() returns null data. The
// scenario.row=null case simulates "GET/PATCH someone else's project".
const scenario: {
  user: { id: string } | null;
  row: { id: string } | null;
  /** Last UPDATE payload sent to the projects table (wave 1.5: property_url asserts). */
  captured: Record<string, unknown> | null;
} = {
  user: { id: "user-a" },
  row: { id: "proj-1" },
  captured: null,
};

mock.module("@/utils/supabase/server", () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: scenario.user } }) },
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: scenario.row, error: null }) }),
      }),
      update: (row: Record<string, unknown>) => {
        scenario.captured = row;
        return {
          eq: () => ({
            select: () => ({ maybeSingle: async () => ({ data: scenario.row, error: null }) }),
          }),
        };
      },
      delete: () => ({ eq: async () => ({ error: null }) }),
      // fire-and-forget logActivity() inserts a project_activity row on every
      // PATCH that changes name/branding/scope; stub it so the caught insert
      // doesn't log a TypeError (it never affects assertions — logActivity swallows errors).
      insert: async () => ({ error: null }),
    }),
  }),
}));
mock.module("next/headers", () => ({ cookies: async () => ({}) }));

const { GET, PATCH, DELETE } = await import("./route");

const params = Promise.resolve({ id: "proj-1" });
function req(method: string, body?: unknown) {
  return new Request("http://localhost/api/projects/proj-1", {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as import("next/server").NextRequest;
}

beforeEach(() => {
  scenario.user = { id: "user-a" };
  scenario.row = { id: "proj-1" };
  scenario.captured = null;
});

test("GET unauthenticated → 401", async () => {
  scenario.user = null;
  const res = await GET(req("GET"), { params });
  expect(res.status).toBe(401);
});

test("GET another user's project → 404 (RLS invisible)", async () => {
  scenario.row = null; // RLS returns no row
  const res = await GET(req("GET"), { params });
  expect(res.status).toBe(404);
});

test("GET owned project → 200", async () => {
  const res = await GET(req("GET"), { params });
  expect(res.status).toBe(200);
});

test("PATCH invalid items → 422", async () => {
  const res = await PATCH(req("PATCH", { items: [{ kind: "bogus" }] }), { params });
  expect(res.status).toBe(422);
});

test("PATCH valid items on owned row → ok", async () => {
  const res = await PATCH(req("PATCH", { items: [], title: "renamed" }), { params });
  expect(res.status).toBe(200);
  expect((await res.json()).ok).toBe(true);
});

test("PATCH non-owned row → 404", async () => {
  scenario.row = null;
  const res = await PATCH(req("PATCH", { title: "x" }), { params });
  expect(res.status).toBe(404);
});

test("DELETE owned row → ok", async () => {
  const res = await DELETE(req("DELETE"), { params });
  expect(res.status).toBe(200);
});

// ── wave 1.5: property_url (head of the artifact link chain) ─────────────────

test("PATCH valid property_url is saved trimmed", async () => {
  const res = await PATCH(req("PATCH", { property_url: "  https://myagentsite.com/homes/465  " }), {
    params,
  });
  expect(res.status).toBe(200);
  expect(scenario.captured?.property_url).toBe("https://myagentsite.com/homes/465");
});

test("PATCH empty-string property_url clears to null", async () => {
  const res = await PATCH(req("PATCH", { property_url: "" }), { params });
  expect(res.status).toBe(200);
  expect(scenario.captured?.property_url).toBeNull();
});

test("PATCH explicit null property_url clears to null", async () => {
  const res = await PATCH(req("PATCH", { property_url: null }), { params });
  expect(res.status).toBe(200);
  expect(scenario.captured?.property_url).toBeNull();
});

test("PATCH non-http(s) property_url → 422, nothing written", async () => {
  const res = await PATCH(req("PATCH", { property_url: "javascript:alert(1)" }), { params });
  expect(res.status).toBe(422);
  expect(scenario.captured).toBeNull();
});

test("PATCH without property_url leaves the column untouched", async () => {
  const res = await PATCH(req("PATCH", { title: "renamed" }), { params });
  expect(res.status).toBe(200);
  expect(scenario.captured && "property_url" in scenario.captured).toBe(false);
});
