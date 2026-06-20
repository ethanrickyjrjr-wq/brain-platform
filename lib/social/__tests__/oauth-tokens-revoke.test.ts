/**
 * revokeToken (build 03 seam added for U1): best-effort platform-side revoke +
 * authoritative local status='revoked' flip. Mocked DB (chainable) + mocked fetch.
 */
import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { encrypt, revokeToken } from "../oauth-tokens";

const realFetch = globalThis.fetch;

beforeEach(() => {
  // 64 hex chars → 32-byte AES key, so encrypt()/decrypt() work in-test.
  process.env.SDG_CRYPTO_KEY = "a".repeat(64);
  process.env.X_CLIENT_ID = "x-id";
  process.env.X_CLIENT_SECRET = "x-secret";
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

function stubFetch() {
  const calls: { url: string; headers: Record<string, string>; body: string }[] = [];
  globalThis.fetch = (async (
    input: unknown,
    init?: { headers?: Record<string, string>; body?: string },
  ) => {
    calls.push({
      url: typeof input === "string" ? input : String(input),
      headers: init?.headers ?? {},
      body: init?.body ?? "",
    });
    return { ok: true, status: 200, json: async () => ({}), text: async () => "" };
  }) as typeof fetch;
  return calls;
}

/** Chainable Supabase stub: `from().select().eq()…` → lookup; `from().update().eq()….select()` → update. */
function makeDb(lookup: unknown, update: unknown) {
  const captured = {
    selEqs: [] as [string, unknown][],
    updVal: undefined as unknown,
    updEqs: [] as [string, unknown][],
  };
  const db = {
    from() {
      return {
        select() {
          const c = {
            eq(col: string, val: unknown) {
              captured.selEqs.push([col, val]);
              return c;
            },
            then(res: (v: unknown) => unknown, rej: (e: unknown) => unknown) {
              return Promise.resolve(lookup).then(res, rej);
            },
          };
          return c;
        },
        update(v: unknown) {
          captured.updVal = v;
          const c = {
            eq(col: string, val: unknown) {
              captured.updEqs.push([col, val]);
              return c;
            },
            select: async () => update,
          };
          return c;
        },
      };
    },
  } as unknown as SupabaseClient;
  return { db, captured };
}

describe("revokeToken", () => {
  it("X: revokes remotely (Basic auth) + flips status, returns revokedRows", async () => {
    const calls = stubFetch();
    const enc = encrypt("x-access-token");
    const { db, captured } = makeDb(
      { data: [{ id: "r1", access_token: enc }], error: null },
      { data: [{ id: "r1" }], error: null },
    );

    const out = await revokeToken(db, "user-a", "x");

    expect(out.revokedRows).toBe(1);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.twitter.com/2/oauth2/revoke");
    expect(calls[0].headers.Authorization).toMatch(/^Basic /);
    // status flip scoped to the user + platform
    expect(captured.updVal).toMatchObject({ status: "revoked" });
    expect(captured.updEqs).toContainEqual(["user_id", "user-a"]);
    expect(captured.updEqs).toContainEqual(["platform", "x"]);
  });

  it("LinkedIn (no revoke endpoint): no remote call, still flips status", async () => {
    const calls = stubFetch();
    const enc = encrypt("li-token");
    const { db } = makeDb(
      { data: [{ id: "r1", access_token: enc }], error: null },
      { data: [{ id: "r1" }], error: null },
    );

    const out = await revokeToken(db, "user-a", "linkedin");

    expect(out.revokedRows).toBe(1);
    expect(calls).toHaveLength(0);
  });

  it("remote revoke failure is NON-FATAL (local flip still happens)", async () => {
    globalThis.fetch = (async () => {
      throw new Error("network down");
    }) as typeof fetch;
    const enc = encrypt("tok");
    const { db } = makeDb(
      { data: [{ id: "r1", access_token: enc }], error: null },
      { data: [{ id: "r1" }], error: null },
    );
    const out = await revokeToken(db, "user-a", "x");
    expect(out.revokedRows).toBe(1);
  });

  it("lookup DB error → throws", async () => {
    const { db } = makeDb({ data: null, error: { message: "boom" } }, { data: [], error: null });
    await expect(revokeToken(db, "user-a", "x")).rejects.toThrow(/revokeToken lookup failed/);
  });
});
