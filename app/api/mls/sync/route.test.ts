import { test, expect, mock } from "bun:test";

mock.module("@/lib/reso/sync", () => ({
  syncConnection: mock(async () => ({ listings: 3, zips: ["33901"] })),
}));

const mockConn = {
  id: "conn-1",
  user_id: "uid-1",
  board_slug: "swfl_mls",
  member_mls_id: "AGT1",
  last_entity_event_sequence: 100,
};
const mockSingle = mock(() => ({ data: mockConn, error: null }));
const mockGetUser = mock(() => ({ data: { user: { id: "uid-1" } }, error: null }));
const mockSelect = mock(() => ({ data: [mockConn], error: null }));
const mockSupabase = {
  auth: { getUser: mockGetUser },
  from: () => ({
    select: () => ({ eq: () => ({ eq: () => ({ single: mockSingle }) }) }),
    select_all: () => ({ eq: mockSelect }),
    update: () => ({ eq: mock(() => ({})) }),
  }),
};
mock.module("@/utils/supabase/server", () => ({ createClient: () => mockSupabase }));
mock.module("@/utils/supabase/service-role", () => ({
  createServiceRoleClient: () => mockSupabase,
}));
mock.module("next/headers", () => ({ cookies: async () => ({}) }));

test("POST syncs user connection and returns ok", async () => {
  const { POST } = await import("./route");
  const req = new Request("http://localhost/api/mls/sync", {
    method: "POST",
    headers: { Authorization: "Bearer jwt", "Content-Type": "application/json" },
    body: JSON.stringify({ connection_id: "conn-1" }),
  });
  const res = await POST(req);
  const body = await res.json();
  expect(res.status).toBe(200);
  expect(body.ok).toBe(true);
});

test("GET returns 403 without CRON_SECRET", async () => {
  const { GET } = await import("./route");
  const req = new Request("http://localhost/api/mls/sync", { method: "GET" });
  const res = await GET(req);
  expect(res.status).toBe(403);
});
