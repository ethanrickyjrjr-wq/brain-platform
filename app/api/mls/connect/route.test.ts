import { test, expect, mock } from "bun:test";

mock.module("@/lib/reso/boards", () => ({
  getBoardConfig: mock((slug: string) => ({
    slug,
    label: "SWFL MLS",
    baseUrl: "https://sandbox",
    token: "tok",
    live: true,
  })),
}));
mock.module("@/lib/reso/sync", () => ({
  syncConnection: mock(async () => ({ listings: 7, zips: ["33901"] })),
}));

const mockSingle = mock(() => ({
  data: {
    id: "conn-1",
    user_id: "uid-1",
    board_slug: "swfl_mls",
    member_mls_id: "AGT001",
    status: "pending",
    last_entity_event_sequence: null,
  },
  error: null,
}));
const mockGetUser = mock(() => ({ data: { user: { id: "uid-1" } }, error: null }));
const mockSupabase = {
  auth: { getUser: mockGetUser },
  from: () => ({ upsert: () => ({ select: () => ({ single: mockSingle }) }) }),
};
mock.module("@/utils/supabase/server", () => ({ createClient: () => mockSupabase }));
mock.module("@/utils/supabase/service-role", () => ({
  createServiceRoleClient: () => mockSupabase,
}));
mock.module("next/headers", () => ({ cookies: async () => ({}) }));

test("POST returns preview on successful initial sync", async () => {
  const { POST } = await import("./route");
  const req = new Request("http://localhost/api/mls/connect", {
    method: "POST",
    headers: { Authorization: "Bearer jwt", "Content-Type": "application/json" },
    body: JSON.stringify({ board_slug: "swfl_mls", member_mls_id: "AGT001" }),
  });
  const res = await POST(req);
  const body = await res.json();
  expect(res.status).toBe(200);
  expect(body.preview.listing_count).toBe(7);
  expect(body.preview.zips).toEqual(["33901"]);
});

test("POST returns 400 when member_mls_id is missing", async () => {
  const { POST } = await import("./route");
  const req = new Request("http://localhost/api/mls/connect", {
    method: "POST",
    headers: { Authorization: "Bearer jwt", "Content-Type": "application/json" },
    body: JSON.stringify({ board_slug: "swfl_mls" }),
  });
  const res = await POST(req);
  expect(res.status).toBe(400);
});
