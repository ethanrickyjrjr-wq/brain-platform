import { test, expect, mock, beforeEach } from "bun:test";

interface Scenario {
  user: { id: string } | null;
  deliverable: Record<string, unknown> | null;
  project: { items: unknown } | null;
  updateError: unknown;
  lastUpdate: Record<string, unknown> | null;
  assembleResult: { id: string };
  assembleThrows: unknown;
  lastAssembleOpts: Record<string, unknown> | null;
}
const scenario: Scenario = {
  user: null,
  deliverable: null,
  project: null,
  updateError: null,
  lastUpdate: null,
  assembleResult: { id: "new-slug" },
  assembleThrows: null,
  lastAssembleOpts: null,
};

mock.module("@/utils/supabase/server", () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: scenario.user } }) },
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: table === "deliverables" ? scenario.deliverable : scenario.project,
          }),
        }),
      }),
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
mock.module("@/lib/deliverable/assemble", () => ({
  assembleDeliverable: async (opts: Record<string, unknown>) => {
    scenario.lastAssembleOpts = opts;
    if (scenario.assembleThrows) throw scenario.assembleThrows;
    return scenario.assembleResult;
  },
  isTemplateId: (t: unknown) =>
    ["market-overview", "bov-lite", "client-email", "one-pager", "email"].includes(t as string),
  DeliverableError: class DeliverableError extends Error {
    status: number;
    constructor(m: string, s: number) {
      super(m);
      this.status = s;
      this.name = "DeliverableError";
    }
  },
}));

const { POST } = await import("./route");

const makeReq = (body: unknown) =>
  new Request("http://localhost/api/deliverables/d1/edit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as import("next/server").NextRequest;
const params = Promise.resolve({ id: "d1" });

const baseDeliverable = {
  user_id: "user-a",
  project_id: "proj-1",
  template: "market-overview",
  instruction: "summary",
  branding: { name: "Acme" },
  items_snapshot: [{ id: "i1" }],
  scope_kind: null,
  scope_value: null,
  deleted_at: null,
};

beforeEach(() => {
  scenario.user = { id: "user-a" };
  scenario.deliverable = { ...baseDeliverable };
  scenario.project = { items: [] };
  scenario.updateError = null;
  scenario.lastUpdate = null;
  scenario.assembleResult = { id: "new-slug" };
  scenario.assembleThrows = null;
  scenario.lastAssembleOpts = null;
});

test("unauthenticated → 401", async () => {
  scenario.user = null;
  expect((await POST(makeReq({ template: "one-pager" }), { params })).status).toBe(401);
});

test("not found → 404", async () => {
  scenario.deliverable = null;
  expect((await POST(makeReq({ template: "one-pager" }), { params })).status).toBe(404);
});

test("not owner → 403", async () => {
  scenario.deliverable = { ...baseDeliverable, user_id: "other" };
  expect((await POST(makeReq({ template: "one-pager" }), { params })).status).toBe(403);
});

test("trashed source → 409", async () => {
  scenario.deliverable = { ...baseDeliverable, deleted_at: "2026-06-17T00:00:00Z" };
  expect((await POST(makeReq({ template: "one-pager" }), { params })).status).toBe(409);
});

test("empty body → 400 (nothing to edit)", async () => {
  expect((await POST(makeReq({}), { params })).status).toBe(400);
});

test("invalid template → 400", async () => {
  expect((await POST(makeReq({ template: "bogus" }), { params })).status).toBe(400);
});

test("cosmetic template-only → in-place update, no new row, no LLM", async () => {
  const res = await POST(makeReq({ template: "one-pager" }), { params });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body).toEqual({ ok: true, id: "d1", inPlace: true });
  expect(scenario.lastUpdate).toEqual({ template: "one-pager" });
  expect(scenario.lastAssembleOpts).toBeNull(); // never assembled
});

test("cosmetic branding-only → in-place update", async () => {
  const res = await POST(makeReq({ branding: { primary_color: "#0a0" } }), { params });
  expect(res.status).toBe(200);
  expect(scenario.lastUpdate).toEqual({ branding: { primary_color: "#0a0" } });
  expect(scenario.lastAssembleOpts).toBeNull();
});

test("cosmetic update failure → 500", async () => {
  scenario.updateError = { message: "boom" };
  expect((await POST(makeReq({ template: "bov-lite" }), { params })).status).toBe(500);
});

test("content edit (new items) → forks a new version with supersedes_id", async () => {
  const items = [{ id: "i1", added_at: "x", origin: "web", kind: "note", text: "hi" }];
  const res = await POST(makeReq({ items }), { params });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ id: "new-slug", inPlace: false });
  expect(scenario.lastAssembleOpts?.supersedesId).toBe("d1");
  expect(scenario.lastAssembleOpts?.items).toEqual(items);
  expect(scenario.lastUpdate).toBeNull(); // not in-place
});

test("content edit (instruction only) → forks, regenerates, inherits items via fallback", async () => {
  const res = await POST(makeReq({ instruction: "lead with rents" }), { params });
  expect(res.status).toBe(200);
  expect(scenario.lastAssembleOpts?.instruction).toBe("lead with rents");
  expect(scenario.lastAssembleOpts?.items).toEqual([{ id: "i1" }]); // snapshot fallback
});

test("content edit merges a template override onto the fork", async () => {
  const items = [{ id: "i1", added_at: "x", origin: "web", kind: "note", text: "hi" }];
  await POST(makeReq({ items, template: "bov-lite" }), { params });
  expect(scenario.lastAssembleOpts?.template).toBe("bov-lite");
});

test("client may include their OWN file item", async () => {
  const items = [
    {
      id: "f1",
      added_at: "x",
      origin: "web",
      kind: "file",
      storage_path: "user-a/p/x.pdf",
      mime: "application/pdf",
      size: 1,
    },
  ];
  const res = await POST(makeReq({ items }), { params });
  expect(res.status).toBe(200);
  expect(scenario.lastAssembleOpts?.items).toEqual(items);
});

test("a FOREIGN file item is rejected (cross-user storage boundary) → 400", async () => {
  const items = [
    {
      id: "f1",
      added_at: "x",
      origin: "web",
      kind: "file",
      storage_path: "victim-uid/p/x.pdf",
      mime: "application/pdf",
      size: 1,
    },
  ];
  const res = await POST(makeReq({ items }), { params });
  expect(res.status).toBe(400);
  expect(scenario.lastAssembleOpts).toBeNull(); // never assembled
});

test("switching a deliverable's template TO email is rejected → 400", async () => {
  const res = await POST(makeReq({ template: "email" }), { params });
  expect(res.status).toBe(400);
  expect(scenario.lastUpdate).toBeNull();
});

test("changing an email deliverable's template in place is rejected → 400", async () => {
  scenario.deliverable = { ...baseDeliverable, template: "email" };
  const res = await POST(makeReq({ template: "market-overview" }), { params });
  expect(res.status).toBe(400);
  expect(scenario.lastUpdate).toBeNull();
});
