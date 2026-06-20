/**
 * Disconnect route: calls revokeToken (build 03 seam) and auto-pauses ONLY this
 * platform's active schedules (U-D3). revokeToken is a spy; the schedules update
 * runs against a chainable mock so we assert the exact filter set.
 */
import { test, expect, mock, beforeEach } from "bun:test";
import { NextRequest } from "next/server";

const captured: {
  revokeArgs?: unknown[];
  updateVal?: unknown;
  eqs: [string, unknown][];
  table?: string;
} = {
  eqs: [],
};
const scenario: {
  user: { id: string } | null;
  pausedRows: { id: number }[];
  updateError: { message: string } | null;
} = { user: { id: "user-a" }, pausedRows: [{ id: 1 }, { id: 2 }], updateError: null };

mock.module("@/lib/social/oauth-tokens", () => ({
  revokeToken: async (...args: unknown[]) => {
    captured.revokeArgs = args;
    return { revokedRows: 1 };
  },
  storeTokens: async () => {},
}));
mock.module("@/utils/supabase/server", () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: scenario.user } }) },
    from: (table: string) => {
      captured.table = table;
      const chain = {
        update(v: unknown) {
          captured.updateVal = v;
          return chain;
        },
        eq(col: string, val: unknown) {
          captured.eqs.push([col, val]);
          return chain;
        },
        select: async () => ({
          data: scenario.updateError ? null : scenario.pausedRows,
          error: scenario.updateError,
        }),
      };
      return chain;
    },
  }),
}));
mock.module("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, getAll: () => [] }),
}));

const { POST } = await import("./route");

function req(platform = "x") {
  return new NextRequest(`https://www.swfldatagulf.com/api/social/connect/${platform}/disconnect`, {
    method: "POST",
  });
}

beforeEach(() => {
  scenario.user = { id: "user-a" };
  scenario.pausedRows = [{ id: 1 }, { id: 2 }];
  scenario.updateError = null;
  captured.revokeArgs = undefined;
  captured.updateVal = undefined;
  captured.eqs = [];
  captured.table = undefined;
});

test("unauthenticated → 401", async () => {
  scenario.user = null;
  const res = await POST(req(), { params: Promise.resolve({ platform: "x" }) });
  expect(res.status).toBe(401);
});

test("unknown platform → 404", async () => {
  const res = await POST(req("bluesky"), { params: Promise.resolve({ platform: "bluesky" }) });
  expect(res.status).toBe(404);
});

test("revokes + pauses ONLY this platform's active schedules", async () => {
  const res = await POST(req("x"), { params: Promise.resolve({ platform: "x" }) });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true, paused_count: 2 });

  // revokeToken(db, userId, platform)
  expect(captured.revokeArgs?.[1]).toBe("user-a");
  expect(captured.revokeArgs?.[2]).toBe("x");

  // schedules update scoped to user + platform + active
  expect(captured.table).toBe("social_schedules");
  expect(captured.updateVal).toMatchObject({ status: "paused" });
  expect(captured.eqs).toContainEqual(["user_id", "user-a"]);
  expect(captured.eqs).toContainEqual(["platform", "x"]);
  expect(captured.eqs).toContainEqual(["status", "active"]);
});

test("schedules update DB error → 500", async () => {
  scenario.updateError = { message: "db fail" };
  const res = await POST(req("x"), { params: Promise.resolve({ platform: "x" }) });
  expect(res.status).toBe(500);
});
