import { test, expect, mock, beforeEach } from "bun:test";

// PostgREST builders are chainable AND awaitable (thenable → { count }). This mock
// returns a per-table count so we can drive the two existence checks.
const scenario = { projectCount: 0, mcpEventCount: 0 };

function builder(getResult: () => { count: number }) {
  const b: Record<string, unknown> = {};
  b.select = () => b;
  b.eq = () => b;
  b.not = () => b;
  b.then = (resolve: (v: { count: number }) => unknown) => resolve(getResult());
  return b;
}

mock.module("@/utils/supabase/service-role", () => ({
  createServiceRoleClient: () => ({
    from: (table: string) =>
      builder(() =>
        table === "projects" ? { count: scenario.projectCount } : { count: scenario.mcpEventCount },
      ),
  }),
}));

const { isMcpConnected } = await import("./mcp-connected");

beforeEach(() => {
  scenario.projectCount = 0;
  scenario.mcpEventCount = 0;
});

test("mcp_key project + mcp:<uid> usage row → true", async () => {
  scenario.projectCount = 1;
  scenario.mcpEventCount = 3;
  expect(await isMcpConnected("uid-1")).toBe(true);
});

test("web-only account (no mcp_key project) → false", async () => {
  scenario.projectCount = 0;
  scenario.mcpEventCount = 0;
  expect(await isMcpConnected("uid-1")).toBe(false);
});

test("wired but never built (mcp_key but no mcp:<uid> row) → false", async () => {
  scenario.projectCount = 1;
  scenario.mcpEventCount = 0;
  expect(await isMcpConnected("uid-1")).toBe(false);
});

test("empty authUid → false (no lookup)", async () => {
  expect(await isMcpConnected("")).toBe(false);
});
