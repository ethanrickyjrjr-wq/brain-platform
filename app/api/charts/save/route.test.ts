import { test, expect, mock } from "bun:test";

const validBlock = {
  title: "Asking Rent — Fort Myers",
  columns: ["Period", "Rent"],
  rows: [
    ["2024-Q1", 1850],
    ["2024-Q2", 1920],
  ],
  chart_type: "area",
};

mock.module("@/utils/supabase/service-role", () => ({
  createServiceRoleClient: () => ({
    from: () => ({
      insert: async () => ({ error: null }),
    }),
  }),
}));

mock.module("@/lib/highlighter/meter", () => ({
  recordUse: async () => 1,
}));

const { POST } = await import("./route");

function makeReq(body: unknown) {
  return new Request("http://localhost/api/charts/save", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as import("next/server").NextRequest;
}

test("missing block → 400", async () => {
  const res = await POST(makeReq({}));
  expect(res.status).toBe(400);
});

test("malformed block (no title) → 422", async () => {
  const res = await POST(makeReq({ block: { columns: ["X"], rows: [] } }));
  expect(res.status).toBe(422);
  const json = await res.json();
  expect(json.detail.length).toBeGreaterThan(0);
});

test("valid block → 200 with id of length 8", async () => {
  const res = await POST(makeReq({ block: validBlock }));
  expect(res.status).toBe(200);
  const json = await res.json();
  expect(typeof json.id).toBe("string");
  expect(json.id).toHaveLength(8);
});
