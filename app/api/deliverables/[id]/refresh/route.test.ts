import { test, expect, mock, beforeEach } from "bun:test";

interface Scenario {
  user: { id: string } | null;
  deliverable: Record<string, unknown> | null;
  project: { items: unknown } | null;
  assembleResult: { id: string };
  assembleThrows: unknown;
  lastAssembleOpts: Record<string, unknown> | null;
}
const scenario: Scenario = {
  user: null,
  deliverable: null,
  project: null,
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
mock.module("@/utils/supabase/service-role", () => ({ createServiceRoleClient: () => ({}) }));
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
const { DeliverableError } = await import("@/lib/deliverable/assemble");

const makeReq = () =>
  new Request("http://localhost/api/deliverables/d1/refresh", {
    method: "POST",
  }) as import("next/server").NextRequest;
const params = Promise.resolve({ id: "d1" });

const baseDeliverable = {
  user_id: "user-a",
  project_id: "proj-1",
  template: "market-overview",
  instruction: "summary",
  branding: { name: "Acme" },
  items_snapshot: [{ id: "i1" }, { id: "i2" }],
  scope_kind: null,
  scope_value: null,
  deleted_at: null,
};

beforeEach(() => {
  scenario.user = { id: "user-a" };
  scenario.deliverable = { ...baseDeliverable };
  scenario.project = { items: [] }; // empty → falls back to the snapshot
  scenario.assembleResult = { id: "new-slug" };
  scenario.assembleThrows = null;
  scenario.lastAssembleOpts = null;
});

test("unauthenticated → 401", async () => {
  scenario.user = null;
  expect((await POST(makeReq(), { params })).status).toBe(401);
});

test("not found → 404", async () => {
  scenario.deliverable = null;
  expect((await POST(makeReq(), { params })).status).toBe(404);
});

test("not owner → 403", async () => {
  scenario.deliverable = { ...baseDeliverable, user_id: "other" };
  expect((await POST(makeReq(), { params })).status).toBe(403);
});

test("trashed source → 409", async () => {
  scenario.deliverable = { ...baseDeliverable, deleted_at: "2026-06-17T00:00:00Z" };
  expect((await POST(makeReq(), { params })).status).toBe(409);
});

test("corrupted template → 422", async () => {
  scenario.deliverable = { ...baseDeliverable, template: "garbage" };
  expect((await POST(makeReq(), { params })).status).toBe(422);
});

test("forks a new version with supersedes_id = source id, inheriting template/scope", async () => {
  const res = await POST(makeReq(), { params });
  expect(res.status).toBe(200);
  expect((await res.json()).id).toBe("new-slug");
  expect(scenario.lastAssembleOpts?.supersedesId).toBe("d1");
  expect(scenario.lastAssembleOpts?.projectId).toBe("proj-1");
  expect(scenario.lastAssembleOpts?.template).toBe("market-overview");
  expect(scenario.lastAssembleOpts?.ownerId).toBe("user-a");
});

test("falls back to the frozen snapshot when the project holds none of the items", async () => {
  await POST(makeReq(), { params });
  expect(scenario.lastAssembleOpts?.items).toEqual([{ id: "i1" }, { id: "i2" }]);
});

test("uses the project's live items when they match the snapshot (frame params intact)", async () => {
  scenario.project = {
    items: [
      { id: "i1", added_at: "x", origin: "web", kind: "note", text: "live1" },
      { id: "i2", added_at: "x", origin: "web", kind: "note", text: "live2" },
    ],
  };
  await POST(makeReq(), { params });
  expect((scenario.lastAssembleOpts?.items as { text: string }[]).map((i) => i.text)).toEqual([
    "live1",
    "live2",
  ]);
});

test("DeliverableError maps to its status", async () => {
  scenario.assembleThrows = new DeliverableError("project items invalid", 422);
  expect((await POST(makeReq(), { params })).status).toBe(422);
});
