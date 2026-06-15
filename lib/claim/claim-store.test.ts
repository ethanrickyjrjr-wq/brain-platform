import { test, expect, beforeEach } from "bun:test";

// In-memory stand-in for `claim_tokens`. The mocked rpc flips `consumed_at`
// SYNCHRONOUSLY at call time (no await before the flip), so it models the DB's
// atomic single-statement consume: under Promise.all, the first invocation wins
// and the second sees the flag already set — exactly one winner.
interface Row {
  token: string;
  items: unknown[];
  title: string | null;
  project_id: string | null;
  created_at: string;
  expires_at: string;
  consumed_at: string | null;
}
let store = new Map<string, Row>();

function makeDb() {
  return {
    from() {
      return {
        insert: async (row: Partial<Row>) => {
          store.set(
            row.token as string,
            {
              project_id: null,
              consumed_at: null,
              title: null,
              ...row,
            } as Row,
          );
          return { error: null };
        },
        select() {
          return {
            eq(_col: string, val: string) {
              return {
                maybeSingle: async () => ({ data: store.get(val) ?? null }),
              };
            },
          };
        },
        update(patch: Partial<Row>) {
          return {
            eq: async (_col: string, val: string) => {
              const row = store.get(val);
              if (row) store.set(val, { ...row, ...patch });
              return { error: null };
            },
          };
        },
      };
    },
    rpc: async (_name: string, { p_token }: { p_token: string }) => {
      const row = store.get(p_token);
      if (!row || row.consumed_at) return { data: [], error: null };
      if (new Date(row.expires_at).getTime() <= Date.now()) return { data: [], error: null };
      row.consumed_at = new Date().toISOString(); // atomic flip at call time
      store.set(p_token, row);
      return { data: [{ items: row.items, title: row.title }], error: null };
    },
  };
}

import { mock } from "bun:test";
mock.module("@/utils/supabase/service-role", () => ({
  createServiceRoleClient: () => makeDb(),
}));

const { mintClaimToken, consumeClaimToken, peekClaimToken, deterministicProjectId } =
  await import("./claim-store");

const item = (text: string) => ({
  id: `i-${text}`,
  added_at: "2026-06-15T00:00:00Z",
  origin: "mcp" as const,
  kind: "note" as const,
  text,
});

beforeEach(() => {
  store = new Map();
});

test("mint returns a URL-safe opaque token and stores a row", async () => {
  const token = await mintClaimToken([item("a")], "My carry");
  expect(token).toMatch(/^[A-Za-z0-9_-]+$/); // base64url
  expect(token.length).toBeGreaterThan(20);
  expect(store.get(token)?.title).toBe("My carry");
});

test("consume returns won exactly once, then consumed", async () => {
  const token = await mintClaimToken([item("a"), item("b")], "T");
  const first = await consumeClaimToken(token);
  expect(first.status).toBe("won");
  if (first.status === "won") {
    expect(first.items).toHaveLength(2);
    expect(first.title).toBe("T");
  }
  const second = await consumeClaimToken(token);
  expect(second.status).toBe("consumed");
});

test("expired token (past expires_at) → expired, not consumed", async () => {
  const token = "expired-tok";
  store.set(token, {
    token,
    items: [item("a")],
    title: null,
    project_id: null,
    created_at: "2020-01-01T00:00:00Z",
    expires_at: "2020-01-01T00:15:00Z",
    consumed_at: null,
  });
  expect((await consumeClaimToken(token)).status).toBe("expired");
});

test("unknown token → missing", async () => {
  expect((await consumeClaimToken("nope")).status).toBe("missing");
});

test("peek is non-consuming and returns a summary (distinct kinds, count)", async () => {
  const token = await mintClaimToken([item("a"), item("b")], "Preview");
  const preview = await peekClaimToken(token);
  expect(preview).not.toBeNull();
  expect(preview?.itemCount).toBe(2);
  expect(preview?.kinds).toEqual(["note"]); // distinct
  expect(preview?.expired).toBe(false);
  // still consumable after a peek → peek did NOT touch consumed_at
  expect((await consumeClaimToken(token)).status).toBe("won");
});

test("peek of an expired row reports expired:true", async () => {
  const token = "old";
  store.set(token, {
    token,
    items: [item("a")],
    title: null,
    project_id: null,
    created_at: "2020-01-01T00:00:00Z",
    expires_at: "2020-01-01T00:15:00Z",
    consumed_at: null,
  });
  expect((await peekClaimToken(token))?.expired).toBe(true);
});

test("two simultaneous consumes → exactly one won, one consumed", async () => {
  const token = await mintClaimToken([item("a")], "Race");
  const [r1, r2] = await Promise.all([consumeClaimToken(token), consumeClaimToken(token)]);
  const statuses = [r1.status, r2.status].sort();
  expect(statuses).toEqual(["consumed", "won"]);
});

test("deterministicProjectId is stable, 12 hex chars", () => {
  const token = "some-high-entropy-token";
  const a = deterministicProjectId(token);
  const b = deterministicProjectId(token);
  expect(a).toBe(b);
  expect(a).toHaveLength(12);
  expect(a).toMatch(/^[0-9a-f]{12}$/);
  expect(deterministicProjectId("different")).not.toBe(a);
});
