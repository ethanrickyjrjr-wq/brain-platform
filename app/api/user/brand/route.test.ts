import { test, expect, mock, beforeEach } from "bun:test";

const scenario: {
  user: { id: string } | null;
  profile: Record<string, unknown> | null;
  upsertError: { message: string } | null;
} = {
  user: { id: "user-a" },
  profile: null,
  upsertError: null,
};

mock.module("@/utils/supabase/server", () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: scenario.user } }) },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: scenario.profile, error: null }),
        }),
      }),
      upsert: async () => ({ error: scenario.upsertError }),
    }),
  }),
}));
mock.module("next/headers", () => ({ cookies: async () => ({}) }));

const { GET, PATCH } = await import("./route");

function req(method: string, body?: unknown) {
  return new Request("http://localhost/api/user/brand", {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as import("next/server").NextRequest;
}

beforeEach(() => {
  scenario.user = { id: "user-a" };
  scenario.profile = null;
  scenario.upsertError = null;
});

// --- GET ---

test("GET unauthenticated → 401", async () => {
  scenario.user = null;
  const res = await GET(req("GET"));
  expect(res.status).toBe(401);
});

test("GET no profile → 200 empty object", async () => {
  scenario.profile = null;
  const res = await GET(req("GET"));
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({});
});

test("GET with profile → 200 returns selected fields", async () => {
  scenario.profile = {
    agent_name: "Jane Smith",
    photo_url: null,
    license: "SL3456789",
    brokerage: "Gulf Realty",
    primary_color: "#00d4aa",
    accent_color: null,
    logo_url: null,
  };
  const res = await GET(req("GET"));
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.agent_name).toBe("Jane Smith");
  expect(body.license).toBe("SL3456789");
  expect(body.brokerage).toBe("Gulf Realty");
  expect(body.primary_color).toBe("#00d4aa");
});

// --- PATCH ---

test("PATCH unauthenticated → 401", async () => {
  scenario.user = null;
  const res = await PATCH(req("PATCH", { agent_name: "Jane" }));
  expect(res.status).toBe(401);
});

test("PATCH non-object body → 400", async () => {
  const res = await PATCH(req("PATCH", "bad"));
  expect(res.status).toBe(400);
});

test("PATCH valid agent fields → 200", async () => {
  const res = await PATCH(
    req("PATCH", { agent_name: "Jane Smith", license: "SL3456789", brokerage: "Gulf Realty" }),
  );
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true });
});

test("PATCH DB error → 500", async () => {
  scenario.upsertError = { message: "db fail" };
  const res = await PATCH(req("PATCH", { agent_name: "Jane" }));
  expect(res.status).toBe(500);
});

test("PATCH ignores unknown keys (only agent fields written)", async () => {
  // Should not throw even if extra keys are passed
  const res = await PATCH(req("PATCH", { agent_name: "Jane", hacker_field: "evil" }));
  expect(res.status).toBe(200);
});
