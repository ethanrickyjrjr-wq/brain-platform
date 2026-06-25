import { test, expect, mock } from "bun:test";

const mockDelete = mock(() => ({ error: null }));
const mockGetUser = mock(() => ({ data: { user: { id: "uid-1" } }, error: null }));
const mockConn = { id: "conn-1", user_id: "uid-1", board_slug: "swfl_mls" };
const mockSingle = mock(() => ({ data: mockConn, error: null }));
const mockSupabase = {
  auth: { getUser: mockGetUser },
  from: () => ({
    select: () => ({ eq: () => ({ eq: () => ({ single: mockSingle }) }) }),
    delete: () => ({ eq: () => ({ error: null }) }),
  }),
  schema: () => ({ from: () => ({ delete: () => ({ eq: () => ({ eq: () => mockDelete() }) }) }) }),
};
mock.module("@/utils/supabase/server", () => ({ createClient: () => mockSupabase }));
mock.module("@/utils/supabase/service-role", () => ({
  createServiceRoleClient: () => mockSupabase,
}));
mock.module("next/headers", () => ({ cookies: async () => ({}) }));

test("DELETE removes connection and returns ok", async () => {
  const { DELETE } = await import("./route");
  const req = new Request("http://localhost/api/mls/disconnect", {
    method: "DELETE",
    headers: { Authorization: "Bearer jwt", "Content-Type": "application/json" },
    body: JSON.stringify({ connection_id: "conn-1" }),
  });
  const res = await DELETE(req);
  const body = await res.json();
  expect(res.status).toBe(200);
  expect(body.ok).toBe(true);
});
