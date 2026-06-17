import { test, expect, mock, beforeEach } from "bun:test";

const scenario: {
  user: { id: string } | null;
  rows: { id: string; title: string | null; items: unknown[] }[];
  insertError: unknown;
} = { user: { id: "user-a" }, rows: [], insertError: null };

mock.module("@/utils/supabase/server", () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: scenario.user } }) },
    from: () => ({
      select: async () => ({ data: scenario.rows }),
      insert: async () => ({ error: scenario.insertError }),
    }),
  }),
}));
mock.module("next/headers", () => ({ cookies: async () => ({}) }));
mock.module("@/lib/highlighter/meter", () => ({ recordUse: async () => 1 }));
mock.module("@/lib/project/apply-brand", () => ({ applyUserBrandToProject: async () => {} }));

const { POST } = await import("./route");

function makeReq(body: unknown) {
  return new Request("http://localhost/api/projects/assemble", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as import("next/server").NextRequest;
}

const floodMetric = (zip: string) => ({
  id: `m-${zip}`,
  added_at: "2026-06-10T00:00:00Z",
  origin: "web",
  kind: "metric",
  report_id: zip,
  label: "Annual flood loss",
  value: "$1",
  freshness_token: "SWFL-7421-v5-20260610",
});

beforeEach(() => {
  scenario.user = { id: "user-a" };
  scenario.rows = [];
  scenario.insertError = null;
});

test("unauthenticated → 401", async () => {
  scenario.user = null;
  expect((await POST(makeReq({ command: "build a project for 33931" }))).status).toBe(401);
});

test("blank command → 400", async () => {
  expect((await POST(makeReq({ command: "   " }))).status).toBe(400);
});

test("no place/ZIP anchor → 400 (asks for a place)", async () => {
  const res = await POST(makeReq({ command: "build me something useful" }));
  expect(res.status).toBe(400);
  expect((await res.json()).error).toMatch(/ZIP or place/i);
});

test("scope-matched command → 200 with matched items + provenance", async () => {
  scenario.rows = [{ id: "luxury", title: "Luxury 33931", items: [floodMetric("33931")] }];
  const res = await POST(makeReq({ command: "build a project for 33931, pull from my projects" }));
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.id).toHaveLength(12);
  expect(body.itemCount).toBe(1);
  expect(body.sourceProjectIds).toEqual(["luxury"]);
});

test("scope present but no scope-matching projects → 200, empty project to start fresh", async () => {
  scenario.rows = [{ id: "naples", title: "Naples", items: [floodMetric("34104")] }];
  const res = await POST(makeReq({ command: "build a project for 33931" }));
  expect(res.status).toBe(200);
  expect((await res.json()).itemCount).toBe(0);
});

test("insert failure → 500", async () => {
  scenario.insertError = { message: "boom" };
  const res = await POST(makeReq({ command: "build a project for 33931" }));
  expect(res.status).toBe(500);
});
