import { test, expect, mock, beforeEach } from "bun:test";

const scenario: {
  user: { id: string } | null;
  profile: Record<string, unknown> | null;
  upsertError: { message: string } | null;
  updateError: { message: string } | null;
  lastUpsert: Record<string, unknown> | null;
  lastUpdate: Record<string, unknown> | null;
} = {
  user: { id: "user-a" },
  profile: null,
  upsertError: null,
  updateError: null,
  lastUpsert: null,
  lastUpdate: null,
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
      upsert: async (payload: Record<string, unknown>) => {
        scenario.lastUpsert = payload;
        return { error: scenario.upsertError };
      },
      update: (payload: Record<string, unknown>) => {
        scenario.lastUpdate = payload;
        return { eq: async () => ({ error: scenario.updateError }) };
      },
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
  scenario.updateError = null;
  scenario.lastUpsert = null;
  scenario.lastUpdate = null;
});

// --- GET ---

test("GET unauthenticated → 401", async () => {
  scenario.user = null;
  const res = await GET(req("GET"));
  expect(res.status).toBe(401);
});

test("GET no profile → 200 empty palette library", async () => {
  scenario.profile = null;
  const res = await GET(req("GET"));
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ color_palettes: [] });
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

test("GET sanitizes stored palettes (drops junk, normalizes hex)", async () => {
  scenario.profile = {
    color_palettes: [
      { id: "p1", name: "Gulf", colors: ["#00d4aa", "abc", ""] },
      { colors: [] }, // dropped
    ],
  };
  const res = await GET(req("GET"));
  const body = await res.json();
  expect(body.color_palettes).toHaveLength(1);
  expect(body.color_palettes[0]).toMatchObject({
    name: "Gulf",
    colors: ["#00d4aa", "#aabbcc", "", ""],
  });
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

test("PATCH persists color fields onto the profile", async () => {
  const res = await PATCH(req("PATCH", { primary_color: "#00d4aa", accent_color: "  " }));
  expect(res.status).toBe(200);
  expect(scenario.lastUpsert?.primary_color).toBe("#00d4aa");
  expect(scenario.lastUpsert?.accent_color).toBeNull(); // blank → null
});

test("PATCH writes a sanitized palette library", async () => {
  const res = await PATCH(
    req("PATCH", {
      color_palettes: [
        { name: "Gulf", colors: ["#00D4AA", "#000000", ""] },
        { colors: ["#00d4aa", "#000000", ""] }, // dup → deduped
      ],
    }),
  );
  expect(res.status).toBe(200);
  expect(scenario.lastUpdate?.color_palettes).toHaveLength(1);
});

test("PATCH DB error → 500", async () => {
  scenario.upsertError = { message: "db fail" };
  const res = await PATCH(req("PATCH", { agent_name: "Jane" }));
  expect(res.status).toBe(500);
});

test("PATCH tolerates a missing color_palettes column (no 500)", async () => {
  scenario.updateError = { message: "column does not exist" };
  const res = await PATCH(req("PATCH", { agent_name: "Jane", color_palettes: [] }));
  expect(res.status).toBe(200); // palette write skipped, agent save still succeeds
});

test("PATCH ignores unknown keys (only known fields written)", async () => {
  const res = await PATCH(req("PATCH", { agent_name: "Jane", hacker_field: "evil" }));
  expect(res.status).toBe(200);
  expect(scenario.lastUpsert).not.toHaveProperty("hacker_field");
});
