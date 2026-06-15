import { test, expect, mock, beforeEach } from "bun:test";

const FIXED_ID = "abc123abc123"; // deterministicProjectId(token), stubbed

const scenario: {
  user: { id: string } | null;
  insertError: { code?: string } | null;
} = { user: { id: "user-a" }, insertError: null };

let inserts: Record<string, unknown>[] = [];

// consumeClaimToken is stubbed per-test; default = a fresh winner.
type Consume = () => Promise<
  | { status: "won"; items: unknown[]; title: string | null }
  | { status: "consumed" }
  | { status: "expired" }
  | { status: "missing" }
>;
let consumeImpl: Consume = async () => ({
  status: "won",
  items: [validItem],
  title: "Carried",
});

mock.module("@/utils/supabase/server", () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: scenario.user } }) },
    from: () => ({
      insert: async (row: Record<string, unknown>) => {
        inserts.push(row);
        return { error: scenario.insertError };
      },
    }),
  }),
}));
mock.module("next/headers", () => ({ cookies: async () => ({}) }));
// Do NOT mock @/lib/highlighter/meter: a partial meter mock would strip
// recordUseForClient (which project-tools.ts imports) when test files share a
// process. Instead mock the single-export service-role client so the real
// recordUse()'s usage_events write no-ops without a live DB hit.
mock.module("@/utils/supabase/service-role", () => ({
  createServiceRoleClient: () => ({ from: () => ({ insert: async () => ({ error: null }) }) }),
}));
mock.module("@/lib/claim/claim-store", () => ({
  consumeClaimToken: () => consumeImpl(),
  attachProjectId: async () => {},
  deterministicProjectId: () => FIXED_ID,
}));

const { POST } = await import("./route");

function makeReq(body: unknown) {
  return new Request("http://localhost/api/claim", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as import("next/server").NextRequest;
}

const validItem = {
  id: "i1",
  added_at: "2026-06-10T00:00:00Z",
  origin: "mcp",
  kind: "note",
  text: "hello",
};

beforeEach(() => {
  scenario.user = { id: "user-a" };
  scenario.insertError = null;
  inserts = [];
  consumeImpl = async () => ({ status: "won", items: [validItem], title: "Carried" });
});

test("missing token → 400", async () => {
  const res = await POST(makeReq({}));
  expect(res.status).toBe(400);
});

test("logged out → 401 (no consume attempted)", async () => {
  scenario.user = null;
  const res = await POST(makeReq({ token: "t1" }));
  expect(res.status).toBe(401);
});

test("won → 200, inserts under auth.uid at the deterministic id", async () => {
  const res = await POST(makeReq({ token: "t1" }));
  expect(res.status).toBe(200);
  expect((await res.json()).id).toBe(FIXED_ID);
  expect(inserts).toHaveLength(1);
  expect(inserts[0].id).toBe(FIXED_ID);
  expect(inserts[0].user_id).toBe("user-a");
  expect(inserts[0].title).toBe("Carried");
  expect(inserts[0].items).toEqual([validItem]);
});

test("consumed (loser/replay) → 200 same id, NO insert", async () => {
  consumeImpl = async () => ({ status: "consumed" });
  const res = await POST(makeReq({ token: "t1" }));
  expect(res.status).toBe(200);
  expect((await res.json()).id).toBe(FIXED_ID);
  expect(inserts).toHaveLength(0);
});

test("expired → 410 claim_link_expired", async () => {
  consumeImpl = async () => ({ status: "expired" });
  const res = await POST(makeReq({ token: "t1" }));
  expect(res.status).toBe(410);
  expect((await res.json()).error).toBe("claim_link_expired");
});

test("missing token row → 410", async () => {
  consumeImpl = async () => ({ status: "missing" });
  const res = await POST(makeReq({ token: "t1" }));
  expect(res.status).toBe(410);
});

test("won but items fail schema → 422, no insert", async () => {
  consumeImpl = async () => ({ status: "won", items: [{ kind: "note" }], title: null });
  const res = await POST(makeReq({ token: "t1" }));
  expect(res.status).toBe(422);
  expect(inserts).toHaveLength(0);
});

test("unique-violation (23505) on insert → idempotent 200", async () => {
  scenario.insertError = { code: "23505" };
  const res = await POST(makeReq({ token: "t1" }));
  expect(res.status).toBe(200);
  expect((await res.json()).id).toBe(FIXED_ID);
});

test("real insert error (not 23505) → 500", async () => {
  scenario.insertError = { code: "55000" };
  const res = await POST(makeReq({ token: "t1" }));
  expect(res.status).toBe(500);
});

test("two simultaneous claims → one insert, both responses same id", async () => {
  let won = 0;
  consumeImpl = async () => {
    if (won === 0) {
      won++;
      return { status: "won", items: [validItem], title: "Carried" };
    }
    return { status: "consumed" };
  };
  const [r1, r2] = await Promise.all([
    POST(makeReq({ token: "t1" })),
    POST(makeReq({ token: "t1" })),
  ]);
  const ids = [(await r1.json()).id, (await r2.json()).id];
  expect(ids).toEqual([FIXED_ID, FIXED_ID]);
  expect(inserts).toHaveLength(1); // exactly one row created
});
