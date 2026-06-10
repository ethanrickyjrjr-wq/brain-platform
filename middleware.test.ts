import { test, expect, mock, beforeEach } from "bun:test";
import { NextResponse, NextRequest } from "next/server";

// The gate reads `user` from updateSession — mock it so we can flip auth state.
const scenario: { user: { id: string } | null } = { user: null };
mock.module("@/utils/supabase/middleware", () => ({
  updateSession: async () => ({ response: NextResponse.next(), user: scenario.user }),
}));

const { middleware } = await import("./middleware");

function req(path: string) {
  return new NextRequest(`http://localhost${path}`);
}

beforeEach(() => {
  scenario.user = null;
});

test("public /r/master passes through untouched (no redirect)", async () => {
  const res = await middleware(req("/r/master"));
  expect(res.headers.get("location")).toBeNull();
  expect(res.status).toBe(200);
});

test("/project/abc unauthenticated → 307 to /login?next=/project/abc", async () => {
  const res = await middleware(req("/project/abc"));
  expect(res.status).toBe(307);
  const loc = res.headers.get("location") ?? "";
  expect(loc).toContain("/login");
  expect(loc).toContain("next=%2Fproject%2Fabc");
});

test("/project list unauthenticated → redirect with next=/project", async () => {
  const res = await middleware(req("/project"));
  expect(res.status).toBe(307);
  expect(res.headers.get("location") ?? "").toContain("next=%2Fproject");
});

test("/project/draft is gated like any /project path (dead carve-out removed)", async () => {
  const res = await middleware(req("/project/draft"));
  expect(res.status).toBe(307);
  expect(res.headers.get("location") ?? "").toContain("next=%2Fproject%2Fdraft");
});

test("/project/abc authenticated → passes through (no redirect)", async () => {
  scenario.user = { id: "u1" };
  const res = await middleware(req("/project/abc"));
  expect(res.headers.get("location")).toBeNull();
  expect(res.status).toBe(200);
});

test("/api/projects is NOT gated by the prefix (self-gates with 401)", async () => {
  const res = await middleware(req("/api/projects"));
  expect(res.headers.get("location")).toBeNull();
  expect(res.status).toBe(200);
});
