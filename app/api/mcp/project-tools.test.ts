import { test, expect, mock, beforeEach } from "bun:test";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/**
 * Session 9 — the capability-keyed project write tools.
 *
 * The security core: (1) the key is read ONLY from the `X-Project-Key` header —
 * never a tool arg, so it can't leak into a call log; (2) the write target is
 * derived SOLELY from the key→project lookup (LB-R6b), so no payload field can
 * redirect it. These tests drive the tool handlers over a fake service-role
 * client, passing the key the way the real transport does — via `extra`.
 */

// --- shared fake service-role client state --------------------------------
const seeded = new Map<string, unknown>();
let inserts: { table: string; row: Record<string, unknown> }[] = [];
let updates: {
  table: string;
  filters: Record<string, unknown>;
  payload: Record<string, unknown>;
}[] = [];

function fakeDb() {
  function qb(table: string) {
    const state: {
      op: string | null;
      payload: Record<string, unknown> | null;
      filters: Record<string, unknown>;
    } = {
      op: null,
      payload: null,
      filters: {},
    };
    const builder: Record<string, (...a: unknown[]) => unknown> = {
      select() {
        state.op = "select";
        return builder;
      },
      insert(row: unknown) {
        inserts.push({ table, row: row as Record<string, unknown> });
        return Promise.resolve({ error: null });
      },
      update(payload: unknown) {
        state.op = "update";
        state.payload = payload as Record<string, unknown>;
        return builder;
      },
      eq(col: unknown, val: unknown) {
        state.filters[col as string] = val;
        if (state.op === "update") {
          updates.push({ table, filters: { ...state.filters }, payload: state.payload! });
          return Promise.resolve({ error: null });
        }
        return builder;
      },
      in() {
        return Promise.resolve({ data: [] });
      },
      maybeSingle() {
        if (table === "projects" && state.op === "select") {
          return Promise.resolve({
            data: seeded.get(state.filters["mcp_key"] as string) ?? null,
            error: null,
          });
        }
        return Promise.resolve({ data: null, error: null });
      },
    };
    return builder;
  }
  return { from: (t: string) => qb(t) };
}

mock.module("@/utils/supabase/service-role", () => ({
  createServiceRoleClient: () => fakeDb(),
}));

// Stub the LLM assembly so build is deterministic + offline (no model call,
// no saved_charts read). assemble.ts imports these from the same module.
mock.module("@/lib/deliverable/build", () => ({
  buildDeliverableNarrative: async () => ({
    narrative: { exec_summary: "", sections: [], inference_notes: [] },
    regenerations: 0,
    stripped: false,
  }),
  freezeSnapshot: async (_db: unknown, items: unknown[]) => items,
}));

const { registerProjectTools, keyFromHeader, isDuplicateItem, resolveProjectByKey } =
  await import("./project-tools");

type Handler = (
  args: Record<string, unknown>,
  extra?: unknown,
) => Promise<{
  content: { type: string; text: string }[];
  isError?: boolean;
}>;

function tools(): Record<string, Handler> {
  const map: Record<string, Handler> = {};
  const fake = {
    registerTool(name: string, _c: unknown, cb: Handler) {
      map[name] = cb;
    },
  } as unknown as McpServer;
  registerProjectTools(fake);
  return map;
}

/** The `extra` the transport hands a tool handler, carrying the key header. */
const hdr = (key: string) => ({ requestInfo: { headers: { "x-project-key": key } } });

const project = (over: Record<string, unknown> = {}) => ({
  id: "p1",
  user_id: "u1",
  title: "Test Project",
  items: [],
  branding: null,
  ...over,
});

const metric = (over: Record<string, unknown> = {}) => ({
  kind: "metric",
  id: "m0",
  added_at: "2026-06-10T00:00:00Z",
  origin: "mcp",
  report_id: "housing-swfl",
  label: "Median sale price",
  value: "$500,000",
  freshness_token: "SWFL-7421-v1-20260610",
  ...over,
});

beforeEach(() => {
  seeded.clear();
  inserts = [];
  updates = [];
});

// --- keyFromHeader (pure) — header-only, never an arg ---------------------

test("keyFromHeader: reads the X-Project-Key header", () => {
  expect(keyFromHeader({ requestInfo: { headers: { "x-project-key": "proj_abc" } } })).toBe(
    "proj_abc",
  );
});

test("keyFromHeader: null when the header is absent (no arg path exists)", () => {
  expect(keyFromHeader(undefined)).toBeNull();
  expect(keyFromHeader({ requestInfo: { headers: {} } })).toBeNull();
});

test("keyFromHeader: tolerates an array-valued header + trims", () => {
  expect(keyFromHeader({ requestInfo: { headers: { "x-project-key": [" proj_abc "] } } })).toBe(
    "proj_abc",
  );
});

// --- isDuplicateItem (pure) -----------------------------------------------

test("isDuplicateItem: same (report_id,label,value) metric is a duplicate", () => {
  expect(isDuplicateItem([metric()] as never, metric({ id: "m1" }) as never)).toBe(true);
});

test("isDuplicateItem: a changed value is NOT a duplicate", () => {
  expect(
    isDuplicateItem([metric()] as never, metric({ id: "m1", value: "$600,000" }) as never),
  ).toBe(false);
});

test("isDuplicateItem: notes dedupe by text, reports by slug", () => {
  const note = { kind: "note", id: "n0", added_at: "t", origin: "mcp", text: "same" };
  expect(isDuplicateItem([note] as never, { ...note, id: "n1" } as never)).toBe(true);
  const rep = { kind: "report", id: "r0", added_at: "t", origin: "mcp", slug: "housing-swfl" };
  expect(isDuplicateItem([rep] as never, { ...rep, id: "r1" } as never)).toBe(true);
});

// --- resolveProjectByKey (mocked db) --------------------------------------

test("resolveProjectByKey: null key short-circuits (no query, no match)", async () => {
  expect(await resolveProjectByKey(fakeDb() as never, null)).toBeNull();
});

test("resolveProjectByKey: unknown key → null", async () => {
  expect(await resolveProjectByKey(fakeDb() as never, "proj_nope")).toBeNull();
});

test("resolveProjectByKey: known key → its project", async () => {
  seeded.set("proj_abc", project());
  const r = await resolveProjectByKey(fakeDb() as never, "proj_abc");
  expect(r?.id).toBe("p1");
});

// --- swfl_project_add -----------------------------------------------------

test("swfl_project_add: files a note with origin:'mcp' onto the resolved project", async () => {
  seeded.set("proj_abc", project());
  const res = await tools().swfl_project_add(
    { item: { kind: "note", text: "hello" } },
    hdr("proj_abc"),
  );
  expect(res.isError).toBeFalsy();
  const projUpdate = updates.find((u) => u.table === "projects");
  expect(projUpdate?.filters.id).toBe("p1");
  const written = projUpdate?.payload.items as Record<string, unknown>[];
  expect(written).toHaveLength(1);
  expect(written[0].origin).toBe("mcp");
  expect(written[0].kind).toBe("note");
});

test("swfl_project_add: [LB-R6b] a smuggled project_id is ignored — write lands ONLY on the key's project", async () => {
  seeded.set("proj_X", project({ id: "projectX", user_id: "u1" }));
  seeded.set("proj_Y", project({ id: "projectY", user_id: "u2" }));
  const res = await tools().swfl_project_add(
    // attacker attempts to redirect the write to projectY via the payload
    { item: { kind: "note", text: "hi", project_id: "projectY" } },
    hdr("proj_X"),
  );
  expect(res.isError).toBeFalsy();
  const targets = updates.filter((u) => u.table === "projects").map((u) => u.filters.id);
  expect(targets).toEqual(["projectX"]); // only X — never Y
  // and the smuggled field never persists on the item
  const item = (
    updates.find((u) => u.table === "projects")!.payload.items as Record<string, unknown>[]
  )[0];
  expect("project_id" in item).toBe(false);
});

test("swfl_project_add: NO header → distinct NO_KEY error, no write", async () => {
  seeded.set("proj_abc", project());
  const res = await tools().swfl_project_add({ item: { kind: "note", text: "x" } }, undefined);
  expect(res.isError).toBe(true);
  expect(res.content[0].text).toContain("X-Project-Key");
  expect(updates).toHaveLength(0);
  expect(inserts).toHaveLength(0);
});

test("swfl_project_add: bad/expired key → clean error, NO write", async () => {
  const res = await tools().swfl_project_add(
    { item: { kind: "note", text: "x" } },
    hdr("proj_nope"),
  );
  expect(res.isError).toBe(true);
  expect(res.content[0].text.toLowerCase()).toContain("invalid");
  expect(updates).toHaveLength(0);
  expect(inserts).toHaveLength(0);
});

test("swfl_project_add: dedupe drops a second identical metric (one item, no write)", async () => {
  seeded.set("proj_abc", project({ items: [metric()] }));
  const res = await tools().swfl_project_add(
    {
      item: {
        kind: "metric",
        report_id: "housing-swfl",
        label: "Median sale price",
        value: "$500,000",
        freshness_token: "SWFL-7421-v1-20260610",
      },
    },
    hdr("proj_abc"),
  );
  expect(res.isError).toBeFalsy();
  expect(res.content[0].text.toLowerCase()).toContain("already filed");
  expect(updates.filter((u) => u.table === "projects")).toHaveLength(0);
});

test("swfl_project_add: chart_block → lint → saves chart → files a {kind:'chart'} ref", async () => {
  seeded.set("proj_abc", project());
  const block = {
    title: "Asking Rent",
    columns: ["Period", "Rent"],
    rows: [
      ["Q1", 1850],
      ["Q2", 1920],
    ],
    chart_type: "area",
  };
  const res = await tools().swfl_project_add(
    { item: { kind: "chart_block", block, title: "Rent chart" } },
    hdr("proj_abc"),
  );
  expect(res.isError).toBeFalsy();
  expect(inserts.filter((i) => i.table === "saved_charts")).toHaveLength(1);
  const item = (
    updates.find((u) => u.table === "projects")!.payload.items as Record<string, unknown>[]
  )[0];
  expect(item.kind).toBe("chart");
  expect(item.origin).toBe("mcp");
  expect(typeof item.chart_id).toBe("string");
});

// --- swfl_project_list ----------------------------------------------------

test("swfl_project_list: returns title + condensed items", async () => {
  seeded.set(
    "proj_abc",
    project({
      title: "My Project",
      items: [{ kind: "note", id: "n1", added_at: "t", origin: "mcp", text: "hello world" }],
    }),
  );
  const res = await tools().swfl_project_list({}, hdr("proj_abc"));
  expect(res.isError).toBeFalsy();
  expect(res.content[0].text).toContain("My Project");
  expect(res.content[0].text).toContain("hello world");
});

test("swfl_project_list: no header → NO_KEY error", async () => {
  const res = await tools().swfl_project_list({}, undefined);
  expect(res.isError).toBe(true);
  expect(res.content[0].text).toContain("X-Project-Key");
});

// --- swfl_project_build ---------------------------------------------------

test("swfl_project_build: happy path returns a /p/ share URL + inserts a deliverable", async () => {
  seeded.set(
    "proj_abc",
    project({ items: [{ kind: "note", id: "n1", added_at: "t", origin: "mcp", text: "hi" }] }),
  );
  const res = await tools().swfl_project_build({ template: "one-pager" }, hdr("proj_abc"));
  expect(res.isError).toBeFalsy();
  expect(res.content[0].text).toMatch(/\/p\/[A-Za-z0-9_-]+/);
  expect(inserts.filter((i) => i.table === "deliverables")).toHaveLength(1);
});

test("swfl_project_build: bad key → error, no deliverable written", async () => {
  const res = await tools().swfl_project_build({ template: "one-pager" }, hdr("proj_nope"));
  expect(res.isError).toBe(true);
  expect(inserts.filter((i) => i.table === "deliverables")).toHaveLength(0);
});
