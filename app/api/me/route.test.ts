import { test, expect, mock, beforeEach } from "bun:test";

// Mutable scenario the mocked cookie client reads — lets each test vary auth.
const scenario: { user: { id: string } | null } = { user: null };

mock.module("@/utils/supabase/server", () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: scenario.user } }) },
  }),
}));
mock.module("next/headers", () => ({ cookies: async () => ({}) }));

const { GET } = await import("./route");

beforeEach(() => {
  scenario.user = null;
});

test("logged-out GET /api/me → { authed: false } and no userId (no PII)", async () => {
  scenario.user = null;
  const res = await GET();
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ authed: false });
});

test("logged-in GET /api/me → { authed: true, userId }", async () => {
  scenario.user = { id: "user-xyz" };
  const res = await GET();
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ authed: true, userId: "user-xyz" });
});
